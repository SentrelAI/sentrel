require "rails_helper"

RSpec.describe "Api::Blobs", type: :request do
  let(:engine_secret) { "test-engine-secret" }

  before do
    allow(ENV).to receive(:fetch).and_call_original
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("ENGINE_API_SECRET").and_return(engine_secret)
    allow(ENV).to receive(:fetch).with("ENGINE_API_SECRET", anything).and_return(engine_secret)
  end

  let(:headers) { { "X-Engine-Secret" => engine_secret } }

  describe "POST /api/blobs" do
    it "uploads a valid file" do
      file = fixture_file_upload(
        Rails.root.join("spec/fixtures/files/test.txt"),
        "text/plain"
      )

      post "/api/blobs", params: { file: file }, headers: headers
      expect(response).to have_http_status(:ok)

      json = JSON.parse(response.body)
      expect(json["signed_id"]).to be_present
      expect(json["filename"]).to eq("test.txt")
      expect(json["content_type"]).to eq("text/plain")
    end

    it "rejects files over size limit" do
      # Create a file that's > MAX_UPLOAD_BYTES
      large_content = "x" * (26 * 1024 * 1024)
      file = Tempfile.new(["large", ".txt"])
      file.write(large_content)
      file.rewind

      upload = Rack::Test::UploadedFile.new(file.path, "text/plain", true, original_filename: "large.txt")
      post "/api/blobs", params: { file: upload }, headers: headers
      expect(response).to have_http_status(:payload_too_large)

      json = JSON.parse(response.body)
      expect(json["error"]).to match(/too large/i)
    ensure
      file&.close
      file&.unlink
    end

    it "rejects blocked extensions" do
      file = Tempfile.new(["malware", ".exe"])
      file.write("MZ")
      file.rewind

      upload = Rack::Test::UploadedFile.new(file.path, "application/octet-stream", true, original_filename: "malware.exe")
      post "/api/blobs", params: { file: upload }, headers: headers
      expect(response).to have_http_status(:unprocessable_entity)

      json = JSON.parse(response.body)
      expect(json["error"]).to match(/\.exe.*not allowed/i)
    ensure
      file&.close
      file&.unlink
    end

    it "rejects disallowed content types" do
      file = Tempfile.new(["script", ".rb"])
      file.write("puts 'hello'")
      file.rewind

      upload = Rack::Test::UploadedFile.new(file.path, "application/x-ruby", true, original_filename: "script.rb")
      post "/api/blobs", params: { file: upload }, headers: headers
      expect(response).to have_http_status(:unprocessable_entity)

      json = JSON.parse(response.body)
      expect(json["error"]).to match(/not allowed/i)
    ensure
      file&.close
      file&.unlink
    end

    it "rejects requests without engine secret" do
      file = fixture_file_upload(
        Rails.root.join("spec/fixtures/files/test.txt"),
        "text/plain"
      )

      post "/api/blobs", params: { file: file }, headers: {}
      expect(response).to have_http_status(:unauthorized)
    end

    Api::BlobsController::BLOCKED_EXTENSIONS.each do |ext|
      it "blocks .#{ext} files" do
        file = Tempfile.new(["bad", ".#{ext}"])
        file.write("x")
        file.rewind

        upload = Rack::Test::UploadedFile.new(file.path, "application/octet-stream", true, original_filename: "bad.#{ext}")
        post "/api/blobs", params: { file: upload }, headers: headers
        expect(response).to have_http_status(:unprocessable_entity)
      ensure
        file&.close
        file&.unlink
      end
    end
  end

  describe "GET /api/blobs/:signed_id" do
    it "downloads a valid blob" do
      blob = ActiveStorage::Blob.create_and_upload!(
        io: StringIO.new("hello world"),
        filename: "hello.txt",
        content_type: "text/plain"
      )

      get "/api/blobs/#{blob.signed_id}"
      expect(response).to have_http_status(:ok)
      expect(response.body).to eq("hello world")
    end

    it "returns 404 for invalid signed_id" do
      get "/api/blobs/invalid-signed-id"
      expect(response).to have_http_status(:not_found)
    end
  end
end
