import { useState } from "react"
import { Head, router } from "@inertiajs/react"
import { Plug, Trash2, Check, Search } from "lucide-react"

import { Overline } from "@/components/brand"
import { PageHeader } from "@/components/page-header"
import AppLayout from "@/layouts/app-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConnectModal, type CatalogApp, type ConnectMode } from "@/components/integrations/connect-modal"

interface CatalogEntry {
  slug: string
  label: string
  category: string
  description: string | null
  logo: string | null
  available: boolean
  auth_type: string
  modes: ConnectMode[]
  review: "none" | "google" | "gated"
  tool: "proxy" | "mcp"
  mcp_url: string | null
}

interface OrgIntegrationConfig {
  provider: string
  mode: ConnectMode
  client_id: string | null
  has_secret: boolean
}

interface Integration {
  id: number
  service_name: string
  status: string
  scopes: string[]
  created_at: string
  scope?: "org" | "user"
  owner_user_id?: number | null
  is_mine?: boolean
}

interface McpServerRow {
  id: number
  name: string
  slug: string
  url: string
  status: string
  connected: boolean
}

interface ServiceCard {
  slug: string
  label: string
  category: string
  description: string | null
  available: boolean
  logo: string | null
  tool: "proxy" | "mcp"
}

interface Props {
  integrations: Integration[]
  catalog?: CatalogEntry[]
  org_integration_configs?: OrgIntegrationConfig[]
  nango_connect_base_url?: string | null
  requested_services?: string[]
  mcp_servers?: McpServerRow[]
}

export default function IntegrationsIndex({
  integrations,
  catalog = [],
  org_integration_configs = [],
  nango_connect_base_url = null,
  requested_services = [],
  mcp_servers = [],
}: Props) {
  const requestedSet = new Set(requested_services)
  // The static catalog (Nango directory) is always present now.
  const services: ServiceCard[] = catalog.map((c) => ({
    slug: c.slug, label: c.label, category: c.category, description: c.description, available: c.available, logo: c.logo, tool: c.tool,
  }))
  const catalogBySlug = new Map(catalog.map((c) => [c.slug, c]))
  const orgConfigBySlug = new Map(org_integration_configs.map((c) => [c.provider, c]))

  const [query, setQuery] = useState("")
  const [scopeView, setScopeView] = useState<"org" | "user">("org")
  const [selectedCategory, setSelectedCategory] = useState<string>("All")
  const [pageSize, setPageSize] = useState<number>(60)
  const [requesting, setRequesting] = useState<string | null>(null)
  const [disconnectingId, setDisconnectingId] = useState<number | null>(null)
  const [pendingDisconnect, setPendingDisconnect] = useState<{ id: number; label: string } | null>(null)
  const [optimisticRequested, setOptimisticRequested] = useState<Set<string>>(new Set())
  // When set, the 3-mode connect modal (Managed / BYO-OAuth / Paste-token).
  const [connectApp, setConnectApp] = useState<CatalogApp | null>(null)
  // When set, the token-auth connect guide (e.g. Meta Ads) — instructions + paste field.
  const [tokenConnect, setTokenConnect] = useState<CatalogEntry | null>(null)
  const [tokenValue, setTokenValue] = useState("")
  const [tokenSaving, setTokenSaving] = useState(false)

  // Catalog apps open the 3-mode modal (Managed / BYO-OAuth / Paste-token).
  function connect(serviceName: string, _scope: "org" | "user" = "org") {
    const entry = catalogBySlug.get(serviceName)
    if (!entry) return
    // tool:mcp apps (Meta Ads) connect via the dedicated MCP's OAuth, not Nango.
    if (entry.tool === "mcp") { connectMcp(entry); return }
    setConnectApp({
      slug: entry.slug, label: entry.label, category: entry.category, description: entry.description,
      logo: entry.logo, auth_type: entry.auth_type, modes: entry.modes, review: entry.review,
    })
  }

  // Direct MCP connect: reuse an existing server for this slug (just re-auth),
  // otherwise create one from the catalog's mcp_url. OAuth-spec servers redirect
  // to full-page consent; token-auth servers (e.g. the Pipeboard Meta Ads MCP,
  // which 401s OAuth discovery) fall back to pasting a static Bearer token.
  async function connectMcp(entry: CatalogEntry) {
    const existing = mcp_servers.find((s) => s.slug === entry.slug)
    if (existing) { window.location.href = `/mcp_servers/${existing.id}/connect`; return }
    if (!entry.mcp_url) return
    const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
    const post = (extra: Record<string, unknown> = {}) =>
      fetch("/mcp_servers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ name: entry.label, slug: entry.slug, url: entry.mcp_url, ...extra }),
      })

    const res = await post()
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.id) { window.location.href = `/mcp_servers/${data.id}/connect`; return }

    // OAuth discovery failed → this MCP authenticates with a static token, not
    // OAuth. Open the guided token-connect modal (how-to instructions + paste field).
    setTokenValue("")
    setTokenConnect(entry)
  }

  // Submit the pasted token for a token-auth MCP (from the connect-guide modal).
  async function submitTokenConnect() {
    if (!tokenConnect || !tokenValue.trim() || tokenSaving) return
    setTokenSaving(true)
    const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
    try {
      const res = await fetch("/mcp_servers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ name: tokenConnect.label, slug: tokenConnect.slug, url: tokenConnect.mcp_url, access_token: tokenValue.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.id) { window.location.reload(); return }
      alert(data.error || "Couldn't connect with that token.")
    } catch {
      alert("Couldn't connect with that token.")
    }
    setTokenSaving(false)
  }

  function disconnect(id: number) {
    setDisconnectingId(id)
    setPendingDisconnect(null)
    router.delete(`/integrations/${id}`, {
      preserveScroll: true,
      onFinish: () => setDisconnectingId(null),
    })
  }

  // Direct MCP servers connect via a full-page OAuth redirect (Meta → back),
  // so Connect is a plain link; disconnect clears the stored tokens.
  async function disconnectMcp(id: number) {
    const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
    await fetch(`/mcp_servers/${id}`, { method: "DELETE", headers: { "X-CSRF-Token": csrf } })
    router.reload()
  }

  async function requestIntegration(slug: string) {
    if (requestedSet.has(slug) || optimisticRequested.has(slug) || requesting) return
    setRequesting(slug)
    const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
    try {
      const res = await fetch(`/integrations/${slug}/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        setOptimisticRequested((prev) => {
          const next = new Set(prev)
          next.add(slug)
          return next
        })
      }
    } finally {
      setRequesting(null)
    }
  }

  // Sidebar-driven layout. "All" first, then ordered categories. Counts
  // reflect the active search query so users see how many matches each
  // category has as they type. Right pane is the only scroll surface.
  const matchesQuery = (s: ServiceCard) => {
    if (!query) return true
    const q = query.toLowerCase()
    return s.slug.toLowerCase().includes(q) || s.label.toLowerCase().includes(q)
  }
  const allFiltered = services
    .filter(matchesQuery)
    .sort((a, b) => (a.available === b.available ? 0 : a.available ? -1 : 1))

  // Categories come from the catalog's own per-app categorization. We don't
  // pin a hardcoded order — most-populated categories first so the user lands
  // on busy buckets, "Other" pinned last as a catch-all.
  const categoryCounts = allFiltered.reduce<Record<string, number>>((acc, s) => {
    acc[s.category] = (acc[s.category] || 0) + 1
    return acc
  }, {})
  const sortedCats = Object.keys(categoryCounts)
    .filter((c) => c !== "Other")
    .sort((a, b) => (categoryCounts[b] - categoryCounts[a]) || a.localeCompare(b))
  const sidebarCategories = [
    "All",
    ...sortedCats,
    ...(categoryCounts["Other"] ? ["Other"] : []),
  ]

  const visibleForCategory = selectedCategory === "All"
    ? allFiltered
    : allFiltered.filter((s) => s.category === selectedCategory)
  const totalInCategory = visibleForCategory.length
  const pagedSlice = visibleForCategory.slice(0, pageSize)

  return (
    <AppLayout
      crumbs={[
        { label: "Workspace", href: "/" },
        { label: "Tools" },
        { label: "Integrations" },
      ]}
    >
      <Head title="Integrations" />
      <div className="flex items-start justify-between">
        <PageHeader
          eyebrow="Tools"
          title="Integrations"
          description="Connect the services your agents work inside. OAuth once, they use them forever."
        />
        <a href="/integrations/activity" className="mt-1 shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-[var(--border-strong)] hover:text-foreground">
          Activity
        </a>
      </div>

      {/* Workspace / Personal scope toggle */}
      <div className="mb-2 inline-flex rounded-md border border-border p-0.5">
        <button
          onClick={() => setScopeView("org")}
          className={`rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
            scopeView === "org"
              ? "bg-[var(--indigo-surface)] text-[var(--color-indigo)]"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Workspace · everyone
        </button>
        <button
          onClick={() => setScopeView("user")}
          className={`rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
            scopeView === "user"
              ? "bg-[var(--indigo-surface)] text-[var(--color-indigo)]"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Yours · just you
        </button>
      </div>

      <p className="mb-4 text-xs text-muted-foreground">
        {scopeView === "org"
          ? "Connections shared across the workspace. Your teammates' agents can use these too."
          : "Personal connections. Only your chats and your agents see these — your teammates can't."}
      </p>

      {/* Direct connections — OAuth straight to the provider's MCP server
          (Meta Ads, etc.), no broker. Connect is a full-page OAuth
          redirect; the callback brings the user back here connected. */}
      {scopeView === "org" && mcp_servers.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex items-baseline justify-between border-b border-border pb-2">
            <h2 className="text-base font-semibold text-foreground">Direct connections</h2>
            <span className="text-xs text-muted-foreground">connected straight to the provider — no broker</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mcp_servers.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{s.name}</p>
                  <p className={`truncate text-xs ${s.connected ? "text-[var(--color-indigo)]" : "text-muted-foreground"}`}>
                    {s.connected ? "Connected" : "Not connected"}
                  </p>
                </div>
                {s.connected ? (
                  <button
                    onClick={() => disconnectMcp(s.id)}
                    className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Disconnect
                  </button>
                ) : (
                  <a
                    href={`/mcp_servers/${s.id}/connect`}
                    className="shrink-0 rounded-md bg-[var(--color-indigo)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                  >
                    Connect
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active category header — spans the full width above both the
          sidebar and the grid so it reads as "this is what's below this
          line", regardless of whether the user is looking at the
          category list or the cards. */}
      <div className="mb-3 flex items-baseline justify-between border-b border-border pb-2">
        <h2 className="text-base font-semibold text-foreground">
          {selectedCategory === "All" ? "All services" : selectedCategory}
        </h2>
        <span className="text-xs font-mono text-muted-foreground">
          {pagedSlice.length.toLocaleString()} / {totalInCategory.toLocaleString()}
        </span>
      </div>

      {/* Two-pane layout: sidebar is content-sized (auto-height card),
          right pane is the only scroll surface with a fixed viewport
          height so cards scroll independently. */}
      <div className="grid grid-cols-[240px_1fr] gap-6 items-start">
        <aside className="rounded-xl border border-border bg-card p-3 flex flex-col">
          <div className="relative mb-3">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-xs placeholder:text-muted-foreground focus:border-[var(--color-indigo)] focus:outline-none focus:ring-2 focus:ring-[var(--indigo-surface)]"
            />
          </div>
          <Overline className="mb-2 px-1">Category</Overline>
          <ul className="space-y-0.5 text-sm">
            {sidebarCategories.map((cat) => {
              const count = cat === "All"
                ? allFiltered.length
                : (categoryCounts[cat] || 0)
              const active = selectedCategory === cat
              return (
                <li key={cat}>
                  <button
                    type="button"
                    onClick={() => { setSelectedCategory(cat); setPageSize(60) }}
                    className={`w-full flex items-center justify-between rounded-md px-2 py-1.5 text-left transition ${
                      active
                        ? "bg-muted text-foreground font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    <span className="truncate">{cat}</span>
                    <span className={`text-[10px] font-mono ${active ? "text-foreground" : "text-muted-foreground/70"}`}>
                      {count.toLocaleString()}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <main className="h-[calc(100vh-14rem)] overflow-y-auto pr-2">
          {totalInCategory === 0 ? (
            <div className="py-12 text-center">
              <p className="font-mono text-sm text-muted-foreground">
                {query ? `No matches for "${query}"` : "No services in this category"}
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {pagedSlice.map((service) => {
                  // tool:mcp apps (Meta) are "connected" via an McpServer, not
                  // an Integration row — check both.
                  const mcpServer = service.tool === "mcp"
                    ? mcp_servers.find((s) => s.slug === service.slug && s.connected)
                    : undefined
                  const connected = mcpServer || (service.available && integrations.find((i) =>
                    i.service_name === service.slug &&
                    i.status === "connected" &&
                    (scopeView === "org" ? i.scope !== "user" : i.is_mine)
                  ))
                  const isRequested = !service.available &&
                    (requestedSet.has(service.slug) || optimisticRequested.has(service.slug))

                  return (
                    <div
                      key={service.slug}
                      className={`group relative flex items-center gap-3 rounded-lg border px-3.5 py-3 transition-all ${
                        connected
                          ? "border-[var(--color-success)]/30 bg-[var(--color-success)]/[0.04]"
                          : service.available
                          ? "hover:border-[var(--border-strong)]"
                          : "border-dashed border-border/60 hover:border-border"
                      }`}
                    >
                      <div
                        className={`relative flex size-9 shrink-0 items-center justify-center rounded-md border overflow-hidden ${
                          connected
                            ? "border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {service.logo ? (
                          <img
                            src={service.logo}
                            alt={service.label}
                            className={`size-6 object-contain ${service.available ? "" : "opacity-70"}`}
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none"
                            }}
                          />
                        ) : (
                          <Plug className="size-4" />
                        )}
                        {connected && (
                          <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-[var(--color-success)] text-white ring-2 ring-background">
                            <Check className="size-2.5" strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm truncate ${connected ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
                          {service.label}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {connected ? (
                            <span className="flex items-center gap-1.5 font-mono font-semibold text-[var(--color-success)]">
                              <span className="size-1 rounded-full bg-[var(--color-success)] animate-pulse-glow" />
                              CONNECTED
                            </span>
                          ) : (
                            service.description || service.category
                          )}
                        </p>
                      </div>
                      {connected ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={disconnectingId === connected.id}
                          onClick={() => mcpServer ? disconnectMcp(mcpServer.id) : setPendingDisconnect({ id: connected.id, label: service.label })}
                          className="h-7 shrink-0 gap-1.5 border-destructive/20 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Disconnect ${service.label}`}
                        >
                          <Trash2 className="size-3" />
                          {disconnectingId === connected.id ? "Disconnecting..." : "Disconnect"}
                        </Button>
                      ) : service.available ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 shrink-0 text-xs"
                          onClick={() => connect(service.slug, scopeView)}
                        >
                          Connect
                        </Button>
                      ) : isRequested ? (
                        <Badge variant="outline" className="h-7 shrink-0 text-[10px] gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                          <Check className="size-3" /> Requested
                        </Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 text-xs"
                          disabled={requesting === service.slug}
                          onClick={() => requestIntegration(service.slug)}
                        >
                          {requesting === service.slug ? "…" : "Request"}
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>

              {pageSize < totalInCategory && (
                <div className="mt-4 mb-4 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => setPageSize((s) => s + 60)}
                  >
                    Load more · {(totalInCategory - pageSize).toLocaleString()} remaining
                  </Button>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {connectApp && (
        <ConnectModal
          app={connectApp}
          scope={scopeView}
          orgConfig={orgConfigBySlug.get(connectApp.slug)}
          connectBaseUrl={nango_connect_base_url}
          onClose={() => setConnectApp(null)}
          onConnected={() => { setConnectApp(null); router.reload() }}
        />
      )}

      <Dialog open={pendingDisconnect !== null} onOpenChange={(open) => !open && setPendingDisconnect(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect {pendingDisconnect?.label}?</DialogTitle>
            <DialogDescription>
              This removes the connected account. Agents will lose access until you reconnect it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingDisconnect(null)}
              disabled={pendingDisconnect ? disconnectingId === pendingDisconnect.id : false}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => pendingDisconnect && disconnect(pendingDisconnect.id)}
              disabled={pendingDisconnect ? disconnectingId === pendingDisconnect.id : false}
              className="gap-1.5"
            >
              <Trash2 className="size-3.5" />
              {pendingDisconnect && disconnectingId === pendingDisconnect.id ? "Disconnecting..." : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Token-auth connect guide — token-based MCPs (e.g. Meta Ads) that don't
          do OAuth. Embeds step-by-step "how to get the token" guidance so the
          connect flow is self-documenting for end users. */}
      <Dialog open={tokenConnect !== null} onOpenChange={(open) => { if (!open) { setTokenConnect(null); setTokenValue("") } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect {tokenConnect?.label}</DialogTitle>
            <DialogDescription>
              {tokenConnect?.slug === "meta_ads"
                ? "Meta Ads connects with a Meta system-user access token (not OAuth). Here's how to get one:"
                : `${tokenConnect?.label ?? "This app"} connects with an access token. Paste it below.`}
            </DialogDescription>
          </DialogHeader>

          {tokenConnect?.slug === "meta_ads" && (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                Open{" "}
                <a className="text-[var(--color-indigo)] underline-offset-4 hover:underline" href="https://business.facebook.com/settings/system-users" target="_blank" rel="noreferrer">
                  Business Settings → Users → System Users
                </a>.
              </li>
              <li>Select (or add) a system user, then click <span className="font-medium text-foreground">Generate New Token</span>.</li>
              <li>Choose the Sentrel Meta app and grant <span className="font-medium text-foreground">ads_management</span> and <span className="font-medium text-foreground">ads_read</span> (add <span className="font-medium text-foreground">pages_show_list</span> + <span className="font-medium text-foreground">pages_manage_posts</span> to post organically).</li>
              <li>Under <span className="font-medium text-foreground">Assign Assets</span>, give the system user your <span className="font-medium text-foreground">Ad Account</span> (and Page).</li>
              <li>Copy the token and paste it below.</li>
            </ol>
          )}

          <Input
            type="password"
            autoFocus
            placeholder="Paste your access token"
            value={tokenValue}
            onChange={(e) => setTokenValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitTokenConnect() }}
          />
          <p className="text-xs text-muted-foreground">
            Stored encrypted and used only to call {tokenConnect?.label ?? "this service"} on your behalf. You won't see the token again after saving.
          </p>

          <DialogFooter>
            <Button variant="ghost" onClick={() => { setTokenConnect(null); setTokenValue("") }} disabled={tokenSaving}>
              Cancel
            </Button>
            <Button onClick={submitTokenConnect} disabled={tokenSaving || !tokenValue.trim()} className="gap-1.5">
              <Plug className="size-3.5" />
              {tokenSaving ? "Connecting..." : "Connect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
