# Step 6 — real-time task comment updates.
# Clients subscribe with { task_id: N }. Server broadcasts new comments
# from both user actions (TaskCommentsController) and engine actions
# (via Api::TaskEventsController bridge).
class TaskChannel < ApplicationCable::Channel
  def subscribed
    task = Task.find_by(id: params[:task_id])
    return reject unless task
    return reject unless task.organization_id == current_user.organization_id

    stream_for task
  end
end
