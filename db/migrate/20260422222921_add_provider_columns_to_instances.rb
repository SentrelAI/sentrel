class AddProviderColumnsToInstances < ActiveRecord::Migration[8.0]
  def change
    # Generalize the AWS-shaped instances table so it works for Fly, Hetzner,
    # DO, etc. The old aws_* columns stay for now — drop them in a later
    # cleanup pass once nothing reads them.
    add_column :instances, :provider,     :string, default: "fly", null: false
    add_column :instances, :machine_id,   :string   # fly machine id / hetzner server id / aws i-xxx
    add_column :instances, :public_ip,    :string   # ipv4
    add_column :instances, :private_ip,   :string   # ipv6 or VPC-internal
    add_column :instances, :machine_type, :string   # "shared-cpu-1x", "cax11", etc.
    add_column :instances, :health_checked_at, :datetime
    add_column :instances, :provisioning_error, :text

    add_index :instances, [:provider, :machine_id]
  end
end
