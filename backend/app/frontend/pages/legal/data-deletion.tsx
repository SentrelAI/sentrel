import { Head } from "@inertiajs/react"

import { LandingNav } from "@/components/landing/landing-nav"
import { LandingFooter } from "@/components/landing/landing-footer"

interface Props {
  lastUpdated: string
}

export default function DataDeletion({ lastUpdated }: Props) {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <Head title="Data Deletion Instructions · Sentrel" />
      <LandingNav />

      <main className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-12">
          <h1 className="font-display text-4xl font-semibold tracking-[-0.025em] text-foreground">
            Data Deletion Instructions
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Last updated: {lastUpdated}
          </p>
        </header>

        <div className="space-y-12 text-[15px] leading-relaxed text-muted-foreground [&_a]:text-[var(--color-indigo)] [&_a]:underline-offset-4 hover:[&_a]:underline">
          <section className="space-y-4">
            <p>
              Sentrel ("we", "us") gives you full control over your data. This page
              explains how to (1) disconnect a connected service such as Meta/Facebook,
              and (2) request full deletion of your Sentrel data. For more on how we
              handle data, see our <a href="/privacy">Privacy Policy</a>.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              1. Disconnect a connected service
            </h2>
            <p>
              Disconnecting a service immediately revokes Sentrel's access to it. To
              disconnect:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                Go to your{" "}
                <a href="/integrations">integrations page</a> in Sentrel, find the
                service (for example Meta/Facebook), and select{" "}
                <strong className="text-foreground">Disconnect</strong>. This revokes
                and deletes the access token we hold for that service.
              </li>
              <li>
                For Meta/Facebook, you can also remove Sentrel directly from your Meta
                account: open{" "}
                <strong className="text-foreground">
                  Meta Business Settings → Apps
                </strong>{" "}
                (or{" "}
                <strong className="text-foreground">
                  Facebook Settings → Security and Login → Business Integrations
                </strong>
                ), select Sentrel, and remove it. This revokes our token from Meta's
                side as well.
              </li>
            </ul>
            <p>
              Once disconnected, your agents can no longer act on that account and we
              stop accessing its data.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              2. Request full deletion of your Sentrel data
            </h2>
            <p>
              You can request deletion of all data associated with your Sentrel account
              at any time. You can do this from within the app, or by email.
            </p>

            <div className="rounded-xl border border-[var(--indigo-border)] bg-[var(--indigo-surface)] p-6">
              <h3 className="font-display text-base font-semibold text-foreground">
                How to request deletion
              </h3>
              <ol className="mt-4 list-decimal space-y-3 pl-5">
                <li>
                  Email{" "}
                  <a href="mailto:privacy@sentrel.ai">privacy@sentrel.ai</a> from the
                  email address on your account, with the subject{" "}
                  <strong className="text-foreground">"Data deletion request"</strong>.
                  Alternatively, open{" "}
                  <strong className="text-foreground">
                    Settings → Account → Delete account
                  </strong>{" "}
                  in the Sentrel app.
                </li>
                <li>
                  We will verify your identity to protect your account, then confirm
                  receipt of your request.
                </li>
                <li>
                  We delete your data — including account information, agent
                  configurations, processed content, and stored OAuth tokens for
                  connected services — within{" "}
                  <strong className="text-foreground">30 days</strong>.
                </li>
              </ol>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              3. What gets deleted
            </h2>
            <ul className="list-disc space-y-2 pl-6">
              <li>Your account information and profile.</li>
              <li>Your agents and their configurations.</li>
              <li>Content your agents processed or created within Sentrel.</li>
              <li>
                OAuth access and refresh tokens for all connected services, including
                Meta/Facebook.
              </li>
              <li>Associated logs and usage data, subject to the exceptions below.</li>
            </ul>
            <p>
              Note: deleting your Sentrel data does not delete content already
              published to a third-party platform (for example, posts or ads already
              live on Meta). To remove that content, manage it directly on the relevant
              platform.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              4. Timeline and retention exceptions
            </h2>
            <p>
              We complete deletion requests within 30 days. Disconnecting Meta (or any
              integration) revokes our token immediately. We may retain limited
              information where required to comply with legal, tax, accounting, or
              security obligations, or to resolve disputes; any retained data remains
              protected under our <a href="/privacy">Privacy Policy</a> and is
              deleted once it is no longer required.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              5. Contact
            </h2>
            <p>
              For any questions about deleting your data, contact{" "}
              <a href="mailto:privacy@sentrel.ai">privacy@sentrel.ai</a> or Sentrel at
              [Company address].
            </p>
          </section>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
