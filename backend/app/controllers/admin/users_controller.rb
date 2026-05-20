module Admin
  class UsersController < BaseController
    def index
      rows = User.includes(:organization).order(created_at: :desc).map { |u| serialize(u) }
      render inertia: "admin/users/index", props: {
        users: rows,
        roles: %w[owner admin member viewer],
      }
    end

    def update
      user = User.find(params[:id])
      attrs = params.permit(:role, :name)
      # Block self-demotion to avoid locking yourself out of admin.
      if user == current_user && attrs[:role] && !%w[owner admin].include?(attrs[:role])
        redirect_to admin_users_path, alert: "Can't demote your own admin role from here" and return
      end
      user.update!(attrs)
      redirect_to admin_users_path, notice: "Updated #{user.email}"
    end

    private

    def serialize(u)
      {
        id: u.id, name: u.name, email: u.email, role: u.role,
        organization: u.organization&.as_json(only: [:id, :name, :slug]),
        created_at: u.created_at, current_sign_in_at: u.try(:current_sign_in_at),
        is_current: u == current_user,
      }
    end
  end
end
