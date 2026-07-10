class AddPersonaHistoryAndTemplateLineage < ActiveRecord::Migration[8.1]
  def change
    # Which catalog template (and version) an agent was created from —
    # the anchor for "propose this improvement back to the template".
    add_column :agents, :template_slug, :string
    add_column :agents, :template_version_number, :integer
    add_index  :agents, :template_slug

    # Every persona edit (identity/personality/instructions/signature)
    # keeps its before/after so admins can see what changed, when, by
    # whom — and promote proven improvements upstream to GitHub.
    create_table :agent_persona_revisions do |t|
      t.references :agent, null: false, foreign_key: true
      t.references :organization, null: false, foreign_key: true
      t.references :user, foreign_key: true
      t.string :field, null: false          # identity_md | personality_md | instructions_md | email_signature_md
      t.text :before_text
      t.text :after_text, null: false
      t.string :note                        # optional "why" the editor typed
      t.string :proposed_pr_url             # set once rolled up to GitHub
      t.timestamps
    end
    add_index :agent_persona_revisions, [ :agent_id, :created_at ]
  end
end
