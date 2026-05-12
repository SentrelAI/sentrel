import { Head, Link, router } from "@inertiajs/react"
import { ArrowLeft, Sparkles, Users, Trash2, ExternalLink } from "lucide-react"
import { useMemo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import AppLayout from "@/layouts/app-layout"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface Template {
  slug: string
  name: string
  role: string
  description: string | null
  category: string | null
  capabilities: Record<string, { enabled?: boolean }>
  suggested_skill_slugs: string[]
  suggested_provider: string | null
  suggested_model: string | null
  identity_md: string | null
  personality_md: string | null
  instructions_md: string | null
  install_count: number
  published: boolean
  system_template: boolean
  author_name: string
  owned_by_me: boolean
}

interface Props {
  template: Template
}

export default function TemplateShow({ template }: Props) {
  const enabledCaps = useMemo(
    () => Object.entries(template.capabilities || {}).filter(([_k, v]) => v?.enabled).map(([k]) => k),
    [template.capabilities],
  )

  return (
    <AppLayout
      crumbs={[
        { label: "Workspace", href: "/" },
        { label: "Templates", href: "/agent_templates" },
        { label: template.name },
      ]}
    >
      <Head title={`${template.name} · template`} />

      <PageHeader
        eyebrow="Template"
        title={template.name}
        description={template.description || `An agent set up to act as a ${template.role}.`}
        action={
          <Button asChild>
            <Link href={`/agents/new?template=${template.slug}`}>
              <ExternalLink className="size-4 mr-1.5" />
              Install
            </Link>
          </Button>
        }
      />

      <div className="max-w-3xl space-y-5">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {template.system_template ? (
                <Badge variant="secondary" className="gap-1">
                  <Sparkles className="size-3" /> System
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <Users className="size-3" /> Community
                </Badge>
              )}
              <Badge variant="outline">Role · {template.role}</Badge>
              {template.category && <Badge variant="outline">{template.category}</Badge>}
              {template.install_count > 0 && (
                <span className="text-muted-foreground">{template.install_count} installs</span>
              )}
              <span className="ml-auto text-muted-foreground">by {template.author_name}</span>
            </div>
            {enabledCaps.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Enables:</span> {enabledCaps.join(", ")}
              </div>
            )}
            {template.suggested_skill_slugs?.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Suggested skills:</span>{" "}
                {template.suggested_skill_slugs.join(", ")}
              </div>
            )}
            {template.suggested_model && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Default model:</span>{" "}
                <span className="font-mono">{template.suggested_provider}/{template.suggested_model}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {[
          { label: "Identity", body: template.identity_md },
          { label: "Personality", body: template.personality_md },
          { label: "Instructions", body: template.instructions_md },
        ].map((sec) =>
          sec.body && sec.body.trim().length > 0 ? (
            <Card key={sec.label}>
              <CardContent className="p-5 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {sec.label}
                </h3>
                <article className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{sec.body}</ReactMarkdown>
                </article>
              </CardContent>
            </Card>
          ) : null,
        )}

        {template.owned_by_me && !template.system_template && (
          <div className="flex items-center justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => {
                router.patch(`/agent_templates/${template.slug}`, {
                  template: { published: !template.published },
                })
              }}
            >
              {template.published ? "Unpublish" : "Publish to org"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (!confirm(`Delete template “${template.name}”?`)) return
                router.delete(`/agent_templates/${template.slug}`)
              }}
            >
              <Trash2 className="size-4 mr-1.5 text-destructive" />
              Delete
            </Button>
          </div>
        )}

        <div className="pt-2">
          <Link href="/agent_templates" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="size-3" /> Back to templates
          </Link>
        </div>
      </div>
    </AppLayout>
  )
}
