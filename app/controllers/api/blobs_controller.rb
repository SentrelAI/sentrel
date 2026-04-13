class Api::BlobsController < ApplicationController
  skip_before_action :verify_authenticity_token
  skip_before_action :set_tenant
  before_action :authenticate_engine!, only: [:create]
  # show (download) is open — the signed_id is unguessable and acts as auth.
  # This lets Twilio fetch media URLs for WhatsApp outbound.

  # POST /api/blobs
  # Used by the engine to upload files (e.g. email attachments)
  def create
    file = params[:file]
    return render json: { error: "No file" }, status: :bad_request unless file

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
  # Sprint 2 — engine downloads blob bytes for media processing
  # (transcription, saving to workspace for agent to Read, etc.)
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
