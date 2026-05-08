import { Head, useForm } from "@inertiajs/react"
import { useRef, useState } from "react"
import { Copy, Check, Loader2, RefreshCw } from "lucide-react"

import { Overline } from "@/components/brand"
import { PageHeader } from "@/components/page-header"
import AppLayout from "@/layouts/app-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { dashboardPath, settingsPath } from "@/routes"
import { AnthropicAccountCard, type AiAccount } from "@/components/anthropic-account-card"

interface Member {
  id: number
  name: string
  email: string
  role: string
  created_at: string
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
}

export default function SettingsShow({ organization, members, anthropic_account }: Props) {
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

function EmailDomainSection({ organization, emailDomain, onDomainChange, onSave, processing }: {
  organization: Props["organization"]
  emailDomain: string
  onDomainChange: (val: string) => void
  onSave: (e: React.FormEvent) => void
  processing: boolean
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

  return (
    <section>
      <Overline className="mb-3">Email Domain</Overline>
      <div className="rounded-lg border border-border p-4 space-y-4">
        <form onSubmit={onSave} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email_domain">Domain</Label>
            <div className="flex items-center gap-3">
              <Input
                id="email_domain"
                placeholder="team.company.com"
                value={emailDomain}
                onChange={(e) => onDomainChange(e.target.value)}
                className="flex-1"
              />
              {organization.email_domain_verified ? (
                <Badge className="bg-emerald-600 shrink-0 text-[10px]">Verified</Badge>
              ) : organization.email_domain ? (
                <Badge variant="secondary" className="shrink-0 text-[10px]">{verificationStatus || "Pending"}</Badge>
              ) : null}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Agents send emails from @{emailDomain || "your-domain.com"}
            </p>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button type="submit" disabled={processing} variant="outline" size="sm" className="h-7 text-xs">
              {processing ? "Saving..." : "Save Domain"}
            </Button>
            {organization.email_domain && !organization.email_domain_verified && (
              <>
                <Button type="button" size="sm" className="h-7 text-xs" onClick={connectDomain} disabled={loading}>
                  {loading ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
                  {dnsRecords.length > 0 ? "Refresh records" : "Connect domain"}
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={checkVerification} disabled={checking}>
                  {checking ? <Loader2 className="size-3 animate-spin mr-1" /> : <RefreshCw className="size-3 mr-1" />}
                  Verify
                </Button>
              </>
            )}
          </div>
        </form>

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
