# Configure ActiveRecord::Encryption from ENV vars instead of the encrypted
# credentials file. Lets us rotate keys via Kamal secrets without re-keying
# the credentials.yml.enc bundle.
#
# Required by OauthCredential's `encrypts` columns. Without these set,
# every save raises "Missing Active Record encryption credential:
# active_record_encryption.primary_key".
if ENV["ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY"].present?
  ActiveRecord::Encryption.configure(
    primary_key:         ENV["ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY"],
    deterministic_key:   ENV["ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY"],
    key_derivation_salt: ENV["ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT"],
  )
end
