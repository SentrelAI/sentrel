class TaskCommentsController < ApplicationController
  before_action :authenticate_user!

  def create
    task = current_tenant.tasks.find(params[:task_id])
    comment = task.comments.build(content: params[:content], user: current_user)

    if comment.save
      redirect_to task_path(task), notice: "Comment added"
    else
      redirect_back fallback_location: task_path(task), alert: comment.errors.full_messages.join(", ")
    end
  end

  def destroy
    task = current_tenant.tasks.find(params[:task_id])
    comment = task.comments.find(params[:id])
    comment.destroy
    redirect_to task_path(task), notice: "Comment deleted"
  end
end
