import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseMessageWithApprovals } from "@/components/agent-chat";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  useAuiState,
  useThreadRuntime,
} from "@assistant-ui/react";
import { useMessageQueueOptional } from "@/contexts/message-queue";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MailIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SquareIcon,
  XIcon,
  Loader2Icon,
} from "lucide-react";
import { ShieldAlertIcon, CheckIcon as CheckCircleIcon, XIcon as XCircleIcon } from "lucide-react";
import { type FC, useState, useEffect, createContext, useContext } from "react";

// Command approval context — set by AgentChat, consumed by Thread
type CmdApprovalData = {
  approvalId: string
  command: string
  level: string
  explanation: string
  resolve: (level: "once" | "session" | "always" | "deny") => void
} | null

const CmdApprovalContext = createContext<CmdApprovalData>(null);
export const CmdApprovalProvider = CmdApprovalContext.Provider;

// Item 4 — generic action approval (LinkedIn post / spend / send batch / etc.)
type ActionApprovalData = {
  approvalToken: string
  summary: string
  payloadType: string
  payload: Record<string, unknown>
  options: Array<{ label: string; value: string }>
  riskTier: string
  allowAmendment: boolean
  resolve: (decision: { value: string; text?: string }) => void
} | null

const ActionApprovalContext = createContext<ActionApprovalData>(null);
export const ActionApprovalProvider = ActionApprovalContext.Provider;

// Item 5 — propose_connection: agent asks the user to connect an unconnected
// toolkit (LinkedIn, HubSpot, etc.). Inline card with a Connect button.
type ConnectionProposalData = {
  service: string
  label: string
  why: string
  dismiss: () => void
} | null

const ConnectionProposalContext = createContext<ConnectionProposalData>(null);
export const ConnectionProposalProvider = ConnectionProposalContext.Provider;

// Agent lifecycle status — set by AgentChat. The composer is disabled and
// shows a "loading" state until the underlying agent reaches "running".
const AgentStatusContext = createContext<string>("running");
export const AgentStatusProvider = AgentStatusContext.Provider;

// Recovery-mode "agent is thinking" signal. True when the page mounted
// while a run was in flight (server-driven via agentThinking prop). The
// composer ORs this with runtime.isRunning so the same Thinking…/stop UI
// appears whether the run is in-tab or carried over from another session.
type RecoveryThinking = {
  active: boolean
  since: string | null
  // Called when user clicks the stop button while in recovery mode — we can't
  // actually cancel a server-side run from a fresh tab, but we can dismiss
  // the local indicator so the user can move on.
  dismiss: () => void
}
const RecoveryThinkingContext = createContext<RecoveryThinking>({
  active: false,
  since: null,
  dismiss: () => {},
});
export const RecoveryThinkingProvider = RecoveryThinkingContext.Provider;

function isAgentReady(status: string) {
  return status === "running";
}

function agentLoadingLabel(status: string) {
  switch (status) {
    case "pending":
    case "starting":
      return "Agent is starting up…";
    case "paused":
      return "Agent is paused";
    case "stopped":
      return "Agent is stopped";
    default:
      return "Agent is loading…";
  }
}

export const Thread: FC = () => {
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-radius" as string]: "24px",
        ["--composer-padding" as string]: "10px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="end"
        autoScroll
        className="aui-thread-viewport relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4"
      >
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <ThreadWelcome />
        </AuiIf>

        <ThreadPrimitive.Messages>
          {() => <ThreadMessage />}
        </ThreadPrimitive.Messages>

        <div className="flex-1" />
        <InlineCommandApproval />
        <InlineActionApproval />
        <InlineConnectionProposal />

        <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible rounded-t-(--composer-radius) bg-background pb-4 md:pb-6">
          <ThreadScrollToBottom />
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);
  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessage />;
};

const InlineCommandApproval: FC = () => {
  const approval = useContext(CmdApprovalContext);
  const [result, setResult] = useState<string | null>(null);

  if (!approval && !result) return null;

  if (result) {
    return (
      <div className="mx-auto w-full max-w-(--thread-max-width) py-2">
        <div className={`rounded-xl border p-3 text-sm ${result === "Denied" ? "border-red-200 text-red-700 dark:border-red-800 dark:text-red-400" : "border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400"}`}>
          Command {result.toLowerCase()}
        </div>
      </div>
    );
  }

  if (!approval) return null;

  function handleAction(level: "once" | "session" | "always" | "deny") {
    const labels: Record<string, string> = { once: "Allowed once", session: "Allowed for session", always: "Always allowed", deny: "Denied" };
    setResult(labels[level]);
    approval!.resolve(level);
    setTimeout(() => setResult(null), 3000);
  }

  return (
    <div className="mx-auto w-full max-w-(--thread-max-width) pb-2 animate-in slide-in-from-bottom-2 fade-in duration-200">
      <div className="rounded-xl border bg-card p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
          <ShieldAlertIcon className="size-4" />
          Command Approval Required ({approval.level})
        </div>
        <code className="block text-xs bg-muted p-2.5 rounded overflow-x-auto">{approval.command}</code>
        <p className="text-xs text-muted-foreground">{approval.explanation}</p>
        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <button onClick={() => handleAction("once")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors">
            <CheckCircleIcon className="size-3" /> Allow Once
          </button>
          <button onClick={() => handleAction("session")} className="px-3 py-1.5 rounded-md border text-xs font-medium hover:bg-muted transition-colors">
            Allow Session
          </button>
          <button onClick={() => handleAction("always")} className="px-3 py-1.5 rounded-md border text-xs font-medium hover:bg-muted transition-colors">
            Always Allow
          </button>
          <button onClick={() => handleAction("deny")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-300 text-red-600 dark:border-red-700 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950 transition-colors">
            <XCircleIcon className="size-3" /> Deny
          </button>
        </div>
      </div>
    </div>
  );
};

const InlineActionApproval: FC = () => {
  const approval = useContext(ActionApprovalContext);
  const [done, setDone] = useState<string | null>(null);
  const [amendOpen, setAmendOpen] = useState(false);
  const [amendText, setAmendText] = useState("");

  if (!approval && !done) return null;

  if (done) {
    return (
      <div className="mx-auto w-full max-w-(--thread-max-width) py-2">
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          {done}
        </div>
      </div>
    );
  }
  if (!approval) return null;

  const handle = (value: string, text?: string, label?: string) => {
    approval.resolve({ value, text });
    setDone(text ? `Sent edit: ${label}` : `Sent: ${label || value}`);
    setAmendOpen(false);
    setAmendText("");
    setTimeout(() => setDone(null), 3000);
  };

  const payload = approval.payload || {};
  const cleanPayload: Record<string, unknown> = { ...payload };
  delete cleanPayload._allow_amendment;
  delete cleanPayload._origin;

  return (
    <div className="mx-auto w-full max-w-(--thread-max-width) pb-2 animate-in slide-in-from-bottom-2 fade-in duration-200">
      <div className="rounded-xl border bg-card p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlertIcon className="size-4 text-amber-600 dark:text-amber-400" />
            <span className="text-xs font-medium">{approval.summary}</span>
            <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {approval.payloadType.replace(/_/g, " ")}
            </span>
          </div>
          {approval.riskTier === "high" && (
            <span className="rounded-sm bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] text-red-500">high risk</span>
          )}
        </div>

        <ActionPreview payloadType={approval.payloadType} payload={cleanPayload} />

        <div className="flex flex-wrap gap-2 pt-2 border-t">
          {approval.options.map((opt) => {
            const isReject = opt.value === "reject" || opt.value === "rejected" || opt.value === "cancel";
            return (
              <button
                key={opt.value}
                onClick={() => handle(opt.value, undefined, opt.label)}
                className={
                  isReject
                    ? "px-3 py-1.5 rounded-md border border-red-300 text-red-600 dark:border-red-700 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    : "px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors"
                }
              >
                {opt.label}
              </button>
            );
          })}
          {approval.allowAmendment && (
            <button
              onClick={() => setAmendOpen(!amendOpen)}
              className="px-3 py-1.5 rounded-md border text-xs font-medium hover:bg-muted transition-colors"
            >
              ✎ Edit
            </button>
          )}
        </div>

        {amendOpen && (
          <div className="space-y-2 pt-2 border-t">
            <textarea
              value={amendText}
              onChange={(e) => setAmendText(e.target.value)}
              placeholder="What should change? e.g. 'tighten the headline; drop paragraph 2'"
              className="w-full min-h-[80px] rounded-md border bg-background p-2 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setAmendOpen(false); setAmendText("") }}
                className="px-3 py-1.5 rounded-md border text-xs font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={!amendText.trim()}
                onClick={() => handle("edit", amendText.trim(), amendText.trim().slice(0, 60))}
                className="px-3 py-1.5 rounded-md bg-foreground text-background text-xs font-medium disabled:opacity-50"
              >
                Send edit
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function ActionPreview({ payloadType, payload }: { payloadType: string; payload: Record<string, unknown> }) {
  const previewMd = typeof payload._preview_markdown === "string" ? payload._preview_markdown : null;
  const previewAtt = Array.isArray(payload._preview_attachments)
    ? (payload._preview_attachments as Array<{ type: string; url: string; label?: string }>)
    : [];

  // For known payload types, prefer the dedicated renderer.
  if (payloadType === "linkedin_post" || payloadType === "tweet") {
    const text = String(payload.text || "");
    return (
      <div className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto">
        {text}
      </div>
    );
  }
  if (payloadType === "email_draft") {
    return (
      <div className="space-y-1.5">
        <div className="text-xs"><span className="text-muted-foreground">To: </span>{String(payload.to || "")}</div>
        <div className="text-xs"><span className="text-muted-foreground">Subj: </span>{String(payload.subject || "")}</div>
        <div className="text-sm whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto border-t pt-2">
          {String(payload.body || "")}
        </div>
      </div>
    );
  }
  if (payloadType === "cold_email_bulk") {
    const items = (payload.items as Array<Record<string, unknown>>) || [];
    return (
      <div className="space-y-2 max-h-72 overflow-y-auto">
        <div className="text-xs text-muted-foreground">{items.length} email(s)</div>
        {items.slice(0, 5).map((item, i) => (
          <div key={i} className="rounded border bg-muted/30 p-2 text-xs">
            <div className="flex justify-between font-medium">
              <span>{String(item.to || "")}</span>
              <span className="text-muted-foreground">{String(item.subject || "")}</span>
            </div>
            <div className="mt-1 text-muted-foreground line-clamp-2">{String(item.body || "")}</div>
          </div>
        ))}
        {items.length > 5 && <div className="text-xs text-muted-foreground">+ {items.length - 5} more</div>}
      </div>
    );
  }
  if (payloadType === "spend_request") {
    return (
      <div className="space-y-1">
        <div className="text-2xl font-semibold">${String(payload.amount_usd || "—")}</div>
        <div className="text-xs text-muted-foreground">{String(payload.vendor || "")}</div>
        {payload.purpose ? <div className="text-sm">{String(payload.purpose)}</div> : null}
      </div>
    );
  }
  // Universal fallback — agent-supplied markdown preview wins over JSON dump.
  if (previewMd) {
    return (
      <div className="space-y-2">
        <div className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0">
          <PreviewMarkdown text={previewMd} />
        </div>
        {previewAtt.length > 0 && <PreviewAttachments items={previewAtt} />}
      </div>
    );
  }

  const cleanForJson: Record<string, unknown> = { ...payload };
  delete cleanForJson._preview_markdown;
  delete cleanForJson._preview_attachments;
  return (
    <div className="space-y-2">
      <pre className="text-xs bg-muted p-2.5 rounded overflow-auto max-h-48 font-mono whitespace-pre-wrap">
        {JSON.stringify(cleanForJson, null, 2)}
      </pre>
      {previewAtt.length > 0 && <PreviewAttachments items={previewAtt} />}
    </div>
  );
}

const InlineConnectionProposal: FC = () => {
  const proposal = useContext(ConnectionProposalContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!proposal) return null;

  const onConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || "";
      const res = await fetch(`/integrations/${proposal.service}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrf },
      });

      // Server may have returned an HTML redirect (legacy path) — treat that
      // as failure and surface a useful message instead of crashing on JSON
      // parse. Successful path always returns Content-Type: application/json.
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setError(`Couldn't reach Composio for ${proposal.label}. Check the integration is set up at composio.dev → Auth configs.`);
        return;
      }

      const data = await res.json().catch(() => ({} as { redirect_url?: string; error?: string }));
      if (data.redirect_url) {
        const popup = window.open(data.redirect_url, "composio-connect", "width=600,height=700,left=200,top=100");
        const timer = setInterval(() => {
          if (popup?.closed) {
            clearInterval(timer);
            proposal.dismiss();
            setTimeout(() => window.location.reload(), 500);
          }
        }, 500);
      } else {
        setError(data.error || `Composio rejected the ${proposal.label} connect request.`);
      }
    } catch (err) {
      setError(`Network error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-(--thread-max-width) pb-2 animate-in slide-in-from-bottom-2 fade-in duration-200">
      <div className="rounded-xl border bg-card p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <ShieldAlertIcon className="size-4 text-amber-600 dark:text-amber-400" />
          <span>Connect <strong>{proposal.label}</strong> {proposal.why ? `— ${proposal.why}` : ""}</span>
        </div>
        {error && (
          <div className="rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 p-2 text-xs text-red-700 dark:text-red-400">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1 border-t">
          <button
            onClick={proposal.dismiss}
            className="px-3 py-1.5 rounded-md border text-xs font-medium hover:bg-muted transition-colors"
          >
            Not now
          </button>
          <button
            onClick={onConnect}
            disabled={busy}
            className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            {busy ? "Opening…" : `Connect ${proposal.label}`}
          </button>
        </div>
      </div>
    </div>
  );
};

function PreviewMarkdown({ text }: { text: string }) {
  // Lazy-import react-markdown so we don't bloat the chat bundle.
  const [Md, setMd] = useState<any>(null);
  const [Gfm, setGfm] = useState<any>(null);
  useEffect(() => {
    Promise.all([import("react-markdown"), import("remark-gfm")]).then(([m, g]) => {
      setMd(() => m.default);
      setGfm(() => g.default);
    }).catch(() => {});
  }, []);
  if (!Md) return <div className="whitespace-pre-wrap">{text}</div>;
  return <Md remarkPlugins={Gfm ? [Gfm] : []}>{text}</Md>;
}

function PreviewAttachments({ items }: { items: Array<{ type: string; url: string; label?: string }> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((a, i) => {
        if (a.type === "image") {
          return <img key={i} src={a.url} alt={a.label || ""} className="max-h-32 rounded border object-contain" />;
        }
        return (
          <a
            key={i}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-[11px] hover:bg-muted"
          >
            <span className="font-mono text-[10px] uppercase text-muted-foreground">{a.type}</span>
            <span>{a.label || a.url}</span>
          </a>
        );
      })}
    </div>
  );
}

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:border-border dark:bg-background dark:hover:bg-accent"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  const agentStatus = useContext(AgentStatusContext);
  const agentReady = isAgentReady(agentStatus);

  if (!agentReady) {
    return (
      <div className="aui-thread-welcome-root mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col">
        <div className="aui-thread-welcome-center flex w-full grow flex-col items-center justify-center">
          <div className="flex flex-col items-center gap-3 px-4 text-center">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
            <h1 className="font-semibold text-xl">{agentLoadingLabel(agentStatus)}</h1>
            <p className="text-muted-foreground text-sm">
              Chat will be available once the agent is running.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="aui-thread-welcome-root mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col">
      <div className="aui-thread-welcome-center flex w-full grow flex-col items-center justify-center">
        <div className="aui-thread-welcome-message flex size-full flex-col justify-center px-4">
          <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-semibold text-xl duration-200">
            What can I do for you?
          </h1>
          <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground text-base delay-75 duration-200">
            Send a message to start working together.
          </p>
        </div>
      </div>
      <ThreadSuggestions />
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions grid w-full @md:grid-cols-2 gap-2 pb-4">
      <ThreadPrimitive.Suggestions>
        {() => <ThreadSuggestionItem />}
      </ThreadPrimitive.Suggestions>
    </div>
  );
};

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 @md:nth-[n+3]:block nth-[n+3]:hidden animate-in fill-mode-both duration-200">
      <SuggestionPrimitive.Trigger send asChild>
        <Button
          variant="ghost"
          className="aui-thread-welcome-suggestion h-auto w-full @md:flex-col flex-wrap items-start justify-start gap-1 rounded-3xl border bg-background px-4 py-3 text-left text-sm transition-colors hover:bg-muted"
        >
          <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1 font-medium" />
          <SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 text-muted-foreground empty:hidden" />
        </Button>
      </SuggestionPrimitive.Trigger>
    </div>
  );
};

const Composer: FC = () => {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const recovery = useContext(RecoveryThinkingContext);
  const agentStatus = useContext(AgentStatusContext);
  const agentReady = isAgentReady(agentStatus);
  const busy = isRunning || recovery.active;
  // Allow typing + queueing while the agent is running — only block input
  // when the agent itself isn't ready (booting / paused / stopped). Send
  // button is queue-aware below.
  const disabled = !agentReady;

  const placeholder = !agentReady
    ? agentLoadingLabel(agentStatus)
    : busy
      ? "Add to queue — sends after the current reply…"
      : "Send a message — or drop files";

  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <QueuedMessagesStrip />
      <ComposerPrimitive.AttachmentDropzone asChild>
        <div
          data-slot="composer-shell"
          aria-disabled={!agentReady}
          className="group relative flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-background p-(--composer-padding) transition-all focus-within:border-ring/75 focus-within:ring-2 focus-within:ring-ring/20 data-[dragging=true]:border-ring data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/40 data-[dragging=true]:ring-4 data-[dragging=true]:ring-ring/10 aria-disabled:opacity-60 aria-disabled:cursor-not-allowed"
        >
          <div className="pointer-events-none absolute inset-0 hidden items-center justify-center rounded-(--composer-radius) bg-background/80 backdrop-blur-sm group-data-[dragging=true]:flex">
            <div className="flex flex-col items-center gap-1 text-center">
              <PlusIcon className="size-6 text-muted-foreground" />
              <span className="text-sm font-medium">Drop files to attach</span>
              <span className="text-xs text-muted-foreground">Images, documents, audio, video</span>
            </div>
          </div>

          <ComposerAttachments />
          <ComposerPrimitive.Input
            placeholder={placeholder}
            className="aui-composer-input max-h-32 min-h-10 w-full resize-none bg-transparent px-1.75 py-1 text-sm outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed"
            rows={1}
            autoFocus
            aria-label="Message input"
            disabled={disabled}
          />
          <ComposerAction agentReady={agentReady} agentStatus={agentStatus} />
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

// Strip rendered above the composer input showing each queued message as a
// dismissible pill. Only renders when there's at least one queued send.
const QueuedMessagesStrip: FC = () => {
  const queue = useMessageQueueOptional();
  if (!queue || queue.items.length === 0) return null;
  return (
    <div className="aui-queued-strip mb-2 flex flex-col gap-1.5">
      {queue.items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-1.5 text-xs"
        >
          <Loader2Icon className="size-3 shrink-0 animate-spin text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            <span className="font-medium text-foreground/80">Queued · </span>
            {item.text || <em>(attachment)</em>}
          </span>
          <button
            type="button"
            onClick={() => queue.remove(item.id)}
            className="text-muted-foreground/60 hover:text-destructive"
            aria-label="Remove from queue"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
};

const ComposerAction: FC<{ agentReady: boolean; agentStatus: string }> = ({ agentReady, agentStatus }) => {
  if (!agentReady) {
    return (
      <div className="aui-composer-action-wrapper relative flex items-center justify-between gap-2">
        <span className="size-8" />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" />
          <span>{agentLoadingLabel(agentStatus)}</span>
        </div>
        <Button
          type="button"
          variant="default"
          size="icon"
          className="aui-composer-send size-8 rounded-full"
          aria-label="Agent not ready"
          disabled
        >
          <Loader2Icon className="size-4 animate-spin" />
        </Button>
      </div>
    );
  }

  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between gap-2">
      <ComposerAddAttachment />

      <div className="flex items-center gap-2">
        <ThinkingStatus />
        <QueueAwareSend />
      </div>
    </div>
  );
};

// Single source of truth for the "agent is thinking" indicator inside the
// composer. Shows the spinner + Stop button when EITHER the runtime is
// running (in-tab adapter run) OR the page mounted in recovery mode (server
// said a run was in flight). Recovery-mode click on Stop dismisses the
// local indicator — the engine run continues server-side, but the user
// stops staring at a stuck pill.
const ThinkingStatus: FC = () => {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const recovery = useContext(RecoveryThinkingContext);
  const showThinking = isRunning || recovery.active;
  const [elapsed, setElapsed] = useState<string>("");

  useEffect(() => {
    if (!recovery.active || !recovery.since) {
      setElapsed("");
      return;
    }
    function tick() {
      if (!recovery.since) return;
      const ms = Date.now() - new Date(recovery.since).getTime();
      const sec = Math.floor(ms / 1000);
      if (sec < 60) setElapsed(`${sec}s`);
      else if (sec < 3600) setElapsed(`${Math.floor(sec / 60)}m ${sec % 60}s`);
      else setElapsed(`${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`);
    }
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [recovery.active, recovery.since]);

  if (!showThinking) return null;

  return (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" />
        <span>Thinking{elapsed ? ` · ${elapsed}` : "…"}</span>
      </div>
      {isRunning ? (
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="aui-composer-cancel size-8 rounded-full text-muted-foreground hover:text-foreground"
            aria-label="Stop generating"
          >
            <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={recovery.dismiss}
          className="aui-composer-cancel size-8 rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Dismiss thinking indicator"
        >
          <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
        </Button>
      )}
    </>
  );
};

// Send button that stays visible during runs. When the agent isn't busy this
// behaves exactly like ComposerPrimitive.Send. While the agent is running it
// intercepts the click, pushes the composer text into the message queue, and
// resets the composer — the queue drains automatically once the assistant
// completes. UX matches Linear / Slack.
const QueueAwareSend: FC = () => {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const composerText = useAuiState((s) => s.thread.composer.text);
  const runtime = useThreadRuntime();
  const queue = useMessageQueueOptional();
  const recovery = useContext(RecoveryThinkingContext);
  const busy = isRunning || recovery.active;

  if (!busy || !queue) {
    return (
      <ComposerPrimitive.Send asChild>
        <TooltipIconButton
          tooltip="Send message"
          side="bottom"
          type="button"
          variant="default"
          size="icon"
          className="aui-composer-send size-8 rounded-full"
          aria-label="Send message"
        >
          <ArrowUpIcon className="aui-composer-send-icon size-4" />
        </TooltipIconButton>
      </ComposerPrimitive.Send>
    );
  }

  const canQueue = (composerText ?? "").trim().length > 0;

  return (
    <TooltipIconButton
      tooltip="Add to queue — sends after current reply"
      side="bottom"
      type="button"
      variant="default"
      size="icon"
      className="aui-composer-send size-8 rounded-full"
      aria-label="Add to queue"
      disabled={!canQueue}
      onClick={() => {
        const text = (composerText ?? "").trim();
        if (!text) return;
        queue.enqueue(text);
        runtime.composer.setText("");
      }}
    >
      <ArrowUpIcon className="aui-composer-send-icon size-4" />
    </TooltipIconButton>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

type ToolStep = {
  id: string;
  tool: string;
  label: string;
  result?: string;
  startedAt: number;
  doneAt?: number;
};

const AssistantMessage: FC = () => {
  // Render a typing-dot pulse when the message is empty + still streaming —
  // covers both fresh sends (placeholder pre-content) and reload-mid-run
  // (recovery seed). AUI's MessagePrimitive.Parts renders nothing for an
  // empty text part on its own.
  const isEmptyAndRunning = useAuiState((s) => {
    const status = s.message.status;
    if (status?.type !== "running") return false;
    const parts = s.message.content as Array<{ type: string; text?: string }> | undefined;
    if (!parts || parts.length === 0) return true;
    return parts.every((p) => p.type !== "text" || !(p.text ?? "").trim());
  });

  const toolSteps = useAuiState((s) => {
    const custom = (s.message.metadata as { custom?: { toolSteps?: ToolStep[] } } | undefined)?.custom;
    return custom?.toolSteps ?? [];
  }) as ToolStep[];

  return (
    <MessagePrimitive.Root
      className="aui-assistant-message-root fade-in slide-in-from-bottom-1 relative mx-auto w-full max-w-(--thread-max-width) animate-in py-3 duration-150"
      data-role="assistant"
    >
      <div className="aui-assistant-message-content wrap-break-word px-2 text-foreground leading-relaxed">
        {toolSteps.length > 0 && <ToolSteps steps={toolSteps} />}
        {isEmptyAndRunning && toolSteps.length === 0 ? (
          <div className="flex items-center gap-1.5 py-1" aria-label="Agent is thinking">
            <span className="size-2 rounded-full bg-foreground/70 animate-pulse" />
            <span className="size-2 rounded-full bg-foreground/40 animate-pulse [animation-delay:150ms]" />
            <span className="size-2 rounded-full bg-foreground/20 animate-pulse [animation-delay:300ms]" />
          </div>
        ) : (
          <MessagePrimitive.Parts>
            {({ part }) => {
              if (part.type === "text") return <TextWithApprovals />;
              if (part.type === "tool-call")
                return part.toolUI ?? <ToolFallback {...part} />;
              return null;
            }}
          </MessagePrimitive.Parts>
        )}
        <MessageError />
      </div>

      <div className="aui-assistant-message-footer mt-1 ml-2 flex min-h-6 items-center">
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

// Inline tool-use timeline. Each entry is a chip with a spinner while
// active; checkmark + click-to-expand-result when done. The list collapses
// to the most-recent entry once the assistant message reaches >2 steps.
const ToolSteps: FC<{ steps: ToolStep[] }> = ({ steps }) => {
  const [expanded, setExpanded] = useState(false);
  const [openResults, setOpenResults] = useState<Record<string, boolean>>({});

  let active: ToolStep | undefined;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (!steps[i].doneAt) { active = steps[i]; break; }
  }
  const visible = expanded ? steps : active ? [active] : steps.slice(-1);
  const hidden = steps.length - visible.length;

  return (
    <div className="aui-tool-steps mb-2 flex flex-col gap-1">
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="self-start text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          ↑ {hidden} earlier {hidden === 1 ? "step" : "steps"}
        </button>
      )}
      {visible.map((step) => {
        const isOpen = openResults[step.id];
        const elapsedMs = (step.doneAt ?? Date.now()) - step.startedAt;
        const elapsed = elapsedMs > 1500 ? ` · ${(elapsedMs / 1000).toFixed(1)}s` : "";
        return (
          <div key={step.id} className="flex flex-col gap-1">
            <button
              type="button"
              disabled={!step.result}
              onClick={() => setOpenResults((p) => ({ ...p, [step.id]: !p[step.id] }))}
              className={cn(
                "group flex items-center gap-2 self-start rounded-md border bg-muted/40 px-2.5 py-1 text-[11px] text-foreground/80",
                step.result ? "cursor-pointer hover:bg-muted/70" : "cursor-default",
                !step.doneAt && "border-border/80 bg-muted/60",
              )}
            >
              {step.doneAt ? (
                <CheckIcon className="size-3 text-foreground/60" />
              ) : (
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground/40 opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-foreground/60" />
                </span>
              )}
              <span className="truncate max-w-[420px]">{step.label}</span>
              {elapsed && <span className="font-mono tabular-nums text-muted-foreground/70">{elapsed}</span>}
              {step.result && (
                <span className="text-[10px] text-muted-foreground/60 ml-auto">
                  {isOpen ? "hide" : "show"}
                </span>
              )}
            </button>
            {isOpen && step.result && (
              <pre className="ml-4 max-h-32 overflow-auto rounded-md border border-border/60 bg-muted/20 p-2 text-[10px] font-mono whitespace-pre-wrap text-muted-foreground">
                {step.result}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
};

const TextWithApprovals: FC = () => {
  const text = useAuiState((s) => {
    const parts = s.message.content;
    const textPart = parts?.find((p: any) => p.type === "text");
    return (textPart as any)?.text || "";
  });

  const { cleanText, approvals } = parseMessageWithApprovals(text);

  if (approvals.length === 0) {
    return <MarkdownText />;
  }

  // When approvals exist, render cleaned text via a simple div
  // (MarkdownText reads raw state which still has the marker)
  return (
    <>
      {cleanText && (
        <div className="aui-md" dangerouslySetInnerHTML={{
          __html: cleanText
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n\n/g, '</p><p class="my-2.5 leading-normal">')
            .replace(/\n/g, '<br>')
            .replace(/^/, '<p class="my-2.5 leading-normal first:mt-0">')
            .replace(/$/, '</p>')
        }} />
      )}
      {approvals.map((email) => (
        <InlineEmailCard key={email.approvalId} email={email} />
      ))}
    </>
  );
};

function InlineEmailCard({ email }: { email: { approvalId: number; to: string; cc?: string[]; subject: string; body_text: string; from_address: string; from_name: string; status?: string } }) {
  const [acting, setActing] = useState<"approving" | "rejecting" | null>(null);
  const [result, setResult] = useState<"approved" | "rejected" | null>(
    email.status === "approved" ? "approved" : email.status === "rejected" ? "rejected" : null
  );

  const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || "";

  async function handleAction(status: "approved" | "rejected") {
    setActing(status === "approved" ? "approving" : "rejecting");
    try {
      await fetch(`/pending_approvals/${email.approvalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ status }),
      });
      setResult(status);
    } catch {
      setActing(null);
    }
  }

  return (
    <div className="my-3 rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <MailIcon className="size-3.5" />
        {result === "approved" ? "Email sent" : result === "rejected" ? "Email rejected" : "Email draft — review before sending"}
      </div>

      {!result && (
        <>
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

          <div className="border-t pt-2 text-sm text-muted-foreground whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">
            {email.body_text}
          </div>

          <div className="flex gap-2 pt-1 border-t">
            <button
              onClick={() => handleAction("approved")}
              disabled={acting !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {acting === "approving" ? <Loader2Icon className="size-3 animate-spin" /> : <CheckIcon className="size-3" />}
              Approve & Send
            </button>
            <button
              onClick={() => handleAction("rejected")}
              disabled={acting !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              {acting === "rejecting" ? <Loader2Icon className="size-3 animate-spin" /> : <XIcon className="size-3" />}
              Reject
            </button>
          </div>
        </>
      )}

      {result === "approved" && (
        <p className="text-xs text-green-700 flex items-center gap-1.5">
          <CheckIcon className="size-3" /> Email approved and sending
        </p>
      )}
      {result === "rejected" && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <XIcon className="size-3" /> Email rejected
        </p>
      )}
    </div>
  );
}

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root col-start-3 row-start-2 -ml-1 flex gap-1 text-muted-foreground"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="More"
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className="aui-user-message-root fade-in slide-in-from-bottom-1 mx-auto grid w-full max-w-(--thread-max-width) animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 py-3 duration-150 [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content wrap-break-word peer rounded-2xl bg-muted px-4 py-2.5 text-foreground empty:hidden">
          {/* Render user-message text via the same MarkdownText renderer
              we use for assistant messages so injected links — like the
              attachment chips we serialize into content for restored
              messages — become clickable instead of showing raw markdown. */}
          <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
        </div>
        <div className="aui-user-action-bar-wrapper absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2 peer-empty:hidden">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker className="aui-user-branch-picker col-span-full col-start-1 row-start-3 -mr-1 justify-end" />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit p-4">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root className="aui-edit-composer-wrapper mx-auto flex w-full max-w-(--thread-max-width) flex-col px-2 py-3">
      <ComposerPrimitive.Root className="aui-edit-composer-root ml-auto flex w-full max-w-[85%] flex-col rounded-2xl bg-muted">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input min-h-14 w-full resize-none bg-transparent p-4 text-foreground text-sm outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm">Update</Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root mr-2 -ml-2 inline-flex items-center text-muted-foreground text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
