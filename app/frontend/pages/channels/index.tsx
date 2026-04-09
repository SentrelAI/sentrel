import { Head, Link, router } from "@inertiajs/react"
import { ArrowLeft, MessageSquare, Phone, Hash, Send, Mail, Check, X, Plus, Loader2, ShoppingCart } from "lucide-react"
import { useState, useEffect } from "react"

import AppLayout from "@/layouts/app-layout"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { agentPath } from "@/routes"

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  web: MessageSquare,
  email: Mail,
  whatsapp: Phone,
  sms: Phone,
  slack: Hash,
  telegram: Send,
}

interface ChannelConfig {
  id: number
  channel_type: string
  enabled: boolean
  config: Record<string, unknown>
  status: string
}

interface AvailableChannel {
  label: string
  icon: string
  description: string
  always_available?: boolean
  fields: Record<string, { type: string; label: string; placeholder?: string; required?: boolean; sensitive?: boolean; hint?: string }>
}

interface TwilioNumber {
  sid: string
  phone_number: string
  friendly_name: string
  capabilities: { sms: boolean; voice: boolean; mms: boolean }
  assigned: boolean
}

interface AvailableNumber {
  phone_number: string
  friendly_name: string
  locality: string
  region: string
  capabilities: { sms: boolean; voice: boolean; mms: boolean }
}

interface Props {
  agent: { id: number; name: string; slug: string }
  channels: ChannelConfig[]
  available_channels: Record<string, AvailableChannel>
  twilio_configured: boolean
}

export default function ChannelsIndex({ agent, channels, available_channels, twilio_configured }: Props) {
  const [connectingChannel, setConnectingChannel] = useState<string | null>(null)
  const connectedTypes = channels.map((c) => c.channel_type)
  const isTwilioChannel = (key: string) => key === "whatsapp" || key === "sms"

  return (
    <AppLayout>
      <Head title={`${agent.name} — Channels`} />

      <div className="mb-6">
        <Link href={agentPath(agent.id)} className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="size-3.5 mr-1" />
          Back to {agent.name}
        </Link>
        <PageHeader title="Channels" description={`Configure how ${agent.name} communicates`} />
      </div>

      <div className="max-w-2xl space-y-3">
        {/* Connected channels */}
        {channels.map((ch) => {
          const Icon = CHANNEL_ICONS[ch.channel_type] || MessageSquare
          const def = available_channels[ch.channel_type]

          return (
            <Card key={ch.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-8 items-center justify-center rounded-md bg-muted">
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{def?.label || ch.channel_type}</p>
                    <p className="text-xs text-muted-foreground">
                      {Object.entries(ch.config || {}).filter(([k]) => !k.includes("token") && !k.includes("secret")).map(([, v]) => `${v}`).join(" · ") || "Connected"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="bg-green-600 text-xs">
                    <Check className="size-3 mr-1" />
                    Connected
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.delete(`/agents/${agent.id}/channel_configs/${ch.id}`)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}

        {/* Available channels to connect */}
        {Object.entries(available_channels)
          .filter(([key, val]) => !connectedTypes.includes(key) && !val.always_available)
          .map(([key, channel]) => {
            const Icon = CHANNEL_ICONS[key] || MessageSquare

            return (
              <Card key={key} className="opacity-60 hover:opacity-100 transition-opacity">
                <CardContent className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-md bg-muted">
                      <Icon className="size-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{channel.label}</p>
                      <p className="text-xs text-muted-foreground">{channel.description}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setConnectingChannel(key)}>
                    <Plus className="size-4 mr-1" />
                    Connect
                  </Button>
                </CardContent>
              </Card>
            )
          })}

        {/* Web chat — always available */}
        <Card className="opacity-50">
          <CardContent className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-md bg-muted">
                <MessageSquare className="size-4 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-sm">Web Chat</p>
                <p className="text-xs text-muted-foreground">Always available from the dashboard</p>
              </div>
            </div>
            <Badge variant="secondary">Built-in</Badge>
          </CardContent>
        </Card>
      </div>

      {/* Connect dialog — channel-specific flows */}
      {connectingChannel && isTwilioChannel(connectingChannel) && twilio_configured && (
        <TwilioConnectDialog
          channelKey={connectingChannel}
          channel={available_channels[connectingChannel]!}
          agentId={agent.id}
          onClose={() => setConnectingChannel(null)}
        />
      )}
      {connectingChannel && connectingChannel === "email" && (
        <EmailConnectDialog
          agentSlug={agent.slug}
          agentId={agent.id}
          onClose={() => setConnectingChannel(null)}
        />
      )}
      {connectingChannel && connectingChannel !== "email" && !(isTwilioChannel(connectingChannel) && twilio_configured) && (
        <GenericConnectDialog
          channelKey={connectingChannel}
          channel={available_channels[connectingChannel]!}
          agentId={agent.id}
          onClose={() => setConnectingChannel(null)}
        />
      )}
    </AppLayout>
  )
}

// ── Twilio connect dialog: pick existing number or buy new ──
function TwilioConnectDialog({ channelKey, channel, agentId, onClose }: {
  channelKey: string
  channel: AvailableChannel
  agentId: number
  onClose: () => void
}) {
  const [step, setStep] = useState<"choose" | "existing" | "buy">("choose")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Existing numbers
  const [existingNumbers, setExistingNumbers] = useState<TwilioNumber[]>([])

  // Buy flow
  const [country, setCountry] = useState("US")
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([])
  const [buying, setBuying] = useState<string | null>(null)

  async function loadExistingNumbers() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/agents/${agentId}/channel_configs/twilio_numbers`)
      if (!res.ok) throw new Error("Failed to load numbers")
      const data = await res.json()
      setExistingNumbers(data)
      setStep("existing")
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function searchAvailableNumbers(c: string) {
    setLoading(true)
    setError(null)
    setCountry(c)
    try {
      const res = await fetch(`/agents/${agentId}/channel_configs/available_numbers?country=${c}`)
      if (!res.ok) throw new Error("Failed to search numbers")
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setAvailableNumbers(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function connectExisting(phoneNumber: string) {
    router.post(`/agents/${agentId}/channel_configs`, {
      channel_config: {
        channel_type: channelKey,
        enabled: true,
        config: { phone_number: phoneNumber },
      },
    }, { onSuccess: onClose })
  }

  function buyAndConnect(phoneNumber: string) {
    setBuying(phoneNumber)
    router.post(`/agents/${agentId}/channel_configs/buy_number`, {
      phone_number: phoneNumber,
      channel_type: channelKey,
    }, {
      onSuccess: onClose,
      onError: () => setBuying(null),
    })
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect {channel.label}</DialogTitle>
          <DialogDescription>
            {step === "choose" && "Choose how to set up your Twilio number"}
            {step === "existing" && "Pick a number from your Twilio account"}
            {step === "buy" && "Browse and purchase a new number"}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</div>
        )}

        {/* Step: Choose */}
        {step === "choose" && (
          <div className="space-y-2">
            <button
              onClick={loadExistingNumbers}
              disabled={loading}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:border-[var(--color-gold-border)] hover:bg-[var(--color-gold-surface)] transition-colors text-left"
            >
              <div className="flex size-9 items-center justify-center rounded-md bg-muted shrink-0">
                <Phone className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Use existing number</p>
                <p className="text-xs text-muted-foreground">Pick from numbers already in your Twilio account</p>
              </div>
              {loading && <Loader2 className="size-4 animate-spin shrink-0" />}
            </button>

            <button
              onClick={() => { setStep("buy"); searchAvailableNumbers("US") }}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:border-[var(--color-gold-border)] hover:bg-[var(--color-gold-surface)] transition-colors text-left"
            >
              <div className="flex size-9 items-center justify-center rounded-md bg-muted shrink-0">
                <ShoppingCart className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Buy new number</p>
                <p className="text-xs text-muted-foreground">Purchase a new phone number from Twilio</p>
              </div>
            </button>
          </div>
        )}

        {/* Step: Existing numbers */}
        {step === "existing" && (
          <div className="space-y-1">
            {existingNumbers.length === 0 && !loading && (
              <div className="py-8 text-center">
                <p className="text-sm text-muted-foreground mb-3">No numbers in your Twilio account</p>
                <Button variant="outline" size="sm" onClick={() => { setStep("buy"); searchAvailableNumbers("US") }}>
                  Buy a number instead
                </Button>
              </div>
            )}

            <div className="max-h-72 overflow-y-auto space-y-1">
              {existingNumbers.map((num) => (
                <div
                  key={num.sid}
                  className="flex items-center justify-between px-3 py-2.5 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <p className="font-mono text-sm font-medium">{num.phone_number}</p>
                    <p className="text-xs text-muted-foreground">{num.friendly_name}</p>
                  </div>
                  {num.assigned ? (
                    <Badge variant="secondary" className="text-[10px]">In use</Badge>
                  ) : (
                    <Button size="sm" onClick={() => connectExisting(num.phone_number)}>
                      Use this
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-3 border-t">
              <Button variant="ghost" size="sm" onClick={() => setStep("choose")}>Back</Button>
              <Button variant="outline" size="sm" onClick={() => { setStep("buy"); searchAvailableNumbers("US") }}>
                <ShoppingCart className="size-3.5 mr-1.5" />
                Buy new number
              </Button>
            </div>
          </div>
        )}

        {/* Step: Buy number */}
        {step === "buy" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Label className="shrink-0 text-xs">Country</Label>
              <Select value={country} onValueChange={(v) => searchAvailableNumbers(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="US">United States</SelectItem>
                  <SelectItem value="GB">United Kingdom</SelectItem>
                  <SelectItem value="CA">Canada</SelectItem>
                  <SelectItem value="AU">Australia</SelectItem>
                  <SelectItem value="DE">Germany</SelectItem>
                  <SelectItem value="FR">France</SelectItem>
                  <SelectItem value="NL">Netherlands</SelectItem>
                  <SelectItem value="SE">Sweden</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="py-8 flex items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : availableNumbers.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No numbers available in this region
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-1">
                {availableNumbers.map((num) => (
                  <div
                    key={num.phone_number}
                    className="flex items-center justify-between px-3 py-2.5 rounded-md hover:bg-muted/50 transition-colors"
                  >
                    <div>
                      <p className="font-mono text-sm font-medium">{num.phone_number}</p>
                      <p className="text-xs text-muted-foreground">
                        {[num.locality, num.region].filter(Boolean).join(", ")}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      disabled={buying !== null}
                      onClick={() => buyAndConnect(num.phone_number)}
                    >
                      {buying === num.phone_number ? (
                        <><Loader2 className="size-3.5 animate-spin mr-1.5" /> Buying...</>
                      ) : (
                        "Buy & Connect"
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t">
              <Button variant="ghost" size="sm" onClick={() => setStep("choose")}>Back</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Generic connect dialog for non-Twilio channels ──
// ── Email connect dialog — auto-suggest address ──
function EmailConnectDialog({ agentSlug, agentId, onClose }: {
  agentSlug: string
  agentId: number
  onClose: () => void
}) {
  const [address, setAddress] = useState(`${agentSlug}@alchemy.scribemd.ai`)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    router.post(`/agents/${agentId}/channel_configs`, {
      channel_config: {
        channel_type: "email",
        enabled: true,
        config: { address },
      },
    }, { onSuccess: onClose })
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Email</DialogTitle>
          <DialogDescription>
            This agent will send and receive emails from this address
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Email Address</Label>
            <Input
              type="email"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Make sure the domain is verified in Settings before sending
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit">Connect</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Generic connect dialog for non-Twilio channels ──
function GenericConnectDialog({ channelKey, channel, agentId, onClose }: {
  channelKey: string
  channel: AvailableChannel
  agentId: number
  onClose: () => void
}) {
  const fields = channel.fields || {}
  const [values, setValues] = useState<Record<string, string>>({})

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    router.post(`/agents/${agentId}/channel_configs`, {
      channel_config: {
        channel_type: channelKey,
        enabled: true,
        config: values,
      },
    }, { onSuccess: onClose })
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {channel.label}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {Object.entries(fields).map(([key, field]) => (
            <div key={key} className="space-y-2">
              <Label>{field.label} {field.required && <span className="text-destructive">*</span>}</Label>
              <Input
                type={field.sensitive ? "password" : "text"}
                placeholder={field.placeholder || ""}
                value={values[key] || ""}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                required={field.required}
              />
              {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
            </div>
          ))}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit">Connect</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
