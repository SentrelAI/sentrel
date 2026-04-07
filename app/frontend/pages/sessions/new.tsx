import { Head, Link, useForm } from "@inertiajs/react"
import { Bot, Zap, Shield, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { userSessionPath, newUserRegistrationPath } from "@/routes"

export default function SessionNew() {
  const { data, setData, post, processing } = useForm({
    email: "",
    password: "",
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    post(userSessionPath(), {
      data: { user: data },
      forceFormData: false,
    })
  }

  return (
    <>
      <Head title="Sign in" />
      <div className="flex min-h-screen">
        {/* Left: Branding */}
        <div className="hidden lg:flex lg:w-1/2 bg-[#0C0A09] text-white flex-col justify-between p-12">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl font-extrabold tracking-tight text-white">ALCHEMY<span className="text-[#D4A843]">.</span></span>
            </div>
          </div>

          <div className="space-y-8">
            <div>
              <h1 className="text-4xl font-bold tracking-tight leading-tight mb-4">
                Your AI team,<br />
                <span className="text-[#D4A843]">ready to work.</span>
              </h1>
              <p className="text-[#A8A29E] text-lg max-w-md">
                Create AI employees with their own email, phone, and Slack. They work autonomously, collaborate as a team, and report to you.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-start gap-3 p-4 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <Bot className="size-5 text-[#D4A843] mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-sm">Any Role</p>
                  <p className="text-xs text-[#A8A29E]">SDR, engineer, finance, content — any employee you need</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <Zap className="size-5 text-[#D4A843] mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-sm">Always On</p>
                  <p className="text-xs text-[#A8A29E]">Heartbeat checks, proactive work, 24/7 execution</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <Shield className="size-5 text-[#D4A843] mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-sm">You Control</p>
                  <p className="text-xs text-[#A8A29E]">Auto-send or draft for approval — per agent, per action</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <Users className="size-5 text-[#D4A843] mt-0.5 shrink-0" />
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
        <div className="flex w-full lg:w-1/2 items-center justify-center p-8">
          <div className="w-full max-w-sm">
            <div className="lg:hidden mb-8 text-center">
              <span className="text-2xl font-extrabold tracking-tight">ALCHEMY<span className="text-[#D4A843]">.</span></span>
            </div>

            <div className="mb-8">
              <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
              <p className="text-muted-foreground mt-1">Sign in to manage your AI team</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={data.email}
                  onChange={(e) => setData("email", e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={data.password}
                  onChange={(e) => setData("password", e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full h-11" disabled={processing}>
                {processing ? "Signing in..." : "Sign in"}
              </Button>
            </form>

            <p className="mt-8 text-center text-sm text-muted-foreground">
              Don't have an account?{" "}
              <Link href={newUserRegistrationPath()} className="text-[#D4A843] hover:text-[#C49A35] font-semibold">
                Create one
              </Link>
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
