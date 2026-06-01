import { Link, router, usePage } from "@inertiajs/react"
import { useState } from "react"
import { Building2, Check, ChevronsUpDown, LogOut, Plus, Settings } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { destroyUserSessionPath, organizationsPath, settingsPath, switchOrganizationPath } from "@/routes"
import type { SharedProps } from "@/types"

export function NavUser() {
  const { auth } = usePage<SharedProps>().props
  const { isMobile } = useSidebar()
  const [createOpen, setCreateOpen] = useState(false)
  const [orgName, setOrgName] = useState("")
  const [creating, setCreating] = useState(false)

  if (!auth.user) return null

  const initials = auth.user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  const organizations = auth.organizations ?? []

  function switchOrg(id: number, isCurrent: boolean) {
    if (isCurrent) return
    router.post(switchOrganizationPath(id), {}, { preserveState: false })
  }

  function createOrg() {
    if (creating) return
    setCreating(true)
    router.post(
      organizationsPath(),
      { name: orgName.trim() },
      {
        preserveState: false,
        onFinish: () => {
          setCreating(false)
          setCreateOpen(false)
          setOrgName("")
        },
      },
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{auth.user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {auth.organization?.name ?? auth.user.email}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{auth.user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {auth.user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Organizations
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {organizations.map((org) => (
                <DropdownMenuItem
                  key={org.id}
                  className="cursor-pointer gap-2"
                  onClick={() => switchOrg(org.id, org.is_current)}
                >
                  <Building2 className="size-4 text-muted-foreground" />
                  <div className="grid flex-1 leading-tight">
                    <span className="truncate">{org.name}</span>
                    <span className="truncate text-xs capitalize text-muted-foreground">
                      {org.role}
                    </span>
                  </div>
                  {org.is_current && <Check className="size-4 text-primary" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                className="cursor-pointer gap-2"
                onSelect={(e) => {
                  e.preventDefault()
                  setCreateOpen(true)
                }}
              >
                <Plus className="size-4" />
                Create organization
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={settingsPath()} className="cursor-pointer">
                <Settings className="mr-2 size-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                router.delete(destroyUserSessionPath(), { preserveState: false })
              }
            >
              <LogOut className="mr-2 size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
            <DialogDescription>
              Start a fresh workspace under your account. You&apos;ll be the owner
              and we&apos;ll walk you through onboarding for it.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              createOrg()
            }}
          >
            <div className="grid gap-2 py-2">
              <Label htmlFor="new-org-name">Organization name</Label>
              <Input
                id="new-org-name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Inc."
                autoFocus
              />
            </div>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating || !orgName.trim()}>
                {creating ? "Creating…" : "Create & continue"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SidebarMenu>
  )
}
