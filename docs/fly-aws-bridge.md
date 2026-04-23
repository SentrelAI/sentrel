# Fly ↔ AWS VPC bridge (WireGuard)

We host **Rails on EC2**, **Postgres on RDS**, **Redis on ElastiCache** — all inside a private AWS VPC. Agent engines run on **Fly Machines** for cheap scale-to-zero + 2s boot. The question is: how do Fly Machines reach RDS / ElastiCache privately?

Answer: **one WireGuard peer in your VPC + a Fly org-level WireGuard tunnel**. Fly has first-class support. Once set up, every agent Machine in that Fly org automatically reaches any private AWS IP as if it were on the VPC. No per-agent config.

Setup is a one-time thing — ~2 hours if you've never done WireGuard, ~30 min if you have. Runs on a **t4g.nano** ($3/mo). After that, everything "just works" forever.

---

## What we're building

```
                 ┌─────────────────────────── AWS (us-west-2 or wherever) ─┐
                 │                                                            │
                 │   ┌──────────┐   ┌──────────┐   ┌─────────────┐           │
                 │   │ Rails    │   │   RDS    │   │ ElastiCache │           │
                 │   │ (EC2)    │   │ Postgres │   │   Redis     │           │
                 │   └──────────┘   └──────────┘   └─────────────┘           │
                 │                                                            │
                 │   ┌──────────────────┐                                    │
                 │   │ wg-bridge        │◄── WireGuard tunnel ───┐           │
                 │   │ (t4g.nano, $3/mo)│                         │           │
                 │   └──────────────────┘                         │           │
                 │                                                 │           │
                 └─────────────────────────────────────────────────│───────────┘
                                                                   │
                                                                   │
                 ┌───────────────────────────── Fly.io (lax) ──────│───────────┐
                 │                                                  │          │
                 │   ┌─────────────────┐  ┌─────────────────┐      │          │
                 │   │ agent-1 Machine │  │ agent-2 Machine │ ...  │          │
                 │   └─────────────────┘  └─────────────────┘      │          │
                 │          │                     │                 │          │
                 │          └─────────────────────┴─────────────────┘          │
                 │                  (all see RDS + Redis via WG)               │
                 └──────────────────────────────────────────────────────────────┘
```

Fly Machines use the WireGuard peer in your VPC as a default route for AWS RFC1918 space. They reach `rds-endpoint.xxx.us-west-2.rds.amazonaws.com:5432` the same way Rails does.

---

## Step 1 — Spin up the WireGuard peer in your VPC

Pick the AWS region where your RDS lives. Assume `us-west-2`. Launch a t4g.nano (ARM, $3.33/mo) in a public subnet (needs public IP so Fly can reach it):

```bash
# Via AWS CLI (swap in your real VPC/subnet IDs)
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t4g.nano \
  --key-name alchemy-admin \
  --subnet-id subnet-xxx \
  --security-group-ids sg-wg-bridge \
  --associate-public-ip-address \
  --user-data file://wg-bridge-cloud-init.sh \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=alchemy-wg-bridge}]"
```

### Security group `sg-wg-bridge`

- **Inbound**: UDP 51820 from `0.0.0.0/0` (WireGuard). SSH 22 from your IP.
- **Outbound**: all traffic to your VPC CIDR (so the peer can forward packets to RDS/ElastiCache on behalf of Fly Machines).

### RDS + ElastiCache security groups

Add inbound rules allowing traffic from the WireGuard peer's **security group** (not IP):

- RDS SG: `5432/tcp from sg-wg-bridge`
- ElastiCache SG: `6379/tcp from sg-wg-bridge`

Private traffic only — no public exposure required.

### `wg-bridge-cloud-init.sh`

```bash
#!/usr/bin/env bash
# Run on first boot — installs WireGuard + enables IP forwarding
set -euo pipefail
apt-get update
apt-get install -y wireguard iptables-persistent

# Enable forwarding so the peer can NAT Fly → VPC traffic
sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward = 1" >> /etc/sysctl.conf

# WireGuard config lands at /etc/wireguard/wg0.conf — written in step 2
```

---

## Step 2 — Create the Fly WireGuard peer

On your laptop (needs `flyctl`):

```bash
flyctl wireguard create <your-fly-org> us-west-2 alchemy-bridge > alchemy-bridge.conf
```

Fly gives you a WireGuard config. Save the private key + interface address.

Copy `alchemy-bridge.conf` to the AWS peer:

```bash
scp alchemy-bridge.conf ubuntu@<wg-peer-public-ip>:/tmp/
ssh ubuntu@<wg-peer-public-ip> "sudo mv /tmp/alchemy-bridge.conf /etc/wireguard/wg0.conf && sudo chmod 600 /etc/wireguard/wg0.conf"
```

Add NAT forwarding rules to the `[Interface]` block so Fly traffic gets NAT'd to the VPC:

```
PostUp   = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
```

Bring it up:

```bash
ssh ubuntu@<wg-peer-public-ip> "sudo systemctl enable --now wg-quick@wg0"
```

Verify from Fly's side — spin up a throwaway Machine and curl your RDS endpoint:

```bash
flyctl machine run ubuntu curl -v <rds-endpoint>:5432
# Should connect. If it times out, the SG rule is missing.
```

---

## Step 3 — Point the engine at the private endpoints

In Rails `.env`:

```bash
# Internal VPC hostnames — reachable from Fly via WG
ENGINE_DATABASE_URL=postgres://alchemy:<pw>@alchemy-prod.cluster-xxx.us-west-2.rds.amazonaws.com:5432/alchemy?sslmode=require
ENGINE_REDIS_URL=rediss://alchemy-cache.xxx.cache.amazonaws.com:6379

# Rails own connections — same URLs, since Rails is ALSO in the VPC
DATABASE_URL=${ENGINE_DATABASE_URL}
REDIS_URL=${ENGINE_REDIS_URL}

# Provisioner
AGENT_PROVISIONER=fly
DEPLOY_ENV=prod
FLY_API_TOKEN=<flyctl auth token>
FLY_ORG_SLUG=<your-org>      # must match the org the WG peer was created in
FLY_REGION=lax               # LA = close to us-west-2 over Fly's backbone
ENGINE_IMAGE=<registry>/alchemy-engine:latest
ENGINE_API_SECRET=<shared secret>
RAILS_INTERNAL_URL=https://<rails-host>
```

`FlyBackend.env_for` already passes these through. No code changes needed.

### Rails internal URL — make it reachable from Fly

`RAILS_INTERNAL_URL` is what agents POST to for `/api/task_events`, `/api/agent_instances/ready`, etc. Two options:

1. **Public Rails URL** (simpler) — use your public domain. Traffic goes Fly → internet → ALB → EC2. Fine, authenticated with `X-Engine-Secret`.
2. **Private Rails URL via WG** — Fly agents reach Rails' private EC2 IP through the WireGuard tunnel. Faster + never leaves private network. Set `RAILS_INTERNAL_URL=http://<rails-private-ip>:3000`.

Start with #1 for simplicity. Move to #2 when you care about latency or egress costs.

---

## Step 4 — Test with one agent

```bash
# Build + push the engine image (one-time)
cd ~/Workspace/code/alchemy-ai/alchemy_engine
./bin/build-and-push.sh

# Restart Rails to pick up new env
cd ~/Workspace/code/alchemy-ai/alchemy
bin/rails restart

# Create an agent in the UI → /agents/new → pick SDR → Hire
```

`agents_controller#create` fires `ProvisionAgentJob.perform_later(agent.id)`. Sidekiq calls Fly Machines API. Machine boots in ~10s. Engine pulls the image, connects to RDS + Redis via WireGuard, pings `/api/agent_instances/ready`. Rails flips `instance.status = "running"`.

```bash
fly apps list | grep alchemy-prod-agent
fly logs -a alchemy-prod-agent-<id>
# Should show: "connected to postgres", "connected to redis", "Reported ready to Rails"
```

If the engine hangs on Postgres or Redis connect → WireGuard is down. Check `sudo wg show` on the peer.

---

## Operational notes

### WG peer is a single point of failure

The t4g.nano is one host. If it goes down, every Fly agent loses DB/Redis access. Two mitigations:

1. **Auto-restart via systemd** — `wg-quick@wg0.service` handles this on reboot
2. **Multi-AZ** — put a second peer in another AZ, use [BGP-ish Fly config](https://fly.io/docs/networking/wireguard/) to failover. Skip for Phase 1; revisit at scale.

### Cost at scale

- WG peer: $3.33/mo
- NAT data transfer: ~$0.09/GB egress from the peer. For 50 agents each doing 100MB/day of DB traffic, that's 150GB/mo = **$13.50/mo**. Trivial.
- Fly Machines: 50 × $3-5 = $150-250/mo with scale-to-zero.

### What happens if Fly goes down

Agents stop. Rails keeps running. BullMQ backs up in ElastiCache — jobs wait until agents come back. No data loss.

### What happens if AWS goes down

Agents can't reach DB/Redis, fail their runs, BullMQ retries. Rails is also down (also on EC2). Bad day, but consistent failure mode.

---

## Migration path from Upstash dev → AWS prod

- **Dev**: `AGENT_PROVISIONER=fly` + Upstash URLs in `.env.development`. Zero AWS setup, free tier.
- **Prod**: same `AGENT_PROVISIONER=fly` + AWS RDS/ElastiCache URLs behind WireGuard in `.env.production`.
- **Code**: identical. The engine just reads `ENGINE_DATABASE_URL` + `ENGINE_REDIS_URL`.

One env var change to switch. Nothing else.

---

## If you prefer not to touch WireGuard

Alternative — publicly accessible RDS + ElastiCache (not ideal but works):

- RDS: `publicly_accessible = true`, SG allows Fly's outbound IP ranges (Fly publishes them). Use TLS with `sslmode=verify-full`.
- ElastiCache: doesn't support a public endpoint natively. You'd need an NLB in front, or switch to **MemoryDB Serverless** (which does support public endpoints) at ~$15-30/mo minimum.

Not recommended — WireGuard is $3/mo and keeps everything on private networking. But if time-to-ship matters more than purity, the public-endpoint path works.

---

## Final answer to "where does Redis live?"

**ElastiCache in your VPC.** Not Upstash. Once the WireGuard bridge is up, Fly agents reach it privately at `alchemy-cache.xxx.cache.amazonaws.com:6379` exactly like Rails does. Same Redis. Same BullMQ queues. Same `rediss://` URL. One source of truth.

The engine doesn't know it's in a tunnel. `ENGINE_REDIS_URL=rediss://alchemy-cache...` and BullMQ/ioredis just work.
