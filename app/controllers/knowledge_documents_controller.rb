class KnowledgeDocumentsController < ApplicationController
  before_action :authenticate_user!
  before_action :set_agent

  # GET /agents/:agent_id/knowledge_documents
  # Lists personal + org-shared docs together so the panel can show both
  # in one view. `scope` on each doc tells the frontend which KB it's in.
  def index
    personal = (engine_get("/rag/documents?agent_id=#{@agent.id}")&.dig("documents") || [])
      .map { |d| d.merge("scope" => "agent") }
    org = (engine_get("/rag/documents?org_id=#{current_tenant.id}")&.dig("documents") || [])
      .map { |d| d.merge("scope" => "org") }
    render inertia: "knowledge/index", props: {
      agent: @agent.as_json(only: [:id, :name, :slug]),
      documents: personal + org,
    }
  end

  # POST /agents/:agent_id/knowledge_documents
  #
  # Three modes × two scopes:
  # - file upload(s): multipart forward to engine /rag/ingest
  # - url:            POST JSON to engine /rag/ingest/url
  # - raw text:       POST JSON to engine /rag/ingest
  #
  # `scope` param selects target: "agent" (default, personal KB) or "org"
  # (shared across every agent in the org). Org scope ingests into
  # agent_data/rag/org-<org_id>.db.
  def create
    files = params[:files] || (params[:file] ? [params[:file]] : [])
    url   = params[:url].presence
    text  = params[:text].presence
    title = params[:title].presence
    scope = params[:scope] == "org" ? "org" : "agent"

    results = []
    errors = []

    files.each do |f|
      next unless f.respond_to?(:tempfile)
      doc_title = title || f.original_filename
      result = engine_upload_file(f, doc_title, scope)
      if result
        results << result
      else
        errors << "Upload failed for #{f.original_filename}"
      end
    end

    scope_field = scope == "org" ? { org_id: current_tenant.id } : { agent_id: @agent.id }

    if url
      result = engine_post_json("/rag/ingest/url", scope_field.merge(
        url: url,
        title: title || url,
      ))
      result ? results << result : errors << "URL ingest failed: #{url}"
    end

    if text
      result = engine_post_json("/rag/ingest", scope_field.merge(
        title: title || "Pasted text",
        source_type: "text",
        content: text,
      ))
      result ? results << result : errors << "Text ingest failed"
    end

    if results.empty? && errors.empty?
      return redirect_to agent_knowledge_documents_path(@agent), alert: "No content provided"
    end

    indexed = results.count { |r| !r["skipped"] }
    total_chunks = results.sum { |r| r["chunk_count"].to_i }
    msg = "Indexed #{indexed} #{scope == "org" ? "org-shared " : ""}document(s), #{total_chunks} chunks total"
    msg += ". Errors: #{errors.join(', ')}" if errors.any?
    redirect_to agent_knowledge_documents_path(@agent), notice: msg
  end

  # DELETE /agents/:agent_id/knowledge_documents/:id[?scope=org]
  def destroy
    scope = params[:scope] == "org" ? "org_id=#{current_tenant.id}" : "agent_id=#{@agent.id}"
    engine_delete("/rag/documents/#{params[:id]}?#{scope}")
    redirect_to agent_knowledge_documents_path(@agent), notice: "Document deleted"
  end

  # POST /agents/:agent_id/knowledge_documents/:id/promote
  # Copy an agent-scoped document (+ chunks + embeddings) into the org KB.
  # Engine dedupes on content_hash, so calling twice is a safe no-op.
  def promote
    result = engine_post_json("/rag/promote", {
      agent_id: @agent.id,
      org_id: current_tenant.id,
      document_id: params[:id].to_i,
    })
    if result.nil?
      redirect_to agent_knowledge_documents_path(@agent), alert: "Promote failed — engine did not respond"
    elsif result["skipped"]
      redirect_to agent_knowledge_documents_path(@agent), notice: "Already in org library (#{result["chunkCount"]} chunks)"
    else
      redirect_to agent_knowledge_documents_path(@agent), notice: "Promoted to org library (#{result["chunkCount"]} chunks)"
    end
  end

  private

  def set_agent
    @agent = find_by_public_id!(current_tenant.agents, params[:agent_id])
  end

  # ENV["ENGINE_URL"] is set in local dev (docker-compose). In prod each
  # agent has its own Fly app — build the per-agent public hostname
  # (same pattern as EngineSync). HTTP requests to stopped Fly Machines
  # wake them automatically.
  def engine_base
    return ENV["ENGINE_URL"] if ENV["ENGINE_URL"].present?
    env = ENV.fetch("DEPLOY_ENV", Rails.env.production? ? "prod" : "dev")
    "https://alchemy-#{env}-agent-#{@agent.id}.fly.dev"
  end

  def engine_secret
    ENV["ENGINE_API_SECRET"] || ""
  end

  def engine_get(path)
    require "net/http"
    uri = URI.parse("#{engine_base}#{path}")
    req = Net::HTTP::Get.new(uri)
    req["X-Engine-Secret"] = engine_secret
    res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https") { |http| http.request(req) }
    JSON.parse(res.body) if res.is_a?(Net::HTTPSuccess)
  rescue => e
    Rails.logger.error "Engine GET failed: #{e.message}"
    nil
  end

  def engine_post_json(path, body)
    require "net/http"
    uri = URI.parse("#{engine_base}#{path}")
    req = Net::HTTP::Post.new(uri, {
      "Content-Type" => "application/json",
      "X-Engine-Secret" => engine_secret,
    })
    req.body = body.to_json
    res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https", read_timeout: 600) { |http| http.request(req) }
    JSON.parse(res.body) if res.is_a?(Net::HTTPSuccess)
  rescue => e
    Rails.logger.error "Engine POST JSON failed: #{e.message}"
    nil
  end

  # Forward a single uploaded file to the engine as multipart/form-data.
  # Body is built as binary (ASCII-8BIT) to preserve PDF/DOCX bytes intact.
  # scope = "agent" (default) or "org".
  def engine_upload_file(file, title, scope = "agent")
    require "net/http"
    require "securerandom"

    boundary = "AlchemyBoundary#{SecureRandom.hex(16)}"
    crlf = "\r\n".b

    # Read the tempfile as binary — no encoding transform
    file.tempfile.binmode
    file.tempfile.rewind
    file_bytes = file.tempfile.read
    file_bytes = file_bytes.b # force ASCII-8BIT

    parts = []
    # Scope field — engine branches on agent_id vs org_id.
    scope_field, scope_value = scope == "org" ? ["org_id", current_tenant.id] : ["agent_id", @agent.id]
    parts << "--#{boundary}".b << crlf
    parts << %(Content-Disposition: form-data; name="#{scope_field}").b << crlf << crlf
    parts << scope_value.to_s.b << crlf

    parts << "--#{boundary}".b << crlf
    parts << %(Content-Disposition: form-data; name="title").b << crlf << crlf
    parts << title.to_s.b << crlf

    parts << "--#{boundary}".b << crlf
    parts << %(Content-Disposition: form-data; name="file"; filename="#{file.original_filename}").b << crlf
    parts << "Content-Type: #{file.content_type || 'application/octet-stream'}".b << crlf << crlf
    parts << file_bytes << crlf

    parts << "--#{boundary}--".b << crlf

    body = parts.join.b
    Rails.logger.info "Engine upload: #{file.original_filename} (#{file_bytes.bytesize}b, total body #{body.bytesize}b, boundary=#{boundary})"

    uri = URI.parse("#{engine_base}/rag/ingest")
    req = Net::HTTP::Post.new(uri.request_uri)
    req["Content-Type"] = "multipart/form-data; boundary=#{boundary}"
    req["X-Engine-Secret"] = engine_secret
    req["Content-Length"] = body.bytesize.to_s
    req.body = body

    res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https", read_timeout: 600) { |http| http.request(req) }

    if res.is_a?(Net::HTTPSuccess)
      JSON.parse(res.body)
    else
      Rails.logger.error "Engine upload failed #{res.code}: #{res.body}"
      nil
    end
  rescue => e
    Rails.logger.error "Engine upload exception: #{e.class}: #{e.message}\n#{e.backtrace.first(3).join("\n")}"
    nil
  end

  def engine_delete(path)
    require "net/http"
    uri = URI.parse("#{engine_base}#{path}")
    req = Net::HTTP::Delete.new(uri)
    req["X-Engine-Secret"] = engine_secret
    Net::HTTP.start(uri.hostname, uri.port) { |http| http.request(req) }
  rescue => e
    Rails.logger.error "Engine DELETE failed: #{e.message}"
  end
end
