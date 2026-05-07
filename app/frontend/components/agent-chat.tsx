import { useRef, useState, useEffect, useCallback } from "react"
import { router } from "@inertiajs/react"
import { Check, X, Loader2, Mail } from "lucide-react"
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type AttachmentAdapter,
  type PendingAttachment,
  type CompleteAttachment,
  type ThreadMessageLike,
} from "@assistant-ui/react"
// @ts-expect-error — @rails/activestorage ships JS without types
import { DirectUpload } from "@rails/activestorage"
import { Thread, CmdApprovalProvider, ActionApprovalProvider, ConnectionProposalProvider, AgentStatusProvider, RecoveryThinkingProvider } from "@/components/assistant-ui/thread"
import { MessageQueueProvider, useMessageQueue } from "@/contexts/message-queue"
import { FilePreviewProvider } from "@/contexts/file-preview"

// The engine gateway lives on Fly's private 6pn network in production, so
// the browser can't reach it directly. Only connect when we're on localhost
// (dev) and the engine is published on 3300. In production the response
// arrives via Inertia re-render after the Sidekiq→engine→Rails round-trip.
const GATEWAY_URL = (() => {
  if (typeof window === "undefined") return ""
  const isLocalDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  return isLocalDev ? "ws://localhost:3300" : ""
})()
const DIRECT_UPLOAD_URL = "/rails/active_storage/direct_uploads"

// Stash signed_ids returned from direct upload, keyed by the original File
// object. createAgentAdapter reads this on submit to get the blob references
// without polluting the assistant-ui PendingAttachment type.
// WeakMap auto-cleans when the File is garbage-collected.
const signedIdByFile = new WeakMap<File, string>()

interface DirectUploadBlob {
  signed_id: string
  key: string
  filename: string
  content_type: string
  byte_size: number
  checksum: string
}

// Direct-upload attachment adapter for assistant-ui composer.
//
// Flow:
// 1. User drops/picks a file → add() is called
// 2. We start a Rails DirectUpload to /rails/active_storage/direct_uploads
// 3. We yield PendingAttachment objects with status: running, progress %
// 4. Browser uploads bytes directly to storage (Disk in dev, S3 in prod)
// 5. On complete: stash signed_id in WeakMap, yield final pending state
// 6. assistant-ui marks the attachment as ready to send
// 7. On submit: createAgentAdapter reads signed_id from WeakMap and POSTs JSON
class DirectUploadAdapter implements AttachmentAdapter {
  accept = "*"

  async *add({ file }: { file: File }): AsyncGenerator<PendingAttachment, void> {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `att-${Date.now()}-${Math.random()}`

    const type: "image" | "document" | "file" = file.type.startsWith("image/")
      ? "image"
      : file.type === "application/pdf" ||
          file.type.includes("officedocument") ||
          file.type.includes("msword")
        ? "document"
        : "file"

    const baseAtt = {
      id,
      type,
      name: file.name,
      contentType: file.type || "application/octet-stream",
      file,
    }

    // Initial state
    yield {
      ...baseAtt,
      status: { type: "running", reason: "uploading", progress: 0 },
    }

    // Bridge between DirectUpload's callback world and our async generator
    const progressQueue: number[] = []
    let resolveNext: (() => void) | null = null
    let done = false
    let error: Error | null = null
    let signedId: string | null = null

    function notifyNext() {
      if (resolveNext) {
        const r = resolveNext
        resolveNext = null
        r()
      }
    }

    // CSRF: @rails/activestorage's BlobRecord constructor reads
    // meta[name="csrf-token"] and sets X-CSRF-Token automatically — we don't
    // need to set it ourselves. The /rails/active_storage/direct_uploads
    // endpoint also has CSRF skipped via the active_storage_direct_uploads
    // initializer (Devise auth replaces it).

    const upload = new DirectUpload(file, DIRECT_UPLOAD_URL, {
      directUploadWillStoreFileWithXHR(xhr: XMLHttpRequest) {
        xhr.upload.addEventListener("progress", (e: ProgressEvent) => {
          if (e.lengthComputable) {
            progressQueue.push(e.loaded / e.total)
            notifyNext()
          }
        })
      },
    })

    upload.create((err: Error | null, blob: DirectUploadBlob | null) => {
      if (err) {
        error = err
      } else if (blob) {
        signedId = blob.signed_id
        signedIdByFile.set(file, blob.signed_id)
      }
      done = true
      notifyNext()
    })

    // Drain progress events + completion
    while (true) {
      if (progressQueue.length > 0) {
        const progress = progressQueue.shift()!
        yield {
          ...baseAtt,
          status: { type: "running", reason: "uploading", progress },
        }
        continue
      }
      if (done) break
      await new Promise<void>((resolve) => {
        resolveNext = resolve
      })
    }

    if (error) {
      yield {
        ...baseAtt,
        status: { type: "incomplete", reason: "error" },
      }
      throw error
    }

    // Upload complete — mark requires-action so assistant-ui treats it as ready
    // to send when the user clicks the send button
    yield {
      ...baseAtt,
      status: { type: "requires-action", reason: "composer-send" },
    }
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const signedId = attachment.file ? signedIdByFile.get(attachment.file) : undefined
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "text" as const,
          text: signedId ? `[Attached: ${attachment.name}]` : `[Attached: ${attachment.name} (upload incomplete)]`,
        },
      ],
    }
  }

  async remove(): Promise<void> {
    // The blob exists in storage but isn't attached to anything yet.
    // Rails will GC unattached blobs after a period via ActiveStorage::PurgeJob.
  }
}

interface PendingEmail {
  approvalId: number
  to: string
  cc?: string[]
  bcc?: string[]
  subject: string
  body_text: string
  from_address: string
  from_name: string
  status?: string
}

// Encode approval data as a special marker in the response text
const APPROVAL_MARKER = "<!--EMAIL_APPROVAL:"
const APPROVAL_MARKER_END = ":EMAIL_APPROVAL-->"

type CmdApprovalState = {
  approvalId: string
  command: string
  level: string
  explanation: string
  resolve: (level: "once" | "session" | "always" | "deny") => void
} | null

type ActionApprovalState = {
  approvalToken: string
  summary: string
  payloadType: string
  payload: Record<string, unknown>
  options: Array<{ label: string; value: string }>
  riskTier: string
  allowAmendment: boolean
  resolve: (decision: { value: string; text?: string }) => void
} | null

type ConnectionProposalState = {
  service: string
  label: string
  why: string
  dismiss: () => void
} | null


interface PendingActionApprovalSeed {
  id: number
  approval_token: string
  summary: string
  payload_type: string
  payload: Record<string, unknown>
  options: Array<{ label: string; value: string }>
  risk_tier: string
  allow_amendment: boolean
  created_at: string
}

interface AgentChatProps {
  agentId: number
  agentName: string
  agentStatus?: string
  initialMessages?: { id?: number; role: string; content: string; created_at: string; metadata?: Record<string, unknown> }[]
  approvalsByMessage?: Record<string, { id: number; tool_name: string; tool_input: Record<string, unknown>; status: string }[]>
  pendingActionApprovals?: PendingActionApprovalSeed[]
  // Hydrated from agents#show — non-null when the most recent message in
  // the chat is a user message sent in the last 15 minutes that doesn't yet
  // have an assistant reply. Persists the "thinking" indicator across page
  // reloads. `after` is the user message's created_at — used as the cursor
  // for /chat/poll.
  agentThinking?: { since: string; after: string } | null
}

// External-store message — the source of truth the runtime renders from.
// Server-restored messages and optimistic / streaming messages both land here.
// `content` is markdown — attachments + media + approval markers are baked in
// (matching the markdown-link rendering in markdown-text.tsx).
type StoreMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: number
  status: "complete" | "running" | "error"
}

// Inject media metadata + ActiveStorage attachments into a server-side
// message's content so the markdown renderer produces the same chip / image
// the live cable stream produces.
function fromServerMessage(
  m: { id?: number | string; role: string; content: string; created_at?: string; metadata?: Record<string, unknown>; attachments?: Array<{ url: string; filename: string; content_type: string }> },
  approvals?: Array<{ id: number; tool_input: Record<string, unknown>; status: string }>,
): StoreMessage {
  let content = m.content || ""
  const meta = m.metadata || {}
  const media = Array.isArray(meta.media)
    ? (meta.media as Array<{ url: string; filename: string; contentType: string }>)
    : []
  for (const med of media) {
    content += med.contentType?.startsWith("image/")
      ? `\n\n![${med.filename}](${med.url})`
      : `\n\n[Download ${med.filename}](${med.url})`
  }
  for (const att of m.attachments || []) {
    content += att.content_type?.startsWith("image/")
      ? `\n\n![${att.filename}](${att.url})`
      : `\n\n[📎 ${att.filename}](${att.url})`
  }
  if (m.role === "assistant" && approvals && approvals.length > 0) {
    const markers = approvals
      .map((a) => {
        const emailData: PendingEmail = {
          approvalId: a.id,
          to: a.tool_input.to as string,
          cc: a.tool_input.cc as string[],
          bcc: a.tool_input.bcc as string[],
          subject: a.tool_input.subject as string,
          body_text: a.tool_input.body_text as string,
          from_address: a.tool_input.from_address as string,
          from_name: a.tool_input.from_name as string,
          status: a.status,
        }
        return APPROVAL_MARKER + JSON.stringify(emailData) + APPROVAL_MARKER_END
      })
      .join("\n")
    content += "\n\n" + markers
  }
  const created = m.created_at ? new Date(m.created_at).getTime() : Date.now()
  return {
    id: String(m.id ?? `srv-${created}`),
    role: m.role === "user" ? "user" : "assistant",
    content,
    createdAt: created,
    status: "complete",
  }
}

const storeToThreadMessage = (m: StoreMessage): ThreadMessageLike => ({
  role: m.role,
  content: [{ type: "text", text: m.content }],
  id: m.id,
  createdAt: new Date(m.createdAt),
  // Tells AUI to render the streaming-dot indicator while content's still
  // landing — without this an in-progress assistant bubble looks empty/
  // finished after a reload.
  status: m.role === "assistant"
    ? m.status === "running"
      ? { type: "running" as const }
      : m.status === "error"
        ? { type: "incomplete" as const, reason: "error" as const }
        : { type: "complete" as const, reason: "stop" as const }
    : undefined,
})

export function AgentChat({ agentId, agentStatus = "running", initialMessages = [], approvalsByMessage = {}, pendingActionApprovals = [], agentThinking = null }: AgentChatProps) {
  // Source of truth for what the chat renders. Hydrated from the server's
  // chat_messages, then updated in-place by the cable subscription.
  // If the server says a run is in flight (agentThinking set), append an
  // empty pending assistant bubble so AUI renders its typing-dot indicator
  // until the cable / poll lands the real content.
  const [messages, setMessages] = useState<StoreMessage[]>(() => {
    const seeded = initialMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => fromServerMessage(m as any, approvalsByMessage[String((m as any).id || "")]))
    if (agentThinking) {
      seeded.push({
        id: `pending-${Date.now()}`,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        status: "running",
      })
    }
    return seeded
  })
  // True while the agent is producing a reply (POST sent, run not yet done).
  // Drives the AUI typing-dot indicator and the composer's Thinking… text.
  // On mount, seeded from agent_thinking so a reload mid-run keeps the pill.
  const [isRunning, setIsRunning] = useState<boolean>(agentThinking != null)
  // Wall-clock the run started — exposed to RecoveryThinkingProvider for
  // the elapsed-time readout. Same lifecycle as isRunning.
  const [runStartedAt, setRunStartedAt] = useState<string | null>(agentThinking?.since ?? null)
  // Drain hook for the queued-messages strip. When isRunning flips false the
  // useEffect below dispatches the next queue item via the runtime.
  const drainQueuedRef = useRef<(() => void) | null>(null)
  // Dedupe ids of finalized assistant messages so cable + poll racing don't
  // each call upsertAssistantContent with final=true (the second call would
  // see a non-pending trailing message and create a duplicate).
  const finalizedIdsRef = useRef<Set<string>>(new Set())
  const [cmdApproval, setCmdApproval] = useState<CmdApprovalState>(null)

  // Hydrate inline cards from server state on mount so a page refresh still
  // shows pending approvals + connection proposals. The first pending row of
  // each kind seeds its respective context. Source of truth = pending_approvals
  // table; this just rebuilds the in-memory promise plumbing the live events
  // would otherwise install.
  const seedConnection: ConnectionProposalState = (() => {
    const seed = pendingActionApprovals.find((p) => p.payload_type === "connection_proposal")
    if (!seed) return null
    const payload = (seed.payload || {}) as Record<string, unknown>
    return {
      service: String(payload.service || ""),
      label: String(payload.label || seed.payload_type),
      why: String(payload.why || ""),
      dismiss: () => setConnectionProposal(null),
    }
  })()
  const [connectionProposal, setConnectionProposal] = useState<ConnectionProposalState>(seedConnection)

  const seedActionApproval: ActionApprovalState = (() => {
    const seed = pendingActionApprovals.find((p) => p.payload_type !== "connection_proposal")
    if (!seed) return null
    return {
      approvalToken: seed.approval_token,
      summary: seed.summary,
      payloadType: seed.payload_type,
      payload: seed.payload || {},
      options: seed.options && seed.options.length > 0 ? seed.options : [{ label: "Approve", value: "approve" }, { label: "Reject", value: "reject" }],
      riskTier: seed.risk_tier || "medium",
      allowAmendment: seed.allow_amendment === true,
      resolve: async (decision) => {
        const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
        setActionApproval(null)
        await fetch(`/pending_approvals/${seed.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify({
            decision: decision.value,
            decision_text: decision.text,
            status: decision.value === "reject" || decision.value === "rejected" || decision.value === "cancel" ? "rejected" : "approved",
          }),
        })
        setTimeout(() => router.reload({ only: ["initialMessages", "pending_action_approvals"], preserveScroll: true }), 3500)
      },
    }
  })()
  const [actionApproval, setActionApproval] = useState<ActionApprovalState>(seedActionApproval)

  // Append to (or update) the trailing assistant message in the store. Used
  // by every cable event that carries assistant content — text_delta streams,
  // media_attachment markdown, the final message, error fallbacks. We never
  // change the existing message's id once it's been issued — AUI's
  // MessageRepository treats id changes as duplicates and crashes the tree.
  const upsertAssistantContent = useCallback(
    (mutator: (current: string) => string, opts?: { final?: boolean; status?: StoreMessage["status"] }) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        const status = opts?.status ?? (opts?.final ? "complete" : "running")
        if (last?.role === "assistant" && last.status === "running") {
          return [
            ...prev.slice(0, -1),
            { ...last, content: mutator(last.content), status },
          ]
        }
        // No pending placeholder yet — create one with a fresh id.
        const created = Date.now()
        return [
          ...prev,
          {
            id: `srv-${created}-${Math.random().toString(36).slice(2, 8)}`,
            role: "assistant",
            content: mutator(""),
            createdAt: created,
            status,
          },
        ]
      })
    },
    [],
  )

  // Persistent listener — stays open while on the chat page, drives the
  // store via cable events + handles approval prompts. Uses ActionCable in
  // prod and the direct engine WS locally.
  useEffect(() => {
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout>
    let cableSub: { unsubscribe(): void } | null = null
    let consumer: { disconnect(): void } | null = null
    let mounted = true

    const handleEvent = (data: any) => {
      if (data.type === "command_approval") {
        handleCommandApproval(data)
      } else if (data.type === "action_approval") {
        handleActionApproval(data)
      } else if (data.type === "connection_proposal") {
        handleConnectionProposal(data)
      } else if (data.type === "text_delta") {
        // Streaming text — overwrite the trailing pending message's content.
        if (typeof data.text === "string") {
          upsertAssistantContent(() => data.text)
        }
      } else if (data.type === "media_attachment") {
        // Engine sent an image/file via send_image/send_file — append as
        // markdown to the trailing pending assistant message.
        const md = data.contentType?.startsWith("image/")
          ? `\n\n![${data.filename}](${data.url})`
          : `\n\n[Download ${data.filename}](${data.url})`
        upsertAssistantContent((cur) => cur + md)
      } else if (data.type === "pending_approval" && data.toolName === "send_email") {
        // Inline email-approval card — encoded as a marker that
        // TextWithApprovals (in thread.tsx) parses and renders.
        const marker =
          APPROVAL_MARKER +
          JSON.stringify({ approvalId: data.approvalId, ...data.toolInput }) +
          APPROVAL_MARKER_END
        upsertAssistantContent((cur) => cur + "\n\n" + marker)
      } else if (data.type === "message" && data.role === "assistant" && data.content) {
        const id = String(data.id ?? "")
        if (id && finalizedIdsRef.current.has(id)) return
        if (id) finalizedIdsRef.current.add(id)
        let body = data.content as string
        const media = Array.isArray(data.metadata?.media)
          ? (data.metadata.media as Array<{ url: string; filename: string; contentType: string }>)
          : []
        for (const med of media) {
          body += med.contentType?.startsWith("image/")
            ? `\n\n![${med.filename}](${med.url})`
            : `\n\n[Download ${med.filename}](${med.url})`
        }
        upsertAssistantContent(() => body, { final: true })
        setIsRunning(false)
        setRunStartedAt(null)
      } else if (data.type === "error") {
        upsertAssistantContent(() => `⚠️ ${data.error || "Run failed"}`, { final: true, status: "error" })
        setIsRunning(false)
        setRunStartedAt(null)
      } else if (data.type === "done") {
        // Engine done event — the paired "message" event finalizes the
        // store. We just safety-clear isRunning here in case the message
        // event is dropped somehow; setting it twice is harmless.
        setIsRunning(false)
        setRunStartedAt(null)
      }
    }

    // Item 5 — agent surfaces a 'Connect <service>' card when an action
    // requires an unconnected toolkit. Click opens the existing
    // /integrations/:service/connect Composio OAuth popup; on close,
    // refresh the page so the connected list updates.
    const handleConnectionProposal = (data: any) => {
      setConnectionProposal({
        service: data.service,
        label: data.label || data.service,
        why: data.why || "",
        dismiss: () => setConnectionProposal(null),
      })
    }

    const handleCommandApproval = (data: any) => {
      const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
      setCmdApproval({
        approvalId: data.approvalId,
        command: (data.command as string).slice(0, 300),
        level: data.level as string,
        explanation: data.explanation as string,
        resolve: async (chosenLevel) => {
          setCmdApproval(null)
          if (GATEWAY_URL) {
            const approvalWs = new WebSocket(GATEWAY_URL)
            approvalWs.onopen = () => {
              approvalWs.send(JSON.stringify({
                type: "command_approval_response",
                approvalId: data.approvalId,
                command: data.command,
                level: chosenLevel,
              }))
              setTimeout(() => approvalWs.close(), 500)
            }
          } else {
            // Use the running-agent id from the event payload when present —
            // a delegated run ("Casper assigns to Sam, Sam runs the command")
            // surfaces approvals tied to Sam's pubsub channel, not Casper's.
            // Fall back to the chat's agent_id for non-delegated runs.
            await fetch("/api/command_approvals", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
              body: JSON.stringify({
                agent_id: data.agentId || agentId,
                approval_id: data.approvalId,
                command: data.command,
                level: chosenLevel,
              }),
            })
          }
        },
      })
    }

    // Item 4 — generic action approval card (LinkedIn post / email / spend / etc.)
    // Surfaces inline in the chat thread via ActionApprovalContext, mirroring
    // the cmd-approval flow. Decision routes through Rails pending_approvals
    // which republishes to Redis where the engine resolves the paused promise.
    const handleActionApproval = (data: any) => {
      const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
      setActionApproval({
        approvalToken: data.approvalToken,
        summary: data.summary,
        payloadType: data.payloadType,
        payload: data.payload || {},
        options: Array.isArray(data.options) && data.options.length > 0
          ? data.options
          : [{ label: "Approve", value: "approve" }, { label: "Reject", value: "reject" }],
        riskTier: data.riskTier || "medium",
        allowAmendment: data.allowAmendment === true,
        resolve: async (decision) => {
          setActionApproval(null)
          // Look up the DB row by approval_token, then PATCH /pending_approvals/:id
          // with the user's decision. Rails publishes action_approval_response
          // to Redis → engine's request_approval await unblocks.
          const lookup = await fetch(`/api/action_approvals/by_token?token=${encodeURIComponent(data.approvalToken)}`, {
            headers: { Accept: "application/json" },
          })
          if (!lookup.ok) return
          const { id } = await lookup.json()
          if (!id) return
          await fetch(`/pending_approvals/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrfToken },
            body: JSON.stringify({
              decision: decision.value,
              decision_text: decision.text,
              status: decision.value === "reject" || decision.value === "rejected" || decision.value === "cancel" ? "rejected" : "approved",
            }),
          })
          // After the agent resumes and writes its response, the per-message
          // listener may have unsubscribed (5-min timeout, page focus loss,
          // remount). Reload the conversation a few seconds later so the
          // new assistant message renders without the user having to refresh.
          // The exact delay matches a typical agent post-decision turn (~3s
          // for short text, longer for additional tool calls — we land on
          // the safer side and rely on the existing message list to show
          // whatever was persisted by then).
          setTimeout(() => router.reload({ only: ["initialMessages", "pending_action_approvals"], preserveScroll: true }), 3500)
        },
      })
    }

    function connect() {
      if (!mounted) return
      if (GATEWAY_URL) {
        ws = new WebSocket(GATEWAY_URL)
        ws.onmessage = (event) => {
          try { handleEvent(JSON.parse(event.data)) } catch {}
        }
        ws.onclose = () => {
          if (mounted) reconnectTimer = setTimeout(connect, 5000)
        }
      } else {
        import("@rails/actioncable").then(({ createConsumer }) => {
          if (!mounted) return
          consumer = createConsumer()
          cableSub = consumer!.subscriptions.create(
            { channel: "AgentChatChannel", agent_id: agentId },
            {
              received: handleEvent,
            },
          )
        }).catch(() => {})
      }
    }

    connect()
    return () => {
      mounted = false
      ws?.close()
      cableSub?.unsubscribe()
      consumer?.disconnect()
      clearTimeout(reconnectTimer)
    }
  }, [agentId])

  // Polling fallback for the reload-mid-run case. Cable broadcast can land
  // before a freshly-mounted page subscribes, so we lean on /chat/poll as a
  // safety net. On reply detection, drop it into the store via the same
  // path the cable uses.
  useEffect(() => {
    if (!agentThinking?.after) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const startedAt = Date.now()
    const tick = async () => {
      if (cancelled) return
      if (Date.now() - startedAt > 5 * 60_000) {
        setIsRunning(false)
        setRunStartedAt(null)
        return
      }
      try {
        const res = await fetch(`/agents/${agentId}/chat/poll?after=${encodeURIComponent(agentThinking.after)}`, {
          headers: { Accept: "application/json" },
        })
        if (res.ok) {
          const data = await res.json() as { id?: string | number; content?: string; metadata?: Record<string, unknown> }
          if (data.content) {
            const id = String(data.id ?? "")
            if (!id || !finalizedIdsRef.current.has(id)) {
              if (id) finalizedIdsRef.current.add(id)
              let body = data.content
              const media = Array.isArray(data.metadata?.media)
                ? (data.metadata!.media as Array<{ url: string; filename: string; contentType: string }>)
                : []
              for (const med of media) {
                body += med.contentType?.startsWith("image/")
                  ? `\n\n![${med.filename}](${med.url})`
                  : `\n\n[Download ${med.filename}](${med.url})`
              }
              upsertAssistantContent(() => body, { final: true })
            }
            setIsRunning(false)
            setRunStartedAt(null)
            return
          }
        }
      } catch { /* network blip — keep polling */ }
      timer = setTimeout(tick, 3000)
    }
    timer = setTimeout(tick, 1500)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [agentId, agentThinking?.after, upsertAssistantContent])

  // Drain a queued message when the run completes — the queue strip pushes
  // pending text in here via the drainRef set by QueueDrainController.
  useEffect(() => {
    if (!isRunning) drainQueuedRef.current?.()
  }, [isRunning])

  const attachmentAdapter = useRef(new DirectUploadAdapter()).current

  // onNew — POST the user message to Rails, optimistically add it to the
  // store, flip isRunning. Cable / poll will land the assistant reply.
  const onNew = useCallback(async (msg: AppendMessage) => {
    const userText = (msg.content as Array<{ type: string; text?: string }>)
      ?.filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("\n") || ""

    const attachmentSignedIds: string[] = []
    let userContent = userText
    const rawAttachments = (msg.attachments ?? []) as readonly unknown[]
    for (const raw of rawAttachments) {
      const att = raw as { file?: File; name?: string; contentType?: string }
      const sid = att.file ? signedIdByFile.get(att.file) : undefined
      if (sid) attachmentSignedIds.push(sid)
      if (att.file) {
        const blobUrl = URL.createObjectURL(att.file)
        const filename = att.name || att.file.name
        userContent += att.contentType?.startsWith("image/")
          ? `\n\n![${filename}](${blobUrl})`
          : `\n\n[📎 ${filename}](${blobUrl})`
      }
    }

    const now = Date.now()
    const userMsg: StoreMessage = {
      id: `tmp-u-${now}`,
      role: "user",
      content: userContent,
      createdAt: now,
      status: "complete",
    }
    const pendingAssistant: StoreMessage = {
      id: `pending-${now}`,
      role: "assistant",
      content: "",
      createdAt: now + 1,
      status: "running",
    }
    setMessages((prev) => [...prev, userMsg, pendingAssistant])
    setIsRunning(true)
    setRunStartedAt(new Date().toISOString())

    const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
    try {
      const res = await fetch("/webhooks/web", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({
          agent_id: agentId,
          body: userText,
          attachment_signed_ids: attachmentSignedIds,
        }),
      })
      if (!res.ok) throw new Error(`POST /webhooks/web returned ${res.status}`)
    } catch (err) {
      upsertAssistantContent(() => `⚠️ ${(err as Error).message}`, { final: true, status: "error" })
      setIsRunning(false)
      setRunStartedAt(null)
    }
  }, [agentId, upsertAssistantContent])

  const onCancel = useCallback(async () => {
    // Best-effort — we can't actually abort an in-flight server run from
    // here. Just clear local state so the user can move on.
    setIsRunning(false)
    setRunStartedAt(null)
  }, [])

  const runtime = useExternalStoreRuntime<StoreMessage>({
    isRunning,
    messages,
    convertMessage: storeToThreadMessage,
    onNew,
    onCancel,
    adapters: {
      attachments: attachmentAdapter,
    },
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AgentStatusProvider value={agentStatus}>
        <RecoveryThinkingProvider value={{
          active: isRunning,
          since: runStartedAt,
          dismiss: () => { setIsRunning(false); setRunStartedAt(null) },
        }}>
          <CmdApprovalProvider value={cmdApproval}>
            <ActionApprovalProvider value={actionApproval}>
              <ConnectionProposalProvider value={connectionProposal}>
                <MessageQueueProvider agentId={agentId}>
                  <FilePreviewProvider>
                    <QueueDrainController drainRef={drainQueuedRef} runtime={runtime} />
                    <div className="relative h-full overflow-hidden bg-background">
                      <Thread />
                    </div>
                  </FilePreviewProvider>
                </MessageQueueProvider>
              </ConnectionProposalProvider>
            </ActionApprovalProvider>
          </CmdApprovalProvider>
        </RecoveryThinkingProvider>
      </AgentStatusProvider>
    </AssistantRuntimeProvider>
  )
}

// Drain the next queued message into the runtime when the previous run
// completes. Lives inside MessageQueueProvider so it can read the queue;
// sets a ref the AgentChat clears via useEffect when isRunning flips false.
function QueueDrainController({
  drainRef,
  runtime,
}: {
  drainRef: React.MutableRefObject<(() => void) | null>
  runtime: ReturnType<typeof useExternalStoreRuntime>
}) {
  const queue = useMessageQueue()
  useEffect(() => {
    drainRef.current = () => {
      const next = queue.shift()
      if (!next) return
      try {
        runtime.thread.append({
          role: "user",
          content: [{ type: "text", text: next.text }],
        })
      } catch (err) {
        console.warn("Queue drain failed, re-queueing:", err)
        queue.enqueue(next.text, next.attachments)
      }
    }
    return () => { drainRef.current = null }
  }, [drainRef, queue, runtime])
  return null
}

// Extract and render approval cards from message text
export function parseMessageWithApprovals(text: string): { cleanText: string; approvals: PendingEmail[] } {
  const approvals: PendingEmail[] = []
  let cleanText = text

  const regex = new RegExp(`${APPROVAL_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(.+?)${APPROVAL_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g')
  cleanText = text.replace(regex, (_, json) => {
    try { approvals.push(JSON.parse(json)) } catch {}
    return ""
  }).trim()

  return { cleanText, approvals }
}

function InlineEmailApproval({ email, onDone }: { email: PendingEmail; onDone: () => void }) {
  const [acting, setActing] = useState<"approving" | "rejecting" | null>(null)
  const [result, setResult] = useState<"approved" | "rejected" | null>(null)

  const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""

  async function handleAction(status: "approved" | "rejected") {
    setActing(status === "approved" ? "approving" : "rejecting")
    try {
      await fetch(`/pending_approvals/${email.approvalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ status }),
      })
      setResult(status)
      setTimeout(onDone, 2000)
    } catch {
      setActing(null)
    }
  }

  if (result) {
    return (
      <div className={`rounded-lg border p-3 text-sm ${result === "approved" ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"}`}>
        {result === "approved" ? "Email approved and sending..." : "Email rejected."}
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-white shadow-lg p-4 space-y-3 animate-slide-up">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Mail className="size-3.5" />
        Email draft — review before sending
      </div>

      <div className="space-y-1 text-xs">
        <div className="flex gap-2">
          <span className="font-medium w-10 shrink-0 text-muted-foreground">From</span>
          <span>{email.from_name} &lt;{email.from_address}&gt;</span>
        </div>
        <div className="flex gap-2">
          <span className="font-medium w-10 shrink-0 text-muted-foreground">To</span>
          <span>{Array.isArray(email.to) ? email.to.join(", ") : email.to}</span>
        </div>
        {email.cc && email.cc.length > 0 && (
          <div className="flex gap-2">
            <span className="font-medium w-10 shrink-0 text-muted-foreground">CC</span>
            <span>{email.cc.join(", ")}</span>
          </div>
        )}
      </div>

      <div className="border-t pt-2">
        <p className="font-medium text-sm">{email.subject}</p>
      </div>

      <div className="border-t pt-2 text-sm text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
        {email.body_text}
      </div>

      <div className="flex gap-2 pt-1 border-t">
        <button
          onClick={() => handleAction("approved")}
          disabled={acting !== null}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--color-ink)] text-white text-xs font-medium hover:bg-[var(--color-ink-soft)] transition-colors disabled:opacity-50"
        >
          {acting === "approving" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          Approve & Send
        </button>
        <button
          onClick={() => handleAction("rejected")}
          disabled={acting !== null}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          {acting === "rejecting" ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
          Reject
        </button>
      </div>
    </div>
  )
}
