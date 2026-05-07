require "rails_helper"

RSpec.describe IntegrationsController, type: :controller do
  def response_for(klass, code, message, body: "{}")
    response = klass.new("1.1", code, message)
    response.instance_variable_set(:@read, true)
    response.instance_variable_set(:@body, body)
    response
  end

  before do
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("COMPOSIO_API_KEY").and_return("test-composio-key")
  end

  describe "#disconnect_composio_integration" do
    let(:integration) do
      Integration.new(
        organization_id: 123,
        service_name: "apollo",
        scope: "org",
        composio_connection_id: "stored-connection",
      )
    end

    it "deletes the stored connected account id and matching remote ids" do
      deleted_paths = []
      ok = response_for(Net::HTTPOK, "200", "OK", body: { success: true }.to_json)

      allow(controller).to receive(:composio_connection_ids_for)
        .with("org_123", "apollo")
        .and_return(["listed-connection", "stored-connection"])
      allow(controller).to receive(:composio_delete) do |path, api_key|
        deleted_paths << [path, api_key]
        ok
      end

      result = controller.send(:disconnect_composio_integration, integration)

      expect(result).to eq(ok: true, message: "disconnected 2 remote account(s)")
      expect(deleted_paths).to eq([
        ["/api/v3/connected_accounts/stored-connection", "test-composio-key"],
        ["/api/v3/connected_accounts/listed-connection", "test-composio-key"],
      ])
    end

    it "reports failed deletes instead of pretending the integration disconnected" do
      failure = response_for(Net::HTTPBadRequest, "400", "Bad Request", body: "still connected")

      allow(controller).to receive(:composio_connection_ids_for).and_return([])
      allow(controller).to receive(:composio_delete).and_return(failure)

      result = controller.send(:disconnect_composio_integration, integration)

      expect(result[:ok]).to be(false)
      expect(result[:message]).to include("stored-connection HTTP 400")
      expect(result[:message]).to include("still connected")
    end
  end

  describe "#composio_connection_ids_for" do
    it "filters connected accounts by toolkit slug and follows pagination" do
      calls = []
      first_page = response_for(Net::HTTPOK, "200", "OK", body: {
        items: [
          { id: "ca_apollo_1", toolkit: { slug: "apollo" } },
          { id: "ca_gmail_1", toolkit: { slug: "gmail" } },
        ],
        next_cursor: "page-two",
      }.to_json)
      second_page = response_for(Net::HTTPOK, "200", "OK", body: {
        items: [
          { id: "ca_apollo_2", toolkit: { slug: "apollo" } },
        ],
        next_cursor: nil,
      }.to_json)

      allow(controller).to receive(:composio_get) do |path, api_key|
        calls << [path, api_key]
        calls.length == 1 ? first_page : second_page
      end

      ids = controller.send(:composio_connection_ids_for, "org_123", "apollo")

      first_query = URI.encode_www_form(user_ids: ["org_123"].to_json, toolkit_slugs: ["apollo"].to_json, limit: 100)
      second_query = URI.encode_www_form(user_ids: ["org_123"].to_json, toolkit_slugs: ["apollo"].to_json, limit: 100, cursor: "page-two")
      expect(ids).to eq(["ca_apollo_1", "ca_apollo_2"])
      expect(calls).to eq([
        ["/api/v3/connected_accounts?#{first_query}", "test-composio-key"],
        ["/api/v3/connected_accounts?#{second_query}", "test-composio-key"],
      ])
    end
  end
end
