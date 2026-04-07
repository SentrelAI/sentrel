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

  # Authenticated routes
  authenticate :user do
    root "dashboard#index", as: :authenticated_root

    resources :agents do
      resources :conversations, only: [:index, :show]
      resources :channel_configs, only: [:index, :create, :update, :destroy]
      resources :scheduled_tasks, only: [:index, :create, :update, :destroy]
    end

    resources :tasks
    resources :integrations, only: [:index, :create, :destroy]
    resources :pending_approvals, only: [:index, :update]
    resources :audit_logs, only: [:index]

    resource :settings, only: [:show, :update]
  end

  # Unauthenticated root
  devise_scope :user do
    root "devise/sessions#new"
  end
end
