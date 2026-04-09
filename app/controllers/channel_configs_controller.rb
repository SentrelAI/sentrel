class ChannelConfigsController < ApplicationController
  before_action :authenticate_user!
  before_action :set_agent

  def index
    render inertia: "channels/index", props: {
      agent: @agent.as_json(only: [:id, :name, :slug]),
      channels: @agent.channel_configs.as_json(only: [:id, :channel_type, :enabled, :config, :status]),
      available_channels: YAML.load_file(Rails.root.join("config/channels.yml")),
      twilio_configured: ENV["TWILIO_ACCOUNT_SID"].present?,
    }
  end

  def create
    config = @agent.channel_configs.build(channel_config_params)
    config.status = "connected"

    # Validate email domain (warn but don't block in dev)
    if config.channel_type == "email"
      address = config.config["address"]
      domain = address&.split("@")&.last
      if current_tenant.email_domain.present? && current_tenant.email_domain != domain
        redirect_back fallback_location: agent_channel_configs_path(@agent),
          alert: "Email must use your org domain @#{current_tenant.email_domain}"
        return
      end
    end

    # Auto-configure Twilio webhook for WhatsApp/SMS
    if config.channel_type.in?(%w[whatsapp sms]) && twilio_client
      phone = config.config["phone_number"]
      begin
        numbers = twilio_client.incoming_phone_numbers.list(phone_number: phone)
        if numbers.empty?
          redirect_back fallback_location: agent_channel_configs_path(@agent),
            alert: "Number #{phone} not found in your Twilio account"
          return
        end
        configure_twilio_webhooks(numbers.first, config.channel_type)
      rescue Twilio::REST::RestError => e
        redirect_back fallback_location: agent_channel_configs_path(@agent),
          alert: "Twilio error: #{e.message}"
        return
      end
    end

    if config.save
      redirect_to agent_channel_configs_path(@agent), notice: "#{config.channel_type.capitalize} connected"
    else
      redirect_back fallback_location: agent_channel_configs_path(@agent), alert: config.errors.full_messages.join(", ")
    end
  end

  def update
    config = @agent.channel_configs.find(params[:id])
    if config.update(channel_config_params)
      redirect_to agent_channel_configs_path(@agent), notice: "Channel updated"
    else
      redirect_back fallback_location: agent_channel_configs_path(@agent), alert: config.errors.full_messages.join(", ")
    end
  end

  def destroy
    config = @agent.channel_configs.find(params[:id])
    config.destroy
    redirect_to agent_channel_configs_path(@agent), notice: "Channel disconnected"
  end

  # GET /agents/:agent_id/channel_configs/twilio_numbers
  def twilio_numbers
    return render json: { error: "Twilio not configured" }, status: :unprocessable_entity unless twilio_client

    numbers = twilio_client.incoming_phone_numbers.list(limit: 50)
    # Find which numbers are already assigned to agents
    assigned = ChannelConfig.where(channel_type: %w[whatsapp sms], enabled: true)
      .pluck(:config).map { |c| c["phone_number"] }.compact

    render json: numbers.map { |n|
      {
        sid: n.sid,
        phone_number: n.phone_number,
        friendly_name: n.friendly_name,
        capabilities: { sms: n.capabilities["sms"], voice: n.capabilities["voice"], mms: n.capabilities["mms"] },
        assigned: assigned.include?(n.phone_number),
      }
    }
  end

  # GET /agents/:agent_id/channel_configs/available_numbers?country=US
  def available_numbers
    return render json: { error: "Twilio not configured" }, status: :unprocessable_entity unless twilio_client

    country = params[:country] || "US"
    begin
      numbers = twilio_client.available_phone_numbers(country).local.list(
        sms_enabled: true,
        limit: 20
      )
      render json: numbers.map { |n|
        {
          phone_number: n.phone_number,
          friendly_name: n.friendly_name,
          locality: n.locality,
          region: n.region,
          capabilities: { sms: n.capabilities["sms"], voice: n.capabilities["voice"], mms: n.capabilities["mms"] },
        }
      }
    rescue Twilio::REST::RestError => e
      render json: { error: e.message }, status: :unprocessable_entity
    end
  end

  # POST /agents/:agent_id/channel_configs/buy_number
  def buy_number
    return render json: { error: "Twilio not configured" }, status: :unprocessable_entity unless twilio_client

    phone = params[:phone_number]
    channel_type = params[:channel_type] || "whatsapp"

    begin
      # Buy the number
      purchased = twilio_client.incoming_phone_numbers.create(phone_number: phone)

      # Auto-configure webhook
      configure_twilio_webhooks(purchased, channel_type)

      # Create channel config
      config = @agent.channel_configs.create!(
        channel_type: channel_type,
        enabled: true,
        status: "connected",
        config: { "phone_number" => purchased.phone_number }
      )

      redirect_to agent_channel_configs_path(@agent), notice: "#{purchased.phone_number} purchased and connected"
    rescue Twilio::REST::RestError => e
      redirect_back fallback_location: agent_channel_configs_path(@agent), alert: "Twilio error: #{e.message}"
    end
  end

  private

  def set_agent
    @agent = current_tenant.agents.find(params[:agent_id])
  end

  def channel_config_params
    params.require(:channel_config).permit(:channel_type, :enabled, config: {})
  end

  def twilio_client
    return nil unless ENV["TWILIO_ACCOUNT_SID"].present? && ENV["TWILIO_AUTH_TOKEN"].present?
    @twilio_client ||= Twilio::REST::Client.new
  end

  def webhook_base_url
    ENV.fetch("WEBHOOK_BASE_URL", request.base_url)
  end

  def configure_twilio_webhooks(number, channel_type)
    case channel_type
    when "whatsapp"
      # WhatsApp webhooks are configured in Twilio Messaging Service, not on the number directly.
      # For sandbox, they're set in the Twilio console. For production, use Messaging Service.
      number.update(
        sms_url: "#{webhook_base_url}/webhooks/whatsapp",
        sms_method: "POST"
      )
    when "sms"
      number.update(
        sms_url: "#{webhook_base_url}/webhooks/sms",
        sms_method: "POST"
      )
    end
  end
end
