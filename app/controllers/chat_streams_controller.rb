class ChatStreamsController < ApplicationController
  include ActionController::Live
  before_action :authenticate_user!

  # GET /agents/:agent_id/chat/stream
  # SSE endpoint — browser listens, engine pushes events via Redis
  def show
    response.headers["Content-Type"] = "text/event-stream"
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"

    agent_id = params[:agent_id]
    redis = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))
    channel = "agent-stream-#{agent_id}"

    # Subscribe to Redis pub/sub for this agent's events
    redis.subscribe(channel) do |on|
      on.message do |_ch, message|
        response.stream.write("data: #{message}\n\n")

        # Close stream when done
        parsed = JSON.parse(message) rescue {}
        if parsed["type"] == "done"
          redis.unsubscribe
        end
      end
    end
  rescue ActionController::Live::ClientDisconnected, IOError
    # Client disconnected
  ensure
    redis&.close rescue nil
    response.stream.close rescue nil
  end
end
