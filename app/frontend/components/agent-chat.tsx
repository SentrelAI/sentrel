import { useRef, useState, useEffect } from "react"
import { router } from "@inertiajs/react"
import { Check, X, Loader2, Mail } from "lucide-react"
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type AttachmentAdapter,
  type ChatModelAdapter,
  type PendingAttachment,
  type CompleteAttachment,
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

// Read the signed_id stashed by DirectUploadAdapter for a given attachment file.
// Used by createAgentAdapter at submit time.
function getSignedIdForFile(file: File | undefined): string | undefined {
  if (!file) return undefined
  return signedIdByFile.get(file)
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

function createAgentAdapter(agentId: number): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const lastMessage = messages[messages.length - 1]
      const userText = lastMessage?.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n") || ""

      // Sprint 1c — collect signed_ids from any attachments the user added.
      // Files were already uploaded via DirectUploadAdapter, we just need
      // to read the signed_ids stashed in the WeakMap.
      const attachmentSignedIds: string[] = []
      const lastAttachments = (lastMessage as { attachments?: Array<{ file?: File }> })?.attachments
      if (Array.isArray(lastAttachments)) {
        for (const att of lastAttachments) {
          const signedId = getSignedIdForFile(att.file)
          if (signedId) attachmentSignedIds.push(signedId)
        }
      }

      const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""

      // In production the engine WebSocket isn't reachable from the browser
      // (Fly 6pn private network). Engine relays every broadcast() event
      // over HTTP to Rails; Rails re-emits on AgentChatChannel. We handle
      // the same event shapes here as the local-dev WS path below:
      //   text_delta      — streaming assistant text
      //   tool_call       — live "thinking" tool-name indicator
      //   pending_approval — send_email approvals
      //   command_approval — dangerous-command approvals
      //   media_attachment — image/file outputs
      //   done            — final assistant content
      //   error           — surface to the user
      //   message         — fallback (Message.after_create_commit post-save)
      if (!GATEWAY_URL) {
        const { createConsumer } = await import("@rails/actioncable")
        const consumer = createConsumer()
        let responseText = ""
        let approvalData: PendingEmail | null = null
        const mediaAttachments: Array<{ url: string; filename: string; contentType: string }> = []
        let sub: { unsubscribe(): void } | undefined
        let resolveResponse: (value: string) => void = () => {}
        let rejectResponse: (err: Error) => void = () => {}

        const responsePromise = new Promise<string>((resolve, reject) => {
          resolveResponse = resolve
          rejectResponse = reject
        })

        const timeout = setTimeout(() => {
          sub?.unsubscribe()
          consumer.disconnect()
          rejectResponse(new Error("Timed out waiting for reply"))
        }, 300_000) // 5 min cap

        const finalize = (text: string) => {
          clearTimeout(timeout)
          sub?.unsubscribe()
          consumer.disconnect()
          let out = text
          for (const m of mediaAttachments) {
            out += m.contentType.startsWith("image/")
              ? `\n\n![${m.filename}](${m.url})`
              : `\n\n[Download ${m.filename}](${m.url})`
          }
          if (approvalData) {
            out += "\n\n" + APPROVAL_MARKER + JSON.stringify(approvalData) + APPROVAL_MARKER_END
          }
          resolveResponse(out)
        }

        sub = consumer.subscriptions.create(
          { channel: "AgentChatChannel", agent_id: agentId },
          {
            received(data: Record<string, any>) {
                switch (data.type) {
                  case "text_delta":
                    responseText = data.text || responseText
                    break
                  case "media_attachment":
                    mediaAttachments.push({
                      url: data.url,
                      filename: data.filename,
                      contentType: data.contentType,
                    })
                    break
                  case "pending_approval":
                    if (data.toolName === "send_email") {
                      approvalData = { approvalId: data.approvalId, ...data.toolInput }
                    }
                    break
                  case "command_approval":
                    // Handled by the persistent cmd-approval subscription below
                    break
                  case "done":
                    finalize(data.content || responseText)
                    break
                  case "error":
                    clearTimeout(timeout)
                    sub?.unsubscribe()
                    consumer.disconnect()
                    rejectResponse(new Error(data.error || "Agent run failed"))
                    break
                  case "message":
                    // Fallback: the `done` event may be missed if a relay drops;
                    // Message.after_create_commit fires once DB has the assistant
                    // row, so we can still resolve from that.
                    if (data.role === "assistant" && data.content) {
                      finalize(data.content)
                    }
                    break
                }
              },
            },
          )

        // Post the user message. Happens in parallel with cable-subscribe;
        // Rails saves the user Message regardless of whether cable is up yet.
        await fetch("/webhooks/web", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify({
            agent_id: agentId,
            body: userText,
            attachment_signed_ids: attachmentSignedIds,
          }),
          signal: abortSignal,
        }).catch((err) => {
          clearTimeout(timeout)
          sub?.unsubscribe()
          consumer.disconnect()
          rejectResponse(err)
        })

        // Yield empty first so the assistant-ui shows the typing / thinking
        // dots indicator while we wait for the engine's `done` event.
        yield { content: [{ type: "text" as const, text: "" }] }

        try {
          const finalText = await responsePromise
          yield { content: [{ type: "text" as const, text: finalText }] }
        } catch (err) {
          yield { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }] }
        }
        return
      }

      const ws = new WebSocket(GATEWAY_URL)
      let responseText = ""
      let approvalData: PendingEmail | null = null
      let done = false
      let resolveResponse: (value: string) => void
      let rejectResponse: (reason: Error) => void

      const responsePromise = new Promise<string>((resolve, reject) => {
        resolveResponse = resolve
        rejectResponse = reject
      })

      const mediaAttachments: Array<{ url: string; filename: string; contentType: string }> = []

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === "text_delta") {
            responseText = data.text
          } else if (data.type === "media_attachment") {
            // Sprint 3 — agent sent an image/file via send_image/send_file
            mediaAttachments.push({ url: data.url, filename: data.filename, contentType: data.contentType })
          } else if (data.type === "command_approval") {
            // Handled by persistent WebSocket in AgentChat — skip here
          } else if (data.type === "pending_approval" && data.toolName === "send_email") {
            approvalData = { approvalId: data.approvalId, ...data.toolInput }
          } else if (data.type === "done") {
            responseText = data.content || responseText
            // Append media as markdown images/links to the response
            for (const m of mediaAttachments) {
              if (m.contentType.startsWith("image/")) {
                responseText += `\n\n![${m.filename}](${m.url})`
              } else {
                responseText += `\n\n[Download ${m.filename}](${m.url})`
              }
            }
            // Append approval marker to response if we got one
            if (approvalData) {
              responseText += "\n\n" + APPROVAL_MARKER + JSON.stringify(approvalData) + APPROVAL_MARKER_END
            }
            done = true
            setTimeout(() => ws.close(), 100)
            resolveResponse(responseText)
          } else if (data.type === "error") {
            done = true
            ws.close()
            rejectResponse(new Error(data.error))
          }
        } catch {}
      }

      ws.onerror = () => { if (!done) rejectResponse(new Error("Connection failed")) }
      ws.onclose = () => { if (!done && responseText) resolveResponse(responseText) }

      const timeout = setTimeout(() => {
        if (!done) { ws.close(); resolveResponse(responseText || "Still processing...") }
      }, 120_000)

      abortSignal?.addEventListener("abort", () => { ws.close(); clearTimeout(timeout) })

      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve()
        setTimeout(resolve, 3000)
      })

      // Sprint 1c — always JSON. Files were uploaded directly to storage by
      // DirectUploadAdapter; we just send the signed_ids.
      await fetch("/webhooks/web", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({
          agent_id: agentId,
          body: userText,
          attachment_signed_ids: attachmentSignedIds,
        }),
        signal: abortSignal,
      })

      yield { content: [{ type: "text" as const, text: "" }] }

      try {
        const finalText = await responsePromise
        clearTimeout(timeout)
        yield { content: [{ type: "text" as const, text: finalText }] }
      } catch (err) {
        clearTimeout(timeout)
        yield { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }] }
      }
    },
  }
}

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

export function AgentChat({ agentId, agentStatus = "running", initialMessages = [], approvalsByMessage = {}, pendingActionApprovals = [], agentThinking = null }: AgentChatProps) {
  // Track "agent is currently working on a message" across reloads + after
  // a fresh send. Cleared when an assistant message arrives via cable.
  const [thinkingSince, setThinkingSince] = useState<string | null>(agentThinking?.since ?? null)
  // Mutable ref the cable handler calls to dispatch the next queued message
  // when the agent's response arrives. Set inside the queue-aware wrapper
  // below so we capture the runtime + queue handles after they exist.
  const drainQueuedRef = useRef<(() => void) | null>(null)
  // "Recovery mode" — the page was mounted while a run was already in flight
  // (typical case: user reloaded mid-stream). The in-memory runtime can't
  // recover state because the original adapter run() is gone. Source of
  // truth becomes the DB: when the reply lands we refetch chat_messages
  // (Inertia partial reload), which bumps the AgentChat key in show.tsx and
  // remounts the runtime with the full message list. Disabled during normal
  // in-tab runs because the adapter handles streaming itself.
  const wasRecoveryMount = useRef(agentThinking != null)
  const refetchInflight = useRef(false)
  const refetchMessages = () => {
    if (!wasRecoveryMount.current) return
    if (refetchInflight.current) return
    refetchInflight.current = true
    router.reload({
      only: ["chat_messages", "agent_thinking", "approvals_by_message", "pending_action_approvals"],
      preserveScroll: true,
      onFinish: () => { refetchInflight.current = false },
    })
  }
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
  const adapter = useRef(createAgentAdapter(agentId)).current

  // Persistent listener — stays open while on the chat page, receives
  // command_approval events even when user hasn't sent a message. Uses
  // ActionCable in prod (where the engine WS is unreachable) and the
  // direct engine WS locally for zero-latency dev feedback.
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
      } else if (data.type === "message" && data.role === "assistant") {
        // Agent finished — refetch chat_messages so a reload-mid-run page
        // picks up the assistant content. Don't clear thinkingSince directly
        // here: the new agent_thinking prop from the server is the source of
        // truth, and the AgentChat remount on key change re-seeds the
        // indicator state. Clearing here causes a flash where the indicator
        // disappears before the new message renders.
        refetchMessages()
        drainQueuedRef.current?.()
      } else if (data.type === "done" || data.type === "error") {
        // `done` (engine relays) and `error` always come paired with the
        // engine-side message persistence — refetching pulls both the new
        // chat_messages and the recomputed agent_thinking so the indicator
        // clears at the same moment the reply (or error message) renders.
        refetchMessages()
        drainQueuedRef.current?.()
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

  // Polling fallback for the reload-mid-run case. The cable broadcast can
  // land before a freshly-mounted page finishes subscribing, so we lean on
  // /chat/poll as a safety net. As soon as we see a reply land in the DB,
  // refetch initialMessages — the chat then re-seeds with the assistant
  // message included.
  useEffect(() => {
    if (!agentThinking?.after) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const startedAt = Date.now()
    const tick = async () => {
      if (cancelled) return
      if (Date.now() - startedAt > 5 * 60_000) {
        setThinkingSince(null)
        return
      }
      try {
        const res = await fetch(`/agents/${agentId}/chat/poll?after=${encodeURIComponent(agentThinking.after)}`, {
          headers: { Accept: "application/json" },
        })
        if (res.ok) {
          const data = await res.json() as { content?: string }
          if (data.content) {
            // Don't clear thinkingSince directly — let refetchMessages pull
            // the new agent_thinking from the server, and the AgentChat key
            // change remount it cleanly with the new state. Otherwise the
            // indicator vanishes a beat before the reply renders.
            refetchMessages()
            drainQueuedRef.current?.()
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
  }, [agentId, agentThinking?.after])
  const sorted = initialMessages.filter((m) => m.role === "user" || m.role === "assistant")

  // Inject media attachments + approval markers into message content for rendering
  const messagesWithApprovals = sorted.map((m) => {
    let content = m.content
    const meta = (m as any).metadata || {}

    // Sprint 3 — render persisted media from message metadata
    const media = Array.isArray(meta.media) ? meta.media as Array<{ url: string; filename: string; contentType: string }> : []
    for (const med of media) {
      if (med.contentType?.startsWith("image/")) {
        content += `\n\n![${med.filename}](${med.url})`
      } else {
        content += `\n\n[Download ${med.filename}](${med.url})`
      }
    }

    // User-uploaded attachments (resolved server-side from ActiveStorage).
    // Without this, files sent by the user vanished on reload because the
    // signed_ids in metadata are useless on the client. Render the same
    // markdown shape so an image previews inline and a doc gets a chip-
    // shaped download link.
    const userAttachments = Array.isArray((m as any).attachments)
      ? (m as any).attachments as Array<{ url: string; filename: string; content_type: string; byte_size: number }>
      : []
    for (const att of userAttachments) {
      if (att.content_type?.startsWith("image/")) {
        content += `\n\n![${att.filename}](${att.url})`
      } else {
        content += `\n\n[📎 ${att.filename}](${att.url})`
      }
    }

    const msgId = String((m as any).id || "")
    const approvals = approvalsByMessage[msgId]
    if (m.role === "assistant" && approvals && approvals.length > 0) {
      const markers = approvals.map((a) => {
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
      }).join("\n")
      return { ...m, content: content + "\n\n" + markers }
    }
    return { ...m, content }
  })

  const attachmentAdapter = useRef(new DirectUploadAdapter()).current

  const runtime = useLocalRuntime(adapter, {
    adapters: {
      attachments: attachmentAdapter,
    },
    initialMessages: messagesWithApprovals.length > 0
      ? messagesWithApprovals.map((m) => ({
          role: m.role as "user" | "assistant",
          content: [{ type: "text" as const, text: m.content }],
        }))
      : undefined,
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AgentStatusProvider value={agentStatus}>
        <RecoveryThinkingProvider value={{
          active: thinkingSince != null,
          since: thinkingSince,
          dismiss: () => setThinkingSince(null),
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

// Wire the cable's onAssistantMessage drain hook to the queue. Lives inside
// MessageQueueProvider so it can read the queue; sets a ref the parent's
// cable handler calls when the agent finishes a run.
function QueueDrainController({
  drainRef,
  runtime,
}: {
  drainRef: React.MutableRefObject<(() => void) | null>
  runtime: ReturnType<typeof useLocalRuntime>
}) {
  const queue = useMessageQueue()
  useEffect(() => {
    drainRef.current = () => {
      const next = queue.shift()
      if (!next) return
      // Append text + attachments to the runtime — kicks off a fresh adapter
      // run via the same path as a normal Send. Attachments-from-queue case
      // is best-effort (text-only is the common queueing flow).
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
