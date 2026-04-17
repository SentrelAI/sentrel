namespace :backfill do
  desc "Step 4 — create a Conversation for every existing Task and mirror its comments as Messages."
  task task_conversations: :environment do
    ActsAsTenant.without_tenant do
      scope = Task.where(conversation_id: nil).includes(:agent, :organization, comments: [:user, :agent])
      total = scope.count
      puts "Backfilling #{total} task(s)..."

      scope.find_each.with_index do |task, i|
        Task.transaction do
          conv = Conversation.create!(
            organization: task.organization,
            agent: task.agent,
            user: task.assigned_by_user,
            kind: "internal",
            contact_identifier: "task-#{task.id}",
            contact_name: task.assigned_by_user&.name,
            contact_email: task.assigned_by_user&.email,
            subject: task.title,
            status: "active",
          )

          # Seed with the original task instruction as the first user message.
          seed = ["Task: #{task.title}", task.description, task.instruction].compact_blank.join("\n\n")
          conv.messages.create!(
            role: "user",
            content: seed,
            direction: "inbound",
            channel: "task",
            created_at: task.created_at,
            updated_at: task.created_at,
            metadata: { task_id: task.id, source: "backfill_task_created" },
          )

          # Mirror comments in chronological order
          task.comments.order(:created_at).each do |c|
            conv.messages.create!(
              role: c.agent_id ? "assistant" : "user",
              content: c.content,
              direction: c.agent_id ? "outbound" : "inbound",
              channel: "task",
              created_at: c.created_at,
              updated_at: c.updated_at,
              metadata: {
                task_id: task.id,
                task_comment_id: c.id,
                source: "backfill_task_comment",
              },
            )
          end

          task.update!(conversation: conv)
        end
        puts "  [#{i + 1}/#{total}] task ##{task.id} → conversation ##{task.reload.conversation_id}"
      end

      puts "Done."
    end
  end
end
