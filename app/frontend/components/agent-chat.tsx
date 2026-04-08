import { useRef } from "react"
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react"
import { Thread } from "@/components/assistant-ui/thread"

const GATEWAY_URL = "ws://localhost:3300"

function createAgentAdapter(agentId: number): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const lastMessage = messages[messages.length - 1]
      const userText = lastMessage?.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n") || ""

      const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""

      // Connect to engine gateway
      const ws = new WebSocket(GATEWAY_URL)
      let responseText = ""
      let done = false
      let resolveResponse: (value: string) => void
      let rejectResponse: (reason: Error) => void

      const responsePromise = new Promise<string>((resolve, reject) => {
        resolveResponse = resolve
        rejectResponse = reject
      })

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === "text_delta") {
            responseText = data.text
          } else if (data.type === "done") {
            responseText = data.content || responseText
            done = true
            ws.close()
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

      // Wait for WS to open, then send message via Rails
      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve()
        setTimeout(resolve, 3000) // fallback if WS doesn't connect
      })

      // Send via Rails webhook
      await fetch("/webhooks/web", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ agent_id: agentId, body: userText }),
        signal: abortSignal,
      })

      // Yield empty to trigger in-progress state (shows loading dots)
      yield { content: [{ type: "text" as const, text: "" }] }

      // Wait for final response from WebSocket
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

interface AgentChatProps {
  agentId: number
  agentName: string
  initialMessages?: { role: string; content: string; created_at: string }[]
}

export function AgentChat({ agentId, agentName, initialMessages = [] }: AgentChatProps) {
  const adapter = useRef(createAgentAdapter(agentId)).current
  const sorted = initialMessages.filter((m) => m.role === "user" || m.role === "assistant")

  const runtime = useLocalRuntime(adapter, {
    initialMessages: sorted.length > 0
      ? sorted.map((m) => ({
          role: m.role as "user" | "assistant",
          content: [{ type: "text" as const, text: m.content }],
        }))
      : undefined,
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div style={{ height: "calc(100vh - 280px)", minHeight: "400px" }} className="rounded-xl border border-border overflow-hidden bg-background">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  )
}
