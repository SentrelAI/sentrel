import { useState } from "react"
import { toast } from "sonner"
import Nango from "@nangohq/frontend"
import { KeyRound, ShieldCheck, Building2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

export type ConnectMode = "managed" | "byo_oauth" | "byo_token"

export interface CatalogApp {
  slug: string
  label: string
  category: string
  description: string | null
  logo: string | null
  auth_type: string
  modes: ConnectMode[]
  review: "none" | "google" | "gated"
}

interface OrgConfig {
  provider: string
  mode: ConnectMode
  client_id: string | null
  has_secret: boolean
}

interface Props {
  app: CatalogApp
  scope: "org" | "user"
  orgConfig?: OrgConfig
  connectBaseUrl?: string | null
  onClose: () => void
  onConnected: () => void
}

function csrf() {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrf() },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data }
}

const MODE_META: Record<ConnectMode, { label: string; icon: typeof KeyRound; blurb: string }> = {
  managed: { label: "One-click", icon: ShieldCheck, blurb: "Connect through Sentrel's app — the simplest option." },
  byo_oauth: { label: "Your own app", icon: Building2, blurb: "Run OAuth on your own app's credentials. Sentrel stays out of the data path." },
  byo_token: { label: "Paste a token", icon: KeyRound, blurb: "Paste an API key / token. Works immediately, no approval needed." },
}

export function ConnectModal({ app, scope, orgConfig, connectBaseUrl, onClose, onConnected }: Props) {
  const modes = app.modes.length ? app.modes : ["managed"]
  const [tab, setTab] = useState<ConnectMode>(modes[0])
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState("")
  const [clientId, setClientId] = useState(orgConfig?.client_id ?? "")
  const [clientSecret, setClientSecret] = useState("")

  // Managed / BYO-OAuth: mint a Nango Connect session, open the Connect UI,
  // and finalize with the connection id the UI hands back.
  async function runNangoConnect(mode: ConnectMode) {
    setBusy(true)
    try {
      if (mode === "byo_oauth") {
        if (!clientId || !clientSecret) {
          toast.error("Enter your app's client ID and secret first.")
          return
        }
        const saved = await postJson(`/integrations/${app.slug}/org_config`, {
          mode: "byo_oauth", client_id: clientId, client_secret: clientSecret,
        })
        if (!saved.ok) {
          toast.error(saved.data.error || "Couldn't save your app credentials.")
          return
        }
      }

      const sess = await postJson(`/integrations/${app.slug}/nango_session`, { scope })
      if (!sess.ok || !sess.data.session_token) {
        toast.error(sess.data.error || "Couldn't start the connection.")
        return
      }

      const connectionId = await openNangoConnectUI(
        sess.data.connect_base_url || connectBaseUrl,
        sess.data.session_token,
      )
      if (!connectionId) {
        toast.message("Connection cancelled.")
        return
      }

      const fin = await postJson(`/integrations/${app.slug}/nango_finalize`, { connection_id: connectionId, scope })
      if (!fin.ok) {
        toast.error(fin.data.error || "Couldn't finalize the connection.")
        return
      }
      toast.success(`${app.label} connected`)
      onConnected()
    } catch (err) {
      toast.error(`Connection failed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function pasteToken() {
    if (!token.trim()) {
      toast.error("Paste a token first.")
      return
    }
    setBusy(true)
    try {
      const res = await postJson(`/integrations/${app.slug}/paste_token`, { token: token.trim(), scope })
      if (!res.ok) {
        toast.error(res.data.error || "Couldn't save the token.")
        return
      }
      toast.success(`${app.label} connected`)
      onConnected()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect {app.label}</DialogTitle>
          <DialogDescription>
            {app.review === "gated"
              ? "One-click is pending app review — paste a token to use it today."
              : app.review === "google"
              ? "Google connections need verification for one-click — or paste a token now."
              : "Choose how you want to connect."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as ConnectMode)}>
          <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${modes.length}, 1fr)` }}>
            {modes.map((m) => {
              const Icon = MODE_META[m].icon
              return (
                <TabsTrigger key={m} value={m} className="gap-1.5 text-xs">
                  <Icon className="size-3.5" /> {MODE_META[m].label}
                </TabsTrigger>
              )
            })}
          </TabsList>

          {modes.includes("managed") && (
            <TabsContent value="managed" className="space-y-3 pt-3">
              <p className="text-xs text-muted-foreground">{MODE_META.managed.blurb}</p>
              <Button disabled={busy} onClick={() => runNangoConnect("managed")} className="w-full">
                {busy ? "Connecting…" : `Connect with Sentrel`}
              </Button>
            </TabsContent>
          )}

          {modes.includes("byo_oauth") && (
            <TabsContent value="byo_oauth" className="space-y-3 pt-3">
              <p className="text-xs text-muted-foreground">{MODE_META.byo_oauth.blurb}</p>
              <div className="space-y-2">
                <Label htmlFor="client_id" className="text-xs">Client ID</Label>
                <Input id="client_id" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="your app's client id" />
                <Label htmlFor="client_secret" className="text-xs">Client secret</Label>
                <Input id="client_secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={orgConfig?.has_secret ? "•••••• (saved — leave blank to keep)" : "your app's client secret"} />
              </div>
              <Button disabled={busy} onClick={() => runNangoConnect("byo_oauth")} className="w-full">
                {busy ? "Connecting…" : "Save & connect"}
              </Button>
            </TabsContent>
          )}

          {modes.includes("byo_token") && (
            <TabsContent value="byo_token" className="space-y-3 pt-3">
              <p className="text-xs text-muted-foreground">{MODE_META.byo_token.blurb}</p>
              <div className="space-y-2">
                <Label htmlFor="token" className="text-xs">API key / token</Label>
                <Input id="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="paste your token" />
              </div>
              <Button disabled={busy} onClick={pasteToken} className="w-full">
                {busy ? "Saving…" : "Connect with token"}
              </Button>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

// Opens the self-hosted Nango Connect UI and resolves with the new connection
// id (or null if the user cancelled). Drives the hosted Connect UI popup and
// reports the result via the SDK's onEvent callback.
async function openNangoConnectUI(baseUrl: string | null | undefined, sessionToken: string): Promise<string | null> {
  if (!baseUrl) throw new Error("Nango Connect URL not configured")
  const nango = new Nango({ connectSessionToken: sessionToken })

  return new Promise<string | null>((resolve) => {
    const connect = nango.openConnectUI({
      baseURL: baseUrl,
      // The Connect UI is served from `baseUrl` (connect.sentrel.ai) and the
      // Nango API is reachable same-origin there (Caddy routes /api,/connect,…
      // to the server). Point apiURL at the same host so the SPA's calls stay
      // same-origin — not the SDK default (api.nango.dev) or the cross-origin
      // admin domain.
      apiURL: baseUrl,
      sessionToken,
      onEvent: (event) => {
        if (event.type === "connect") {
          resolve(event.payload.connectionId)
        } else if (event.type === "close") {
          resolve(null)
        } else if (event.type === "error") {
          toast.error(event.payload.errorMessage || "Connection error")
          resolve(null)
        }
      },
    })
    // The session token can be set after open() in case it arrived async.
    connect.setSessionToken(sessionToken)
  })
}
