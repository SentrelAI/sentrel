import { Head, useForm } from "@inertiajs/react"
import { useState } from "react"
import { Copy, Check, Loader2, RefreshCw } from "lucide-react"

import AppLayout from "@/layouts/app-layout"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { settingsPath } from "@/routes"

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
}

export default function SettingsShow({ organization, members }: Props) {
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
    <AppLayout>
      <Head title="Settings" />
      <PageHeader title="Settings" description="Manage your organization" />

      <div className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
            <CardDescription>General settings for your workspace</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={data.organization.name} onChange={(e) => setData("organization", { ...data.organization, name: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Slug</Label>
                <Input value={organization.slug} disabled className="text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Used in URLs — cannot be changed</p>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={processing}>
                  {processing ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <EmailDomainCard
          organization={organization}
          emailDomain={data.organization.email_domain}
          onDomainChange={(val) => setData("organization", { ...data.organization, email_domain: val })}
          onSave={handleSubmit}
          processing={processing}
        />

        <Card>
          <CardHeader>
            <CardTitle>Organization Context</CardTitle>
            <CardDescription>Tell your agents about your company — shared with all agents</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="context_md">Context</Label>
                <textarea
                  id="context_md"
                  className="flex min-h-[160px] w-full rounded-md border-2 border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus:border-[var(--color-gold)] focus:ring-[3px] focus:ring-[var(--color-gold-border)]"
                  placeholder={"ScribeMD builds AI-powered medical transcription.\nOur ICP: healthcare companies, 50-500 employees.\nCompetitors: Nuance, DeepScribe.\nCEO prefers Slack for updates."}
                  value={data.organization.context_md}
                  onChange={(e) => setData("organization", { ...data.organization, context_md: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  This appears in every agent's context as "About My Organization"
                </p>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={processing}>
                  {processing ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Separator />

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Team Members</CardTitle>
                <CardDescription>People who can manage agents in this organization</CardDescription>
              </div>
              <Button variant="outline" size="sm" disabled>
                Invite
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">{member.name}</TableCell>
                    <TableCell className="text-muted-foreground">{member.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">{member.role}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(member.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}

interface DnsRecord {
  type: string
  name: string
  value: string
  purpose: string
}

function EmailDomainCard({ organization, emailDomain, onDomainChange, onSave, processing }: {
  organization: Props["organization"]
  emailDomain: string
  onDomainChange: (val: string) => void
  onSave: (e: React.FormEvent) => void
  processing: boolean
}) {
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  async function getDnsRecords() {
    setLoading(true)
    try {
      const res = await fetch("/settings/verify_domain", { method: "POST", headers: { "X-CSRF-Token": document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || "", "Content-Type": "application/json" } })
      if (!res.ok) throw new Error("Failed")
      const data = await res.json()
      setDnsRecords(data.records || [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  async function checkVerification() {
    setChecking(true)
    try {
      const res = await fetch("/settings/check_domain_verification", { method: "POST", headers: { "X-CSRF-Token": document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || "", "Content-Type": "application/json" } })
      const data = await res.json()
      setVerificationStatus(data.status)
    } catch { /* ignore */ }
    setChecking(false)
  }

  function copyValue(value: string, idx: number) {
    navigator.clipboard.writeText(value)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Domain</CardTitle>
        <CardDescription>Custom domain for agent email addresses</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
                <Badge className="bg-green-600 shrink-0">Verified</Badge>
              ) : organization.email_domain ? (
                <Badge variant="secondary" className="shrink-0">
                  {verificationStatus || "Pending"}
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Agents will send emails from @{emailDomain || "your-domain.com"}
            </p>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button type="submit" disabled={processing} variant="outline" size="sm">
              {processing ? "Saving..." : "Save Domain"}
            </Button>
            {organization.email_domain && !organization.email_domain_verified && (
              <>
                <Button type="button" size="sm" variant="outline" onClick={getDnsRecords} disabled={loading}>
                  {loading ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
                  Get DNS Records
                </Button>
                <Button type="button" size="sm" onClick={checkVerification} disabled={checking}>
                  {checking ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <RefreshCw className="size-3.5 mr-1.5" />}
                  Check Verification
                </Button>
              </>
            )}
          </div>
        </form>

        {dnsRecords.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Add these DNS records to your domain:</p>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dnsRecords.map((record, idx) => (
                    <TableRow key={idx}>
                      <TableCell><Badge variant="outline" className="font-mono text-[10px]">{record.type}</Badge></TableCell>
                      <TableCell className="font-mono text-xs break-all">{record.name}</TableCell>
                      <TableCell className="font-mono text-xs break-all max-w-[200px] truncate">{record.value}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{record.purpose}</TableCell>
                      <TableCell>
                        <button onClick={() => copyValue(record.value, idx)} className="p-1 hover:bg-muted rounded">
                          {copiedIdx === idx ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5 text-muted-foreground" />}
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
