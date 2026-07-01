import { Link } from "@inertiajs/react"
import { GitBranch, Rocket, Sparkles, Users } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { RobotCharacter } from "@/components/robot-character"

export interface DeployTemplate {
  slug: string
  name: string
  role: string
  description: string | null
  icon?: string | null
  category?: string | null
  system_template: boolean
  author_name?: string
  install_count?: number
  source_url?: string | null
}

// Deploy → the standard new-agent workflow, pre-filled with this template.
// A plain <a> (full navigation) not an Inertia <Link>: /agents/new is
// auth-gated, so a logged-out visitor must follow Devise's redirect-to-login
// (which an Inertia XHR can't) and land back here after signing in.
export function deployHref(slug: string): string {
  return `/agents/new?template=${encodeURIComponent(slug)}`
}

// View → the public template detail page (both pages are public, so an
// Inertia <Link> is fine).
export function viewHref(slug: string): string {
  return `/templates/${encodeURIComponent(slug)}`
}

export function TemplateDeployCard({ t }: { t: DeployTemplate }) {
  return (
    <Card className="relative flex h-full flex-col transition-colors hover:border-foreground/40">
      <Badge
        variant={t.system_template ? "secondary" : "outline"}
        className="absolute right-3 top-3 z-10 gap-1 text-[10px]"
      >
        {t.system_template ? <Sparkles className="size-3" /> : <Users className="size-3" />}
        {t.system_template ? "System" : "Community"}
      </Badge>

      {t.source_url && (
        <a
          href={t.source_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute left-3 top-3 z-10 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="View source on GitHub"
          title="View this template's bundle on GitHub"
        >
          <GitBranch className="size-3.5" />
        </a>
      )}

      <CardContent className="flex flex-1 flex-col items-center gap-2 p-4 pt-5 text-center">
        <Link href={viewHref(t.slug)} aria-label={`View ${t.name}`}>
          <RobotCharacter
            seed={t.slug}
            size={92}
            className="drop-shadow-sm transition-transform hover:scale-105"
          />
        </Link>

        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{t.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">{t.role}</div>
        </div>

        {t.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
        )}

        <div className="mt-auto grid w-full grid-cols-2 gap-2 pt-3">
          <Button asChild size="sm" className="gap-1.5">
            <a href={deployHref(t.slug)}>
              <Rocket className="size-3.5" />
              Deploy
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={viewHref(t.slug)}>View</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
