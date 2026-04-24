import { Head, Link, router } from "@inertiajs/react"
import { useState } from "react"
import { Button } from "@/components/ui/button"

interface Props {
  invitation: { email: string; role: string; organization: string; token: string }
  signed_in: boolean
}

export default function AcceptInvitation({ invitation, signed_in }: Props) {
  const [busy, setBusy] = useState(false)

  function accept() {
    setBusy(true)
    const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
    const form = document.createElement("form")
    form.method = "POST"
    form.action = `/invite/${invitation.token}/accept`
    const csrfInput = document.createElement("input")
    csrfInput.type = "hidden"
    csrfInput.name = "authenticity_token"
    csrfInput.value = csrf
    form.appendChild(csrfInput)
    document.body.appendChild(form)
    form.submit()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Head title={`Join ${invitation.organization}`} />
      <div className="w-full max-w-md rounded-lg border bg-card p-8">
        <h1 className="text-xl font-semibold mb-2">Join {invitation.organization}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          You've been invited to join <strong>{invitation.organization}</strong> as <strong>{invitation.role}</strong> — for <code className="text-xs">{invitation.email}</code>.
        </p>

        {signed_in ? (
          <Button onClick={accept} disabled={busy} className="w-full">
            {busy ? "Joining…" : `Join ${invitation.organization}`}
          </Button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Sign in (or create an account) using <code className="text-xs">{invitation.email}</code>, then this invitation will be attached automatically.
            </p>
            <Button asChild className="w-full">
              <Link href={`/users/sign_in?invitation=${invitation.token}`}>Sign in</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href={`/users/sign_up?invitation=${invitation.token}`}>Create account</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
