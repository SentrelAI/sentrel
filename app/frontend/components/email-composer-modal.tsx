import { useEffect, useState } from "react"
import { Send, X as XIcon, Loader2, User2 } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

export type ComposerMode = "compose" | "reply" | "followup"

interface EmailComposerModalProps {
  open: boolean
  onClose: () => void
  // Agent's outward identity — what the recipient will see in the From line.
  agentId: string | number
  agentName: string
  agentEmail: string | null
  // The human currently logged in, for the "acting as" banner.
  currentUser?: { id: number; name: string; email: string } | null
  // Drives the title + the context banner copy. "compose" = fresh email,
  // "reply" = responding to an inbound, "followup" = continuing a thread
  // we already sent.
  mode?: ComposerMode
  // Optional initial values (used by Reply / Follow up). The modal re-syncs
  // these to internal state every time `open` flips from false → true so
  // the same instance can be reused across multiple opens without leaking
  // stale state from the prior session.
  initialTo?: string
  initialCc?: string
  initialSubject?: string
  initialBody?: string
  // Tells the user "this is a reply to that thread" so the framing is clear.
  replyingTo?: { from: string | null; subject: string | null } | null
  onSent?: () => void
}

function csrf(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
}

const MODE_TITLE: Record<ComposerMode, string> = {
  compose: "Compose email",
  reply: "Reply",
  followup: "Follow up",
}

const MODE_CONTEXT_LABEL: Record<ComposerMode, string> = {
  compose: "",
  reply: "Replying to",
  followup: "Following up with",
}

// Compose / reply window. Visually distinctive (indigo accent + explicit
// "Sending as <agent>" banner) so users don't confuse this with chatting
// WITH the agent — this UI sends email through the agent's SES identity
// while attributing the human action via Message.sender_user_id + the
// AuditLog row.
export function EmailComposerModal({
  open,
  onClose,
  agentId,
  agentName,
  agentEmail,
  currentUser = null,
  mode = "compose",
  initialTo = "",
  initialCc = "",
  initialSubject = "",
  initialBody = "",
  replyingTo = null,
  onSent,
}: EmailComposerModalProps) {
  const [to, setTo] = useState(initialTo)
  const [cc, setCc] = useState(initialCc)
  const [bcc, setBcc] = useState("")
  const [subject, setSubject] = useState(initialSubject)
  const [body, setBody] = useState(initialBody)
  const [sending, setSending] = useState(false)
  const [showCc, setShowCc] = useState(initialCc.length > 0)
  const [showBcc, setShowBcc] = useState(false)

  // Re-seed state every time the modal opens. The parent renders this
  // component permanently and toggles `open` — without this hook, the
  // form keeps state from the previous open (so clicking Reply after a
  // prior Compose would show empty To / Subject because they were
  // overwritten earlier).
  useEffect(() => {
    if (!open) return
    setTo(initialTo)
    setCc(initialCc)
    setBcc("")
    setSubject(initialSubject)
    setBody(initialBody)
    setShowCc(initialCc.length > 0)
    setShowBcc(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTo, initialCc, initialSubject, initialBody])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!agentEmail) {
      toast.error("This agent has no email channel configured")
      return
    }
    if (!to.trim()) {
      toast.error("Enter at least one recipient")
      return
    }

    setSending(true)
    try {
      const res = await fetch(`/agents/${agentId}/outbound_emails`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf() },
        body: JSON.stringify({
          to: to.split(/[,;]+/).map((s) => s.trim()).filter(Boolean),
          cc: cc.split(/[,;]+/).map((s) => s.trim()).filter(Boolean),
          bcc: bcc.split(/[,;]+/).map((s) => s.trim()).filter(Boolean),
          subject,
          body_text: body,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      toast.success("Email queued for delivery")
      onSent?.()
      onClose()
    } catch (err) {
      toast.error(`Send failed: ${(err as Error).message}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl border-l-4 border-l-indigo-500">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-4 text-indigo-500" />
            {MODE_TITLE[mode]}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 text-xs">
            <User2 className="size-3.5" />
            Sending as <span className="font-semibold">{agentName}</span>
            {agentEmail && (
              <span className="font-mono text-muted-foreground">&lt;{agentEmail}&gt;</span>
            )}
            {currentUser && (
              <span className="text-muted-foreground">· acting as {currentUser.name}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          {replyingTo && replyingTo.from && mode !== "compose" && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {MODE_CONTEXT_LABEL[mode]}{" "}
              <span className="font-medium text-foreground">{replyingTo.from}</span>
              {replyingTo.subject && <span> · "{replyingTo.subject}"</span>}
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com, second@example.com"
            />
            <div className="flex gap-3 text-[10px] text-muted-foreground">
              {!showCc && (
                <button type="button" onClick={() => setShowCc(true)} className="hover:text-foreground">
                  + Cc
                </button>
              )}
              {!showBcc && (
                <button type="button" onClick={() => setShowBcc(true)} className="hover:text-foreground">
                  + Bcc
                </button>
              )}
            </div>
          </div>

          {showCc && (
            <div className="space-y-1">
              <Label className="text-xs">Cc</Label>
              <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="cc@example.com" />
            </div>
          )}
          {showBcc && (
            <div className="space-y-1">
              <Label className="text-xs">Bcc</Label>
              <Input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="bcc@example.com" />
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Subject</Label>
            <Input
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Message</Label>
            <textarea
              required
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={`Write as ${agentName}…`}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-sans shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="ghost" onClick={onClose} disabled={sending}>
              <XIcon className="size-3.5 mr-1" />
              Cancel
            </Button>
            <Button type="submit" disabled={sending || !agentEmail}>
              {sending ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Send className="size-3.5 mr-1" />}
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
