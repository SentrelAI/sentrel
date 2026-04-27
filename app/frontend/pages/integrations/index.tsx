import { Head, router } from "@inertiajs/react"
import { Plug, Trash2, Check, Sparkles, AlertTriangle } from "lucide-react"

import { Overline } from "@/components/brand"
import { PageHeader } from "@/components/page-header"
import AppLayout from "@/layouts/app-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const AVAILABLE_INTEGRATIONS = [
  { name: "apollo", label: "Apollo", description: "CRM and lead generation", category: "Sales" },
  { name: "hubspot", label: "HubSpot", description: "CRM, marketing, and sales", category: "Sales" },
  { name: "linkedin", label: "LinkedIn", description: "Professional network and outreach", category: "Sales" },
  { name: "gmail", label: "Gmail", description: "Email via Google", category: "Communication" },
  { name: "slack", label: "Slack", description: "Team messaging", category: "Communication" },
  { name: "intercom", label: "Intercom", description: "Customer support", category: "Communication" },
  { name: "googlecalendar", label: "Google Calendar", description: "Scheduling", category: "Productivity" },
  { name: "googlesheets", label: "Google Sheets", description: "Spreadsheets", category: "Productivity" },
  { name: "googledrive", label: "Google Drive", description: "Documents and files", category: "Productivity" },
  { name: "notion", label: "Notion", description: "Docs and wiki", category: "Productivity" },
  { name: "airtable", label: "Airtable", description: "Flexible database", category: "Productivity" },
  { name: "calendly", label: "Calendly", description: "Booking and scheduling", category: "Productivity" },
  { name: "github", label: "GitHub", description: "Code and PRs", category: "Engineering" },
  { name: "linear", label: "Linear", description: "Issue tracking", category: "Engineering" },
  { name: "vercel", label: "Vercel", description: "Frontend deployment", category: "Engineering" },
  { name: "stripe", label: "Stripe", description: "Payments and billing", category: "Finance" },
  { name: "twitter", label: "Twitter / X", description: "Social media", category: "Content" },
  { name: "figma", label: "Figma", description: "Design collaboration", category: "Content" },
  { name: "mailchimp", label: "Mailchimp", description: "Email marketing", category: "Content" },
  { name: "typeform", label: "Typeform", description: "Forms and surveys", category: "Content" },
  { name: "digital_ocean", label: "DigitalOcean", description: "Cloud infrastructure", category: "Engineering" },
]

interface Integration {
  id: number
  service_name: string
  status: string
  scopes: string[]
  created_at: string
}

interface AiAccount {
  provider: "anthropic" | "openai"
  connected: boolean
  account_email: string | null
  expires_at: string | null
  last_refreshed_at: string | null
}

interface Props {
  integrations: Integration[]
  ai_accounts: AiAccount[]
  oauth_configured: { anthropic: boolean; openai: boolean }
}

const AI_PROVIDER_META: Record<string, { label: string; description: string; rateLimit: string }> = {
  anthropic: {
    label: "Anthropic Account",
    description: "Connect your Claude Pro / Max / Team subscription. Agents use your existing quota instead of metered API.",
    rateLimit: "~250 msgs / 5h on Pro · 5× on Max",
  },
  openai: {
    label: "OpenAI Account",
    description: "Connect your ChatGPT Plus / Pro / Business subscription. Same auth that Codex CLI uses.",
    rateLimit: "~80 msgs / 3h on Plus",
  },
}

export default function IntegrationsIndex({ integrations, ai_accounts = [], oauth_configured = { anthropic: false, openai: false } }: Props) {
  async function connect(serviceName: string) {
    // Get the Composio OAuth URL from Rails, then open in a popup
    const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
    const res = await fetch(`/integrations/${serviceName}/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "X-CSRF-Token": csrfToken },
    })
    const data = await res.json()
    if (data.redirect_url) {
      const popup = window.open(data.redirect_url, "composio-connect", "width=600,height=700,left=200,top=100")
      // Poll for popup close, then refresh
      const timer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(timer)
          router.reload()
        }
      }, 500)
    } else if (data.error) {
      alert(data.error)
    }
  }

  function disconnect(id: number) {
    router.delete(`/integrations/${id}`)
  }

  const categories = [...new Set(AVAILABLE_INTEGRATIONS.map((i) => i.category))]

  return (
    <AppLayout
      crumbs={[
        { label: "Workspace", href: "/" },
        { label: "Integrations" },
      ]}
    >
      <Head title="Integrations" />

      <PageHeader
        eyebrow="Tools"
        title="Integrations"
        description="Connect the services your agents work inside. OAuth once, they use them forever."
      />

      <div className="space-y-8">
        <div>
          <Overline className="mb-3 flex items-center gap-2">
            <Sparkles className="size-3.5" /> AI accounts (subscription auth)
          </Overline>
          <p className="text-xs text-muted-foreground mb-3">
            Run agents on your Claude Pro / ChatGPT Plus subscription instead of paying per token.
            Subject to subscription rate limits — best for hands-on use, not autonomous fleets.
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            {ai_accounts.map((acc) => {
              const meta = AI_PROVIDER_META[acc.provider]
              const configured = oauth_configured[acc.provider]
              return (
                <div
                  key={acc.provider}
                  className={`group relative flex items-start gap-3 rounded-lg border px-3.5 py-3 transition-all ${
                    acc.connected
                      ? "border-[var(--color-success)]/30 bg-[var(--color-success)]/[0.04]"
                      : "hover:border-[var(--border-strong)]"
                  }`}
                >
                  <div
                    className={`relative flex size-9 shrink-0 items-center justify-center rounded-md border ${
                      acc.connected
                        ? "border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Sparkles className="size-4" />
                    {acc.connected && (
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-[var(--color-success)] text-white ring-2 ring-background">
                        <Check className="size-2.5" strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{meta.label}</p>
                    <p className="text-[11px] text-muted-foreground mb-1">{meta.description}</p>
                    <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground/80">
                      Limit: {meta.rateLimit}
                    </p>
                    {acc.connected && acc.account_email && (
                      <p className="text-[11px] mt-1 font-mono text-[var(--color-success)]">
                        {acc.account_email}
                      </p>
                    )}
                  </div>
                  {!configured ? (
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <AlertTriangle className="size-3" /> Not configured
                    </Badge>
                  ) : acc.connected ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 text-xs"
                      onClick={() => router.delete(`/oauth/${acc.provider}/disconnect`)}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 text-xs"
                      onClick={() => (window.location.href = `/oauth/${acc.provider}/connect`)}
                    >
                      Connect
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {categories.map((category) => (
          <div key={category}>
            <Overline className="mb-3">{category}</Overline>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {AVAILABLE_INTEGRATIONS.filter((i) => i.category === category).map((service) => {
                const connected = integrations.find((i) => i.service_name === service.name)
                return (
                  <div
                    key={service.name}
                    className={`group relative flex items-center gap-3 rounded-lg border px-3.5 py-3 transition-all ${
                      connected
                        ? "border-[var(--color-success)]/30 bg-[var(--color-success)]/[0.04]"
                        : "hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <div
                      className={`relative flex size-9 shrink-0 items-center justify-center rounded-md border ${
                        connected
                          ? "border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Plug className="size-4" />
                      {connected && (
                        <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-[var(--color-success)] text-white ring-2 ring-background">
                          <Check className="size-2.5" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${connected ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
                        {service.label}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {connected ? (
                          <span className="flex items-center gap-1.5 font-mono font-semibold text-[var(--color-success)]">
                            <span className="size-1 rounded-full bg-[var(--color-success)] animate-pulse-glow" />
                            CONNECTED
                          </span>
                        ) : (
                          service.description
                        )}
                      </p>
                    </div>
                    {connected ? (
                      <button
                        onClick={() => disconnect(connected.id)}
                        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        aria-label={`Disconnect ${service.label}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 text-xs"
                        onClick={() => connect(service.name)}
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </AppLayout>
  )
}
