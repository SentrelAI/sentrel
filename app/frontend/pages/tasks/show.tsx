import { Head, Link, router } from "@inertiajs/react"
import { ArrowLeft, MessageSquare, Clock, User, Bot, Send } from "lucide-react"
import { useState, useRef } from "react"

import AppLayout from "@/layouts/app-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { tasksPath } from "@/routes"

interface Comment {
  id: number
  content: string
  created_at: string
  author: { id: number; name: string } | null
  author_type: "user" | "agent"
}

interface TaskData {
  id: number
  title: string
  description: string | null
  instruction: string | null
  status: string
  priority: string
  due_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  agent: { id: number; name: string; slug: string }
  assigned_by: { id: number; name: string } | null
  comments_count: number
}

interface Props {
  task: TaskData
  comments: Comment[]
}

const STATUS_COLORS: Record<string, string> = {
  todo: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "destructive",
  high: "default",
  normal: "secondary",
  low: "outline",
} as const

export default function TaskShow({ task, comments: initialComments }: Props) {
  const [comments, setComments] = useState(initialComments)
  const [newComment, setNewComment] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""

  async function handleAddComment() {
    if (!newComment.trim() || submitting) return
    setSubmitting(true)

    const res = await fetch(`/tasks/${task.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ content: newComment }),
    })

    if (res.ok || res.redirected) {
      // Reload via Inertia to get fresh data
      router.reload({ only: ["comments"] })
      setNewComment("")
    }
    setSubmitting(false)
  }

  function handleStatusChange(status: string) {
    router.patch(`/tasks/${task.id}`, { task: { status } }, { preserveScroll: true })
  }

  return (
    <AppLayout>
      <Head title={task.title} />

      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <Link href={tasksPath()} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-lg font-semibold">{task.title}</h1>
        </div>

        {/* Task details */}
        <div className="rounded-lg border bg-card p-5 mb-6 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[task.status] || ""}`}>
              {task.status.replace("_", " ")}
            </span>
            <Badge variant={PRIORITY_COLORS[task.priority] as any} className="text-[10px]">{task.priority}</Badge>
            <span className="text-xs text-muted-foreground">Assigned to {task.agent.name}</span>
            {task.assigned_by && <span className="text-xs text-muted-foreground">by {task.assigned_by.name}</span>}
          </div>

          {task.description && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
          )}

          {task.instruction && (
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Instruction</p>
              <p className="text-sm whitespace-pre-wrap">{task.instruction}</p>
            </div>
          )}

          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
            <span className="flex items-center gap-1"><Clock className="size-3" /> Created {new Date(task.created_at).toLocaleDateString()}</span>
            {task.due_at && <span>Due {new Date(task.due_at).toLocaleDateString()}</span>}
            {task.completed_at && <span>Completed {new Date(task.completed_at).toLocaleDateString()}</span>}
          </div>

          {/* Status actions */}
          <div className="flex gap-2 pt-2 border-t">
            {task.status !== "in_progress" && task.status !== "done" && (
              <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => handleStatusChange("in_progress")}>
                Start
              </Button>
            )}
            {task.status !== "done" && (
              <Button size="sm" className="h-7 text-xs" onClick={() => handleStatusChange("done")}>
                Mark Done
              </Button>
            )}
            {task.status === "done" && (
              <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => handleStatusChange("todo")}>
                Reopen
              </Button>
            )}
          </div>
        </div>

        {/* Comments */}
        <div className="rounded-lg border bg-card p-5">
          <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
            <MessageSquare className="size-4" />
            Comments ({comments.length})
          </h3>

          <div className="space-y-3 mb-4">
            {comments.map((c) => (
              <div key={c.id} className="flex gap-3">
                <div className={`size-7 rounded-full flex items-center justify-center shrink-0 text-xs font-medium ${c.author_type === "agent" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                  {c.author_type === "agent" ? <Bot className="size-3.5" /> : <User className="size-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium">{c.author?.name || "System"}</span>
                    <span className="text-[10px] text-muted-foreground">{new Date(c.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{c.content}</p>
                </div>
              </div>
            ))}
            {comments.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No comments yet</p>
            )}
          </div>

          {/* Add comment */}
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Add a comment..."
              rows={2}
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm resize-none"
              onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) handleAddComment() }}
            />
            <Button size="sm" className="h-auto" onClick={handleAddComment} disabled={!newComment.trim() || submitting}>
              <Send className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
