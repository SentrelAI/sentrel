class InvitationsController < ApplicationController
  before_action :authenticate_user!, except: [ :show, :accept ]
  before_action :require_admin!, only: [ :index, :create, :destroy ]

  # GET /invitations
  def index
    invitations = current_tenant.invitations.order(created_at: :desc)
    # Everyone who belongs to this org (via memberships), not just users whose
    # active org happens to be this one — a teammate switched into another of
    # their orgs is still a member here. Role shown is their role IN this org.
    members = current_tenant.memberships.includes(:user)
                            .map { |m| member_json(m) }
                            .sort_by { |m| m[:email].to_s }
    render inertia: "invitations/index", props: {
      invitations: invitations.map { |i| invite_json(i) },
      members: members,
      current_role: current_user.role
    }
  end

  # POST /invitations
  def create
    email = params.require(:email).to_s.downcase.strip
    role = params[:role].to_s.presence || "member"
    return head :forbidden if role == "owner"

    inv = current_tenant.invitations.new(
      email: email,
      role: role,
      invited_by: current_user,
    )
    if inv.save
      InvitationMailer.invite(inv).deliver_later
      render json: { ok: true, invitation: invite_json(inv) }
    else
      render json: { ok: false, errors: inv.errors.full_messages }, status: :unprocessable_entity
    end
  end

  # DELETE /invitations/:id
  def destroy
    inv = current_tenant.invitations.find(params[:id])
    inv.destroy!
    redirect_to invitations_path, notice: "Invitation revoked"
  end

  # GET /invitations/:token/accept — user clicks the link in the email
  def show
    @invitation = Invitation.find_by!(token: params[:token])
    return redirect_to root_path, alert: "Invitation is expired or already used" unless @invitation.pending?
    render inertia: "invitations/accept", props: {
      invitation: {
        email: @invitation.email,
        role: @invitation.role,
        organization: @invitation.organization.name,
        token: @invitation.token
      },
      signed_in: user_signed_in?
    }
  rescue ActiveRecord::RecordNotFound
    redirect_to root_path, alert: "Invitation not found"
  end

  # POST /invitations/:token/accept
  def accept
    @invitation = Invitation.find_by!(token: params[:token])
    return redirect_to root_path, alert: "Invitation is expired or already used" unless @invitation.pending?

    # If the user isn't signed in we stash the token so Devise sign-in/up
    # flow can pick it up and call accept again after auth.
    unless user_signed_in?
      session[:pending_invitation_token] = @invitation.token
      return redirect_to new_user_registration_path
    end

    @invitation.accept!(current_user)
    redirect_to dashboard_path, notice: "Welcome to #{@invitation.organization.name}"
  rescue ActiveRecord::RecordNotFound
    redirect_to root_path, alert: "Invitation not found"
  end

  private

  def require_admin!
    head :forbidden unless %w[owner admin].include?(current_user.role)
  end

  def invite_json(inv)
    {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      status: inv.accepted_at ? "accepted" : (inv.expired? ? "expired" : "pending"),
      accepted_at: inv.accepted_at,
      expires_at: inv.expires_at,
      invited_by: inv.invited_by&.email,
      created_at: inv.created_at
    }
  end

  def user_json(u)
    { id: u.id, email: u.email, role: u.role, created_at: u.created_at }
  end

  # Like user_json, but role reflects the membership's role in THIS org rather
  # than the user's active-org role (which may point at a different org).
  def member_json(membership)
    u = membership.user
    { id: u.id, email: u.email, role: membership.role, created_at: membership.created_at }
  end
end
