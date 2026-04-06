class CreateInstances < ActiveRecord::Migration[8.1]
  def change
    create_table :instances do |t|
      t.references :agent, null: false, foreign_key: true, index: { unique: true }
      t.string :instance_type, default: "t3.micro"
      t.string :aws_instance_id
      t.string :aws_volume_id
      t.string :aws_ip_address
      t.string :region, default: "us-east-1"
      t.string :status, default: "pending", null: false
      t.datetime :started_at
      t.datetime :stopped_at

      t.timestamps
    end

  end
end
