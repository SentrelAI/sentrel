class AgentsController < ApplicationController
  before_action :authenticate_user!
  before_action :set_agent, only: [ :show, :edit, :update, :destroy, :export, :persona_revisions, :propose_upstream ]

  def index
    agents = current_tenant.agents.includes(:ai_config, :instance, :manager).to_a
    props = { agents: agents.map { |a| agent_json(a) } }
    # When the workspace is empty, the page shows a template picker instead of
    # forcing the create flow — surface a handful of deployable templates.
    props[:templates] = empty_state_templates if agents.empty?
    render inertia: "agents/index", props: props
  end

  # GET /agents/tree(.json)
  # Full nested org chart for the current tenant. Roots = agents with no
  # manager; children = each agent's direct reports. Used by the agents index
  # "tree" view and the engine's teammate roster.
  def tree
    agents = current_tenant.agents.includes(:ai_config).order(:name)
    by_manager = agents.group_by(&:manager_id)

    build = ->(agent) {
      {
        id: agent.to_param,
        name: agent.name,
        slug: agent.slug,
        role: agent.role,
        status: agent.status,
        model_id: agent.ai_config&.model_id,
        reports: (by_manager[agent.id] || []).map { |child| build.call(child) }
      }
    }

    roots = (by_manager[nil] || []).map { |a| build.call(a) }
    render json: { roots: roots, total: agents.size }
  end

  def show
    # Find internal chat conversation (boss ↔ agent). Multiple internal convs
    # exist for historical reasons — pick the most recently active one, and
    # prefer the one tied to this specific user.
    chat_conversation = @agent.conversations
      .where(kind: "internal", user: current_user)
      .order(updated_at: :desc)
      .first
    # Resolve user-uploaded attachments per message so they survive a page
    # reload. ActiveStorage stores them on Message via has_many_attached;
    # we surface their URL + filename + content_type so the frontend can
    # render the same attachment chip we use during composition.
    chat_messages = if chat_conversation
      ordered_msgs = chat_conversation.messages.includes(attachments_attachments: :blob).order(id: :asc).to_a
      ordered_msgs.each_with_index.map do |m, i|
        base = m.as_json(only: [ :id, :role, :content, :channel, :metadata, :created_at, :sender_name, :sender_email, :sender_user_id ])
        base["sender"] = m.display_sender
        base["attachments"] = m.attachments.map do |att|
          blob = att.blob
          {
            filename: blob.filename.to_s,
            content_type: blob.content_type,
            byte_size: blob.byte_size,
            url: Rails.application.routes.url_helpers.rails_blob_path(blob, only_path: true)
          }
        end
        # Engine emits metadata.thinking with duration_ms=0 today, so the
        # "Thought" pill loses its time hint on reload. Fall back to the
        # turn-elapsed (this assistant's created_at minus the prior message's
        # created_at) so the pill can render "Thought for Xs" instead of a
        # bare "Thought". Tool steps inflate this beyond pure thinking time,
        # but it's the closest signal until the engine reports a real value.
        thinking = base.dig("metadata", "thinking")
        if thinking.is_a?(Hash) && thinking["text"].to_s.length > 0 && thinking["duration_ms"].to_i <= 0
          prior = ordered_msgs[i - 1] if i > 0
          if prior
            gap_ms = ((m.created_at - prior.created_at) * 1000).to_i
            base["metadata"] = base["metadata"].merge(
              "thinking" => thinking.merge("duration_ms" => [ gap_ms, 0 ].max)
            )
          end
        end
        base
      end
    else
      []
    end

    # Surface "agent is thinking" across page reloads / new tabs. Heuristic:
    # find the most recent user message and see if any assistant message
    # exists *after* it. If not, and the user message is recent (<15 min),
    # the run is still in flight. Compare on created_at — m["id"] is the
    # PrefixedIds string ("msg_abc123") not the integer, so id.to_i would
    # always return 0 and the comparison would never match. Frontend
    # hydrates the indicator from this on mount and clears it via cable /
    # poll once a reply lands.
    agent_thinking = nil
    if chat_messages.any?
      last_user_msg = chat_messages.reverse.find { |m| m["role"] == "user" }
      if last_user_msg && last_user_msg["created_at"].to_time > 15.minutes.ago
        last_user_at = last_user_msg["created_at"].to_time
        has_reply = chat_messages.any? { |m|
          m["role"] == "assistant" &&
            m["content"].to_s.strip.length > 0 &&
            m["created_at"].to_time > last_user_at
        }
        unless has_reply
          agent_thinking = {
            since: last_user_msg["created_at"],
            after: last_user_msg["created_at"]
          }
        end
      end
    end

    # Get approvals keyed by message_id for inline rendering
    approvals_by_message = @agent.pending_approvals
      .where.not(message_id: nil)
      .where("created_at > ?", 7.days.ago)
      .group_by(&:message_id)
      .transform_values { |approvals|
        approvals.map { |a| a.as_json(only: [ :id, :tool_name, :tool_input, :status, :created_at ]) }
      }

    # Item 4 — pending generic action approvals (request_approval) so the
    # inline chat card survives a page refresh. The card is hydrated from
    # this prop on mount; its DB row stays the source of truth.
    pending_action_approvals = @agent.pending_approvals
      .where(status: "pending")
      .where.not(payload_type: nil)
      .where("created_at > ?", 24.hours.ago)
      .order(created_at: :desc)
      .limit(5)
      .map { |a|
        {
          id: a.id,
          approval_token: a.approval_token,
          summary: a.summary,
          payload_type: a.payload_type,
          payload: a.tool_input,
          options: a.options.presence || [
            { label: "Approve", value: "approve" },
            { label: "Reject", value: "reject" }
          ],
          risk_tier: a.risk_tier,
          allow_amendment: a.tool_input.is_a?(Hash) && a.tool_input["_allow_amendment"] == true,
          created_at: a.created_at
        }
      }

    # Whether the org has an active Anthropic-subscription credential
    # (paste-token flow). The brain picker conditionally shows the
    # "via your Claude subscription" group only when this is true so the
    # option doesn't 401 the moment a user picks it.
    anthropic_account_connected = begin
      OauthCredential.exists?(
        organization_id: @agent.organization_id,
        provider: "anthropic",
        kind: "ai_provider",
      )
    rescue StandardError
      false
    end

    # Which LLM providers the org has BYO keys for. Drives the model picker's
    # disabled state so users can't pick a model that would 401 the moment it
    # ran for lack of a stored key.
    available_llm_providers = current_tenant.credentials
      .where(kind: "llm_api_key")
      .distinct
      .pluck(:provider)

    render inertia: "agents/show", props: {
      agent: agent_json(@agent),
      anthropic_account_connected: anthropic_account_connected,
      available_llm_providers: available_llm_providers,
      spend: AgentSpend.for_agent(@agent),
      rail: build_rail_payload(@agent),
      conversations: @agent.conversations.where(kind: "external").where.not(status: "archived").includes(:messages).order(updated_at: :desc).limit(20).map { |c|
        last_msg = c.messages.order(created_at: :desc).first
        c.as_json(only: [ :id, :kind, :contact_name, :contact_email, :contact_phone, :subject, :status, :updated_at ]).merge(
          channel: last_msg&.channel,
          message_count: c.messages.count,
          last_message_preview: last_msg&.content&.truncate(80),
          last_message_direction: last_msg&.direction,
        )
      },
      # Individual email messages for mail-style inbox. Archived
      # conversations hide all their messages from this list — archive is
      # the user's "out of sight" signal, so leaving them in the email
      # row stream would defeat the point.
      emails: Message.joins(:conversation)
        .where(conversations: { agent_id: @agent.id, kind: "external" })
        .where.not(conversations: { status: "archived" })
        .where(channel: "email")
        .order(created_at: :desc)
        .limit(50)
        .map { |m|
          m.as_json(only: [ :id, :role, :content, :direction, :channel, :created_at, :sender_name, :sender_email, :sender_user_id ]).merge(
            subject: m.metadata&.dig("subject"),
            to: m.metadata&.dig("to"),
            cc: m.metadata&.dig("cc"),
            # Use the MESSAGE's own sender for inbound rows — every
            # inbound writes sender_email via InboundProcessor. Falling
            # back to conversation.contact_email was the bug that pasted
            # the thread's original sender onto every CC reply.
            from: m.direction == "inbound" ? (m.sender_email.presence || m.conversation.contact_email) : @agent.channel_configs.find_by(channel_type: "email")&.config&.dig("address"),
            sender: m.display_sender,
            conversation_id: m.conversation_id,
            contact: m.conversation.contact_email || m.conversation.contact_name,
          )
        },
      chat_messages: chat_messages,
      agent_thinking: agent_thinking,
      approvals_by_message: approvals_by_message,
      pending_action_approvals: pending_action_approvals,
      # conversation_id → pending-approval count, so the inbox list can
      # flag threads blocked on a human decision. Keyed by BOTH the
      # prefixed id (cnv_… — what conversation rows serialize as) and the
      # raw id (what Message#conversation_id ships on email rows).
      pending_approvals_by_conversation: begin
        raw = Message
          .where(id: @agent.pending_approvals.where(status: "pending").select(:message_id))
          .group(:conversation_id)
          .count
        Conversation.where(id: raw.keys).each_with_object({}) { |c, h|
          h[c.prefix_id] = raw[c.id]
          h[c.id] = raw[c.id]
        }
      end,
      tasks: @agent.tasks.order(created_at: :desc).limit(20).as_json(
        only: [ :id, :title, :status, :priority, :due_at, :completed_at ]
      ),
      channel_configs: @agent.channel_configs.as_json(only: [ :id, :channel_type, :enabled, :status ]),
      scheduled_tasks: @agent.scheduled_work.order(created_at: :desc).map { |sw|
        recent_logs = AuditLog.where(agent_id: @agent.id, action: "scheduled_task")
          .where("input->>'taskId' = ?", sw.id.to_s)
          .order(created_at: :desc).limit(20)
          .map { |l| {
            id: l.to_param,
            status: l.status,
            output: l.output&.dig("response"),
            duration_ms: l.output&.dig("duration_ms"),
            tool_calls: l.output&.dig("tool_calls") || [],
            created_at: l.created_at
          } }

        {
          id: sw.to_param,
          name: sw.name,
          instruction: sw.instruction,
          cron_expression: sw.cron_expression,
          timezone: sw.timezone,
          active: sw.active,
          last_run_at: sw.last_run_at,
          mode: sw.mode,
          fire_at: sw.fire_at,
          interval_seconds: sw.interval_seconds,
          recent_runs: recent_logs
        }
      },
      # Inbound webhook endpoints — the Webhooks tab. URL carries the
      # secret token, so it only ever renders to authenticated org members.
      webhooks: @agent.agent_webhooks.order(created_at: :asc).map { |w|
        w.as_json(only: [ :id, :name, :instruction, :source, :active, :receive_count, :last_received_at, :created_at ])
         .merge(url: w.url(request.base_url))
      },
      knowledge_documents: fetch_knowledge_documents(@agent),
      agent_files: AgentFile.visible_to_agent(@agent).with_attached_file.order(created_at: :desc).map(&:as_engine_json),
      # Sprint 6 — skills
      installed_skills: @agent.agent_skills.includes(:skill_definition).filter_map { |as|
        sd = as.skill_definition
        next nil unless sd # orphaned grant — skip silently, surfaced for cleanup elsewhere
        sd.as_json(only: [ :id, :slug, :name, :description, :category, :icon, :requires_connections ])
          .merge(enabled: as.enabled, agent_skill_id: as.id)
      },
      # Available skills = anything the org can see (own skills + system seeds
      # + published marketplace skills from other orgs) minus what's already
      # installed. Source flag flows through so the picker can show System /
      # Yours / Community badges.
      available_skills: SkillDefinition.visible_to(current_tenant)
        .where.not(id: @agent.agent_skills.select(:skill_definition_id))
        .order(:category, :name)
        .map { |s|
          s.as_json(only: [ :id, :slug, :name, :description, :category, :icon, :requires_connections, :source, :visibility, :install_count ]).merge(
            owned_by_me: s.organization_id == current_tenant&.id,
          )
        },
      # Surface integrations the agent's enabled skills need but the org
      # hasn't connected yet. Drives the "Connect to unlock this agent"
      # callout on the show page. Empty array = fully connected (hide).
      missing_integrations: missing_integrations_for(@agent)
    }
  end

  # Build a UI-friendly payload for the missing-integrations card on the
  # agent show page. Cross-references agent.missing_integration_slugs
  # against the integration catalog (label, logo, category) so the
  # client doesn't have to look those up itself.
  def missing_integrations_for(agent)
    connected = current_tenant.integrations.pluck(:service_name).map { |x| x.to_s.downcase }.to_set
    catalog = IntegrationCatalog.list(current_tenant.id).index_by { |t| t[:slug] }
    entry = ->(slug) {
      meta = catalog[slug] || {}
      { slug: slug, label: meta[:label] || slug.titleize, category: meta[:category] || "Other",
        logo: meta[:logo], description: meta[:description] }
    }

    items = agent.missing_integration_slugs.map { |slug| entry.call(slug).merge(kind: "service") }

    # Template lineage: bundle-declared integrations the skills don't carry
    # (e.g. Nova's publishing networks live in an any_of group, not in any
    # skill's requires_connections — without this the agent looks like it
    # needs nothing while it can't actually publish).
    if agent.template_slug.present?
      template = ActsAsTenant.without_tenant { AgentTemplate.find_by(slug: agent.template_slug) }
      Array(template&.current_version&.definition&.dig("integrations_required")).each do |req|
        next unless req.is_a?(Hash)
        if req["service"].present?
          slug = req["service"].to_s
          next if connected.include?(slug.downcase) || items.any? { |i| i[:slug] == slug }
          items << entry.call(slug).merge(kind: "service", optional: req["required"] == false)
        elsif req["any_of"].is_a?(Array) && req["any_of"].none? { |o| connected.include?(o.to_s.downcase) }
          items << { kind: "group", required: req["required"] != false,
                     options: req["any_of"].map { |o| entry.call(o.to_s) } }
        end
      end
    end
    items
  end

  def new
    # AgentTemplate acts_as_tenant filters out system seeds (org_id: NULL).
    # Wrap so the new-agent picker shows ALL published templates the org
    # is allowed to install (visible_to handles the access check).
    # Capture tenant outside the block — inside without_tenant the
    # current_tenant helper returns nil, which would hide org-owned
    # community templates from their own org.
    tenant = current_tenant
    # GitHub-backed templates deploy through the full /deploy-agent wizard —
    # one deploy UI, not two. /agents/new?template=<slug> deep links redirect
    # there; only templates without a bundle source use the in-page flow.
    if params[:template].present?
      requested = ActsAsTenant.without_tenant { AgentTemplate.visible_to(tenant).find_by(slug: params[:template]) }
      if requested&.source_url.present?
        return redirect_to deploy_agent_path(source: requested.source_url)
      end
    end
    templates_for_picker = ActsAsTenant.without_tenant do
      AgentTemplate.visible_to(tenant).order(:name).to_a
    end
    render inertia: "agents/new", props: {
      templates: templates_for_picker.map { |t| template_summary(t) },
      agents: current_tenant.agents.select(:id, :name, :slug, :role).order(:name).map { |a|
        { id: a.to_param, name: a.name, slug: a.slug, role: a.role }
      },
      org_email_domain: current_tenant.try(:email_domain).presence,
      # Connected service_names so the template panel can show per-integration
      # connect status (same signal the /deploy-agent wizard gets).
      connected_services: current_tenant.integrations.where(status: "connected").pluck(:service_name)
    }
  end

  def create
    # Tenant bypass: a user installing a system template (org_id: NULL)
    # needs to be able to look it up by slug. visible_to is the access
    # check; tenant scoping would 404 NULL-org rows.
    template = if params[:template_slug].present?
      tenant = current_tenant
      ActsAsTenant.without_tenant { AgentTemplate.visible_to(tenant).find_by(slug: params[:template_slug]) }
    end

    if template
      # Template install path — funnel through AgentTemplates::Installer so
      # one code path handles both "install from saved version" and (later)
      # "install from raw JSON paste". Picks a specific version when
      # params[:version_number] is present; otherwise current_version.
      version = if params[:version_number].present?
        template.versions.find_by(version_number: params[:version_number].to_i)
      end || template.current_version
      definition = version&.definition || legacy_definition_from(template)

      # If the new-agent wizard's drafter augmented the skill list to
      # include integrations the user explicitly named, honor that:
      # replace the definition's skills with the override entries by
      # slug. The Installer's ensure_skill! finds each one by slug in
      # the org's catalog and links — works for both platform seeds and
      # org-owned skills. Avoids hiding "you also need hubspot-crm"
      # behind a Skills-tab visit the user has to remember.
      override_slugs = Array(params[:skill_slugs_override]).map(&:to_s).reject(&:blank?).uniq
      if override_slugs.any?
        definition = definition.deep_dup
        definition["skills"] = override_slugs.map { |slug| { "slug" => slug } }
      end

      @agent = begin
        AgentTemplates::Installer.new(
          definition: definition,
          # Pass identity/personality/instructions through when the
          # form has them filled in (from the drafter's fresh persona
          # generation). Installer's apply_persona! is `||=`, so the
          # form values win over the template's pre-baked markdown.
          agent_attrs: agent_params.to_h.symbolize_keys.slice(
            :name, :slug, :role, :manager_id,
            :identity_md, :personality_md, :instructions_md,
          ),
          ai_config_attrs: ai_config_params.to_h,
          user: current_user,
          organization: current_tenant,
          prefer_anthropic_oauth: org_has_anthropic_oauth?,
          inputs: params[:inputs].respond_to?(:to_unsafe_h) ? params[:inputs].to_unsafe_h : (params[:inputs] || {}),
        ).call
      rescue AgentTemplates::Installer::InvalidDefinition, ActiveRecord::RecordInvalid => e
        return redirect_back fallback_location: new_agent_path, alert: e.message
      end

      # Lineage: which template (and version) this agent came from — the
      # anchor for persona-edit history + propose-upstream.
      @agent.update_columns(template_slug: template.slug, template_version_number: version&.version_number)

      apply_initial_channels!(@agent)
      EngineSync.trigger(@agent)
      ProvisionAgentJob.perform_later(@agent.id)

      missing = template.respond_to?(:missing_integrations_for) ? template.missing_integrations_for(current_tenant) : []
      template.respond_to?(:increment_installs!) && template.increment_installs!
      msg = "Agent created — machine provisioning in background"
      msg += ". Connect these integrations to fully enable: #{missing.map(&:titleize).join(', ')}" if missing.any?
      return redirect_to agent_path(@agent), notice: msg
    end

    # Direct-create (no template) — the "Blank" path from the new-agent
    # form. Persona stays empty until the user writes it on the Identity
    # tab; skills come from skill_slugs_override if any were picked.
    @agent = current_tenant.agents.build(agent_params)
    if @agent.save
      ai_cfg = ai_config_params.to_h
      if ai_cfg[:provider].to_s == "anthropic" && org_has_anthropic_oauth?
        ai_cfg[:provider] = "anthropic_account"
      end
      @agent.create_ai_config!(ai_cfg)

      # Install the skills the drafter recommended. Each slug is
      # resolved against the org's catalog (org-owned + platform seeds);
      # missing slugs are logged and skipped so a stale recommendation
      # doesn't fail the whole create.
      install_skill_slugs!(@agent, params[:skill_slugs_override])

      apply_initial_channels!(@agent)
      EngineSync.trigger(@agent)
      ProvisionAgentJob.perform_later(@agent.id)
      redirect_to agent_path(@agent), notice: "Agent created — machine provisioning in background"
    else
      redirect_back fallback_location: new_agent_path, alert: @agent.errors.full_messages.join(", ")
    end
  end

  def install_skill_slugs!(agent, slugs)
    Array(slugs).map(&:to_s).reject(&:blank?).uniq.each do |slug|
      skill = SkillDefinition.where(slug: slug)
        .where("organization_id = ? OR organization_id IS NULL", current_tenant.id)
        .first
      if skill
        agent.agent_skills.find_or_create_by!(skill_definition: skill).update!(enabled: true)
      else
        Rails.logger.warn "[AgentsController#create] Skipped unknown skill slug #{slug.inspect}"
      end
    end
  end

  # Build a minimal v1-shaped definition from a legacy template row that
  # was created before the agent_template_versions migration ran (and that
  # the backfill rake hasn't been run for yet). Mirrors what the backfill
  # task would emit. Last-resort fallback so the install path never breaks
  # on a non-backfilled template.
  def legacy_definition_from(template)
    {
      "spec_version" => "1.0",
      "kind"         => "agent",
      "name"         => template.name,
      "role"         => template.role,
      "description"  => template.description,
      "category"     => template.category,
      "icon"         => template.icon,
      "persona" => {
        "identity_md"        => template.identity_md,
        "personality_md"     => template.personality_md,
        "instructions_md"    => template.instructions_md,
        "email_signature_md" => template.email_signature_md
      },
      "model" => {
        "provider" => template.suggested_provider,
        "model_id" => template.suggested_model
      }.compact,
      "capabilities" => template.capabilities || {},
      "skills"       => Array(template.suggested_skill_slugs).map { |s| { "slug" => s } },
      "integrations_required" => Array(template.suggested_integrations).map { |s| { "service" => s } },
      "approval_rules" => []
    }
  end

  def edit
    # Approval rules surfaced inline on the Approvals tab: agent-specific
    # first (rules this agent is the explicit target of), then org-wide
    # rules that ALSO apply to this agent. Sorted by enabled-then-newest.
    agent_rules = @agent.approval_rules.includes(:agent)
    org_wide_rules = current_tenant.approval_rules.where(agent_id: nil).includes(:agent)
    approval_rules = (agent_rules.to_a + org_wide_rules.to_a)
      .sort_by { |r| [ r.enabled ? 0 : 1, r.agent_id ? 0 : 1, -r.created_at.to_i ] }
      .map { |r|
        {
          id: r.id,
          label: r.label,
          scope: r.agent_id ? "agent" : "org",
          payload_type: r.payload_type,
          auto_decision: r.auto_decision,
          enabled: r.enabled,
          predicate: r.predicate
        }
      }

    render inertia: "agents/edit", props: {
      agent: agent_json(@agent),
      agents: current_tenant.agents.where.not(id: @agent.id).select(:id, :name, :slug, :role).order(:name).map { |a|
        { id: a.to_param, name: a.name, slug: a.slug, role: a.role }
      },
      org_credentials: current_tenant.credentials.where(agent_id: nil)
        .order(kind: :asc, provider: :asc, name: :asc)
        .map { |c| { id: c.id, kind: c.kind, provider: c.provider, name: c.name } },
      granted_credential_ids: @agent.credentials.pluck(:id),
      approval_rules: approval_rules,
      # Capability resolution preview — for each multi-provider capability,
      # show how it'd resolve for THIS agent. The frontend uses this to
      # render the Capabilities tab with one-click "add key" actions
      # pre-scoped to either this agent or the whole org.
      capabilities_overview: build_agent_capabilities_overview(@agent),
      # Per-(kind, provider) field schema — the agent edit Capabilities
      # tab uses this to render an inline "Add key" form without bouncing
      # to /settings/credentials.
      credential_field_schemas: Credential::FIELD_SCHEMAS.merge("__default__" => Credential::DEFAULT_FIELDS)
    }
  end

  def update
    persona_before = @agent.attributes.slice(*AgentPersonaRevision::FIELDS)
    if @agent.update(agent_params)
      record_persona_revisions!(persona_before)
      env_changed = false
      if params[:ai_config].present? && @agent.ai_config
        @agent.ai_config.assign_attributes(ai_config_params)
        env_changed ||= AiConfig::ENV_AFFECTING_FIELDS.any? { |f| @agent.ai_config.changes.key?(f) }
        @agent.ai_config.save!
      end
      if params.key?(:granted_credential_ids)
        # Credential grants determine which BYO key agent_provisioner.byo_key
        # resolves for the current provider — swapping grants requires the
        # machine env to be repushed.
        env_changed ||= credential_grants_changed?
        update_credential_grants
      end
      if env_changed
        AgentMachineOps.reload(@agent) rescue nil
      else
        EngineSync.trigger(@agent)
      end
      redirect_to agent_path(@agent), notice: "Agent updated"
    else
      redirect_back fallback_location: edit_agent_path(@agent), alert: @agent.errors.full_messages.join(", ")
    end
  end

  def destroy
    # Fly teardown is handled by Agent's before_destroy :terminate_infrastructure.
    @agent.destroy
    redirect_to agents_path, notice: "Agent deleted"
  end

  # GET /agents/:id/export → portable agent.json. Triggers a browser
  # download via Content-Disposition; safe to share publicly (no
  # secrets / channel tokens / runtime state embedded).
  # GET /agents/:id/persona_revisions — the agent's prompt-edit history.
  def persona_revisions
    revisions = @agent.persona_revisions.newest_first.limit(100).includes(:user).map do |r|
      {
        id: r.id, field: r.field, note: r.note,
        before_text: r.before_text, after_text: r.after_text,
        user_name: r.user&.name, created_at: r.created_at.iso8601,
        proposed_pr_url: r.proposed_pr_url
      }
    end
    render json: {
      template_slug: @agent.template_slug,
      template_version_number: @agent.template_version_number,
      upstream_configured: AgentTemplates::UpstreamProposer.configured?,
      revisions: revisions
    }
  end

  # POST /agents/:id/propose_upstream { revision_id } — open a PR on the
  # agent-templates repo carrying this revision's text. Admin/owner only.
  def propose_upstream
    unless current_user.role.in?(%w[owner admin])
      return render json: { error: "Only workspace admins can propose template changes" }, status: :forbidden
    end
    revision = @agent.persona_revisions.find(params[:revision_id])
    return render json: { error: "Already proposed", url: revision.proposed_pr_url }, status: :conflict if revision.proposed?
    url = AgentTemplates::UpstreamProposer.new(revision: revision, user: current_user).call
    render json: { ok: true, url: url }
  rescue AgentTemplates::UpstreamProposer::Error => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  def export
    definition = AgentTemplates::Exporter.new(@agent, exported_by: current_user).call
    filename   = "#{@agent.slug.presence || "agent"}.agent.json"
    send_data JSON.pretty_generate(definition),
              filename: filename,
              type: "application/json",
              disposition: "attachment"
  end

  private

  def set_agent
    @agent = find_by_public_id!(current_tenant.agents, params[:id])
  end

  # Deployable templates for the no-agent empty state — system + this org's
  # published ones. without_tenant so visible_to does its own access check
  # (acts_as_tenant would otherwise hide the org-NULL system seeds). Capped
  # to keep the picker glanceable; the full gallery lives at /templates.
  def empty_state_templates
    tenant = current_tenant
    ActsAsTenant.without_tenant do
      AgentTemplate.visible_to(tenant)
                   .includes(:created_by_user)
                   .order(:category, :name)
                   .limit(6)
                   .map(&:card_attributes)
    end
  end

  # Right-rail payload for the agent show page. One round-trip of small
  # signals (approvals, status, activity, spend, channels, hierarchy) so
  # the rail is glanceable without N follow-up fetches.
  def build_rail_payload(agent)
    {
      # Rail wants enough context per approval to actually be useful — older
      # generic approvals don't have `summary`/`payload_type` populated (only
      # action approvals do), so we ship `tool_name` + a brief tool_input
      # preview as fallbacks.
      pending_approvals: agent.pending_approvals
        .where(status: "pending")
        .order(created_at: :asc) # oldest-first — those have been waiting longest
        .limit(8)
        .map { |a|
          input_preview = if a.tool_input.is_a?(Hash) && a.tool_input.any?
            # Pick the first 2-3 meaningful keys (skip underscored internals).
            a.tool_input
              .reject { |k, _| k.to_s.start_with?("_") }
              .first(3)
              .map { |k, v| "#{k}: #{v.to_s.truncate(60)}" }
              .join(" · ")
              .presence
          end
          {
            id: a.id,
            summary: a.summary,
            tool_name: a.tool_name,
            payload_type: a.payload_type,
            risk_tier: a.risk_tier,
            input_preview: input_preview,
            # Full payload + decision options so the rail can render a
            # complete preview modal and approve/reject without leaving
            # the page.
            tool_input: a.tool_input,
            context: a.context,
            options: a.options,
            created_at: a.created_at
          }
        },
      # Last few tool calls / sent messages so the rail shows "what it just did".
      recent_activity: agent.audit_logs
        .where("created_at >= ?", 24.hours.ago)
        .where.not(action: [ "secret_fetched" ]) # too noisy
        .order(created_at: :desc)
        .limit(8)
        .map { |l|
          {
            id: l.id,
            action: l.action,
            tool_name: l.tool_name,
            status: l.status,
            created_at: l.created_at,
            duration_ms: l.duration_ms
          }
        },
      channels: agent.channel_configs.where(enabled: true).order(:channel_type).pluck(:channel_type).uniq,
      # Hierarchy slice — manager + direct reports. Lets the user jump
      # to siblings without going back to the sidebar.
      manager: agent.manager && { id: agent.manager.to_param, name: agent.manager.name, role: agent.manager.role },
      reports: agent.sub_agents.order(:name).map { |a| { id: a.to_param, name: a.name, role: a.role, status: a.status } },
      skills: agent.skill_definitions.order(:name).limit(12).pluck(:slug, :name).map { |slug, name| { slug: slug, name: name } }
    }
  end

  # Fetches the agent's knowledge_base docs from the engine. Best-effort —
  # returns [] if the engine is unreachable so the page still renders.
  def fetch_knowledge_documents(agent)
    require "net/http"
    base = ENV.fetch("ENGINE_URL", "http://localhost:3300")
    uri = URI.parse("#{base}/rag/documents?agent_id=#{agent.id}")
    req = Net::HTTP::Get.new(uri)
    req["X-Engine-Secret"] = ENV["ENGINE_API_SECRET"] || ""
    res = Net::HTTP.start(uri.hostname, uri.port, read_timeout: 3, open_timeout: 1) { |http| http.request(req) }
    return [] unless res.is_a?(Net::HTTPSuccess)
    JSON.parse(res.body)["documents"] || []
  rescue => e
    Rails.logger.warn "fetch_knowledge_documents failed for agent #{agent.id}: #{e.message}"
    []
  end

  CAPABILITY_KEYS = {
    knowledge_base: [ :enabled, :always_retrieve, :threshold, :top_k ],
    scheduling:   [ :enabled ],
    tasks:        [ :enabled ],
    integrations: [ :enabled ],
    recall:       [ :enabled ],
    send_media:   [ :enabled ],
    # New multi-provider capabilities. provider="auto" walks the engine
    # registry; or pin to a specific vendor name.
    image_generation: [ :enabled, :provider ],
    tts:              [ :enabled, :provider ],
    stt:              [ :enabled, :provider ],
    browser_access:   [ :enabled, :provider ],
    web_search:       [ :enabled, :provider ],
    doc_parse:        [ :enabled, :provider ],
    video_generation: [ :enabled, :provider ],
    code_sandbox:     [ :enabled, :provider ]
  }.freeze

  # Per-agent capability resolution preview. Mirrors Credential.find_for
  # without actually fetching the secret value — just reports the tier
  # each provider would resolve to for this agent ("agent_owned" |
  # "agent_grant" | "org_default" | "missing"). The frontend renders this
  # into the Capabilities tab so users can see exactly what's wired and
  # add agent-scoped or org-scoped keys per-provider.
  def build_agent_capabilities_overview(agent)
    effective = agent.effective_capabilities
    CredentialsController::CAPABILITY_PROVIDERS.map do |cap_key, cfg|
      providers = cfg[:providers].map do |p|
        resolution = if p[:always_available]
          { tier: "platform_default", credential_id: nil, credential_name: cfg[:label] }
        else
          resolve_provider_tier(agent, p)
        end
        {
          provider: p[:provider],
          label: p[:label],
          note: p[:note],
          kind: p[:kind],
          resolution: resolution
        }
      end
      cap_cfg = effective.dig(cap_key.to_s) || {}
      {
        key: cap_key,
        label: cfg[:label],
        blurb: cfg[:blurb],
        enabled: cap_cfg["enabled"] != false,
        provider: cap_cfg["provider"] || "auto",
        available_providers: [ "auto" ] + cfg[:providers].map { |p| p[:provider] },
        providers: providers,
        # Effective resolution: which provider actually fires for this agent
        # given its current capability config. Mirrors the engine registry's
        # `provider: "auto"` walk (first available wins). When pinned, this
        # is the pinned provider's resolution.
        active_provider: pick_active_provider(cap_cfg, providers)
      }
    end
  end

  def resolve_provider_tier(agent, p)
    kinds = [ p[:kind], *(p[:also] || []) ].compact
    # Agent-owned first.
    owned = current_tenant.credentials.where(agent_id: agent.id, provider: p[:provider], kind: kinds).first
    return { tier: "agent_owned", credential_id: owned.id, credential_name: owned.name } if owned
    # Then agent grants on org credentials.
    granted = agent.credentials.where(provider: p[:provider], kind: kinds).first
    return { tier: "agent_grant", credential_id: granted.id, credential_name: granted.name } if granted
    # Then org default.
    org_default = current_tenant.credentials.where(agent_id: nil, provider: p[:provider], kind: kinds).first
    return { tier: "org_default", credential_id: org_default.id, credential_name: org_default.name } if org_default
    { tier: "missing", credential_id: nil, credential_name: nil }
  end

  def pick_active_provider(cap_cfg, providers)
    pinned = cap_cfg["provider"]
    if pinned.present? && pinned != "auto"
      match = providers.find { |pp| pp[:provider] == pinned }
      return match && match[:resolution][:tier] != "missing" ? pinned : nil
    end
    # "auto" — first provider whose resolution isn't "missing".
    hit = providers.find { |pp| pp[:resolution][:tier] != "missing" }
    hit && hit[:provider]
  end

  def agent_params
    permitted = params.require(:agent).permit(
      :name, :slug, :role, :status, :manager_id,
      :identity_md, :personality_md, :instructions_md, :email_signature_md, :memory_md,
      :spend_daily_cap_usd, :spend_monthly_cap_usd, :spend_notify_threshold_pct,
      :heartbeat_enabled, :heartbeat_interval_minutes, :approval_mode,
      permissions: {},
      capabilities: CAPABILITY_KEYS
    )
    # Frontend posts manager_id as a prefix_id string (e.g. "agt_..."); decode
    # to the numeric FK. "none" / blank clears the manager.
    if permitted.key?(:manager_id)
      raw = permitted[:manager_id]
      permitted[:manager_id] =
        if raw.blank? || raw == "none"
          nil
        elsif raw.is_a?(String) && raw.start_with?("agt_")
          Agent._prefix_id.decode(raw)
        else
          raw
        end
    end
    permitted
  end

  # Lightweight template summary for the new-agent picker UI.
  def template_summary(t)
    {
      slug: t.slug,
      name: t.name,
      role: t.role,
      description: t.description,
      icon: t.icon,
      capabilities: t.capabilities,
      suggested_skill_slugs: t.suggested_skill_slugs,
      suggested_integrations: t.respond_to?(:suggested_integrations) ? (t.suggested_integrations || []) : [],
      suggested_manager_role: t.suggested_manager_role,
      suggested_provider: t.suggested_provider,
      suggested_model: t.suggested_model,
      variables: t.variables,
      source_url: t.source_url
    }
  end

  def ai_config_params
    params.fetch(:ai_config, {}).permit(:provider, :model_id, :temperature, :max_tokens, :thinking_level)
  end

  # True when the current_tenant has a usable Anthropic OAuth credential
  # (Pro/Max/Team subscription). Drives the auto-pick to
  # provider: "anthropic_account" at agent install time so the org's
  # subscription pays for usage, not the platform's API key.
  def org_has_anthropic_oauth?
    OauthCredential.exists?(
      organization_id: current_tenant.id,
      provider: "anthropic",
      kind: "ai_provider",
    )
  end

  # Replaces the agent's credential grants with whatever the form sent.
  # Empty array clears all grants — agent falls back to org defaults.
  # One revision row per persona field the save actually changed — the
  # agent's prompt-edit history. note comes from the editor's optional
  # "what/why" input.
  def record_persona_revisions!(before)
    AgentPersonaRevision::FIELDS.each do |field|
      next unless @agent.saved_changes.key?(field)
      after = @agent[field]
      next if after.blank? # clearing a field isn't a promotable edit
      @agent.persona_revisions.create!(
        organization: current_tenant,
        user: current_user,
        field: field,
        before_text: before[field],
        after_text: after,
        note: params[:revision_note].to_s.strip.presence,
      )
    end
  rescue => e
    Rails.logger.error("persona revision capture failed: #{e.message}")
  end

  def update_credential_grants
    requested_ids = Array(params[:granted_credential_ids]).map(&:to_i).reject(&:zero?)
    # Only allow grants for credentials in the agent's organization.
    allowed_ids = current_tenant.credentials.where(id: requested_ids).pluck(:id)

    AgentCredentialGrant.transaction do
      @agent.agent_credential_grants.where.not(credential_id: allowed_ids).destroy_all
      existing_ids = @agent.agent_credential_grants.pluck(:credential_id)
      (allowed_ids - existing_ids).each do |cid|
        @agent.agent_credential_grants.create!(credential_id: cid)
      end
    end
  end

  def credential_grants_changed?
    requested_ids = Array(params[:granted_credential_ids]).map(&:to_i).reject(&:zero?)
    allowed_ids = current_tenant.credentials.where(id: requested_ids).pluck(:id).sort
    existing_ids = @agent.agent_credential_grants.pluck(:credential_id).sort
    allowed_ids != existing_ids
  end

  # Stores the channel preferences captured in the new-agent wizard intro.
  # Email gets a fully-provisioned address (auto-generated as
  # "{slug}@{org_domain}" if the user didn't override). Other channels are
  # recorded as "pending" — the user finishes connecting them on the
  # agent's Channels page (Telegram bot token, Twilio number, etc.).
  def apply_initial_channels!(agent)
    # Inertia POSTs are JSON, which wrap_parameters duplicates under :agent.
    # Read either shape so the controller works regardless.
    requested = params[:channel_configs].presence || params.dig(:agent, :channel_configs)
    return if requested.blank?

    requested = requested.values if requested.is_a?(ActionController::Parameters)
    Array(requested).each do |raw|
      attrs = raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h : raw.to_h
      kind = attrs["channel_type"] || attrs[:channel_type]
      next if kind.blank?
      next unless agent.channel_configs.where(channel_type: kind).empty?

      cfg = (attrs["config"] || attrs[:config] || {}).to_h.stringify_keys
      status = "pending"
      if kind == "email"
        cfg["address"] = cfg["address"].presence || default_email_address_for(agent)
        # Org hasn't picked an email domain yet — skip the email channel rather
        # than persisting a half-formed config. User can connect it from the
        # Channels page after they set up email in /settings.
        next if cfg["address"].blank?
        status = "connected"
      end

      agent.channel_configs.create(
        channel_type: kind,
        enabled: kind == "email",
        status: status,
        config: cfg,
      )
    end
  rescue => e
    Rails.logger.warn "[AgentsController] apply_initial_channels failed for #{agent.id}: #{e.message}"
  end

  def default_email_address_for(agent)
    domain = current_tenant.try(:email_domain).presence
    return nil unless domain
    "#{agent.slug}@#{domain}"
  end

  def agent_json(agent)
    agent.as_json(only: [
      :id, :name, :slug, :role, :status,
      :identity_md, :personality_md, :instructions_md, :memory_md, :email_signature_md,
      :spend_daily_cap_usd, :spend_monthly_cap_usd, :spend_notify_threshold_pct,
      :heartbeat_enabled, :heartbeat_interval_minutes, :permissions, :approval_mode,
      :created_at, :updated_at
    ]).merge(
      capabilities: agent.effective_capabilities,
      ai_config: agent.ai_config&.as_json(only: [ :provider, :model_id, :temperature, :max_tokens, :thinking_level ]),
      instance: agent.instance&.as_json(only: [ :status, :instance_type, :region, :aws_ip_address, :provider, :machine_id, :public_ip, :health_checked_at, :started_at, :provisioning_error ]),
      manager: agent.manager&.as_json(only: [ :id, :name, :slug ])
    )
  end
end
