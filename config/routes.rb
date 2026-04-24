Rails.application.routes.draw do
  devise_for :users, controllers: {
    sessions: "users/sessions",
    registrations: "users/registrations"
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
    # User clicks Allow/Deny on a dangerous-command approval in the UI →
    # Rails relays the decision to the engine via Redis pub/sub.
    resources :command_approvals, only: [:create]
    # cloud-init callback: engine posts when its container is up + healthy.
    post "agent_instances/ready", to: "agent_instances#ready"
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
    get "dashboard", to: "dashboard#index", as: :dashboard

    get "agents/tree", to: "agents#tree", as: :agents_tree
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
      scope module: :agents, path: "ops" do
        post "restart",     to: "ops#restart",     as: :agent_ops_restart
        post "reload",      to: "ops#reload",      as: :agent_ops_reload
        post "redeploy",    to: "ops#redeploy",    as: :agent_ops_redeploy
        post "reprovision", to: "ops#reprovision", as: :agent_ops_reprovision
        get  "logs",        to: "ops#logs",        as: :agent_ops_logs
      end
      # Quick model switch from the agent page top bar (AgentModelPicker).
      resource :ai_config, only: [:update], module: :agents, controller: :ai_configs
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
      end
    end
    resources :pending_approvals, only: [:index, :update]
    resources :audit_logs, only: [:index]

    # Observability — run timings, costs, tool call trees, error tracking
    namespace :ops do
      resources :runs, only: [:index, :show]
      get "cost", to: "cost#index"
    end

    resource :settings, only: [:show, :update] do
      post :verify_domain
      post :check_domain_verification
    end
  end

  # Root always renders the public landing page (auth-aware actions inside).
  root "home#index"
end
