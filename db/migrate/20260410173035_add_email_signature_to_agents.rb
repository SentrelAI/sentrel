class AddEmailSignatureToAgents < ActiveRecord::Migration[8.1]
  def change
    add_column :agents, :email_signature_md, :text
  end
end
