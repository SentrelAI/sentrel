# File finder — whole files made available to an agent, stored as ActiveStorage
# blobs (not vectorized). Sibling to KnowledgeDocumentsController, but the data
# lives in Rails (the agent_files table + blobs) instead of the engine RAG store.
#
# The agent reads these at runtime via the engine's list_files / read_file MCP
# tools, which call Api::AgentFilesController#index and /api/blobs/:signed_id.
class AgentFilesController < ApplicationController
  before_action :authenticate_user!
  before_action :set_agent

  MAX_UPLOAD_BYTES = (ENV.fetch("MAX_UPLOAD_MB", "25").to_i * 1024 * 1024)
  BLOCKED_EXTENSIONS = %w[exe bat scr cmd com pif vbs js ps1 sh msi dll sys].freeze

  # GET /agents/:agent_id/files
  def index
    render inertia: "files/index", props: {
      agent: @agent.as_json(only: [ :id, :name, :slug ]),
      files: visible_files.map(&:as_engine_json)
    }
  end

  # POST /agents/:agent_id/files
  # Accepts one or more files. `scope` = "agent" (default) or "org".
  def create
    files = params[:files] || (params[:file] ? [ params[:file] ] : [])
    scope = params[:scope] == "org" ? "org" : "agent"
    title = params[:title].presence

    created = []
    errors = []

    files.each do |f|
      next unless f.respond_to?(:tempfile)
      if f.size > MAX_UPLOAD_BYTES
        errors << "#{f.original_filename}: too large (max #{MAX_UPLOAD_BYTES / 1.megabyte}MB)"
        next
      end
      ext = File.extname(f.original_filename).delete(".").downcase
      if BLOCKED_EXTENSIONS.include?(ext)
        errors << "#{f.original_filename}: file type .#{ext} not allowed"
        next
      end

      record = AgentFile.new(
        organization_id: current_tenant.id,
        agent: scope == "org" ? nil : @agent,
        scope: scope,
        title: title || f.original_filename
      )
      record.file.attach(io: f.tempfile, filename: f.original_filename, content_type: f.content_type)
      if record.save
        created << record
      else
        errors << "#{f.original_filename}: #{record.errors.full_messages.join(', ')}"
      end
    end

    # First file auto-enables the capability so the agent actually gets the tools.
    enable_agent_files_capability! if created.any?

    if created.empty? && errors.empty?
      return redirect_to agent_files_path(@agent), alert: "No files provided"
    end

    msg = "Added #{created.size} #{scope == "org" ? "org-shared " : ""}file(s)"
    msg += ". Errors: #{errors.join(', ')}" if errors.any?
    redirect_to agent_files_path(@agent), notice: msg
  end

  # DELETE /agents/:agent_id/files/:id
  def destroy
    record = visible_files.find_by(id: params[:id])
    record&.destroy
    redirect_to agent_files_path(@agent), notice: "File removed"
  end

  # POST /agents/:agent_id/files/:id/promote
  # Copy a personal file into the org-shared library (shares the same blob).
  def promote
    record = @agent.agent_files.find_by(id: params[:id], scope: "agent")
    return redirect_to agent_files_path(@agent), alert: "File not found" unless record

    org_copy = AgentFile.new(
      organization_id: current_tenant.id,
      agent: nil,
      scope: "org",
      title: record.title,
      description: record.description
    )
    org_copy.file.attach(record.file.blob) if record.file.attached?
    if org_copy.save
      redirect_to agent_files_path(@agent), notice: "Promoted to org library"
    else
      redirect_to agent_files_path(@agent), alert: "Promote failed: #{org_copy.errors.full_messages.join(', ')}"
    end
  end

  private

  def set_agent
    @agent = find_by_public_id!(current_tenant.agents, params[:agent_id])
  end

  def visible_files
    AgentFile.visible_to_agent(@agent).with_attached_file.order(created_at: :desc)
  end

  def enable_agent_files_capability!
    return if @agent.capability_enabled?(:agent_files)
    caps = @agent.capabilities || {}
    caps = caps.merge("agent_files" => (caps["agent_files"] || {}).merge("enabled" => true))
    @agent.update(capabilities: caps)
  end
end
