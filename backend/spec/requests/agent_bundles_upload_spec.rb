require "rails_helper"
require "rubygems/package"

# The CLI half of `npx agentmanifest deploy`: an unauthenticated multipart
# POST caches a validated bundle, and the returned ?upload= URL lets the
# browser session preview + deploy it.
RSpec.describe "Agent bundle CLI uploads", type: :request do
  let(:org) { create_org(onboarding_completed_at: Time.current) }
  let(:user) { create_user(org) }

  # Test env runs :null_store — uploads need a real (in-memory) cache to
  # survive the upload→preview→deploy handshake.
  let(:cache) { ActiveSupport::Cache::MemoryStore.new }
  before do
    allow(Rails).to receive(:cache).and_return(cache)
    allow(EngineSync).to receive(:trigger) # Redis pub/sub — not under test
    ActsAsTenant.current_tenant = nil
  end

  def tar_gz(files)
    io = StringIO.new
    Zlib::GzipWriter.wrap(io) do |gz|
      Gem::Package::TarWriter.new(gz) do |tar|
        files.each do |path, content|
          tar.add_file_simple(path, 0o644, content.bytesize) { |f| f.write(content) }
        end
      end
    end
    file = Tempfile.new(["bundle", ".tar.gz"])
    file.binmode
    file.write(io.string)
    file.rewind
    Rack::Test::UploadedFile.new(file.path, "application/gzip")
  end

  let(:valid_files) do
    {
      "agent.yaml" => <<~YAML,
        spec: agent-bundle/v1
        name: CLI Test Agent
        role: Tester
      YAML
      "personality.md" => "Calm and methodical.",
    }
  end

  describe "POST /agent_bundles/upload" do
    it "accepts a valid bundle without authentication and returns a wizard URL" do
      post upload_agent_bundles_path, params: { bundle: tar_gz(valid_files) }

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body["name"]).to eq("CLI Test Agent")
      expect(body["url"]).to include("/deploy-agent?upload=#{body['id']}")
      expect(Rails.cache.read("agent_bundles:upload:#{body['id']}")).to include("agent.yaml")
    end

    it "rejects an invalid bundle and caches nothing" do
      post upload_agent_bundles_path, params: { bundle: tar_gz("agent.yaml" => "spec: wrong/v9\nname: X\n") }

      expect(response).to have_http_status(:unprocessable_entity)
      expect(JSON.parse(response.body)["error"]).to include("spec must be")
    end

    it "rejects a request without a bundle file" do
      post upload_agent_bundles_path

      expect(response).to have_http_status(:unprocessable_entity)
      expect(JSON.parse(response.body)["error"]).to include("missing multipart")
    end

    it "rejects a non-gzip payload" do
      file = Tempfile.new(["junk", ".tar.gz"])
      file.write("not a tarball")
      file.rewind
      post upload_agent_bundles_path, params: { bundle: Rack::Test::UploadedFile.new(file.path, "application/gzip") }

      expect(response).to have_http_status(:unprocessable_entity)
      expect(JSON.parse(response.body)["error"]).to include("not a gzip")
    end
  end

  describe "GET /deploy-agent?upload=" do
    before { sign_in user }

    it "previews a cached upload" do
      post upload_agent_bundles_path, params: { bundle: tar_gz(valid_files) }
      token = JSON.parse(response.body)["id"]

      get deploy_agent_path(upload: token)

      expect(response).to have_http_status(:ok)
      expect(response.body).to include("CLI Test Agent")
    end

    it "shows an expiry error for an unknown token" do
      get deploy_agent_path(upload: "nope")

      expect(response).to have_http_status(:ok)
      expect(response.body).to include("Upload expired or not found")
    end
  end

  describe "POST /agent_bundles with upload_id" do
    before { sign_in user }

    it "deploys the cached bundle" do
      post upload_agent_bundles_path, params: { bundle: tar_gz(valid_files) }
      token = JSON.parse(response.body)["id"]

      expect {
        post agent_bundles_path, params: { upload_id: token, save_as_template: "0" }, as: :json
      }.to change { org.agents.count }.by(1)

      expect(response).to have_http_status(:created)
      expect(org.agents.last.name).to eq("CLI Test Agent")
    end

    it "fails with a friendly message when the upload has expired" do
      post agent_bundles_path, params: { upload_id: "expired-token", save_as_template: "0" }, as: :json

      expect(response).to have_http_status(:unprocessable_entity)
      expect(JSON.parse(response.body)["error"]).to include("upload expired")
    end
  end
end
