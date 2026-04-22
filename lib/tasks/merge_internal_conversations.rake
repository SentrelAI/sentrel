namespace :merge do
  desc "Merge duplicate kind=internal conversations per (agent, user) into the most recently active one. Pass [dry] or DRY=1 to preview."
  task :internal_conversations, [:mode] => :environment do |_, args|
    dry = args[:mode].to_s.downcase == "dry" || ENV["DRY"] == "1"
    puts dry ? "DRY RUN — no writes" : "LIVE RUN — mutating database"
    puts ""

    ActsAsTenant.without_tenant do
      groups = Conversation.where(kind: "internal")
                           .where.not(user_id: nil)
                           .group(:agent_id, :user_id)
                           .having("COUNT(*) > 1")
                           .pluck(:agent_id, :user_id, Arel.sql("COUNT(*)"))

      if groups.empty?
        puts "No duplicate internal conversations found."
        next
      end

      puts "Found #{groups.size} (agent, user) pair(s) with duplicates."
      puts ""

      merged = 0
      msgs_moved = 0
      tasks_moved = 0

      groups.each do |agent_id, user_id, count|
        convs = Conversation.where(kind: "internal", agent_id: agent_id, user_id: user_id)
                            .order(updated_at: :desc, id: :desc)
        winner = convs.first
        losers = convs[1..] || []
        loser_ids = losers.map(&:id)

        msg_count_by_conv = Message.where(conversation_id: [winner.id, *loser_ids]).group(:conversation_id).count
        loser_msg_count = loser_ids.sum { |id| msg_count_by_conv[id] || 0 }
        task_count = Task.where(conversation_id: loser_ids).count

        summary = "agent ##{agent_id} user ##{user_id}: keep #{winner.to_param} (#{msg_count_by_conv[winner.id] || 0} msgs), merge #{loser_ids.inspect} (#{loser_msg_count} msgs, #{task_count} tasks)"

        if dry
          puts "  #{summary}"
          next
        end

        begin
          Conversation.transaction do
            if loser_ids.any?
              Message.where(conversation_id: loser_ids).update_all(conversation_id: winner.id, updated_at: Time.current)
              Task.where(conversation_id: loser_ids).update_all(conversation_id: winner.id, updated_at: Time.current)
              Conversation.where(id: loser_ids).delete_all
            end
          end
          merged += 1
          msgs_moved += loser_msg_count
          tasks_moved += task_count
          puts "  ✓ #{summary}"
        rescue => e
          puts "  ✗ #{summary} — FAILED: #{e.class}: #{e.message}"
        end
      end

      puts ""
      if dry
        puts "Dry run complete. Would merge #{groups.size} group(s)."
      else
        puts "Done. Merged #{merged}/#{groups.size} group(s). Reparented #{msgs_moved} msgs + #{tasks_moved} tasks."
      end
    end
  end
end
