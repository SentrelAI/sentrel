module TestHelpers
  def create_org(attrs = {})
    Organization.create!({
      name: "Test Org",
      slug: "test-org-#{SecureRandom.hex(4)}",
      email_domain: "test.com",
      email_domain_verified: true,
    }.merge(attrs))
  end

  def create_user(org, attrs = {})
    User.create!({
      organization: org,
      name: "Test User",
      email: "user-#{SecureRandom.hex(4)}@test.com",
      password: "password123",
      role: "owner",
    }.merge(attrs))
  end

  def create_agent(org, attrs = {})
    Agent.create!({
      organization: org,
      name: "Test Agent",
      slug: "test-agent-#{SecureRandom.hex(4)}",
      role: "SDR",
      status: "running",
    }.merge(attrs))
  end

  def create_conversation(agent, attrs = {})
    Conversation.create!({
      organization: agent.organization,
      agent: agent,
      kind: "external",
      contact_identifier: "contact-#{SecureRandom.hex(4)}@test.com",
      status: "active",
    }.merge(attrs))
  end

  def create_message(conversation, attrs = {})
    Message.create!({
      conversation: conversation,
      role: "user",
      content: "Test message",
      direction: "inbound",
      channel: "web",
    }.merge(attrs))
  end

  def with_tenant(org, &block)
    ActsAsTenant.with_tenant(org, &block)
  end
end

RSpec.configure do |config|
  config.include TestHelpers
  config.include ActiveJob::TestHelper

  config.before(:each, type: :job) do
    ActiveJob::Base.queue_adapter = :test
  end
end
