import { Head, Link, useForm } from "@inertiajs/react"
import { Bot, Zap, Shield, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { userRegistrationPath, newUserSessionPath } from "@/routes"

export default function RegistrationNew() {
  const { data, setData, post, processing } = useForm({
    user: {
      name: "",
      email: "",
      password: "",
      password_confirmation: "",
      organization_name: "",
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    post(userRegistrationPath())
  }

  return (
    <>
      <Head title="Sign up" />
      <div className="flex min-h-screen">
        {/* Left: Branding */}
        <div className="hidden lg:flex lg:w-1/2 bg-background text-white flex-col justify-between p-12">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl font-medium tracking-tight text-white">ALCHEMY<span className="text-[var(--color-cyan)]">.</span></span>
            </div>
          </div>

          <div className="space-y-8">
            <div>
              <h1 className="text-4xl font-bold tracking-tight leading-tight mb-4">
                Build your AI team<br />
                <span className="text-[var(--color-cyan)]">in minutes.</span>
              </h1>
              <p className="text-[#A8A29E] text-lg max-w-md">
                Create an organization, add AI employees, connect your tools. They start working immediately.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-start gap-3 p-4 rounded-xl bg-background/[0.04] border border-white/[0.06]">
                <Bot className="size-5 text-[var(--color-cyan)] mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-sm">Any Role</p>
                  <p className="text-xs text-[#A8A29E]">SDR, engineer, finance, content — any employee you need</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl bg-background/[0.04] border border-white/[0.06]">
                <Zap className="size-5 text-[var(--color-cyan)] mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-sm">Always On</p>
                  <p className="text-xs text-[#A8A29E]">Heartbeat checks, proactive work, 24/7 execution</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl bg-background/[0.04] border border-white/[0.06]">
                <Shield className="size-5 text-[var(--color-cyan)] mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-sm">You Control</p>
                  <p className="text-xs text-[#A8A29E]">Auto-send or draft for approval — per agent, per action</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl bg-background/[0.04] border border-white/[0.06]">
                <Users className="size-5 text-[var(--color-cyan)] mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-sm">Team Play</p>
                  <p className="text-xs text-[#A8A29E]">Agents delegate, collaborate, and report to each other</p>
                </div>
              </div>
            </div>
          </div>

          <p className="text-xs text-[#78716C]">Alchemy — Turn effort into outcome</p>
        </div>

        {/* Right: Form */}
        <div className="flex w-full lg:w-1/2 items-center justify-center p-8 bg-background">
          <div className="w-full max-w-sm">
            <div className="lg:hidden mb-8 text-center">
              <span className="text-2xl font-medium tracking-tight">ALCHEMY<span className="text-[var(--color-cyan)]">.</span></span>
            </div>

            <div className="mb-8">
              <h2 className="text-2xl font-bold tracking-tight">Create your account</h2>
              <p className="text-muted-foreground mt-1">Start building your AI workforce</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="organization_name">Organization</Label>
                <Input
                  id="organization_name"
                  placeholder="ScribeMD"
                  value={data.user.organization_name}
                  onChange={(e) => setData("user", { ...data.user, organization_name: e.target.value })}
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Your name</Label>
                <Input
                  id="name"
                  placeholder="Abdel"
                  value={data.user.name}
                  onChange={(e) => setData("user", { ...data.user, name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={data.user.email}
                  onChange={(e) => setData("user", { ...data.user, email: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={data.user.password}
                    onChange={(e) => setData("user", { ...data.user, password: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password_confirmation">Confirm</Label>
                  <Input
                    id="password_confirmation"
                    type="password"
                    placeholder="••••••••"
                    value={data.user.password_confirmation}
                    onChange={(e) => setData("user", { ...data.user, password_confirmation: e.target.value })}
                    required
                  />
                </div>
              </div>

              <Button type="submit" className="w-full h-11" disabled={processing}>
                {processing ? "Creating account..." : "Create account"}
              </Button>
            </form>

            <p className="mt-8 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href={newUserSessionPath()} className="text-[var(--color-cyan)] hover:text-[var(--color-cyan-hover)] font-semibold">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
