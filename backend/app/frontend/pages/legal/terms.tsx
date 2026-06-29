import { Head } from "@inertiajs/react"

import { LandingNav } from "@/components/landing/landing-nav"
import { LandingFooter } from "@/components/landing/landing-footer"

interface Props {
  lastUpdated: string
}

export default function TermsOfService({ lastUpdated }: Props) {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <Head title="Terms of Service · Sentrel" />
      <LandingNav />

      <main className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-12">
          <h1 className="font-display text-4xl font-semibold tracking-[-0.025em] text-foreground">
            Terms of Service
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Last updated: {lastUpdated}
          </p>
        </header>

        <div className="space-y-12 text-[15px] leading-relaxed text-muted-foreground [&_a]:text-[var(--color-indigo)] [&_a]:underline-offset-4 hover:[&_a]:underline">
          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              1. Acceptance of these terms
            </h2>
            <p>
              These Terms of Service ("Terms") govern your access to and use of
              sentrel.ai and the Sentrel platform (the "Service"), provided by Sentrel
              ("Sentrel", "we", "us", or "our"). By creating an account or using the
              Service, you agree to these Terms. If you are using the Service on behalf
              of an organization, you represent that you have authority to bind that
              organization to these Terms.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              2. Description of the Service
            </h2>
            <p>
              Sentrel provides autonomous AI agents ("agents") that act on the
              third-party accounts you connect, with your authorization. Agents can
              perform work such as managing advertising campaigns, publishing content,
              and analyzing performance across connected platforms (including
              Meta/Facebook, Instagram, and others). Sensitive actions are subject to a
              human-in-the-loop approval model as described below.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              3. Your responsibilities
            </h2>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong className="text-foreground">Lawful use.</strong> You will use
                the Service and your agents only for lawful purposes and in compliance
                with these Terms and all applicable laws.
              </li>
              <li>
                <strong className="text-foreground">Valid authorization.</strong> You
                represent that you are authorized to connect each account you link to
                Sentrel and to permit agents to act on it. You must hold the necessary
                rights to the Pages, ad accounts, and assets you connect.
              </li>
              <li>
                <strong className="text-foreground">Platform compliance.</strong> You
                will comply with the terms, policies, and advertising standards of each
                connected platform, including the{" "}
                <a href="https://developers.facebook.com/terms/" target="_blank" rel="noreferrer">
                  Meta Platform Terms
                </a>
                ,{" "}
                <a href="https://www.facebook.com/policies/ads/" target="_blank" rel="noreferrer">
                  Meta Advertising Policies
                </a>
                , and Community Standards. You are responsible for the content your
                agents publish and the campaigns they run.
              </li>
              <li>
                <strong className="text-foreground">Account security.</strong> You are
                responsible for safeguarding your credentials and for all activity
                under your account.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              4. Human-in-the-loop and approvals
            </h2>
            <p>
              Sentrel applies a human-in-the-loop model: sensitive actions — such as
              publishing content, launching or modifying paid campaigns, or spending
              budget — can require your review and approval before they are executed,
              according to the policies you configure. You are responsible for
              configuring approval settings appropriately and for reviewing actions
              presented to you. Approving an action authorizes Sentrel to carry it out
              on the connected account.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              5. Ad spend and published content
            </h2>
            <p>
              You remain solely responsible for all advertising spend incurred on your
              connected ad accounts and for all content published through the Service,
              whether the action was taken automatically by an agent or after your
              approval. Sentrel does not control, and is not responsible for, the
              billing relationships between you and connected platforms (for example,
              amounts charged to your Meta ad account). You are responsible for
              monitoring your budgets, campaigns, and published content.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              6. Acceptable use
            </h2>
            <p>You agree not to use the Service to:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>Violate any law or the terms of any connected platform.</li>
              <li>
                Publish or promote content that is illegal, deceptive, infringing, or
                that violates platform advertising or community policies.
              </li>
              <li>
                Attempt to gain unauthorized access to the Service, other accounts, or
                connected platforms.
              </li>
              <li>
                Interfere with or disrupt the integrity or performance of the Service,
                or circumvent its security or rate limits.
              </li>
              <li>
                Connect accounts you are not authorized to access or act upon.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              7. Intellectual property
            </h2>
            <p>
              The Service, including its software, design, and content (excluding your
              content), is owned by Sentrel and protected by intellectual property
              laws. You retain all rights to the content you provide and the content
              your agents create on your behalf. You grant Sentrel a limited license to
              host, process, and transmit that content solely to operate the Service
              for you.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              8. Disclaimers
            </h2>
            <p>
              The Service is provided "as is" and "as available" without warranties of
              any kind, whether express or implied, including warranties of
              merchantability, fitness for a particular purpose, and non-infringement.
              AI agents are probabilistic systems and may produce inaccurate or
              unexpected results. We do not warrant that the Service will be
              uninterrupted, error-free, or that agent actions will achieve any
              particular outcome. You are responsible for reviewing agent activity.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              9. Limitation of liability
            </h2>
            <p>
              To the maximum extent permitted by law, Sentrel and its affiliates will
              not be liable for any indirect, incidental, special, consequential, or
              punitive damages, or for any loss of profits, revenue, data, advertising
              spend, or goodwill, arising out of or related to your use of the Service.
              Our total aggregate liability for any claim relating to the Service will
              not exceed the amount you paid us for the Service in the twelve months
              preceding the event giving rise to the claim.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              10. Termination
            </h2>
            <p>
              You may stop using the Service and delete your account at any time. We may
              suspend or terminate your access if you violate these Terms, if required
              by law, or to protect the Service or other users. Upon termination, your
              right to use the Service ends, connected integrations are disconnected,
              and we will handle your data in accordance with our{" "}
              <a href="/privacy">Privacy Policy</a> and{" "}
              <a href="/data-deletion">Data Deletion Instructions</a>.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              11. Changes to these terms
            </h2>
            <p>
              We may update these Terms from time to time. When we do, we will revise
              the "Last updated" date above and, where appropriate, notify you. Your
              continued use of the Service after changes take effect constitutes
              acceptance of the updated Terms.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              12. Governing law
            </h2>
            <p>
              These Terms are governed by the laws of [jurisdiction], without regard to
              its conflict-of-laws principles. Any disputes arising under these Terms
              will be resolved in the courts located in [jurisdiction].
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              13. Contact us
            </h2>
            <p>
              Questions about these Terms can be sent to{" "}
              <a href="mailto:legal@sentrel.ai">legal@sentrel.ai</a> or to Sentrel at
              [Company address].
            </p>
          </section>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
