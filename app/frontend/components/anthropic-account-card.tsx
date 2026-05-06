import { useState } from "react"
import { router } from "@inertiajs/react"
import { Sparkles, Check, Terminal } from "lucide-react"

import { Button } from "@/components/ui/button"

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
            <ol className="text-xs text-muted-foreground space-y-2 mb-4 list-decimal list-inside">
              <li>
                On your laptop, run <code className="font-mono bg-muted px-1.5 py-0.5 rounded">claude /login</code> in any terminal.
                Complete the browser sign-in.
              </li>
              <li>
                Copy the credentials to your clipboard:
                <div className="mt-1.5 space-y-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">macOS (Keychain)</div>
                  <pre className="rounded bg-muted p-2 text-[10px] font-mono leading-relaxed overflow-x-auto">security find-generic-password -s &quot;Claude Code-credentials&quot; -w | pbcopy</pre>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mt-1.5">Linux / WSL</div>
                  <pre className="rounded bg-muted p-2 text-[10px] font-mono leading-relaxed overflow-x-auto">cat ~/.claude/.credentials.json | xclip -selection clipboard</pre>
                </div>
              </li>
              <li>Paste the JSON below and submit. Tokens are stored encrypted at rest.</li>
            </ol>
            <textarea
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              placeholder='{"claudeAiOauth":{"accessToken":"sk-ant-...","refreshToken":"...","expiresAt":...}}'
              className="w-full h-32 rounded-md border bg-background p-2 text-[11px] font-mono"
              disabled={pasteBusy}
            />
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
