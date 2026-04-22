# Per-agent hosting — provider comparison

Each Alchemy agent wants its own environment: persistent browser sessions (Gmail, Notion, LinkedIn logged in), a real filesystem with its workspace, a unique-ish IP so shared-ASN flags don't burn us, and process isolation so one agent's `rm -rf` doesn't take down the rest.

This doc compares six providers on the criteria that matter for us, and recommends one to start with.

## The criteria

1. **Cost per agent** (baseline — a 1 vCPU, 2 GB RAM, 20 GB disk machine is our floor).
2. **API quality** — how painful is provisioning from Rails/Sidekiq?
3. **Boot speed** — time from "create agent" to "engine online."
4. **Persistent disk** — survives restarts without manual volume config.
5. **Unique IP** — each agent gets its own egress IP by default, no extra proxy tier.
6. **Chrome / browser tooling** — can we run headful Chromium + noVNC for the "watch my agent" feature?
7. **Multi-region** — needed eventually (EU customers want EU residency).
8. **Billing granularity** — hourly, second-level, or just monthly? Matters if we delete agents a lot.
9. **Simplicity to start** — can one person ship Phase 1 in a week?

## The contenders

### Fly.io

- Cost: **$5/mo** for shared-cpu-1x/2GB ("Fly Machines"). Scales to zero when idle (auto-stop). `$0.0000014/s` hot.
- API: REST API + `flyctl`. One `fly machines create` call per agent. Excellent.
- Boot: **1-3 seconds** (Machines are Firecracker micro-VMs). Best in class.
- Disk: Attach a Fly volume at provisioning; survives machine restarts. +$0.15/GB/mo.
- IP: shared IPv4 by default, but each Machine gets a unique IPv6. Dedicated IPv4 = +$2/mo. Shared ASN — risk for Gmail/Google.
- Chrome: works. Fly has published Playwright-on-Fly guides.
- Multi-region: 30+ regions, great.
- Billing: per-second.
- Simplicity: **fly.toml + one API call = done.** Best dev-ex of the bunch.

**Verdict:** best for Phase 1 + Phase 2. Boot speed alone makes the "user clicks Create → agent online in 10 seconds" experience possible. Only real downside: shared IPv4 → for Gmail we'd eventually want dedicated or a residential proxy.

### Hetzner Cloud

- Cost: **€3.29/mo** for CAX11 (2 ARM vCPU, 4 GB RAM, 40 GB disk). Best price/GB on the market.
- API: REST API, straightforward. `hcloud` CLI. ~20 endpoints.
- Boot: **30-90 seconds** to a ready Debian/Ubuntu VM.
- Disk: included. 40 GB is generous.
- IP: **dedicated IPv4 + IPv6 per VM, baked in.** No extra cost, no shared-ASN problem.
- Chrome: works like any Linux box. More work to run noVNC (self-manage).
- Multi-region: Nuremberg, Falkenstein, Helsinki, Ashburn, Hillsboro, Singapore. Decent.
- Billing: hourly.
- Simplicity: VM is a VM. More scaffolding to own (ssh keys, base image, cloud-init) but nothing is hidden.

**Verdict:** best for steady-state cost at scale. 50 agents on Fly ≈ $250/mo baseline; on Hetzner ≈ $165/mo + better IP hygiene. But Phase 1 velocity suffers — more DevOps to own.

### DigitalOcean

- Cost: **$4/mo** for 512 MB droplet (too small), **$12/mo** for 1 vCPU / 2 GB (realistic).
- API: clean REST, `doctl` CLI. Similar shape to Hetzner.
- Boot: 45-75 seconds.
- Disk: included (25 GB on the $12 tier).
- IP: dedicated IPv4 per droplet.
- Chrome: same as Hetzner — it's a Linux box.
- Multi-region: ~9 regions. OK.
- Billing: hourly.
- Simplicity: similar to Hetzner. Slightly nicer UI.

**Verdict:** Hetzner but 2-3× the price. No killer feature over Hetzner. Skip.

### AWS EC2

- Cost: **$8-10/mo** for t4g.small (ARM, 2 GB). Reserved instances get cheaper; on-demand is worse.
- API: the best API in the universe but also the most verbose. IAM, VPC, security groups, subnets — all mandatory setup.
- Boot: 30-60 seconds, sometimes slower with user_data scripts.
- Disk: EBS volumes, extra $0.10/GB/mo for gp3.
- IP: dedicated public IP $3.60/mo each, or share via Elastic IP pool.
- Chrome: same Linux box story.
- Multi-region: everywhere.
- Billing: per-second (for Linux on EC2).
- Simplicity: **no.** Weeks of VPC/IAM plumbing before one agent runs. Only worth it if you're already an AWS shop.

**Verdict:** skip for Phase 1. Come back if enterprise customers demand it.

### Railway

- Cost: usage-based. ~$5/mo per lightweight service, scales with CPU/memory.
- API: decent, less mature than Fly's.
- Boot: fast (Firecracker-ish for "Services").
- Disk: persistent volumes available.
- IP: shared. Pretty limited for outbound.
- Chrome: possible but not their sweet spot.
- Multi-region: single region, last I checked.
- Billing: per-second.
- Simplicity: good for web apps. Less good for "run a long-lived browser-having process per agent."

**Verdict:** Fly is a strictly better version of this for our use case.

### Render

- Similar to Railway. Single region, shared IP, fine for web apps, not designed for "one VM per customer" pattern.

### Kubernetes (EKS / GKE / DigitalOcean K8s)

- Cost: +$50-75/mo just for the control plane on top of node costs.
- API: excellent once set up. Terraform/Helm.
- Boot: pod starts in seconds, but node autoscaling is slow.
- Disk: PVs work well.
- IP: typically pool; dedicated IP per pod requires NAT gateway tricks.
- Chrome: works, you'd run it in a pod.
- Simplicity: **no.** Don't start here. Maybe Phase 5 when you have 500+ agents.

## Recommendation

**Start with Fly.io. Migrate or hybridize with Hetzner at 50+ agents.**

Why:

- **1-3s boot** means the UI flow "Create agent → agent online" feels magical. On Hetzner it's "Create agent → …grab a coffee… → online."
- **Fly Machines API is ~5 calls** to provision a new agent end-to-end. Hetzner is ~8-10 (server + ssh key + cloud-init + firewall + volume + attach). More surface area = more bugs.
- **Pre-built Docker registry** (Fly pulls from their registry, very fast). Hetzner wants a custom image you maintain yourself.
- **Scale-to-zero.** An idle SDR agent on Fly costs ~$1/mo; on Hetzner it's always $3.29 regardless.
- **`fly machines run`** lets us spin up test agents from the CLI in one line while building. Great dev ex.

The one downside — shared IPv4 ASN — doesn't bite until the agent is sending 100s of Gmail-authed messages/day from one IP. We're not there yet. When it becomes a problem we add per-machine dedicated IPv4 at $2/mo each or put a residential proxy in front.

**Fallback plan:** if Fly becomes expensive at scale, the Dockerfile we're writing runs on Hetzner too — the engine doesn't know or care who hosts it. Migration is a provisioner swap, not a rewrite.

## The bill at different scales

Ballpark monthly cost for N agents (not counting Rails + Postgres + Redis, which are shared):

| Provider | 10 agents | 50 agents | 200 agents |
|---|---|---|---|
| Fly (scale-to-zero, avg 30% active) | ~$30 | ~$150 | ~$600 |
| Fly (always-on) | $50 | $250 | $1000 |
| Hetzner | $33 | $165 | $660 |
| DigitalOcean | $120 | $600 | $2400 |
| AWS on-demand | $80 | $400 | $1600 |

Pass-through to customers at **$29/mo per agent** → profitable from day one on Fly or Hetzner. DO/AWS eat too much margin.

## Phase 1 decision: Fly

Shipping:
1. `alchemy_engine/Dockerfile` — builds a self-contained engine image.
2. `alchemy_engine/fly.toml` — one-machine-per-agent config template.
3. `docs/per-agent-hosting.md` — this doc.
4. Later: `alchemy/app/services/fly_provisioner.rb` — Rails side that calls Fly Machines API on agent create/destroy.

Every piece works with Hetzner too when we want to migrate — the Dockerfile is portable.
