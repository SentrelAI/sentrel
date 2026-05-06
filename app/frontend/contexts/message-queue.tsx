"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"

export interface QueuedMessage {
  id: string
  text: string
  // Stash the original attachment objects so we can restore them on drain.
  // Keeping minimal shape — just URLs and filenames; the runtime rebuilds
  // CompleteAttachment internally when we call append().
  attachments: Array<{ filename: string; url: string; content_type: string }>
  createdAt: number
}

interface MessageQueueContextValue {
  items: QueuedMessage[]
  enqueue: (text: string, attachments?: QueuedMessage["attachments"]) => void
  remove: (id: string) => void
  // Returns and removes the oldest queued item (for drain on agent-done).
  shift: () => QueuedMessage | undefined
}

const MessageQueueContext = createContext<MessageQueueContextValue | null>(null)

export function useMessageQueue(): MessageQueueContextValue {
  const ctx = useContext(MessageQueueContext)
  if (!ctx) throw new Error("useMessageQueue must be used inside <MessageQueueProvider>")
  return ctx
}

// Optional accessor — components that only care about queue *display* can
// use this to avoid the throw above when there's no provider yet.
export function useMessageQueueOptional(): MessageQueueContextValue | null {
  return useContext(MessageQueueContext)
}

export function MessageQueueProvider({ agentId, children }: { agentId: number; children: ReactNode }) {
  const storageKey = `alchemy.queue.agent.${agentId}`
  const [items, setItems] = useState<QueuedMessage[]>(() => {
    if (typeof window === "undefined") return []
    try {
      const raw = window.sessionStorage.getItem(storageKey)
      return raw ? JSON.parse(raw) as QueuedMessage[] : []
    } catch { return [] }
  })

  // Mirror items into sessionStorage so a reload mid-thinking doesn't drop
  // queued sends. sessionStorage (not localStorage) on purpose: clearing
  // stale queues on tab close is the right default.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(items))
    } catch { /* quota/private mode — non-fatal */ }
  }, [items, storageKey])

  // Use refs for the synchronous shift() so callers reading the value get the
  // pre-shift snapshot reliably even when called from event handlers.
  const itemsRef = useRef(items)
  useEffect(() => { itemsRef.current = items }, [items])

  const enqueue = useCallback((text: string, attachments: QueuedMessage["attachments"] = []) => {
    if (!text.trim() && attachments.length === 0) return
    const item: QueuedMessage = {
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text,
      attachments,
      createdAt: Date.now(),
    }
    setItems((prev) => [...prev, item])
  }, [])

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }, [])

  const shift = useCallback((): QueuedMessage | undefined => {
    const head = itemsRef.current[0]
    if (!head) return undefined
    setItems((prev) => prev.slice(1))
    return head
  }, [])

  return (
    <MessageQueueContext.Provider value={{ items, enqueue, remove, shift }}>
      {children}
    </MessageQueueContext.Provider>
  )
}
