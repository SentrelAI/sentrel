Rails.application.routes.draw do
  devise_for :users, controllers: {
    sessions: "users/sessions",
    registrations: "users/registrations",
    passwords: "users/passwords",
    omniauth_callbacks: "users/omniauth_callbacks"
  }

  # Redirect 127.0.0.1 to localhost for Vite
  constraints(host: "127.0.0.1") do
    get "(*path)", to: redirect { |params, req| "#{req.protocol}localhost:#{req.port}/#{params[:path]}" }
  end

  get "up" => "rails/health#show", as: :rails_health_check

  # Public inbound agent webhooks — the token is the credential. Sentry
  # alert rules, GitHub repo webhooks, Linear, Zapier, curl … anything
  # that can POST JSON can wake an agent. See HooksController.
  post "/hooks/:token", to: "hooks#receive", as: :receive_hook

  # API for engine→Rails (blob uploads, etc.)
  namespace :api do
    # Token-authenticated JSON API for the Expo (React Native) mobile app.
    # Auth: Authorization: Bearer <MobileDevice#auth_token>. See
    # Api::Mobile::BaseController. Distinct from the engine endpoints below,
    # which use the X-Engine-Secret shared secret.
    namespace :mobile do
      post   "login",            to: "sessions#create"
      post   "signup",           to: "registrations#create"
      get    "me",               to: "sessions#show"
      delete "logout",           to: "sessions#destroy"
      # Google sign-in: opened in the app's in-app browser; bounces through the
      # web omniauth flow and deep-links a device token back to the app.
      get    "oauth/google/start", to: "oauth#google_start"

      # Multi-org: list / switch / create. Onboarding for a fresh org.
      get  "organizations",            to: "organizations#index"
      post "organizations",            to: "organizations#create"
      post "organizations/:id/switch", to: "organizations#switch"
      get  "conversations",            to: "conversations#index"
      get  "model_catalog",            to: "model_catalog#show"
      post "uploads",                  to: "uploads#create"
      get  "onboarding",               to: "onboarding#show"
      post "onboarding/analyze",       to: "onboarding#analyze"
      post "onboarding/complete",      to: "onboarding#complete"
      post "onboarding/skip",          to: "onboarding#skip"
      patch  "device",           to: "devices#update"
      post   "device/test_push", to: "devices#test_push"

      resources :agents, only: [ :index, :show, :create, :update, :destroy ] do
        # Day-2 ops → Api::Mobile::Agents::OpsController (agent_id param).
        scope module: :agents do
          post "ops/restart",     to: "ops#restart"
          post "ops/reload",      to: "ops#reload"
          post "ops/redeploy",    to: "ops#redeploy"
          post "ops/reprovision", to: "ops#reprovision"
          get  "ops/logs",        to: "ops#logs"
        end
        # Chat
        get  "messages",      to: "messages#index"
        post "messages",      to: "messages#create"
        get  "messages/poll", to: "messages#poll"
        post "messages/read", to: "messages#read"
      end
    end

    resources :blobs, only: [ :create, :show ], param: :signed_id
    # Engine -> Rails: agent's file-finder files (list_files tool). Bytes are
    # fetched separately via /api/blobs/:signed_id. Auth = engine secret.
    resources :agent_files, only: [ :index ]
    resource :send_email, only: [ :create ]
    # Engine -> Rails for Slack outbound. Same auth pattern as send_email;
    # gated by send_slack_message permission on the agent.
    resource :send_slack_message, only: [ :create ], controller: "slack_messages"
    resources :task_events, only: [ :create ]
    # Engine relays every broadcast() event here; Rails re-emits over
    # AgentChatChannel so the browser sees live tool calls, progress, and
    # approval prompts without a direct WS into the engine.
    resources :agent_events, only: [ :create ]
    # Engine consults this from the request_approval tool before pausing,
    # to honor standing rules ("auto-approve LinkedIn < 3/day", etc.).
    post "approval_rules/match", to: "approval_rules#match"
    # Engine consults this before each run to enforce daily/monthly spend
    # caps + decide whether to post the "approaching cap" heads-up.
    get  "spend_caps/check",         to: "spend_caps#check"
    post "spend_caps/mark_notified", to: "spend_caps#mark_notified"
    # User clicks Allow/Deny on a dangerous-command approval in the UI →
    # Rails relays the decision to the engine via Redis pub/sub.
    resources :command_approvals, only: [ :create ]
    # Item 4 — frontend looks up an action approval by the engine-generated
    # approval_token to PATCH /pending_approvals/:id with the user's decision.
    get "action_approvals/by_token", to: "action_approvals#by_token"
    # cloud-init callback: engine posts when its container is up + healthy.
    post "agent_instances/ready", to: "agent_instances#ready"
    # Engine fetches the canonical supported-integrations list from Composio
    # at boot + every 30 min. Source of truth — no hard-coded list to drift.
    get "integrations/supported", to: "integrations#supported"
    # Engine fetches the agent's CONNECTED Nango providers (for nango_request).
    get "integrations", to: "integrations#connected"
    # Engine's nango_request tool proxies a provider API call through here.
    post "nango_proxy", to: "integrations#proxy"
    # Engine asks for a stored credential via the secrets.get MCP tool.
    # ACL: Credential.find_for resolves per-agent grant first, falls back to
    # org default. Every fetch writes an audit log row.
    get "secrets", to: "secrets#show"
    # Engine asks for the agent's connected external MCP servers + fresh tokens.
    get "mcp_servers", to: "mcp_servers#index"
    # Skill self-authoring — agents create + install skills via the engine's
    # skills.create / skills.install_on_me MCP tools. Both require the
    # engine secret; org scoping flows from agent_id → agent.organization_id.
    resources :skills, only: [ :create ] do
      collection do
        post :install_on_agent
      end
    end
  end

  # Webhook gateway (external services + dashboard chat)
  scope :webhooks do
    post :email, to: "webhooks#email"
    post :email_bounces, to: "webhooks#email_bounces"
    post :email_complaints, to: "webhooks#email_complaints"
    post :slack, to: "webhooks#slack"
    post "slack/commands",      to: "webhooks#slack_command"
    post "slack/interactivity", to: "webhooks#slack_interactivity"
    post :whatsapp, to: "webhooks#whatsapp"
    post :sms, to: "webhooks#sms"
    post "telegram/:bot_token", to: "webhooks#telegram", as: :telegram_webhook
    post :web, to: "webhooks#web"
  end

  # Admin panel (owner + admin roles only — gate is in Admin::BaseController).
  # Covers: dashboard overview, templates, skills, agents, users,
  # organizations, and the Forge runner.
  namespace :admin do
    root to: "dashboard#index", as: :root
    get "dashboard", to: "dashboard#index"

    resources :templates, only: [ :index, :new, :update, :destroy ] do
      collection do
        post :draft          # AI Template Creator: run preview (no DB write)
        post :commit         # AI Template Creator: commit the preview
        post :bulk_destroy
      end
    end
    resources :skills, only: [ :index, :new, :update, :destroy ] do
      member { post :resync }
      collection do
        post :draft        # AI Skill Creator: run preview (no DB write)
        post :commit       # AI Skill Creator: commit the preview
        post :bulk_destroy
      end
    end
    resources :agents, only: [ :index, :update, :destroy ] do
      collection { post :bulk_destroy }
    end
    resources :users, only: [ :index, :update, :destroy ] do
      member { post :masquerade }
      collection { post :bulk_destroy }
    end
    resources :organizations, only: [ :index, :update, :destroy ] do
      collection { post :bulk_destroy }
    end

    # Forge runner — kicks the background job, polls for status.
    get  "forge",                  to: "forge#show"
    post "forge",                  to: "forge#create"
    post "forge/reset",            to: "forge#reset_state"
    post "forge/lint",             to: "forge#lint"             # ?unpublish=1 to also unpublish failures
    post "forge/republish_passing", to: "forge#republish_passing"
    post "forge/dedup",            to: "forge#dedup"
  end

  # `npx agentmanifest deploy` posts the packed folder here (no auth — the
  # CLI has no session, so this must live outside `authenticate :user`).
  # The bundle is validated, cached briefly, and the response URL opens the
  # wizard (/deploy-agent?upload=<id>) where the real, authenticated deploy
  # happens.
  post "agent_bundles/upload", to: "agent_bundles#upload", as: :upload_agent_bundles

  # Shareable deploy link — the "Deploy to sentrel" button target:
  #   /deploy-agent?source=https://github.com/owner/repo[/tree/ref/subdir]
  # PUBLIC: anonymous visitors get the full bundle preview with a sign-in
  # overlay (the controller stores the return location); deploying still
  # requires auth via POST /agent_bundles.
  get "deploy-agent", to: "agent_bundles#new", as: :deploy_agent

  # Authenticated routes
  authenticate :user do
    # Stop an in-flight admin masquerade. Lives outside /admin because
    # while impersonating, current_user is the target (not necessarily a
    # platform admin) and the /admin gate would block the escape hatch.
    resource :masquerade, only: [ :destroy ], controller: "masquerades"

    get "onboarding", to: "onboarding#show", as: :onboarding
    post "onboarding/analyze", to: "onboarding#analyze", as: :onboarding_analyze
    get "onboarding/status", to: "onboarding#status", as: :onboarding_status
    post "onboarding/setup_mailbox", to: "onboarding#setup_mailbox", as: :onboarding_setup_mailbox
    post "onboarding/verify_mailbox", to: "onboarding#verify_mailbox", as: :onboarding_verify_mailbox
    post "onboarding/connect_provider", to: "onboarding#connect_provider", as: :onboarding_connect_provider
    post "onboarding/complete", to: "onboarding#complete", as: :onboarding_complete
    post "onboarding/skip", to: "onboarding#skip", as: :onboarding_skip

    get "dashboard", to: "dashboard#index", as: :dashboard

    # User-facing org management: create a new org (→ onboarding) and switch
    # the active org. One account / email, many organizations. Distinct from
    # the cross-tenant /admin/organizations panel above.
    resources :organizations, only: [ :create ] do
      member { post :switch }
    end

    get "agents/tree", to: "agents#tree", as: :agents_tree
    # Deploy an agent-bundle/v1 folder (the open agent-manifest format) from a
    # GitHub URL or an uploaded .tar.gz — the server half of
    # `npx agentmanifest deploy`.
    resources :agent_bundles, only: [ :create ]
    get "agents/:agent_id/screen", to: "agent_screens#show", as: :agent_screen
    resources :agents do
      resources :conversations, only: [ :index, :show ] do
        member do
          patch :archive
          patch :unarchive
        end
      end
      resources :channel_configs, only: [ :index, :create, :update, :destroy ] do
        member do
          post :resync_inbound
        end
        collection do
          get :twilio_numbers
          get :available_numbers
          post :buy_number
        end
      end
      resources :agent_skills, only: [ :create, :update, :destroy ]
      resources :scheduled_tasks, only: [ :index, :create, :update, :destroy ]
      resources :agent_webhooks, only: [ :create, :update, :destroy ], path: "webhooks"
      get "chat/stream", to: "chat_streams#show"
      get "chat/poll", to: "chat_polls#show"
      # Day-2 ops on the agent's Fly Machine — one-click restart / reload
      # config / redeploy / destroy + recreate, plus a live log tail.
      post "ops/restart",     to: "agents/ops#restart",     as: :agent_ops_restart
      post "ops/reload",      to: "agents/ops#reload",      as: :agent_ops_reload
      post "ops/redeploy",    to: "agents/ops#redeploy",    as: :agent_ops_redeploy
      post "ops/reprovision", to: "agents/ops#reprovision", as: :agent_ops_reprovision
      get  "ops/logs",        to: "agents/ops#logs",        as: :agent_ops_logs
      # Quick model switch from the agent page top bar (AgentModelPicker).
      resource :ai_config, only: [ :update ], module: :agents, controller: :ai_configs
      # Per-agent ACL on third-party tool calls. The Permissions tab on the
      # agent edit page reads + writes these.
      resources :tool_policies, only: [ :index, :update ], module: :agents do
        collection do
          get "tools/:toolkit_slug", action: :tools, as: :tools
        end
      end
      # Human user composes / replies to an email AS the agent (uses the
      # agent's SES identity but persists Message.sender_user_id +
      # AuditLog.acting_user_id so the trail attributes it to the human).
      resources :outbound_emails, only: [ :create ], module: :agents
    end

    resources :tasks do
      resources :comments, controller: "task_comments", only: [ :create, :destroy ]
      member do
        post :cancel
      end
    end

    # Knowledge base (RAG) — per-agent document upload + index management
    resources :agents, only: [] do
      resources :knowledge_documents, only: [ :index, :create, :destroy ] do
        member do
          post :promote
        end
      end
      # File finder — whole files (ActiveStorage), browsed/read by the agent
      # via the engine list_files / read_file tools. Not vectorized.
      resources :files, only: [ :index, :create, :destroy ], controller: "agent_files" do
        member do
          post :promote
        end
      end
    end
    # Community + system templates. System seeds (organization_id IS NULL,
    # system_template = true) are visible to every org; org-owned templates
    # (created via "Save as template" on the agent edit page) stay private
    # to the org unless published = true.
    resources :agent_templates, only: [ :index, :show, :create, :update, :destroy ] do
      member do
        get  :export    # current version's definition (agent.json)
        post :publish   # new version from { agent_id, ... }
      end
      collection do
        get  "import", to: "agent_templates#new_import"  # Inertia import form
        post :import                                       # paste / file / URL → new template + v1
      end
      # Browse + fetch any historical version of a template.
      resources :versions, only: [ :index, :show ], controller: "agent_template_versions"
    end

    # Per-agent JSON export — same Exporter payload, no template intermediate.
    # Used by the "Download agent.json" button on the agent edit page.
    get "agents/:id/export", to: "agents#export", as: :export_agent

    # Skills editor + marketplace. Org-owned skills (organization_id is set)
    # are editable by anyone in that org; marketplace-published skills
    # (visibility = "marketplace", published = true) are visible to every org
    # but only editable by the owning org. Forking copies a marketplace skill
    # into the current org so users can customize without affecting the
    # original. Slug is the URL identifier (param: :id below).
    resources :skills, only: [ :index, :show, :new, :create, :edit, :update, :destroy ], param: :id do
      member do
        post :publish
        post :unpublish
        post :fork
      end
    end

    # Fleet-wide ops: roll-update every agent's engine image in the org.
    post "ops/roll_engine", to: "ops#roll_engine", as: :ops_roll_engine

    # Team management — invite teammates, manage roles.
    resources :invitations, only: [ :index, :create, :destroy ] do
      member { post :resend }
    end
    get  "invite/:token",        to: "invitations#show",   as: :invitation_link
    post "invite/:token/accept", to: "invitations#accept", as: :accept_invitation
    resources :reports, only: [ :index ]
    resources :integrations, only: [ :index, :destroy ] do
      collection do
        post ":service_name/connect", action: :connect, as: :connect
        get :callback
        post :refresh
        # Catalog entries we don't have an auth_config for yet — users click
        # "Request" and we record demand here, surfacing aggregate counts to
        # ops so prioritisation is data-driven.
        post ":service_name/request", action: :request_integration, as: :request_integration
        # Observability — recent connected-app API calls (audit log) for this org.
        get :activity

        # ── Nango-backed connect flow (managed / byo_oauth / byo_token) ──
        # Managed + BYO-OAuth: mint a Nango Connect session; the browser SDK
        # runs the OAuth UI and hands the connection id back to #nango_finalize.
        post ":service_name/nango_session",  action: :nango_session,  as: :nango_session
        post ":service_name/nango_finalize", action: :nango_finalize, as: :nango_finalize
        # Paste-token: store a Credential + connect the app without OAuth.
        post ":service_name/paste_token",    action: :paste_token,    as: :paste_token
        # Org admin: set an app's connect mode + (for byo_oauth) app creds.
        post ":service_name/org_config",     action: :org_config,     as: :org_config
      end
    end

    # OAuth-connected external MCP servers (Meta Ads MCP, etc.). Endpoints are
    # discovered from the server's well-known metadata, not hardcoded.
    resources :mcp_servers, only: [ :index, :create, :destroy ] do
      member     { get :connect }
      collection { get :callback }
    end

    # OAuth flows for AI provider subscriptions (Anthropic Pro/Max/Team,
    # ChatGPT Plus/Pro/Business). NOT loaded into agents as MCP tools —
    # these configure the engine's LLM provider auth instead.
    get    "oauth/:provider/connect",    to: "oauth#connect",    as: :oauth_connect,
           constraints: { provider: /anthropic|openai/ }
    get    "oauth/:provider/callback",   to: "oauth#callback",   as: :oauth_callback,
           constraints: { provider: /anthropic|openai/ }
    delete "oauth/:provider/disconnect", to: "oauth#disconnect", as: :oauth_disconnect,
           constraints: { provider: /anthropic|openai/ }
    # Manual token paste flow — claude /login locally, paste the result here.
    # Works because claude.ai/oauth/authorize rejects unregistered client_ids.
    post   "oauth/anthropic/import_token", to: "oauth#import_token", as: :oauth_import_anthropic
  end

  # Slack-as-channel OAuth install. Agent-scoped: /slack/install?agent_id=AGT
  # → consent screen → /slack/oauth/callback exchanges code and persists a
  # ChannelConfig + encrypted bot_token. Distinct from Slack-as-integration
  # (Composio path), which gives agents Slack tool calls instead of making
  # them the bot user.
  authenticate :user do
    get    "slack/install",            to: "slack_oauth#install",    as: :slack_install
    delete "slack/oauth/disconnect",   to: "slack_oauth#disconnect", as: :slack_disconnect
  end
  get "slack/oauth/callback", to: "slack_oauth#callback", as: :slack_oauth_callback

  # OAuth 2.0 self-identifying client metadata documents (RFC-style, public).
  # Anthropic's claude.ai/oauth/authorize accepts any URL as client_id as long
  # as it serves valid OAuth client metadata. Hosting our own here means we
  # don't need a registered Anthropic client_id — we self-publish.
  get "oauth/anthropic/client-metadata", to: "oauth#anthropic_client_metadata", as: :anthropic_client_metadata
  get "oauth/openai/client-metadata",    to: "oauth#openai_client_metadata",    as: :openai_client_metadata

  # Authenticated routes (close the block reopened above).
  authenticate :user do
    resources :pending_approvals, only: [ :index, :update ]
    resources :audit_logs, only: [ :index ]
    # Filterable audit trail of every approval decision (manual + auto-rule),
    # with CSV export for compliance reviews.
    get "audits/approvals", to: "audits#approvals", as: :audits_approvals
    get "audits/approvals.csv", to: "audits#approvals", defaults: { format: "csv" }
    # Approval rules CRUD — org-wide + per-agent rules that the engine
    # consults via Api::ApprovalRulesController#match before pausing for
    # a human. Audit-logged on every create/update/toggle/destroy.
    resources :approval_rules, only: [ :index, :create, :update, :destroy ] do
      member { post :toggle }
      collection { post :test } # dry-run a predicate against last N days of approvals
    end

    # Observability — run timings, costs, tool call trees, error tracking
    namespace :ops do
      resources :runs, only: [ :index, :show ]
      get "cost", to: "cost#index"
      # Item 7 — delegation tree view: one row per top-level user request,
      # expandable to show every spawned task across agents. The `by_job`
      # route lets the chat UI deep-link to a trace when it only knows the
      # engine's job_id (carried on the assistant Message's metadata).
      get "traces/by_job/:job_id", to: "traces#by_job", as: :traces_by_job
      resources :traces, only: [ :index, :show ]
    end

    resource :settings, only: [ :show, :update ] do
      post :verify_domain
      post :check_domain_verification
      post :claim_managed_subdomain
      post :reset_email_domain
      get  :subdomain_availability
      get  :ses_status
      get  :email_change_impact
    end

    # BYO secrets (LLM API keys, cloud provider creds, generic API keys).
    # LLM keys auto-pipe into the agent's Fly machine env via
    # AgentProvisioner. Cloud + generic creds expose via the secrets.get
    # MCP tool. Per-agent ACL: agent_credential_grants restricts which
    # creds a given agent may use (empty = use org defaults).
    resources :credentials, only: [ :index, :create, :update, :destroy ], path: "settings/credentials"
  end

  # Root always renders the public landing page (auth-aware actions inside).
  root "home#index"

  # Public-facing catalog of 100+ ready-to-hire agent roles. Each card has
  # the role, what it does, suggested skills + integrations, and a deep
  # link to /agents/new pre-filled with the template. Aspirational right
  # now — not every role has a seeded AgentTemplate yet, the page is the
  # spec we build templates against.
  get "use-cases", to: "home#use_cases"

  # Public community + system agent-template gallery. Unauthenticated — the
  # per-card "Deploy" button funnels into /agents/new?template=… (which
  # prompts sign-in when needed). Distinct from the auth-gated in-app
  # /agent_templates library.
  get "templates", to: "templates#index", as: :templates
  # Public per-template detail page (the "View" target). Deploy still routes
  # through /agents/new?template=… from here.
  get "templates/:slug", to: "templates#show", as: :community_template
end
