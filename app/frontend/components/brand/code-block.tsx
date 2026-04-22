import type { ComponentPropsWithoutRef, ReactNode } from "react"
import { cn } from "@/lib/utils"

interface CodeBlockProps extends ComponentPropsWithoutRef<"div"> {
  filename?: string
  language?: string
  children: ReactNode
}

export function CodeBlock({
  filename,
  language = "ts",
  children,
  className,
  ...props
}: CodeBlockProps) {
  return (
    <div
      {...props}
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b bg-[var(--muted)] px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-[#ff5f56]" />
          <span className="size-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="size-2.5 rounded-full bg-[#27c93f]" />
          {filename && (
            <span className="ml-3 font-mono text-[11px] text-muted-foreground">
              {filename}
            </span>
          )}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
          {language}
        </span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-foreground">
        {children}
      </pre>
    </div>
  )
}
