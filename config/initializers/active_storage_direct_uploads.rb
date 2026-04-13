# Direct upload security + validation
#
# Requires Devise auth, skips CSRF (session auth is sufficient for an
# idempotent blob-creation endpoint), and validates file size + type
# before creating the blob record.
Rails.application.config.to_prepare do
  ActiveStorage::DirectUploadsController.class_eval do
    before_action :authenticate_user!
    skip_before_action :verify_authenticity_token
    before_action :validate_blob_params, only: [:create]

    private

    def validate_blob_params
      max_bytes = (ENV.fetch("MAX_UPLOAD_MB", "25").to_i * 1024 * 1024)
      byte_size = blob_args[:byte_size].to_i
      content_type = blob_args[:content_type].to_s
      filename = blob_args[:filename].to_s

      if byte_size > max_bytes
        render json: { error: "File too large (max #{max_bytes / 1.megabyte}MB)" }, status: :payload_too_large
        return
      end

      blocked_exts = %w[exe bat scr cmd com pif vbs js ps1 sh msi dll sys]
      ext = File.extname(filename).delete(".").downcase
      if blocked_exts.include?(ext)
        render json: { error: "File type .#{ext} is not allowed" }, status: :unprocessable_entity
        return
      end
    end
  end
end
