Rails.application.routes.draw do
  devise_for :users, controllers: {
    sessions: "users/sessions",
    registrations: "users/registrations",
    passwords: "users/passwords"
  }

  # Redirect 127.0.0.1 to localhost for Vite
  constraints(host: "127.0.0.1") do
    get "(*path)", to: redirect { |params, req| "#{req.protocol}localhost:#{req.port}/#{params[:path]}" }
  end

  get "up" => "rails/health#show", as: :rails_health_check

  # API for engine→Rails (blob uploads, etc.)
  namespace :api do
    resources :blobs, only: [:create, :show], param: :signed_id
    resource :send_email, only: [:create]
    resources :task_events, only: [:create]
    # Engine relays every broadcast() event here; Rails re-emits over
    # AgentChatChannel so the browser sees live tool calls, progress, and
    # approval prompts without a direct WS into the engine.
    resources :agent_events, only: [:create]
    # Engine consults this from the request_approval tool before pausing,
    # to honor standing rules ("auto-approve LinkedIn < 3/day", etc.).
    post "approval_rules/match", to: "approval_rules#match"
    # Engine consults this before each run to enforce daily/monthly spend
    # caps + decide whether to post the "approaching cap" heads-up.
    get  "spend_caps/check",         to: "spend_caps#check"
    post "spend_caps/mark_notified", to: "spend_caps#mark_notified"
    # User clicks Allow/Deny on a dangerous-command approval in the UI →
    # Rails relays the decision to the engine via Redis pub/sub.
    resources :command_approvals, only: [:create]
    # Item 4 — frontend looks up an action approval by the engine-generated
    # approval_token to PATCH /pending_approvals/:id with the user's decision.
    get "action_approvals/by_token", to: "action_approvals#by_token"
    # cloud-init callback: engine posts when its container is up + healthy.
    post "agent_instances/ready", to: "agent_instances#ready"
    # Engine fetches the canonical supported-integrations list from Composio
    # at boot + every 30 min. Source of truth — no hard-coded list to drift.
    get "integrations/supported", to: "integrations#supported"
  end

  # Webhook gateway (external services + dashboard chat)
  scope :webhooks do
    post :email, to: "webhooks#email"
    post :email_bounces, to: "webhooks#email_bounces"
    post :email_complaints, to: "webhooks#email_complaints"
    post :slack, to: "webhooks#slack"
    post :whatsapp, to: "webhooks#whatsapp"
    post :sms, to: "webhooks#sms"
    post "telegram/:bot_token", to: "webhooks#telegram", as: :telegram_webhook
    post :web, to: "webhooks#web"
  end

  # Authenticated routes
  authenticate :user do
    get "onboarding", to: "onboarding#show", as: :onboarding
    post "onboarding/analyze", to: "onboarding#analyze", as: :onboarding_analyze
    get "onboarding/status", to: "onboarding#status", as: :onboarding_status
    post "onboarding/setup_mailbox", to: "onboarding#setup_mailbox", as: :onboarding_setup_mailbox
    post "onboarding/verify_mailbox", to: "onboarding#verify_mailbox", as: :onboarding_verify_mailbox
    post "onboarding/complete", to: "onboarding#complete", as: :onboarding_complete
    post "onboarding/skip", to: "onboarding#skip", as: :onboarding_skip

    get "dashboard", to: "dashboard#index", as: :dashboard

    get "agents/tree", to: "agents#tree", as: :agents_tree
    post "agents/draft", to: "agents#draft", as: :agents_draft
    get "agents/:agent_id/screen", to: "agent_screens#show", as: :agent_screen
    resources :agents do
      resources :conversations, only: [:index, :show]
      resources :channel_configs, only: [:index, :create, :update, :destroy] do
        collection do
          get :twilio_numbers
          get :available_numbers
          post :buy_number
        end
      end
      resources :agent_skills, only: [:create, :update, :destroy]
      resources :scheduled_tasks, only: [:index, :create, :update, :destroy]
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
      resource :ai_config, only: [:update], module: :agents, controller: :ai_configs
      # Per-agent ACL on third-party tool calls. The Permissions tab on the
      # agent edit page reads + writes these.
      resources :tool_policies, only: [:index, :update], module: :agents do
        collection do
          get "tools/:toolkit_slug", action: :tools, as: :tools
        end
      end
    end

    resources :tasks do
      resources :comments, controller: "task_comments", only: [:create, :destroy]
      member do
        post :cancel
      end
    end

    # Knowledge base (RAG) — per-agent document upload + index management
    resources :agents, only: [] do
      resources :knowledge_documents, only: [:index, :create, :destroy] do
        member do
          post :promote
        end
      end
    end
    resources :agent_templates, only: [:index, :show]

    # Fleet-wide ops: roll-update every agent's engine image in the org.
    post "ops/roll_engine", to: "ops#roll_engine", as: :ops_roll_engine

    # Team management — invite teammates, manage roles.
    resources :invitations, only: [:index, :create, :destroy]
    get  "invite/:token",        to: "invitations#show",   as: :invitation_link
    post "invite/:token/accept", to: "invitations#accept", as: :accept_invitation
    resources :reports, only: [:index]
    resources :integrations, only: [:index, :destroy] do
      collection do
        post ":service_name/connect", action: :connect, as: :connect
        get :callback
        post :refresh
        # Catalog entries we don't have an auth_config for yet — users click
        # "Request" and we record demand here, surfacing aggregate counts to
        # ops so prioritisation is data-driven.
        post ":service_name/request", action: :request_integration, as: :request_integration
      end
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

  # OAuth 2.0 self-identifying client metadata documents (RFC-style, public).
  # Anthropic's claude.ai/oauth/authorize accepts any URL as client_id as long
  # as it serves valid OAuth client metadata. Hosting our own here means we
  # don't need a registered Anthropic client_id — we self-publish.
  get "oauth/anthropic/client-metadata", to: "oauth#anthropic_client_metadata", as: :anthropic_client_metadata
  get "oauth/openai/client-metadata",    to: "oauth#openai_client_metadata",    as: :openai_client_metadata

  # Authenticated routes (close the block reopened above).
  authenticate :user do

    resources :pending_approvals, only: [:index, :update]
    resources :audit_logs, only: [:index]
    # Filterable audit trail of every approval decision (manual + auto-rule),
    # with CSV export for compliance reviews.
    get "audits/approvals", to: "audits#approvals", as: :audits_approvals
    get "audits/approvals.csv", to: "audits#approvals", defaults: { format: "csv" }
    # approval_rules CRUD UI is a follow-up — for MVP, rules are created via
    # Rails console: ApprovalRule.create!(organization:, payload_type: "linkedin_post",
    #   predicate: { max_per_day: 3 }, auto_decision: "approve", label: "...")

    # Observability — run timings, costs, tool call trees, error tracking
    namespace :ops do
      resources :runs, only: [:index, :show]
      get "cost", to: "cost#index"
      # Item 7 — delegation tree view: one row per top-level user request,
      # expandable to show every spawned task across agents. The `by_job`
      # route lets the chat UI deep-link to a trace when it only knows the
      # engine's job_id (carried on the assistant Message's metadata).
      get "traces/by_job/:job_id", to: "traces#by_job", as: :traces_by_job
      resources :traces, only: [:index, :show]
    end

    resource :settings, only: [:show, :update] do
      post :verify_domain
      post :check_domain_verification
      post :claim_managed_subdomain
      post :reset_email_domain
      get  :subdomain_availability
    end
  end

  # Root always renders the public landing page (auth-aware actions inside).
  root "home#index"
end
