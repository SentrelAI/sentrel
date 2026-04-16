import { Head, useForm, router, Link } from "@inertiajs/react"
import { Plus, CheckSquare, MoreHorizontal, Pencil, Trash2, ArrowRight, MessageSquare, Clock, User, Bot, Send, X } from "lucide-react"
import {
  DndContext,
  DragOverlay,
  closestCenter,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useDroppable } from "@dnd-kit/core"
import { useState } from "react"

import AppLayout from "@/layouts/app-layout"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { tasksPath } from "@/routes"

interface TaskItem {
  id: number
  title: string
  description: string | null
  instruction: string | null
  status: string
  priority: string
  due_at: string | null
  agent: { id: number; name: string; slug: string }
  assigned_by: { id: number; name: string } | null
  comments_count?: number
}

interface Props {
  tasks: TaskItem[]
  agents: { id: number; name: string; slug: string }[]
}

const columns = [
  { key: "todo", label: "To Do", dot: "bg-stone-400" },
  { key: "in_progress", label: "In Progress", dot: "bg-blue-500" },
  { key: "done", label: "Done", dot: "bg-green-500" },
  { key: "failed", label: "Failed", dot: "bg-red-500" },
] as const

const priorityBadge: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  urgent: { label: "Urgent", variant: "destructive" },
  high: { label: "High", variant: "default" },
  normal: { label: "Normal", variant: "secondary" },
  low: { label: "Low", variant: "outline" },
}

// ── Sortable Task Card ──
function TaskCard({ task, overlay, setEditingTask, onOpen }: { task: TaskItem; overlay?: boolean; setEditingTask?: (t: TaskItem) => void; onOpen?: (t: TaskItem) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { status: task.status } })

  const style = overlay
    ? {}
    : {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }

  const pb = priorityBadge[task.priority] || priorityBadge.normal

  const otherStatuses = columns.filter((c) => c.key !== task.status)

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={style}
      {...(overlay ? {} : { ...attributes, ...listeners })}
      className="cursor-grab active:cursor-grabbing"
    >
      <Card className={`group ${overlay ? "shadow-lg ring-2 ring-accent rotate-2" : ""}`}>
        <CardContent className="px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <button className="font-medium text-sm leading-snug flex-1 text-left hover:underline" onClick={(e) => { e.stopPropagation(); onOpen?.(task) }} onPointerDown={(e) => e.stopPropagation()}>
              {task.title}
            </button>
            {!overlay && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:bg-muted transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="size-4 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ArrowRight className="size-4 mr-2" />
                      Move to
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {otherStatuses.map((col) => (
                        <DropdownMenuItem
                          key={col.key}
                          onClick={() => router.patch(`/tasks/${task.id}`, { task: { status: col.key } }, { preserveScroll: true })}
                        >
                          <div className={`size-2 rounded-full ${col.dot} mr-2`} />
                          {col.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setEditingTask(task)}>
                    <Pencil className="size-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => router.delete(`/tasks/${task.id}`, { preserveScroll: true })}
                  >
                    <Trash2 className="size-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <Badge variant={pb.variant} className="text-[10px]">{pb.label}</Badge>
            <div className="flex items-center gap-1.5 ml-auto">
              <div className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                {task.agent.name[0]}
              </div>
              <span className="text-xs text-muted-foreground">{task.agent.name}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2">
            {task.due_at && (
              <span className="text-[11px] text-muted-foreground">
                Due {new Date(task.due_at).toLocaleDateString()}
              </span>
            )}
            {(task.comments_count ?? 0) > 0 && (
              <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground ml-auto">
                <MessageSquare className="size-3" /> {task.comments_count}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Droppable Column ──
function Column({ columnKey, label, dot, tasks: columnTasks, setEditingTask, onOpenTask }: {
  columnKey: string
  label: string
  dot: string
  tasks: TaskItem[]
  setEditingTask: (t: TaskItem) => void
  onOpenTask: (t: TaskItem) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnKey })

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-2 px-0.5 shrink-0">
        <div className={`size-2 rounded-full ${dot}`} />
        <h3 className="font-semibold text-sm">{label}</h3>
        <span className="text-xs text-muted-foreground">
          {columnTasks.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 space-y-2 rounded-lg p-2.5 border overflow-y-auto transition-colors ${
          isOver
            ? "bg-accent/5 border-accent/20 border-dashed"
            : "bg-muted/50 border-transparent"
        }`}
      >
        <SortableContext items={columnTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {columnTasks.map((task) => (
            <TaskCard key={task.id} task={task} setEditingTask={setEditingTask} onOpen={onOpenTask} />
          ))}
        </SortableContext>

        {columnTasks.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-10">No tasks</p>
        )}
      </div>
    </div>
  )
}

// ── Edit Form ──
function EditTaskForm({ task, agents, onClose }: { task: TaskItem; agents: Props["agents"]; onClose: () => void }) {
  const { data, setData, patch, processing } = useForm({
    title: task.title,
    instruction: task.instruction || "",
    priority: task.priority,
    agent_id: String(task.agent.id),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    patch(`/tasks/${task.id}`, {
      data: { task: data },
      preserveScroll: true,
      onSuccess: () => onClose(),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Assign to</Label>
        <Select value={data.agent_id} onValueChange={(v) => setData("agent_id", v)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {agents.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Title</Label>
        <Input value={data.title} onChange={(e) => setData("title", e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label>Instruction</Label>
        <textarea
          className="flex min-h-[80px] w-full rounded-md border-2 border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus:border-[var(--color-gold)] focus:ring-[3px] focus:ring-[var(--color-gold-border)]"
          value={data.instruction}
          onChange={(e) => setData("instruction", e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>Priority</Label>
        <Select value={data.priority} onValueChange={(v) => setData("priority", v)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={processing}>{processing ? "Saving..." : "Save"}</Button>
      </div>
    </form>
  )
}

// ── Main Page ──
interface Comment {
  id: number
  content: string
  created_at: string
  author: { id: number; name: string } | null
  author_type: "user" | "agent"
}

export default function TasksIndex({ tasks, agents }: Props) {
  const [activeTask, setActiveTask] = useState<TaskItem | null>(null)
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null)
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)

  async function openTaskDetail(task: TaskItem) {
    setSelectedTask(task)
    setLoadingComments(true)
    try {
      const res = await fetch(`/tasks/${task.id}`, { headers: { "Accept": "application/json", "X-Inertia": "true", "X-Inertia-Version": "" } })
      if (res.ok) {
        const data = await res.json()
        setComments(data.props?.comments || [])
      }
    } catch {}
    setLoadingComments(false)
  }
  const { data, setData, post, processing, reset } = useForm({
    agent_id: "",
    title: "",
    instruction: "",
    priority: "normal",
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id)
    if (task) setActiveTask(task)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null)
    const { active, over } = event
    if (!over) return

    const taskId = active.id as number

    // over.id could be a column key OR a task id
    let targetColumn = columns.find((c) => c.key === over.id)?.key
    if (!targetColumn) {
      // Dropped over a task card — find which column that task is in
      const overTask = tasks.find((t) => t.id === over.id)
      if (overTask) targetColumn = overTask.status
    }
    if (!targetColumn) return

    const task = tasks.find((t) => t.id === taskId)
    if (task && task.status !== targetColumn) {
      router.patch(`/tasks/${taskId}`, { task: { status: targetColumn } }, { preserveScroll: true })
    }
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    post(tasksPath(), { onSuccess: () => reset() })
  }

  if (tasks.length === 0 && agents.length === 0) {
    return (
      <AppLayout>
        <Head title="Tasks" />
        <PageHeader title="Tasks" description="Assign and track work across your agents" />
        <EmptyState icon={CheckSquare} title="No tasks yet" description="Create agents first, then assign them tasks" />
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <Head title="Tasks" />
      <PageHeader
        title="Tasks"
        description="Assign and track work across your agents"
        action={
          <Dialog>
            <DialogTrigger asChild>
              <Button><Plus className="size-4 mr-2" />New Task</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Task</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label>Assign to</Label>
                  <Select value={data.agent_id} onValueChange={(v) => setData("agent_id", v)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select agent" /></SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input value={data.title} onChange={(e) => setData("title", e.target.value)} placeholder="Research top competitors" required />
                </div>
                <div className="space-y-2">
                  <Label>Instruction</Label>
                  <textarea
                    className="flex min-h-[80px] w-full rounded-md border-2 border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus:border-[var(--color-gold)] focus:ring-[3px] focus:ring-[var(--color-gold-border)]"
                    placeholder="Detailed instructions for the agent..."
                    value={data.instruction}
                    onChange={(e) => setData("instruction", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={data.priority} onValueChange={(v) => setData("priority", v)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full" disabled={processing}>Create Task</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-4 gap-4" style={{ height: "calc(100vh - 180px)" }}>
          {columns.map((col) => (
            <Column
              key={col.key}
              columnKey={col.key}
              label={col.label}
              dot={col.dot}
              tasks={tasks.filter((t) => t.status === col.key)}
              setEditingTask={setEditingTask}
              onOpenTask={openTaskDetail}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} overlay /> : null}
        </DragOverlay>
      </DndContext>

      {/* Edit Dialog */}
      <Dialog open={!!editingTask} onOpenChange={(open) => !open && setEditingTask(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Task</DialogTitle></DialogHeader>
          {editingTask && (
            <EditTaskForm task={editingTask} agents={agents} onClose={() => setEditingTask(null)} />
          )}
        </DialogContent>
      </Dialog>

      {/* Task Detail Modal (Linear-style) */}
      {selectedTask && (
        <TaskDetailModal task={selectedTask} comments={comments} loading={loadingComments} onClose={() => setSelectedTask(null)} />
      )}
    </AppLayout>
  )
}

function TaskDetailModal({ task, comments, loading, onClose }: { task: TaskItem; comments: Comment[]; loading: boolean; onClose: () => void }) {
  const [newComment, setNewComment] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [localComments, setLocalComments] = useState(comments)
  const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""

  // Sync when comments prop changes
  if (comments !== localComments && comments.length > 0 && localComments.length === 0) {
    setLocalComments(comments)
  }

  async function handleAddComment() {
    if (!newComment.trim() || submitting) return
    setSubmitting(true)
    await fetch(`/tasks/${task.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ content: newComment }),
    })
    setLocalComments((prev) => [...prev, {
      id: Date.now(), content: newComment, created_at: new Date().toISOString(),
      author: { id: 0, name: "You" }, author_type: "user",
    }])
    setNewComment("")
    setSubmitting(false)
  }

  const statusColors: Record<string, string> = {
    todo: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  }

  const pb = priorityBadge[task.priority] || priorityBadge.normal

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]" onClick={onClose}>
      <div className="fixed inset-0 bg-black/50 animate-in fade-in duration-150" />
      <div className="relative w-full max-w-2xl max-h-[75vh] bg-background border rounded-xl shadow-2xl flex flex-col animate-in zoom-in-95 fade-in duration-150" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold">{task.title}</h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${statusColors[task.status] || ""}`}>
                {task.status.replace("_", " ")}
              </span>
              <Badge variant={pb.variant} className="text-[10px]">{pb.label}</Badge>
              <span className="text-xs text-muted-foreground">{task.agent.name}</span>
              {task.due_at && <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="size-3" /> Due {new Date(task.due_at).toLocaleDateString()}</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted transition-colors">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {task.description && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
          )}
          {task.instruction && (
            <div className="rounded-md bg-muted p-3">
              <p className="text-[11px] font-medium text-muted-foreground mb-1">Instruction</p>
              <p className="text-sm whitespace-pre-wrap">{task.instruction}</p>
            </div>
          )}

          {/* Comments */}
          <div className="border-t pt-4">
            <h3 className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
              <MessageSquare className="size-3.5" /> Comments ({localComments.length})
            </h3>

            {loading ? (
              <p className="text-xs text-muted-foreground text-center py-4">Loading...</p>
            ) : (
              <div className="space-y-3">
                {localComments.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <div className={`size-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-medium ${c.author_type === "agent" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                      {c.author_type === "agent" ? <Bot className="size-3" /> : <User className="size-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{c.author?.name || "System"}</span>
                        <span className="text-[10px] text-muted-foreground">{new Date(c.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm mt-0.5 whitespace-pre-wrap">{c.content}</p>
                    </div>
                  </div>
                ))}
                {localComments.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">No comments yet</p>}
              </div>
            )}
          </div>
        </div>

        {/* Comment input */}
        <div className="border-t p-3 flex gap-2">
          <input
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment() } }}
          />
          <button onClick={handleAddComment} disabled={!newComment.trim() || submitting} className="px-3 py-1.5 rounded-md bg-foreground text-background text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
            <Send className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
