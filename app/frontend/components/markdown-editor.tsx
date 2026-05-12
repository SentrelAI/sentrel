import { useEditor, EditorContent, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import Placeholder from "@tiptap/extension-placeholder"
import { Markdown } from "tiptap-markdown"
import { useCallback, useEffect, useRef } from "react"
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
  Undo2,
  Redo2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface MarkdownEditorProps {
  /** Current markdown source. */
  value: string
  /** Called with the new markdown source on every change. */
  onChange: (markdown: string) => void
  placeholder?: string
  /** Sets a min-height (the editor still expands). */
  minHeight?: string
  /** Optional aria-label / form-id passthrough. */
  ariaLabel?: string
  /** Tailwind classes appended to the editor container. */
  className?: string
  /** Renders a disabled / read-only surface (e.g. for memory.md). */
  readOnly?: boolean
}

// WYSIWYG markdown editor backed by TipTap + tiptap-markdown. The .getMarkdown()
// serializer round-trips cleanly with the engine's raw-markdown read path —
// what you save is what the agent will see. Keep formatting basic: bold,
// italic, headings, lists, quote, code, link. Image embeds + tables + slash
// commands are out of scope for now.
export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write…",
  minHeight = "180px",
  ariaLabel,
  className,
  readOnly = false,
}: MarkdownEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false, // we register Link separately below for clickable behavior
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Placeholder.configure({ placeholder }),
      // round-trip serializer/parser: editor state <→> markdown string
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: "-",
        linkify: true,
        transformPastedText: true,
      }),
    ],
    content: value,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      // storage is added by tiptap-markdown; getMarkdown() emits clean md.
      // The plugin doesn't ship TS types for editor.storage augmentation.
      const md = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
      onChange(md)
    },
    // Avoid SSR mismatch in dev when Inertia hydrates from snapshot.
    immediatelyRender: false,
  })

  // External value changes (form reset / template install) should reflect in
  // the editor. Only re-sync when the markdown actually differs to avoid the
  // cursor-jump bug from setContent during keystrokes.
  const lastSetRef = useRef(value)
  useEffect(() => {
    if (!editor) return
    if (value === lastSetRef.current) return
    const current = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
    if (current === value) return
    editor.commands.setContent(value, { emitUpdate: false })
    lastSetRef.current = value
  }, [editor, value])

  if (!editor) return null

  return (
    <div
      className={cn(
        "rounded-md border border-input bg-background overflow-hidden",
        readOnly && "opacity-70 cursor-not-allowed",
        className,
      )}
    >
      <Toolbar editor={editor} disabled={readOnly} />
      <EditorContent
        editor={editor}
        aria-label={ariaLabel}
        className={cn(
          "[&_.ProseMirror]:px-3 [&_.ProseMirror]:py-3 [&_.ProseMirror]:outline-none",
          "[&_.ProseMirror]:text-sm [&_.ProseMirror]:leading-relaxed",
          "[&_.ProseMirror_h1]:text-xl [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h1]:mt-3 [&_.ProseMirror_h1]:mb-1",
          "[&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:mt-3 [&_.ProseMirror_h2]:mb-1",
          "[&_.ProseMirror_h3]:text-sm [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:mt-2 [&_.ProseMirror_h3]:mb-1",
          "[&_.ProseMirror_p]:mb-2",
          "[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6",
          "[&_.ProseMirror_a]:text-indigo-600 [&_.ProseMirror_a]:underline",
          "[&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-muted-foreground",
          "[&_.ProseMirror_code]:bg-muted [&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_code]:text-xs",
          "[&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0",
        )}
        style={{ minHeight }}
      />
    </div>
  )
}

function Toolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const setLink = useCallback(() => {
    const prev = editor.getAttributes("link").href as string | undefined
    const url = window.prompt("URL", prev ?? "https://")
    if (url === null) return
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
  }, [editor])

  const Btn = ({
    onClick,
    active,
    title,
    children,
  }: {
    onClick: () => void
    active?: boolean
    title: string
    children: React.ReactNode
  }) => (
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      className="h-7 w-7 p-0"
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </Button>
  )

  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-border bg-muted/30">
      <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold">
        <Bold className="size-3.5" />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic">
        <Italic className="size-3.5" />
      </Btn>
      <div className="w-px h-4 bg-border mx-1" />
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} title="Heading 1">
        <Heading1 className="size-3.5" />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Heading 2">
        <Heading2 className="size-3.5" />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="Heading 3">
        <Heading3 className="size-3.5" />
      </Btn>
      <div className="w-px h-4 bg-border mx-1" />
      <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bulleted list">
        <List className="size-3.5" />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Numbered list">
        <ListOrdered className="size-3.5" />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Quote">
        <Quote className="size-3.5" />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} title="Inline code">
        <Code className="size-3.5" />
      </Btn>
      <Btn onClick={setLink} active={editor.isActive("link")} title="Link">
        <LinkIcon className="size-3.5" />
      </Btn>
      <div className="ml-auto flex items-center gap-0.5">
        <Btn onClick={() => editor.chain().focus().undo().run()} title="Undo">
          <Undo2 className="size-3.5" />
        </Btn>
        <Btn onClick={() => editor.chain().focus().redo().run()} title="Redo">
          <Redo2 className="size-3.5" />
        </Btn>
      </div>
    </div>
  )
}
