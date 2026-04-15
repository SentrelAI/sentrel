require "rails_helper"

RSpec.describe Email::OutboundSender do
  let(:org) { create_org(email_domain: "acme.com", email_domain_verified: true) }
  let(:agent) { create_agent(org, name: "Sarah", email_signature_md: "--\nSarah\nSDR at Acme") }

  let(:base_payload) do
    {
      org_id: org.id,
      agent_id: agent.id,
      from_address: "sarah@acme.com",
      from_name: "Sarah",
      to: ["bob@example.com"],
      subject: "Q4 Proposal",
      body_text: "Here is the proposal for Q4.",
    }
  end

  let(:ses_response) { double("SES Response", message_id: "ses-msg-123") }
  let(:ses_client) { instance_double(Aws::SES::Client, send_raw_email: ses_response) }

  before do
    allow(SesClient).to receive(:for).and_return(ses_client)
  end

  describe "#call" do
    it "sends email and returns :sent status" do
      with_tenant(org) do
        result = described_class.new(base_payload).call
        expect(result.status).to eq(:sent)
        expect(result.message_id).to be_present
      end
    end

    it "creates a conversation and outbound message" do
      with_tenant(org) do
        expect {
          described_class.new(base_payload).call
        }.to change(Conversation, :count).by(1)
          .and change(Message, :count).by(1)

        msg = Message.last
        expect(msg.role).to eq("assistant")
        expect(msg.direction).to eq("outbound")
        expect(msg.channel).to eq("email")
      end
    end

    it "logs success in audit log" do
      with_tenant(org) do
        described_class.new(base_payload).call
        log = AuditLog.last
        expect(log.action).to eq("email_sent")
        expect(log.status).to eq("success")
      end
    end

    context "BCC recipients" do
      it "passes BCC in destinations array to SES" do
        with_tenant(org) do
          payload = base_payload.merge(
            cc: ["carol@example.com"],
            bcc: ["dave@example.com", "eve@example.com"]
          )

          described_class.new(payload).call

          expect(ses_client).to have_received(:send_raw_email) do |args|
            destinations = args[:destinations]
            expect(destinations).to include("bob@example.com")
            expect(destinations).to include("carol@example.com")
            expect(destinations).to include("dave@example.com")
            expect(destinations).to include("eve@example.com")
            expect(destinations.size).to eq(4)
          end
        end
      end

      it "deduplicates recipients in destinations" do
        with_tenant(org) do
          payload = base_payload.merge(
            cc: ["bob@example.com"],  # same as to
            bcc: ["bob@example.com"]   # same as to
          )

          described_class.new(payload).call

          expect(ses_client).to have_received(:send_raw_email) do |args|
            expect(args[:destinations].size).to eq(1)
            expect(args[:destinations]).to eq(["bob@example.com"])
          end
        end
      end
    end

    context "domain verification" do
      it "fails when domain not verified" do
        org.update!(email_domain_verified: false)
        with_tenant(org) do
          result = described_class.new(base_payload).call
          expect(result.status).to eq(:failed)
          expect(result.error).to match(/not verified/)
        end
      end

      it "fails when from_address domain doesn't match org domain" do
        with_tenant(org) do
          payload = base_payload.merge(from_address: "sarah@other.com")
          result = described_class.new(payload).call
          expect(result.status).to eq(:failed)
          expect(result.error).to match(/not verified/)
        end
      end
    end

    context "suppression" do
      it "returns :suppressed when recipient is on suppression list" do
        with_tenant(org) do
          EmailSuppression.create!(
            organization: org,
            email_address: "bob@example.com",
            reason: "hard_bounce"
          )
          result = described_class.new(base_payload).call
          expect(result.status).to eq(:suppressed)
        end
      end
    end

    context "signature" do
      it "appends agent signature to the MIME body when no sign-off present" do
        with_tenant(org) do
          described_class.new(base_payload).call

          # Verify the raw email sent to SES contains the signature
          expect(ses_client).to have_received(:send_raw_email) do |args|
            raw = args[:raw_message][:data]
            expect(raw).to include("SDR at Acme")
          end
        end
      end

      it "does not double-append when body already has a sign-off" do
        with_tenant(org) do
          payload = base_payload.merge(body_text: "Sounds good.\n\nBest,\nSarah")
          described_class.new(payload).call

          expect(ses_client).to have_received(:send_raw_email) do |args|
            raw = args[:raw_message][:data]
            # Signature should NOT be appended
            expect(raw).not_to include("SDR at Acme")
          end
        end
      end
    end
  end
end
