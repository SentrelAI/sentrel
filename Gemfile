source "https://rubygems.org"

gem "rails", "~> 8.1.3"
gem "pg", "~> 1.1"
gem "puma", ">= 5.0"
gem "propshaft"

# Frontend
gem "inertia_rails"
gem "vite_rails"
gem "js-routes"

# Auth & Multi-tenancy
gem "devise"
gem "acts_as_tenant"
gem "pundit"

# Background Jobs & Redis
gem "sidekiq"
gem "redis"

# Channels
gem "twilio-ruby"

# AWS
gem "aws-sdk-ec2"
gem "aws-sdk-ses"
gem "aws-sdk-sns"

# Security & Utilities
gem "rack-attack"
gem "bcrypt", "~> 3.1.7"
gem "bootsnap", require: false
gem "tzinfo-data", platforms: %i[ windows jruby ]
gem "image_processing", "~> 1.2"

# Deployment
gem "kamal", require: false
gem "thruster", require: false

group :development, :test do
  gem "debug", platforms: %i[ mri windows ], require: "debug/prelude"
  gem "bundler-audit", require: false
  gem "brakeman", require: false
  gem "rubocop-rails-omakase", require: false
  gem "dotenv-rails"
end

group :development do
  gem "web-console"
end

gem "rspec-rails", "~> 8.0", groups: [:development, :test]
