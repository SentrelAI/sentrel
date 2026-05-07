"use client";

import "@assistant-ui/react-markdown/styles/dot.css";

import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { createContext, type FC, memo, useContext, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useFilePreviewOptional } from "@/contexts/file-preview";
import { cn } from "@/lib/utils";

// Citation context — populated by the assistant message renderer when it has
// a flat list of WebSearch / WebFetch sources for this turn. The text
// preprocessor uses it to swap raw [N] markers in the prose for clickable
// superscript links that hover-preview the matching source chip.
export type Citation = { url: string; title?: string };
const CitationsContext = createContext<Citation[] | null>(null);
export const CitationsProvider = CitationsContext.Provider;

// Best-effort guess at content type from a URL or filename. Used to feed
// the FilePreview drawer when we only have a markdown link, no headers.
function guessContentType(href: string, filename: string): string {
  const lower = (filename || href).toLowerCase()
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.match(/\.(jpe?g)$/)) return "image/jpeg"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".svg")) return "image/svg+xml"
  if (lower.endsWith(".csv")) return "text/csv"
  if (lower.endsWith(".json")) return "application/json"
  if (lower.endsWith(".md")) return "text/markdown"
  if (lower.endsWith(".txt")) return "text/plain"
  if (lower.match(/\.(mp4|webm|mov)$/)) return "video/mp4"
  if (lower.match(/\.(mp3|wav|m4a|ogg)$/)) return "audio/mpeg"
  return ""
}

const MarkdownTextImpl = () => {
  const citations = useContext(CitationsContext);
  // Pre-rewrites bare [N] tokens in the prose to special markdown links of
  // the form [N](aui-cite:URL) so the existing `a` renderer below can pick
  // them up and render the superscript hover card. No-ops when the message
  // has no sources (typical chat) so we don't touch random brackets.
  const preprocess = citations && citations.length > 0
    ? (text: string) => rewriteCitations(text, citations)
    : undefined;
  return (
    <MarkdownTextPrimitive
      // Smoothing on by default in AUI; making it explicit so a library
      // upgrade can't silently flip it off and bring the chunk-flicker back.
      smooth
      remarkPlugins={[remarkGfm]}
      className="aui-md"
      components={defaultComponents}
      preprocess={preprocess}
    />
  );
};

function rewriteCitations(text: string, citations: Citation[]): string {
  return text.replace(/\[(\d+)\]/g, (whole, n) => {
    const idx = Number(n) - 1;
    const c = citations[idx];
    if (!c) return whole;
    return `[${n}](aui-cite:${encodeURIComponent(c.url)})`;
  });
}

export const MarkdownText = memo(MarkdownTextImpl);

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  return (
    <div className="aui-code-header-root mt-2.5 flex items-center justify-between rounded-t-lg border border-border/50 border-b-0 bg-muted/50 px-3 py-1.5 text-xs">
      <span className="aui-code-header-language font-medium text-muted-foreground lowercase">
        {language}
      </span>
      <TooltipIconButton tooltip="Copy" onClick={onCopy}>
        {!isCopied && <CopyIcon />}
        {isCopied && <CheckIcon />}
      </TooltipIconButton>
    </div>
  );
};

const useCopyToClipboard = ({
  copiedDuration = 3000,
}: {
  copiedDuration?: number;
} = {}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const copyToClipboard = (value: string) => {
    if (!value) return;

    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), copiedDuration);
    });
  };

  return { isCopied, copyToClipboard };
};

const defaultComponents = memoizeMarkdownComponents({
  // Sprint 3 — render images from agent (screenshots, logos, etc.)
  img: function MarkdownImage({ className, src, alt, ...props }) {
    const previewer = useFilePreviewOptional()
    const onClick = (e: React.MouseEvent) => {
      if (
        !previewer || !src ||
        e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
      ) return
      e.preventDefault()
      previewer.open({
        url: src,
        filename: alt || src.split("/").pop() || "image",
        contentType: guessContentType(src, alt || "") || "image/*",
      })
    }
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        className="block my-2"
      >
        <img
          src={src}
          alt={alt || ""}
          className={cn(
            "aui-md-img max-w-full rounded-lg border border-border/50 shadow-sm cursor-pointer hover:opacity-90 transition-opacity",
            className,
          )}
          loading="lazy"
          {...props}
        />
      </a>
    )
  },
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        "aui-md-h1 mb-2 scroll-m-20 font-semibold text-base first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "aui-md-h2 mt-3 mb-1.5 scroll-m-20 font-semibold text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "aui-md-h3 mt-2.5 mb-1 scroll-m-20 font-semibold text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "aui-md-h4 mt-2 mb-1 scroll-m-20 font-medium text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5
      className={cn(
        "aui-md-h5 mt-2 mb-1 font-medium text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h6: ({ className, ...props }) => (
    <h6
      className={cn(
        "aui-md-h6 mt-2 mb-1 font-medium text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p
      className={cn(
        "aui-md-p my-2.5 leading-normal first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  a: function MarkdownLink({ className, href, children, ...props }) {
    // File / blob links — render as a styled chip card with an icon. Catches
    // both Rails ActiveStorage URLs (/rails/active_storage/blobs/...) and
    // the engine's signed-blob proxy (/api/blobs/...). Plus we strip the
    // 📎 emoji prefix the agent / serializer adds since the icon SVG already
    // signals "attachment".
    const hrefStr = href || ""
    const isBlob =
      hrefStr.includes("/api/blobs/") ||
      hrefStr.includes("/rails/active_storage/")
    const previewer = useFilePreviewOptional()

    // Inline citation injected by rewriteCitations — render as a small
    // superscript link that hover-previews the source's domain/title.
    if (hrefStr.startsWith("aui-cite:")) {
      const citationUrl = decodeURIComponent(hrefStr.slice("aui-cite:".length))
      let domain = citationUrl
      try { domain = new URL(citationUrl).hostname.replace(/^www\./, "") } catch {}
      return (
        <a
          href={citationUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={citationUrl}
          className="aui-md-cite mx-0.5 inline-flex items-center justify-center rounded-sm bg-muted/60 px-1 align-super text-[10px] font-medium text-foreground/70 leading-tight no-underline hover:bg-muted hover:text-foreground transition-colors"
        >
          {children}
          <span className="sr-only"> — {domain}</span>
        </a>
      )
    }

    if (isBlob) {
      const childArray = Array.isArray(children) ? children : [children]
      const cleanChildren = childArray.map((c) =>
        typeof c === "string" ? c.replace(/^📎\s*/, "") : c,
      )
      const filenameGuess =
        typeof cleanChildren[0] === "string" ? cleanChildren[0] : ""
      const isPdf = hrefStr.toLowerCase().includes(".pdf") ||
        filenameGuess.toLowerCase().endsWith(".pdf")

      const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        // Cmd/Ctrl-click, middle-click, modifier keys → let the browser open
        // the URL in a new tab as the user expects. Otherwise pop the inline
        // side-panel preview.
        if (
          !previewer ||
          e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ||
          e.button !== 0
        ) return
        e.preventDefault()
        previewer.open({
          url: hrefStr,
          filename: filenameGuess || hrefStr.split("/").pop() || "file",
          contentType: guessContentType(hrefStr, filenameGuess),
        })
      }

      return (
        <a
          href={hrefStr}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClick}
          className={cn(
            "aui-md-a not-prose inline-flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-xs no-underline hover:border-[var(--border-strong)] transition-colors my-1.5 max-w-[320px]",
            className,
          )}
          {...props}
        >
          <span className="shrink-0 flex size-9 items-center justify-center rounded-md bg-muted">
            {isPdf ? (
              <span className="text-[9px] font-semibold tracking-wider text-red-500">PDF</span>
            ) : (
              <svg className="size-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
            )}
          </span>
          <span className="min-w-0 flex-1 py-0.5">
            <span className="block truncate font-medium text-foreground/90">
              {cleanChildren}
            </span>
            <span className="block text-[10px] text-muted-foreground mt-0.5">
              Click to preview
            </span>
          </span>
        </a>
      )
    }
    // All other markdown links open in a new tab — safer default and matches
    // user expectation when clicking an external URL inside chat.
    return (
      <a
        href={hrefStr}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "aui-md-a text-primary underline underline-offset-2 hover:text-primary/80",
          className,
        )}
        {...props}
      >
        {children}
      </a>
    )
  },
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "aui-md-blockquote my-2.5 border-muted-foreground/30 border-l-2 pl-3 text-muted-foreground italic",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "aui-md-ul my-2 ml-4 list-disc marker:text-muted-foreground [&>li]:mt-1",
        className,
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "aui-md-ol my-2 ml-4 list-decimal marker:text-muted-foreground [&>li]:mt-1",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr
      className={cn("aui-md-hr my-2 border-muted-foreground/20", className)}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <table
      className={cn(
        "aui-md-table my-2 w-full border-separate border-spacing-0 overflow-y-auto",
        className,
      )}
      {...props}
    />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "aui-md-th bg-muted px-2 py-1 text-left font-medium first:rounded-tl-lg last:rounded-tr-lg [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        "aui-md-td border-muted-foreground/20 border-b border-l px-2 py-1 text-left last:border-r [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }) => (
    <tr
      className={cn(
        "aui-md-tr m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-bl-lg [&:last-child>td:last-child]:rounded-br-lg",
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("aui-md-li leading-normal", className)} {...props} />
  ),
  sup: ({ className, ...props }) => (
    <sup
      className={cn("aui-md-sup [&>a]:text-xs [&>a]:no-underline", className)}
      {...props}
    />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "aui-md-pre overflow-x-auto rounded-t-none rounded-b-lg border border-border/50 border-t-0 bg-muted/30 p-3 text-xs leading-relaxed",
        className,
      )}
      {...props}
    />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock &&
            "aui-md-inline-code rounded-md border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        {...props}
      />
    );
  },
  CodeHeader,
});
