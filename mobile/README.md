# Sentrel Mobile (Expo)

A React Native (Expo) companion app for the Sentrel control plane. Log in,
create/edit agents, run day-2 ops, chat with an agent, and receive push
notifications for agent replies and spend-cap breaches.

## Stack

- Expo SDK 56 + expo-router (file-based routing)
- expo-secure-store (token storage), expo-notifications (push)
- Talks to the Rails backend's token-authenticated JSON API at
  `/api/mobile/*` (see `backend/app/controllers/api/mobile/`).

## Running

1. **Start the backend** (from `../backend`):
   ```bash
   bin/rails s -p 3200      # web/API
   bundle exec sidekiq      # required for push delivery + agent provisioning
   ```
   Make sure Redis + Postgres are up. A demo login already exists:
   `demo@sentrel.ai` / `password123`.

2. **Start the app** (from here):
   ```bash
   npm install      # first time only
   npm start        # then press i / a, or scan the QR with Expo Go
   ```

### API base URL

`src/lib/api.ts` auto-derives the dev machine's LAN IP from the Metro bundler
host and targets port **3200**, so it works on a physical device in Expo Go
with no config. For a standalone build, set `expo.extra.apiBaseUrl` in
`app.json`.

## Push notifications

- Real push requires a **physical device** (simulators can't get an Expo push
  token) and notification permission granted.
- On login the app registers its Expo push token via `PATCH /api/mobile/device`.
- Verify the path end-to-end with **Settings → Send a test notification**.
- Backend triggers:
  - **Agent reply** — `Api::AgentEventsController#create` enqueues `MobilePushJob`
    when the engine relays a persisted assistant `message` event.
  - **Spend cap reached** — `Api::SpendCapsController#check` enqueues a push when
    an agent first crosses a daily/monthly cap (deduped per UTC day via
    `agents.spend_cap_pushed_on`).

## Structure

```
app/
  _layout.tsx            root: AuthProvider + notification-tap deep-linking
  index.tsx              auth gate → /agents or /login
  login.tsx
  (app)/
    _layout.tsx          authed stack; registers push
    agents/index.tsx     agent list
    agents/new.tsx       create
    agents/[id]/index    detail (status, spend, machine)
    agents/[id]/edit     edit (shared AgentForm)
    agents/[id]/chat     chat (poll-based)
    agents/[id]/ops      restart/reload/redeploy/reprovision + logs
    settings.tsx         account, test push, sign out
src/
  lib/      api client, auth context, push, model catalog, types
  components/ ui kit, AgentForm
  theme/    colors
```
