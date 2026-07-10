// Searchable IANA timezone picker. Used wherever a bundle/template declares
// a `timezone` deploy input — free-text IANA strings are a support ticket
// factory ("EST" isn't a zone), so this is always a select. Defaults to the
// browser's zone via the one-click suggestion row.
import { useMemo, useState } from "react"
import { Check, ChevronsUpDown, Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

function allTimezones(): string[] {
  try {
    // Every zone the runtime knows (~420). Falls back to a sane shortlist on
    // old browsers without supportedValuesOf.
    return Intl.supportedValuesOf("timeZone")
  } catch {
    return [
      "UTC", "America/New_York", "America/Chicago", "America/Denver",
      "America/Los_Angeles", "Europe/London", "Europe/Paris", "Europe/Berlin",
      "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
    ]
  }
}

// Current UTC offset for a zone, e.g. "UTC+2" — shown next to each option so
// picking between similarly-named zones doesn't require tribal knowledge.
function offsetLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date())
    return parts.find((p) => p.type === "timeZoneName")?.value?.replace("GMT", "UTC") || ""
  } catch {
    return ""
  }
}

export function TimezoneSelect({
  value,
  onChange,
  placeholder = "Select timezone…",
  className,
}: {
  value: string
  onChange: (tz: string) => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const zones = useMemo(allTimezones, [])
  const detected = useMemo(browserTimezone, [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground", className)}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search timezones…" />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            {!value && (
              <CommandGroup heading="Detected">
                <CommandItem value={`detected ${detected}`} onSelect={() => { onChange(detected); setOpen(false) }}>
                  <Globe className="mr-2 size-4 text-muted-foreground" />
                  {detected}
                  <span className="ml-auto text-xs text-muted-foreground">{offsetLabel(detected)}</span>
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {zones.map((tz) => (
                <CommandItem key={tz} value={tz} onSelect={() => { onChange(tz); setOpen(false) }}>
                  <Check className={cn("mr-2 size-4", value === tz ? "opacity-100" : "opacity-0")} />
                  {tz}
                  <span className="ml-auto text-xs text-muted-foreground">{offsetLabel(tz)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// A deploy input should render as a timezone select when the bundle names it
// that way — key convention first, IANA-looking placeholder as the fallback.
export function isTimezoneInput(input: { key: string; placeholder?: string | null }): boolean {
  if (/(^|_)(timezone|time_zone|tz)$/.test(input.key)) return true
  return /^[A-Za-z]+\/[A-Za-z_]+/.test(input.placeholder || "") && /timezone/i.test(input.key)
}
