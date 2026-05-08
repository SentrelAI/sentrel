import { Head, useForm } from "@inertiajs/react"
import { useEffect, useRef, useState } from "react"
import { Copy, Check, Loader2, RefreshCw, X } from "lucide-react"

import { Overline } from "@/components/brand"
import { PageHeader } from "@/components/page-header"
import AppLayout from "@/layouts/app-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { dashboardPath, settingsPath } from "@/routes"
import { AnthropicAccountCard, type AiAccount } from "@/components/anthropic-account-card"
import { cn } from "@/lib/utils"

interface Member {
  id: number
  name: string
  email: string
  role: string
  created_at: string
}

interface ManagedDnsInfo {
  zones: Array<{ zone: string; provider: string }>
  suggested_subdomain: string | null
  auto_connect?: boolean
}

interface Props {
  organization: {
    id: number
    name: string
    slug: string
    email_domain: string | null
    email_domain_verified: boolean
    context_md: string | null
  }
  members: Member[]
  anthropic_account?: AiAccount
  managed_dns?: ManagedDnsInfo
}

export default function SettingsShow({ organization, members, anthropic_account, managed_dns }: Props) {
  const { data, setData, patch, processing } = useForm({
    organization: {
      name: organization.name,
      email_domain: organization.email_domain || "",
      context_md: organization.context_md || "",
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    patch(settingsPath())
  }

  return (
    <AppLayout
      crumbs={[
        { label: "Control panel", href: dashboardPath() },
        { label: "Settings" },
      ]}
    >
      <Head title="Settings" />

      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Manage your organization, email domain, and team members."
      />

      <div className="max-w-2xl space-y-8">
        {/* AI account (subscription auth) — moved here from /integrations.
            Pasting a Claude Pro / Max token routes agents through the
            in-process billing proxy on their Fly Machine instead of metered
            API. */}
        <section>
          <Overline className="mb-3">AI Account</Overline>
          <p className="text-xs text-muted-foreground mb-3">
            Run agents on your Claude Pro / Max / Team subscription instead of paying per token. Subject to subscription rate limits — best for hands-on use, not autonomous fleets.
          </p>
          <AnthropicAccountCard account={anthropic_account} />
        </section>

        {/* Organization */}
        <section>
          <Overline className="mb-3">Organization</Overline>
          <div className="rounded-lg border bg-card p-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={data.organization.name} onChange={(e) => setData("organization", { ...data.organization, name: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>Slug</Label>
                  <Input value={organization.slug} disabled className="text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground">Used in URLs — cannot be changed</p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={processing}>
                  {processing ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </div>
        </section>

        {/* Email Domain */}
        <EmailDomainSection
          organization={organization}
          emailDomain={data.organization.email_domain}
          onDomainChange={(val) => setData("organization", { ...data.organization, email_domain: val })}
          onSave={handleSubmit}
          processing={processing}
          managedDns={managed_dns}
        />

        {/* Organization Context */}
        <section>
          <Overline className="mb-3">Agent Context</Overline>
          <div className="rounded-lg border border-border p-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="context_md">Shared context for all agents</Label>
                <textarea
                  id="context_md"
                  className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus:border-[var(--color-signal)] focus:ring-2 focus:ring-[var(--color-signal)]/10"
                  placeholder={"ScribeMD builds AI-powered medical transcription.\nOur ICP: healthcare companies, 50-500 employees.\nCompetitors: Nuance, DeepScribe."}
                  value={data.organization.context_md}
                  onChange={(e) => setData("organization", { ...data.organization, context_md: e.target.value })}
                />
                <p className="text-[10px] text-muted-foreground">
                  Appears in every agent's context as "About My Organization"
                </p>
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={processing}>
                  {processing ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </div>
        </section>

        {/* Team Members */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <Overline>Team Members</Overline>
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled>
              Invite
            </Button>
          </div>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Email</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Role</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Joined</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium">{member.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{member.email}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="secondary" className="text-[10px] capitalize">{member.role}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(member.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppLayout>
  )
}

// ── Email domain section ──
interface DnsRecord { type: string; name: string; value: string; purpose: string }
interface AutoDnsResult {
  applied?: Array<{ type: string; name: string; purpose: string }>
  skipped?: Array<{ type: string; name: string; purpose: string; reason: string }>
  errors?: Array<{ type: string; name: string; purpose: string; error: string }>
  zone?: string
  error?: string
}

function EmailDomainSection({ organization, emailDomain, onDomainChange, onSave, processing, managedDns }: {
  organization: Props["organization"]
  emailDomain: string
  onDomainChange: (val: string) => void
  onSave: (e: React.FormEvent) => void
  processing: boolean
  managedDns?: ManagedDnsInfo
}) {
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([])
  const [autoDns, setAutoDns] = useState<AutoDnsResult | null>(null)
  const [managedZone, setManagedZone] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const pollAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false })

  // Auto-poll verification once we've connected the identity (or DNS auto-
  // applied). 5s interval, stops on Success or after 5 minutes.
  function startVerificationPoll() {
    pollAbortRef.current.cancelled = false
    const startedAt = Date.now()
    const tick = async () => {
      if (pollAbortRef.current.cancelled) return
      if (Date.now() - startedAt > 5 * 60_000) return
      const ok = await pollOnce()
      if (ok) return
      setTimeout(tick, 5_000)
    }
    setTimeout(tick, 5_000)
  }

  async function pollOnce(): Promise<boolean> {
    try {
      const res = await fetch("/settings/check_domain_verification", { method: "POST", headers: { "X-CSRF-Token": csrf(), "Content-Type": "application/json" } })
      const data = await res.json()
      setVerificationStatus(data.status)
      if (data.verified) return true
    } catch { /* keep polling */ }
    return false
  }

  function csrf() {
    return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
  }

  async function connectDomain() {
    setLoading(true)
    setErrorMsg(null)
    try {
      const res = await fetch("/settings/verify_domain", { method: "POST", headers: { "X-CSRF-Token": csrf(), "Content-Type": "application/json" } })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data.error || `Server returned ${res.status}`)
        return
      }
      setDnsRecords(data.records || [])
      setAutoDns(data.auto_dns || null)
      setManagedZone(data.managed_zone || null)
      setVerificationStatus(data.verification_status || "Pending")
      // Whether records were auto-applied or the user has to add them
      // manually, start polling so the UI flips to Verified on its own.
      startVerificationPoll()
    } catch (e) {
      setErrorMsg((e as Error).message || "Network error")
    }
    setLoading(false)
  }

  async function checkVerification() {
    setChecking(true)
    setErrorMsg(null)
    try {
      const res = await fetch("/settings/check_domain_verification", { method: "POST", headers: { "X-CSRF-Token": csrf(), "Content-Type": "application/json" } })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data.error || `Server returned ${res.status}`)
        return
      }
      setVerificationStatus(data.status)
      // If the server self-healed the missing identity, fetch records for the
      // user to add manually (or auto-apply if managed zone).
      if (data.initialized) {
        await connectDomain()
      }
    } catch (e) {
      setErrorMsg((e as Error).message || "Network error")
    }
    setChecking(false)
  }

  function copyValue(value: string, idx: number) {
    navigator.clipboard.writeText(value)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  // Auto-trigger Connect when we land on the page with ?connect=1 (set by
  // the claim-subdomain redirect) so the user lands on a fully-configured
  // domain without an extra click.
  useEffect(() => {
    if (managedDns?.auto_connect && organization.email_domain && !organization.email_domain_verified && dnsRecords.length === 0) {
      connectDomain()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function resetEmailDomain() {
    setLoading(true)
    setErrorMsg(null)
    try {
      const form = document.createElement("form")
      form.method = "POST"
      form.action = "/settings/reset_email_domain"
      const csrfInput = document.createElement("input")
      csrfInput.type = "hidden"
      csrfInput.name = "authenticity_token"
      csrfInput.value = csrf()
      form.appendChild(csrfInput)
      document.body.appendChild(form)
      form.submit()
    } catch (e) {
      setErrorMsg((e as Error).message || "Network error")
      setLoading(false)
    }
  }

  async function claimManagedSubdomain(args: { label?: string; zone?: string; domain?: string }) {
    setLoading(true)
    setErrorMsg(null)
    try {
      const form = document.createElement("form")
      form.method = "POST"
      form.action = "/settings/claim_managed_subdomain"
      const csrfInput = document.createElement("input")
      csrfInput.type = "hidden"
      csrfInput.name = "authenticity_token"
      csrfInput.value = csrf()
      form.appendChild(csrfInput)
      for (const [k, v] of Object.entries(args)) {
        if (!v) continue
        const i = document.createElement("input")
        i.type = "hidden"
        i.name = k
        i.value = v
        form.appendChild(i)
      }
      document.body.appendChild(form)
      form.submit()
    } catch (e) {
      setErrorMsg((e as Error).message || "Network error")
      setLoading(false)
    }
  }

  return (
    <section>
      <Overline className="mb-3">Email Domain</Overline>
      <div className="rounded-lg border border-border p-4 space-y-4">
        {!organization.email_domain && managedDns?.zones && managedDns.zones.length > 0 && (
          <SubdomainPicker
            defaultLabel={managedDns.suggested_subdomain?.split(".")[0] || ""}
            zone={managedDns.zones[0].zone}
            onProvision={(label, zone) => claimManagedSubdomain({ label, zone })}
            loading={loading}
          />
        )}
        {organization.email_domain && (
          <ConnectedDomainCard
            domain={organization.email_domain}
            verified={organization.email_domain_verified || verificationStatus === "Success"}
            verificationStatus={verificationStatus}
            loading={loading}
            checking={checking}
            recordsLoaded={dnsRecords.length > 0}
            onConnect={connectDomain}
            onVerify={checkVerification}
            onReset={resetEmailDomain}
          />
        )}

        {!organization.email_domain && (
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground transition-colors">Use your own domain instead</summary>
            <form onSubmit={onSave} className="space-y-3 mt-3 pl-2 border-l border-border/50">
              <div className="space-y-1">
                <Label htmlFor="email_domain" className="text-xs">Domain</Label>
                <Input
                  id="email_domain"
                  placeholder="team.company.com"
                  value={emailDomain}
                  onChange={(e) => onDomainChange(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground/80">You'll add the DNS records yourself. We'll show you what to add after Save.</p>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={processing} variant="outline" size="sm" className="h-7 text-xs">
                  {processing ? "Saving..." : "Save Domain"}
                </Button>
              </div>
            </form>
          </details>
        )}

        {errorMsg && (
          <div className="rounded-md border border-red-300 bg-red-50 p-2 text-[11px] text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            <span className="font-medium">Error:</span> {errorMsg}
          </div>
        )}

        {autoDns?.error && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <span className="font-medium">DNS auto-config failed:</span> {autoDns.error}
            <span className="block text-[10px] mt-1 text-amber-700 dark:text-amber-400">Falling back to manual — copy the records below into your DNS provider.</span>
          </div>
        )}

        {autoDns && (autoDns.applied?.length || autoDns.skipped?.length) ? (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-[11px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <span className="font-medium">Auto-configured DNS on {autoDns.zone}.</span>
            {autoDns.applied && autoDns.applied.length > 0 && (
              <span className="ml-1">{autoDns.applied.length} record{autoDns.applied.length === 1 ? "" : "s"} added.</span>
            )}
            {autoDns.skipped && autoDns.skipped.length > 0 && (
              <span className="ml-1 text-emerald-700 dark:text-emerald-400">{autoDns.skipped.length} already in place.</span>
            )}
            <span className="block text-[10px] mt-1 text-emerald-700 dark:text-emerald-400">Verification polls every 5s; the badge flips to Verified once SES confirms (usually 1–5 min).</span>
          </div>
        ) : null}

        {managedZone && !autoDns?.applied?.length && !autoDns?.error && (
          <div className="rounded-md border border-sky-300 bg-sky-50 p-2 text-[11px] text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300">
            <span className="font-medium">{managedZone} is on our managed zone.</span> Click <span className="font-medium">Connect domain</span> and we'll add the records for you — no DNS copy/paste needed.
          </div>
        )}

        {dnsRecords.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">DNS Records</p>
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Type</th>
                    <th className="text-left px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Name</th>
                    <th className="text-left px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Value</th>
                    <th className="text-left px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Purpose</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {dnsRecords.map((record, idx) => (
                    <tr key={idx} className="border-b border-border last:border-0">
                      <td className="px-3 py-2"><Badge variant="outline" className="font-mono text-[10px]">{record.type}</Badge></td>
                      <td className="px-3 py-2 font-mono break-all">{record.name}</td>
                      <td className="px-3 py-2 font-mono break-all max-w-[180px] truncate">{record.value}</td>
                      <td className="px-3 py-2 text-muted-foreground">{record.purpose}</td>
                      <td className="px-2 py-2">
                        <button onClick={() => copyValue(record.value, idx)} className="p-1 hover:bg-muted rounded">
                          {copiedIdx === idx ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3 text-muted-foreground" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

// Picker for grabbing a subdomain on one of our managed zones (default
// double.md). Live availability check while the user types — debounced
// 350ms — so we don't hammer the server. Default value is the org slug.
// One Provision button → claim_managed_subdomain → redirect → auto-runs
// the SES + DNS provisioning on mount.
function SubdomainPicker({
  defaultLabel,
  zone,
  onProvision,
  loading,
}: {
  defaultLabel: string
  zone: string
  onProvision: (label: string, zone: string) => void
  loading: boolean
}) {
  const [label, setLabel] = useState(defaultLabel)
  const [status, setStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle")
  const [reason, setReason] = useState<string | null>(null)

  useEffect(() => {
    if (!label.trim()) { setStatus("idle"); setReason(null); return }
    setStatus("checking")
    setReason(null)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/settings/subdomain_availability?label=${encodeURIComponent(label)}&zone=${encodeURIComponent(zone)}`, {
          headers: { Accept: "application/json" },
        })
        const data = await res.json()
        if (data.available) { setStatus("available"); setReason(null) }
        else { setStatus(data.full ? "taken" : "invalid"); setReason(data.reason || null) }
      } catch { setStatus("idle") }
    }, 350)
    return () => clearTimeout(t)
  }, [label, zone])

  const sanitized = label.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
  const canProvision = status === "available" && !loading && sanitized.length > 0

  return (
    <div className="rounded-lg border border-indigo-300 bg-indigo-50/40 p-4 dark:border-indigo-800 dark:bg-indigo-950/30">
      <div className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">Pick your email subdomain</div>
      <div className="mt-1 text-[11px] text-indigo-800/80 dark:text-indigo-300/80">
        Your agents will send and receive at <span className="font-mono">your-pick</span><span className="font-mono text-indigo-600 dark:text-indigo-400">.{zone}</span>. We auto-create the SES identity, DKIM, and Route 53 records — no DNS work for you.
      </div>
      <div className="mt-3 flex items-stretch gap-2">
        <div className="flex flex-1 items-stretch rounded-md border bg-background overflow-hidden focus-within:border-indigo-400">
          <input
            type="text"
            placeholder="acme"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="flex-1 px-2.5 py-1.5 text-sm font-mono outline-none bg-transparent"
            spellCheck={false}
            autoFocus
          />
          <span className="flex items-center pr-2.5 text-xs font-mono text-muted-foreground select-none">.{zone}</span>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-auto px-3 text-xs"
          disabled={!canProvision}
          onClick={() => onProvision(sanitized, zone)}
        >
          {loading ? <Loader2 className="size-3 animate-spin mr-1.5" /> : null}
          Provision
        </Button>
      </div>
      <div className="mt-1.5 min-h-[16px] text-[11px]">
        {status === "checking" && <span className="text-muted-foreground inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Checking…</span>}
        {status === "available" && <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><Check className="size-3" /> <span className="font-mono">{sanitized}.{zone}</span> is available</span>}
        {status === "taken" && <span className="text-red-600 dark:text-red-400 inline-flex items-center gap-1"><X className="size-3" /> {reason || "already taken"}</span>}
        {status === "invalid" && <span className="text-amber-600 dark:text-amber-400">{reason || "Invalid subdomain"}</span>}
      </div>
    </div>
  )
}

// Compact "domain is connected" view. Shows the domain, the verified
// state with a friendly label (not the raw SES status), and the actions
// the user actually needs at this stage. Click "Change" to reset back
// to the picker. While unverified, exposes the manual Connect/Verify
// buttons (mostly redundant with auto-poll, kept for the "your-own-
// domain" path where we couldn't push DNS for them).
function ConnectedDomainCard({
  domain,
  verified,
  verificationStatus,
  loading,
  checking,
  recordsLoaded,
  onConnect,
  onVerify,
  onReset,
}: {
  domain: string
  verified: boolean
  verificationStatus: string | null
  loading: boolean
  checking: boolean
  recordsLoaded: boolean
  onConnect: () => void
  onVerify: () => void
  onReset: () => void
}) {
  // SES returns "Success" / "Failed" / "Pending"; map to user-facing text.
  const statusLabel = verified
    ? "Verified"
    : verificationStatus === "Failed"
      ? "Failed"
      : verificationStatus === "Pending"
        ? "Pending DNS propagation…"
        : verificationStatus
          ? verificationStatus
          : "Pending"

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-3 flex items-center gap-3">
        <div className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md border",
          verified
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
            : "border-amber-500/40 bg-amber-500/10 text-amber-500",
        )}>
          {verified ? <Check className="size-4" strokeWidth={3} /> : <Loader2 className="size-4 animate-spin" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm truncate">{domain}</div>
          <div className="text-[11px] text-muted-foreground">
            {verified
              ? <>Agents at <span className="font-mono">your-name@{domain}</span></>
              : statusLabel}
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={onReset} disabled={loading}>
          Change
        </Button>
      </div>

      {!verified && (
        <div className="flex items-center justify-end gap-2">
          <Button type="button" size="sm" className="h-7 text-xs" onClick={onConnect} disabled={loading}>
            {loading ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
            {recordsLoaded ? "Refresh records" : "Connect domain"}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={onVerify} disabled={checking}>
            {checking ? <Loader2 className="size-3 animate-spin mr-1" /> : <RefreshCw className="size-3 mr-1" />}
            Verify
          </Button>
        </div>
      )}
    </div>
  )
}
