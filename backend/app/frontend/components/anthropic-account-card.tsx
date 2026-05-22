import { useState } from "react"
import { router } from "@inertiajs/react"
import { Sparkles, Check, Terminal, Clock, AlertTriangle } from "lucide-react"

import { Button } from "@/components/ui/button"

// Returns null if the token doesn't expire (long-lived sk-ant-oat01),
// or a tier describing how urgent re-auth is. The threshold mirrors
// OauthCredential#expiring_soon? (1h) and the auto-refresh window.
function expiryStatus(expiresAt: string | null): { tier: "expired" | "soon" | "ok"; label: string } | null {
  if (!expiresAt) return null
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return { tier: "expired", label: "Expired — re-paste to restore access" }
  const hours = ms / (1000 * 60 * 60)
  if (hours < 1) return { tier: "soon", label: `Expires in ${Math.max(1, Math.round(hours * 60))} min — refresh runs every 30 min` }
  if (hours < 24) return { tier: "soon", label: `Expires in ${Math.round(hours)} h` }
  if (hours > 24 * 30) return { tier: "ok", label: `Valid for ${Math.round(hours / 24)} more days` }
  return { tier: "ok", label: `Expires ${new Date(expiresAt).toLocaleDateString()}` }
}

export interface AiAccount {
  provider: "anthropic" | "openai"
  connected: boolean
  account_email: string | null
  expires_at: string | null
  last_refreshed_at: string | null
}

interface Props {
  account?: AiAccount
}

// Anthropic-subscription paste-token card. Originally lived on /integrations,
// moved to /settings (this file is the shared component). Renders the card +
// the credentials-paste modal. Token is sent to /oauth/anthropic/import_token
// which encrypts and stores it; agents using provider=anthropic_account pick
// it up on next reload.
export function AnthropicAccountCard({ account }: Props) {
  const acc = account || { provider: "anthropic", connected: false, account_email: null, expires_at: null, last_refreshed_at: null }
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteValue, setPasteValue] = useState("")
  const [pasteBusy, setPasteBusy] = useState(false)

  function submitPaste() {
    if (!pasteValue.trim()) return
    setPasteBusy(true)
    const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
    const form = document.createElement("form")
    form.method = "POST"
    form.action = "/oauth/anthropic/import_token"
    const t = document.createElement("input"); t.type = "hidden"; t.name = "authenticity_token"; t.value = csrf
    const c = document.createElement("input"); c.type = "hidden"; c.name = "credentials"; c.value = pasteValue
    form.appendChild(t); form.appendChild(c)
    document.body.appendChild(form)
    form.submit()
  }

  return (
    <>
      <div
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
          <p className="text-sm font-semibold text-foreground">Anthropic Account</p>
          <p className="text-[11px] text-muted-foreground mb-1">
            Connect your Claude Pro / Max / Team subscription. Agents use your existing quota instead of metered API.
          </p>
          <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground/80">
            Limit: ~250 msgs / 5h on Pro · 5× on Max
          </p>
          {acc.connected && acc.account_email && (
            <p className="text-[11px] mt-1 font-mono text-[var(--color-success)]">
              {acc.account_email}
            </p>
          )}
          {acc.connected && (() => {
            const status = expiryStatus(acc.expires_at)
            if (!status) return null
            const styles =
              status.tier === "expired" ? "text-red-600 dark:text-red-400" :
              status.tier === "soon" ? "text-amber-600 dark:text-amber-400" :
              "text-muted-foreground"
            const Icon = status.tier === "ok" ? Clock : AlertTriangle
            return (
              <p className={`text-[10px] mt-1 inline-flex items-center gap-1 ${styles}`}>
                <Icon className="size-3" /> {status.label}
              </p>
            )
          })()}
        </div>
        {acc.connected ? (
          <div className="flex flex-col gap-1.5 shrink-0">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPasteOpen(true)}>
              Replace token
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={() => router.delete(`/oauth/${acc.provider}/disconnect`)}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="h-7 shrink-0 text-xs" onClick={() => setPasteOpen(true)}>
            Paste token
          </Button>
        )}
      </div>

      {pasteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => !pasteBusy && setPasteOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-xl border border-border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <Terminal className="size-4 text-[var(--color-indigo)]" />
              <h2 className="text-sm font-semibold">Connect your Claude account</h2>
            </div>

            <div className="rounded-lg border border-[var(--color-indigo)]/30 bg-[var(--color-indigo)]/5 p-3 mb-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="rounded bg-[var(--color-indigo)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">Recommended</span>
                <span className="text-xs font-medium text-foreground">Long-lived token (1 year)</span>
              </div>
              <ol className="text-xs text-muted-foreground space-y-2 list-decimal list-inside">
                <li>
                  In any terminal:{" "}
                  <code className="font-mono bg-muted px-1.5 py-0.5 rounded">claude setup-token</code>
                </li>
                <li>Complete the browser sign-in.</li>
                <li>
                  Copy the token starting with{" "}
                  <code className="font-mono bg-muted px-1.5 py-0.5 rounded">sk-ant-oat01-…</code>{" "}
                  and paste it below.
                </li>
              </ol>
              <p className="text-[10px] text-muted-foreground/80 mt-2">
                No refresh cycle, no 30-min cron race — survives a year before re-auth. Best fit for an always-on agent.
              </p>
            </div>

            <details className="mb-3">
              <summary className="text-xs text-muted-foreground hover:text-foreground cursor-pointer">
                Or use a short-lived <code className="font-mono">claude /login</code> session
              </summary>
              <ol className="text-xs text-muted-foreground space-y-2 list-decimal list-inside mt-2 pl-3">
                <li>
                  Run <code className="font-mono bg-muted px-1.5 py-0.5 rounded">claude /login</code> and complete the browser sign-in.
                </li>
                <li>
                  Copy the credentials JSON to your clipboard:
                  <div className="mt-1.5 space-y-1">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">macOS (Keychain)</div>
                    <pre className="rounded bg-muted p-2 text-[10px] font-mono leading-relaxed overflow-x-auto">security find-generic-password -s &quot;Claude Code-credentials&quot; -w | pbcopy</pre>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mt-1.5">Linux / WSL</div>
                    <pre className="rounded bg-muted p-2 text-[10px] font-mono leading-relaxed overflow-x-auto">cat ~/.claude/.credentials.json | xclip -selection clipboard</pre>
                  </div>
                </li>
                <li>Paste the JSON below.</li>
              </ol>
              <p className="text-[10px] text-muted-foreground/80 mt-2 pl-3">
                Token expires in ~8h; auto-refresh runs every 30 min. If a refresh ever silently fails you'll hit 401s — re-paste or switch to the long-lived token above.
              </p>
            </details>

            <textarea
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              placeholder="sk-ant-oat01-… (or paste the full credentials.json)"
              className="w-full h-24 rounded-md border bg-background p-2 text-[11px] font-mono"
              disabled={pasteBusy}
            />
            <p className="text-[10px] text-muted-foreground mt-1.5">Stored encrypted at rest. Don't paste it into chat or commit it to a repo.</p>

            <div className="flex justify-end gap-2 mt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setPasteOpen(false); setPasteValue("") }}
                disabled={pasteBusy}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={submitPaste} disabled={pasteBusy || !pasteValue.trim()}>
                {pasteBusy ? "Saving…" : "Save token"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
