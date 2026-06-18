import { useEffect, useRef, useState } from "react"

/**
 * Sentrel workforce graph — CEO → VPs → specialists rendered as
 * rounded workspace-cards (not circles). Edges stream packets of real
 * work types between them, status stripes show live state.
 */

const SVG_NS = "http://www.w3.org/2000/svg"
const VB_W = 640
const VB_H = 440

type Tier = 0 | 1 | 2
type Status = "idle" | "running" | "waiting"

interface NodeDef {
  id: string
  /** Top-left x/y in viewBox units */
  x: number
  y: number
  w: number
  h: number
  name: string
  role: string
  tier: Tier
  status: Status
}

/* Card grid — CEO wide at top, 3 VPs mid, 5 specialists bottom */
const NW = 132 // card width
const NH = 44 // card height

function mkRow(cy: number, centers: number[]): Array<[number, number]> {
  return centers.map((cx) => [cx - NW / 2, cy - NH / 2])
}

const ROW_CEO = mkRow(60, [VB_W / 2])
const ROW_VP = mkRow(220, [140, VB_W / 2, VB_W - 140])
const ROW_SPEC = mkRow(380, [70, 210, VB_W / 2, VB_W - 210, VB_W - 70])

const NODES: NodeDef[] = [
  { id: "ceo", ...fromXY(ROW_CEO[0]),  name: "Maya",  role: "CEO",          tier: 0, status: "running" },
  { id: "mkt", ...fromXY(ROW_VP[0]),   name: "Aria",  role: "Marketing",    tier: 1, status: "running" },
  { id: "sal", ...fromXY(ROW_VP[1]),   name: "Leo",   role: "Sales",        tier: 1, status: "waiting" },
  { id: "eng", ...fromXY(ROW_VP[2]),   name: "Noa",   role: "Engineering",  tier: 1, status: "running" },
  { id: "con", ...fromXY(ROW_SPEC[0]), name: "Kai",   role: "Content",      tier: 2, status: "idle"    },
  { id: "ads", ...fromXY(ROW_SPEC[1]), name: "Vera",  role: "Ads",          tier: 2, status: "running" },
  { id: "sdr", ...fromXY(ROW_SPEC[2]), name: "Alex",  role: "SDR",          tier: 2, status: "running" },
  { id: "sup", ...fromXY(ROW_SPEC[3]), name: "Jamie", role: "Support",      tier: 2, status: "idle"    },
  { id: "ops", ...fromXY(ROW_SPEC[4]), name: "Riley", role: "DevOps",       tier: 2, status: "running" },
]

function fromXY([x, y]: [number, number]) {
  return { x, y, w: NW, h: NH }
}

const EDGES: [string, string][] = [
  ["ceo", "mkt"], ["ceo", "sal"], ["ceo", "eng"],
  ["mkt", "con"], ["mkt", "ads"],
  ["sal", "sdr"], ["sal", "sup"],
  ["eng", "ops"],
]

const PACKET_LABELS = ["email", "tool", "report", "approval", "task"] as const
type PacketKind = (typeof PACKET_LABELS)[number]

const PACKET_COLOR: Record<PacketKind, string> = {
  email:    "#00e0e0",
  tool:     "#818cf8",
  report:   "#a5b4fc",
  approval: "#fbbf24",
  task:     "#34d399",
}

const STATUS_COLOR: Record<Status, string> = {
  idle:    "#6b7280",
  running: "#818cf8",
  waiting: "#fbbf24",
}

/* ═════════════════════════════════════════════════════════════ */
export function OrgGraph() {
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    wrap.innerHTML = ""

    const byId = Object.fromEntries(NODES.map((n) => [n.id, n]))

    const svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("viewBox", `0 0 ${VB_W} ${VB_H}`)
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet")
    svg.setAttribute("width", "100%")
    svg.setAttribute("height", "100%")
    svg.style.fontFamily = "DM Sans, ui-sans-serif, system-ui, sans-serif"
    wrap.appendChild(svg)

    // ── defs ───────────────────────────────────────────────
    const defs = document.createElementNS(SVG_NS, "defs")
    defs.innerHTML = `
      <linearGradient id="card-bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#16161b"/>
        <stop offset="100%" stop-color="#0f0f13"/>
      </linearGradient>
      <linearGradient id="card-bg-ceo" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1a1a24"/>
        <stop offset="100%" stop-color="#0f0f18"/>
      </linearGradient>
      <linearGradient id="avatar-ceo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#00e0e0"/>
        <stop offset="100%" stop-color="#0089ff"/>
      </linearGradient>
      <linearGradient id="avatar-vp" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#818cf8"/>
        <stop offset="100%" stop-color="#4338ca"/>
      </linearGradient>
      <linearGradient id="avatar-spec" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#6366f1"/>
        <stop offset="100%" stop-color="#312e81"/>
      </linearGradient>
      <linearGradient id="edge-flow" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#818cf8" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="#00e0e0" stop-opacity="0.15"/>
      </linearGradient>
      <filter id="soft-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2.5"/>
      </filter>
    `
    svg.appendChild(defs)

    // ── edges (drawn first so cards sit on top) ────────────
    const edgeGroup = document.createElementNS(SVG_NS, "g")
    svg.appendChild(edgeGroup)

    const edgeRecs = EDGES.map(([fromId, toId]) => {
      const p = byId[fromId]
      const c = byId[toId]
      const x1 = p.x + p.w / 2
      const y1 = p.y + p.h
      const x2 = c.x + c.w / 2
      const y2 = c.y
      const cy1 = y1 + (y2 - y1) * 0.55
      const cy2 = y1 + (y2 - y1) * 0.45
      const d = `M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`

      // Base line
      const base = document.createElementNS(SVG_NS, "path")
      base.setAttribute("d", d)
      base.setAttribute("fill", "none")
      base.setAttribute("stroke", "rgba(129,140,248,0.16)")
      base.setAttribute("stroke-width", "1")
      edgeGroup.appendChild(base)

      // Flowing dashes
      const flow = document.createElementNS(SVG_NS, "path")
      flow.setAttribute("d", d)
      flow.setAttribute("fill", "none")
      flow.setAttribute("stroke", "url(#edge-flow)")
      flow.setAttribute("stroke-width", "1.1")
      flow.setAttribute("stroke-dasharray", "3 10")
      flow.setAttribute("stroke-linecap", "round")
      edgeGroup.appendChild(flow)

      return { path: flow, length: 0 }
    })

    requestAnimationFrame(() => {
      edgeRecs.forEach((e) => {
        e.length = e.path.getTotalLength()
      })
    })

    // ── node cards ─────────────────────────────────────────
    const nodeGroup = document.createElementNS(SVG_NS, "g")
    svg.appendChild(nodeGroup)

    type NodeRec = { def: NodeDef; g: SVGGElement; pulseRing: SVGRectElement }
    const nodeRecs: NodeRec[] = []

    NODES.forEach((n) => {
      const g = document.createElementNS(SVG_NS, "g")
      g.setAttribute("transform", `translate(${n.x} ${n.y})`)
      g.dataset.id = n.id

      // Expanding outline used on spotlight pulse
      const pulseRing = document.createElementNS(SVG_NS, "rect")
      pulseRing.setAttribute("x", "0")
      pulseRing.setAttribute("y", "0")
      pulseRing.setAttribute("width", String(n.w))
      pulseRing.setAttribute("height", String(n.h))
      pulseRing.setAttribute("rx", "10")
      pulseRing.setAttribute("fill", "none")
      pulseRing.setAttribute("stroke", "#00e0e0")
      pulseRing.setAttribute("stroke-width", "1.5")
      pulseRing.setAttribute("opacity", "0")
      g.appendChild(pulseRing)

      // Card body
      const card = document.createElementNS(SVG_NS, "rect")
      card.setAttribute("x", "0")
      card.setAttribute("y", "0")
      card.setAttribute("width", String(n.w))
      card.setAttribute("height", String(n.h))
      card.setAttribute("rx", "10")
      card.setAttribute("fill", n.tier === 0 ? "url(#card-bg-ceo)" : "url(#card-bg)")
      card.setAttribute("stroke", "rgba(255,255,255,0.10)")
      card.setAttribute("stroke-width", "1")
      g.appendChild(card)

      // Left status stripe (3px wide rounded on left)
      const stripe = document.createElementNS(SVG_NS, "rect")
      stripe.setAttribute("x", "0")
      stripe.setAttribute("y", "0")
      stripe.setAttribute("width", "3")
      stripe.setAttribute("height", String(n.h))
      stripe.setAttribute("rx", "1.5")
      stripe.setAttribute("fill", STATUS_COLOR[n.status])
      if (n.status !== "idle") {
        stripe.setAttribute("filter", "url(#soft-glow)")
      }
      g.appendChild(stripe)

      // Avatar circle (left of text)
      const ax = 22
      const ay = n.h / 2
      const ar = 12
      const avatar = document.createElementNS(SVG_NS, "circle")
      avatar.setAttribute("cx", String(ax))
      avatar.setAttribute("cy", String(ay))
      avatar.setAttribute("r", String(ar))
      avatar.setAttribute(
        "fill",
        n.tier === 0 ? "url(#avatar-ceo)" : n.tier === 1 ? "url(#avatar-vp)" : "url(#avatar-spec)",
      )
      avatar.setAttribute("stroke", "rgba(255,255,255,0.25)")
      avatar.setAttribute("stroke-width", "0.8")
      g.appendChild(avatar)

      // Avatar initial
      const initial = document.createElementNS(SVG_NS, "text")
      initial.setAttribute("x", String(ax))
      initial.setAttribute("y", String(ay))
      initial.setAttribute("text-anchor", "middle")
      initial.setAttribute("dominant-baseline", "central")
      initial.setAttribute("font-family", "DM Sans, sans-serif")
      initial.setAttribute("font-size", "11")
      initial.setAttribute("font-weight", "700")
      initial.setAttribute("letter-spacing", "-0.02em")
      initial.setAttribute("fill", "#0a0a0a")
      initial.textContent = n.name[0]
      g.appendChild(initial)

      // Name
      const nameText = document.createElementNS(SVG_NS, "text")
      nameText.setAttribute("x", "42")
      nameText.setAttribute("y", "19")
      nameText.setAttribute("font-family", "DM Sans, sans-serif")
      nameText.setAttribute("font-size", "12.5")
      nameText.setAttribute("font-weight", "600")
      nameText.setAttribute("letter-spacing", "-0.01em")
      nameText.setAttribute("fill", "rgba(255,255,255,0.96)")
      nameText.textContent = n.name
      g.appendChild(nameText)

      // Role
      const roleText = document.createElementNS(SVG_NS, "text")
      roleText.setAttribute("x", "42")
      roleText.setAttribute("y", "32")
      roleText.setAttribute("font-family", "JetBrains Mono, ui-monospace, monospace")
      roleText.setAttribute("font-size", "9")
      roleText.setAttribute("font-weight", "500")
      roleText.setAttribute("letter-spacing", "1.2")
      roleText.setAttribute("fill", "rgba(255,255,255,0.45)")
      roleText.textContent = n.role.toUpperCase()
      g.appendChild(roleText)

      // Right-edge status dot
      const statusDot = document.createElementNS(SVG_NS, "circle")
      statusDot.setAttribute("cx", String(n.w - 12))
      statusDot.setAttribute("cy", String(n.h / 2))
      statusDot.setAttribute("r", "3")
      statusDot.setAttribute("fill", STATUS_COLOR[n.status])
      if (n.status !== "idle") statusDot.setAttribute("filter", "url(#soft-glow)")
      g.appendChild(statusDot)

      nodeGroup.appendChild(g)
      nodeRecs.push({ def: n, g, pulseRing })
    })

    // ── packets ────────────────────────────────────────────
    const packetGroup = document.createElementNS(SVG_NS, "g")
    svg.appendChild(packetGroup)

    interface Packet {
      start: number
      duration: number
      reverse: boolean
      edge: (typeof edgeRecs)[number]
      g: SVGGElement
    }
    const packets: Packet[] = []

    function spawnPacket() {
      const edge = edgeRecs[Math.floor(Math.random() * edgeRecs.length)]
      if (!edge) return
      const reverse = Math.random() < 0.22
      const kind: PacketKind = reverse
        ? "report"
        : (PACKET_LABELS[Math.floor(Math.random() * 4)] as PacketKind)
      const color = PACKET_COLOR[kind]

      const g = document.createElementNS(SVG_NS, "g")

      // Soft halo
      const halo = document.createElementNS(SVG_NS, "circle")
      halo.setAttribute("r", "8")
      halo.setAttribute("fill", color)
      halo.setAttribute("fill-opacity", "0.18")
      halo.setAttribute("filter", "url(#soft-glow)")
      g.appendChild(halo)

      // Core
      const core = document.createElementNS(SVG_NS, "circle")
      core.setAttribute("r", "2.5")
      core.setAttribute("fill", color)
      g.appendChild(core)

      // Label to the right
      const lbl = document.createElementNS(SVG_NS, "text")
      lbl.setAttribute("x", "10")
      lbl.setAttribute("y", "2.5")
      lbl.setAttribute("font-family", "JetBrains Mono, ui-monospace, monospace")
      lbl.setAttribute("font-size", "7.5")
      lbl.setAttribute("font-weight", "600")
      lbl.setAttribute("letter-spacing", "1.4")
      lbl.setAttribute("fill", color)
      lbl.textContent = kind.toUpperCase()
      g.appendChild(lbl)

      packetGroup.appendChild(g)
      packets.push({
        start: performance.now(),
        duration: 1800 + Math.random() * 800,
        reverse,
        edge,
        g,
      })
    }

    const spawnTimer = window.setInterval(spawnPacket, 550)

    // ── spotlight pulse ────────────────────────────────────
    const pulseTimer = window.setInterval(() => {
      const running = nodeRecs.filter((r) => r.def.status === "running")
      const rec = running[Math.floor(Math.random() * running.length)]
      if (!rec) return
      rec.pulseRing.animate(
        [
          { opacity: 0.8, transform: "scale(1)" } as unknown as Keyframe,
          { opacity: 0, transform: "scale(1.06)" } as unknown as Keyframe,
        ],
        {
          duration: 1200,
          easing: "cubic-bezier(.2,.7,.2,1)",
          iterations: 1,
        },
      )
    }, 1500)

    // ── rAF loop ──────────────────────────────────────────
    let raf = 0
    function step(now: number) {
      // Flow offset
      const offset = -(now / 55) % 40
      edgeRecs.forEach((e) => {
        e.path.setAttribute("stroke-dashoffset", String(offset))
      })

      // Advance packets
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i]
        const t = (now - p.start) / p.duration
        if (t >= 1) {
          p.g.remove()
          packets.splice(i, 1)
          continue
        }
        const len = p.edge.length || p.edge.path.getTotalLength()
        const pos = p.edge.path.getPointAtLength((p.reverse ? 1 - t : t) * len)
        p.g.setAttribute("transform", `translate(${pos.x} ${pos.y})`)
        const a = t < 0.12 ? t / 0.12 : t > 0.88 ? (1 - t) / 0.12 : 1
        p.g.setAttribute("opacity", String(a))
      }

      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)

    return () => {
      cancelAnimationFrame(raf)
      clearInterval(spawnTimer)
      clearInterval(pulseTimer)
      wrap.innerHTML = ""
    }
  }, [])

  return (
    <div
      ref={wrapRef}
      className="aspect-[640/440] w-full"
      aria-label="Animated workforce graph of AI agents"
      role="img"
    />
  )
}

/* Live stat ticker shown in the card footer — self-incrementing. */
export function OrgGraphStats() {
  const [tokens, setTokens] = useState(124_380)
  const [cost, setCost] = useState(4.12)
  const [actions, setActions] = useState(847)

  useEffect(() => {
    const t = setInterval(() => {
      setTokens((v) => v + Math.floor(Math.random() * 420) + 40)
      setCost((v) => +(v + Math.random() * 0.04).toFixed(2))
      setActions((v) => (Math.random() < 0.55 ? v + 1 : v))
    }, 1100)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/65">
      <span>
        <span className="text-white/40">tokens</span>{" "}
        <span className="text-white">{tokens.toLocaleString()}</span>
      </span>
      <span className="opacity-30">·</span>
      <span>
        <span className="text-white/40">cost</span>{" "}
        <span className="text-[var(--cyan-strong)]">${cost.toFixed(2)}</span>
      </span>
      <span className="opacity-30">·</span>
      <span>
        <span className="text-white/40">actions</span>{" "}
        <span className="text-white">{actions.toLocaleString()}</span>
      </span>
    </div>
  )
}
