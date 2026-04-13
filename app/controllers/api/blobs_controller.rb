class Api::BlobsController < ApplicationController
  skip_before_action :verify_authenticity_token
  skip_before_action :set_tenant
  before_action :authenticate_engine!, only: [:create]

  # Sprint 5 — upload safety
  MAX_UPLOAD_BYTES = (ENV.fetch("MAX_UPLOAD_MB", "25").to_i * 1024 * 1024)

  ALLOWED_CONTENT_TYPES = [
    %r{^image/(png|jpe?g|gif|webp|heic|svg\+xml)$},
    %r{^audio/},
    %r{^video/(mp4|quicktime|webm)$},
    %r{^application/(pdf|json|zip|gzip)$},
    %r{^application/vnd\.openxmlformats-officedocument},
    %r{^application/(msword|vnd\.ms-excel|vnd\.ms-powerpoint)$},
    %r{^text/},
  ].freeze

  BLOCKED_EXTENSIONS = %w[exe bat scr cmd com pif vbs js ps1 sh msi dll sys].freeze

  # POST /api/blobs
  def create
    file = params[:file]
    return render json: { error: "No file" }, status: :bad_request unless file

    # Size check
    if file.size > MAX_UPLOAD_BYTES
      return render json: { error: "File too large (max #{MAX_UPLOAD_BYTES / 1.megabyte}MB)" }, status: :payload_too_large
    end

    # Extension check
    ext = File.extname(file.original_filename).delete(".").downcase
    if BLOCKED_EXTENSIONS.include?(ext)
      return render json: { error: "File type .#{ext} is not allowed" }, status: :unprocessable_entity
    end

    # Content type check
    unless ALLOWED_CONTENT_TYPES.any? { |pattern| pattern.match?(file.content_type) }
      return render json: { error: "Content type #{file.content_type} is not allowed" }, status: :unprocessable_entity
    end

    blob = ActiveStorage::Blob.create_and_upload!(
      io: file.tempfile,
      filename: file.original_filename,
      content_type: file.content_type,
    )

    render json: {
      signed_id: blob.signed_id,
      filename: blob.filename.to_s,
      content_type: blob.content_type,
      byte_size: blob.byte_size,
    }
  end

  # GET /api/blobs/:signed_id
  # Open endpoint — signed_id is unguessable auth (Rails MessageVerifier).
  # Used by engine (media processing) and Twilio (WhatsApp MediaUrl).
  def show
    blob = ActiveStorage::Blob.find_signed!(params[:signed_id])
    send_data blob.download,
              filename: blob.filename.to_s,
              type: blob.content_type,
              disposition: "inline"
  rescue ActiveSupport::MessageVerifier::InvalidSignature
    head :not_found
  end

  private

  def authenticate_engine!
    secret = ENV["ENGINE_API_SECRET"]
    return head :unauthorized unless secret.present?
    return head :unauthorized unless request.headers["X-Engine-Secret"] == secret
  end
end
