class ApplicationController < ActionController::Base
  include Pundit::Authorization
  include Masquerading

  allow_browser versions: :modern

  set_current_tenant_through_filter
  before_action :redirect_apex_to_www
  before_action :set_tenant

  before_action :configure_permitted_parameters, if: :devise_controller?
  before_action :consume_pending_invitation, if: :user_signed_in?
  before_action :redirect_to_onboarding, if: :user_signed_in?

  # Share current user and org with all Inertia pages.
  #   is_platform_admin → controls the cross-tenant /admin sidebar link
  #                       (ScribeMD employees only; checked via email allowlist
  #                       in User#platform_admin?).
  #   is_org_admin      → controls in-org admin features (invite, billing,
  #                       org settings). True for org owners + admins.
  inertia_share do
    {
      auth: {
        user: current_user&.as_json(only: [ :id, :name, :email, :role ]),
        organization: current_tenant&.as_json(only: [ :id, :name, :slug, :onboarding_completed_at ]),
        # Every org this user can switch into, with their role in each. Drives
        # the org switcher in the sidebar user menu.
        organizations: current_user ? current_user_organizations_payload : []
      },
      is_platform_admin: current_user&.platform_admin? || false,
      is_org_admin: current_user&.admin? || false,
      # Set only while a platform admin has started a masquerade — the
      # banner reads this to render the warning bar and "Stop" button.
      masquerade: impersonating? ? {
        admin: true_user&.as_json(only: [ :id, :name, :email ]),
        target: current_user&.as_json(only: [ :id, :name, :email ])
      } : nil,
      # Tree of every agent in the workspace + each agent's unread inbox /
      # pending-approval counts. Drives the sidebar's agent disclosure
      # tree. Sub-agents nest under their manager. Skipped on unauth-ed
      # / onboarding flows to keep the payload light.
      agents_tree: current_tenant && current_user && current_tenant.onboarding_completed_at.present? ? build_agents_tree_payload : nil,
      flash: {
        success: flash[:notice],
        error: flash[:alert]
      }
    }
  end

  def after_sign_in_path_for(resource)
    # Honor a stored return location (e.g. a shared /deploy-agent link the
    # visitor hit while logged out) before falling back to the dashboard.
    stored_location_for(resource) || dashboard_path
  end

  private

  # Sidebar agent tree — flat array of every agent plus an indented_depth
  # so the React side can render nesting without re-walking the tree.
  # Includes pending approval + unread inbox counts as badges.
  def build_agents_tree_payload
    agents = current_tenant.agents
                            .select(:id, :name, :slug, :role, :status, :manager_id)
                            .order(:name)
                            .to_a
    # Every pending approval counts — old ones are MORE urgent (waiting
    # longer), not less. Earlier "7-day staleness window" hid the signal
    # we most want to surface (real users let approvals sit for weeks).
    # Oldest-pending tracked separately so the badge can shift color
    # based on age (>3d amber, >7d red) without a second query.
    pending_counts = current_tenant.pending_approvals
                                    .where(status: "pending")
                                    .group(:agent_id).count
    pending_oldest = current_tenant.pending_approvals
                                     .where(status: "pending")
                                     .group(:agent_id)
                                     .minimum(:created_at)
    # "External" conversations with at least one inbound message in the last
    # 7 days approximate "unread inbox" cheaply — without a per-user read
    # state migration, this is the closest signal.
    inbox_counts = Conversation.where(agent_id: agents.map(&:id), kind: "external")
                                 .where.not(status: "archived")
                                 .group(:agent_id).count
    by_manager = agents.group_by(&:manager_id)
    rows = []
    build_node = ->(agent, depth) {
      oldest = pending_oldest[agent.id]
      rows << {
        id: agent.to_param,
        name: agent.name,
        slug: agent.slug,
        role: agent.role,
        status: agent.status,
        depth: depth,
        has_children: by_manager[agent.id]&.any? == true,
        pending_approvals: pending_counts[agent.id] || 0,
        # Frontend uses this to color the badge by age — older = redder.
        oldest_pending_age_hours: oldest ? ((Time.current - oldest) / 3600).to_i : nil,
        active_conversations: inbox_counts[agent.id] || 0,
      }
      (by_manager[agent.id] || []).each { |child| build_node.call(child, depth + 1) }
    }
    (by_manager[nil] || []).each { |root| build_node.call(root, 0) }
    rows
  end

  def redirect_apex_to_www
    return unless Rails.env.production? && request.host == "sentrel.ai"
    redirect_to "https://www.sentrel.ai#{request.fullpath}",
                status: :moved_permanently,
                allow_other_host: true
  end

  # Lookup a record by either its public prefix_id (agt_..., tsk_..., etc.)
  # or a raw numeric id. Relation-scoped — pass a chain like
  # `current_tenant.agents` to keep tenant isolation.
  #
  # The gem's `find()` override doesn't fire through tenant-scoped relations
  # (acts_as_tenant + prefixed_ids interaction), so we decode explicitly.
  def find_by_public_id!(scope, param)
    prefix_id = scope.klass.respond_to?(:_prefix_id) ? scope.klass._prefix_id : nil
    numeric   = prefix_id ? (prefix_id.decode(param, fallback: true) || param) : param
    scope.find(numeric)
  end

  def set_tenant
    if current_user
      set_current_tenant(current_user.organization)
      set_sentry_context
    end
  end

  # Orgs the current user belongs to, with their per-org role, ordered by name.
  # `is_current` marks the active org so the switcher can highlight it without
  # comparing ids on the client. Memberships aren't tenant-scoped, so this is a
  # single cross-org query.
  def current_user_organizations_payload
    active_org_id = current_user.organization_id
    current_user.memberships.includes(:organization).map do |m|
      {
        id: m.organization_id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
        is_current: m.organization_id == active_org_id
      }
    end.sort_by { |o| o[:name].to_s.downcase }
  end

  def set_sentry_context
    return unless defined?(Sentry) && Sentry.initialized?

    Sentry.set_user(id: current_user.id, email: current_user.email)
    Sentry.set_tags(org_id: current_tenant&.id, org_slug: current_tenant&.slug)
  end

  # After sign-in/up, auto-accept any invitation the user was mid-flow for
  # (captured in session by InvitationsController#accept when unauthenticated).
  def consume_pending_invitation
    token = session.delete(:pending_invitation_token) || params[:invitation].presence
    return unless token.present?
    inv = Invitation.find_by(token: token)
    return unless inv&.pending?
    return unless inv.email.casecmp?(current_user.email) # must match the invited email
    inv.accept!(current_user)
    flash[:notice] = "Joined #{inv.organization.name}"
  rescue => e
    Rails.logger.warn "Invitation consume failed: #{e.message}"
  end

  def redirect_to_onboarding
    return if devise_controller?
    return if self.is_a?(OnboardingController)
    return if request.path.start_with?("/onboarding", "/api", "/webhooks", "/deploy-agent", "/hooks")
    return if current_tenant&.onboarding_completed_at.present?

    redirect_to onboarding_path
  end

  def configure_permitted_parameters
    devise_parameter_sanitizer.permit(:sign_up, keys: [ :name ])
    devise_parameter_sanitizer.permit(:account_update, keys: [ :name ])
  end
end
