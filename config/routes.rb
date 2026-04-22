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
    root "dashboard#index", as: :authenticated_root

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
    end

    resources :tasks do
      resources :comments, controller: "task_comments", only: [:create, :destroy]
      member do
        post :cancel
      end
    end

    # Knowledge base (RAG) — per-agent document upload + index management
    resources :agents, only: [] do
      resources :knowledge_documents, only: [:index, :create, :destroy]
    end
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

  # Unauthenticated root — public marketing landing page
  root "home#index"
end
