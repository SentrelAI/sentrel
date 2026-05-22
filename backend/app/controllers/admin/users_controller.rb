module Admin
  class UsersController < BaseController
    include Admin::Concerns::BulkDestroyable
    # Guard: never bulk-destroy yourself.
    bulk_destroyable User, guard: ->(user, current_user) { user != current_user }

    def index
      q = params[:q].to_s.strip

      scope = User.includes(:organization).order(created_at: :desc)
      if q.present?
        like = "%#{q.downcase}%"
        scope = scope.where("LOWER(users.email) LIKE ? OR LOWER(users.name) LIKE ?", like, like)
      end

      pagy, rows = pagy(scope, limit: params[:per_page])

      render inertia: "admin/users/index", props: {
        users: rows.map { |u| serialize(u) },
        roles: %w[owner admin member viewer],
        pagy: pagy_props(pagy),
        q: q,
      }
    end

    def destroy
      user = User.find(params[:id])
      if user == current_user
        redirect_to admin_users_path, alert: "Can't delete yourself" and return
      end
      user.destroy!
      redirect_to admin_users_path, notice: "Deleted #{user.email}"
    end

    def update
      user = User.find(params[:id])
      attrs = params.permit(:role, :name, :platform_admin)
      # Coerce checkbox/JSON values for the boolean column.
      if attrs.key?(:platform_admin)
        attrs[:platform_admin] = ActiveModel::Type::Boolean.new.cast(attrs[:platform_admin])
      end
      # Block self-demotion from platform_admin — losing your own access
      # in one click is the easiest way to lock yourself out.
      if user == current_user && attrs.key?(:platform_admin) && attrs[:platform_admin] == false
        redirect_to admin_users_path, alert: "Can't revoke your own platform_admin here. Have another platform admin do it." and return
      end
      # Same protection on org role.
      if user == current_user && attrs[:role] && !%w[owner admin].include?(attrs[:role])
        redirect_to admin_users_path, alert: "Can't demote your own org role from here" and return
      end
      user.update!(attrs)
      redirect_to admin_users_path, notice: "Updated #{user.email}"
    end

    private

    def serialize(u)
      {
        id: u.id, name: u.name, email: u.email, role: u.role,
        platform_admin: u.platform_admin,
        organization: u.organization&.as_json(only: [:id, :name, :slug]),
        created_at: u.created_at, current_sign_in_at: u.try(:current_sign_in_at),
        is_current: u == current_user,
      }
    end
  end
end
