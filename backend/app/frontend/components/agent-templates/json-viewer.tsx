import { useState } from "react"
import { Check, Copy, Download } from "lucide-react"

interface Props {
  value: unknown
  /** Filename used when the user clicks Download. Defaults to "data.json". */
  filename?: string
  /** Optional small label rendered above the editor (e.g. "Spec v1.0"). */
  label?: string
  className?: string
}

// Read-only, formatted JSON viewer with copy + download. No new deps —
// just <pre> with monospace font + line numbers. The JSON tab on
// templates/show is the primary consumer; reusable for any "here's the
// raw payload" use case (debug panels, future API exports).
export function JsonViewer({ value, filename = "data.json", label, className = "" }: Props) {
  const [copied, setCopied] = useState(false)
  const pretty = pretty_json(value)
  const lines = pretty.split("\n")

  function onCopy() {
    if (typeof window === "undefined") return
    navigator.clipboard.writeText(pretty).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  function onDownload() {
    if (typeof window === "undefined") return
    const blob = new Blob([pretty], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={`rounded-lg border border-border bg-card overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
        <span className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
          {label || filename}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
            title="Copy JSON"
          >
            {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
            title="Download as .json"
          >
            <Download className="size-3" /> Download
          </button>
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full font-mono text-[11.5px] leading-[1.55]">
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx} className="hover:bg-muted/30">
                <td className="select-none border-r border-border/50 bg-muted/20 px-2 py-px text-right text-muted-foreground/60 align-top w-10 tabular-nums">
                  {idx + 1}
                </td>
                <td className="whitespace-pre px-3 py-px text-foreground">{line || " "}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function pretty_json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
