import { Head } from "@inertiajs/react"

import { LandingNav } from "@/components/landing/landing-nav"
import { LandingFooter } from "@/components/landing/landing-footer"

interface Props {
  lastUpdated: string
}

export default function PrivacyPolicy({ lastUpdated }: Props) {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <Head title="Privacy Policy · Sentrel" />
      <LandingNav />

      <main className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-12">
          <h1 className="font-display text-4xl font-semibold tracking-[-0.025em] text-foreground">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Last updated: {lastUpdated}
          </p>
        </header>

        <div className="space-y-12 text-[15px] leading-relaxed text-muted-foreground [&_a]:text-[var(--color-indigo)] [&_a]:underline-offset-4 hover:[&_a]:underline">
          <section className="space-y-4">
            <p>
              This Privacy Policy explains how Sentrel ("Sentrel", "we", "us", or
              "our") collects, uses, shares, and protects information when you use
              sentrel.ai and the Sentrel platform (the "Service"). Sentrel is an
              AI-employee platform: autonomous AI agents that act on your behalf
              across the apps and accounts you choose to connect.
            </p>
            <p>
              By using the Service, you agree to the practices described in this
              policy. If you do not agree, please do not use the Service.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              1. Who we are
            </h2>
            <p>
              Sentrel provides a platform where customers configure AI agents that
              perform work autonomously across connected third-party services, with
              human approval required for sensitive actions. The data controller for
              the purposes of this policy is Sentrel, located at [Company address].
            </p>
            <p>
              If you have any questions about this policy or your data, contact us at{" "}
              <a href="mailto:privacy@sentrel.ai">privacy@sentrel.ai</a>.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              2. Information we collect
            </h2>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong className="text-foreground">Account information.</strong>{" "}
                Your name, email address, password (hashed), organization details,
                and billing information when you create or manage a Sentrel account.
              </li>
              <li>
                <strong className="text-foreground">Content the agents process.</strong>{" "}
                The instructions, messages, documents, drafts, ad copy, creative
                assets, and other content you or your agents create, upload, or act
                upon while using the Service.
              </li>
              <li>
                <strong className="text-foreground">
                  OAuth tokens for connected services.
                </strong>{" "}
                When you connect a third-party service (for example Meta/Facebook,
                Google, or email), we receive and securely store the access and
                refresh tokens needed to operate the agent on your behalf, along with
                the scope of permissions you granted.
              </li>
              <li>
                <strong className="text-foreground">Usage and device data.</strong>{" "}
                Log data, IP address, browser and device information, feature usage,
                and diagnostic information used to operate, secure, and improve the
                Service.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              3. Meta / Facebook Platform data
            </h2>
            <p>
              When you connect your Meta account using Facebook Login for Business,
              Sentrel accesses Meta Platform data strictly according to the
              permissions you grant, and solely to operate the agent you configured
              on your behalf. Depending on the permissions you approve, this may
              include:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong className="text-foreground">Ad accounts and advertising</strong>{" "}
                (e.g. <code className="rounded bg-muted px-1 py-0.5 text-[13px]">ads_management</code>,{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[13px]">business_management</code>):
                to create, manage, and report on campaigns, ad sets, ads, and
                audiences via the Meta Marketing API.
              </li>
              <li>
                <strong className="text-foreground">Pages</strong>{" "}
                (e.g. <code className="rounded bg-muted px-1 py-0.5 text-[13px]">pages_manage_posts</code>,{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[13px]">pages_read_engagement</code>):
                to publish, schedule, and manage content on Pages you administer.
              </li>
              <li>
                <strong className="text-foreground">Instagram</strong>{" "}
                (e.g. <code className="rounded bg-muted px-1 py-0.5 text-[13px]">instagram_content_publish</code>,{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[13px]">instagram_basic</code>):
                to publish and manage content on connected Instagram accounts.
              </li>
              <li>
                <strong className="text-foreground">Insights and metrics</strong>{" "}
                (e.g. <code className="rounded bg-muted px-1 py-0.5 text-[13px]">read_insights</code>):
                to analyze performance so your agent can report and optimize.
              </li>
            </ul>
            <p>
              We store Meta access tokens securely and use Meta Platform data only to
              provide the service you requested. We <strong className="text-foreground">do not sell</strong>{" "}
              Meta Platform data, and we do not use it for any purpose other than
              operating the Service on your behalf. We comply with the{" "}
              <a href="https://developers.facebook.com/terms/" target="_blank" rel="noreferrer">
                Meta Platform Terms
              </a>{" "}
              and{" "}
              <a href="https://developers.facebook.com/devpolicy/" target="_blank" rel="noreferrer">
                Meta Developer Policies
              </a>
              . You can revoke our access at any time from your{" "}
              <a href="/integrations">integrations page</a> or in your Meta Business
              settings; see our{" "}
              <a href="/data-deletion">Data Deletion Instructions</a>.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              4. How we use your information
            </h2>
            <ul className="list-disc space-y-2 pl-6">
              <li>To provide, operate, and maintain the Service and your agents.</li>
              <li>To carry out the actions you and your agents authorize on connected accounts.</li>
              <li>To request your approval for sensitive actions (human-in-the-loop).</li>
              <li>To process payments and manage your subscription.</li>
              <li>To secure the Service, prevent abuse, and debug issues.</li>
              <li>To communicate with you about the Service and respond to support requests.</li>
              <li>To comply with legal obligations.</li>
            </ul>
            <p>
              We do not use your content or Meta Platform data to train foundation
              models for third parties.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              5. Legal bases for processing
            </h2>
            <p>
              Where applicable law (such as the GDPR) requires a legal basis, we rely
              on: performance of our contract with you to provide the Service; your
              consent (for example when you connect an integration); our legitimate
              interests in operating and securing the Service; and compliance with
              legal obligations.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              6. How we share information
            </h2>
            <p>
              We do not sell your personal data or Meta Platform data. We share
              information only as follows:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong className="text-foreground">Subprocessors.</strong> Trusted
                service providers that help us run the Service, such as cloud hosting
                providers and large language model (LLM) providers that process
                content to power agent reasoning. These providers act on our
                instructions and are bound by confidentiality and data-protection
                obligations.
              </li>
              <li>
                <strong className="text-foreground">Connected services.</strong> When
                your agent acts on a connected account, the relevant data is sent to
                that platform (for example Meta) to carry out the action you
                authorized.
              </li>
              <li>
                <strong className="text-foreground">Legal and safety.</strong> When
                required by law, legal process, or to protect the rights, safety, and
                security of Sentrel, our users, or the public.
              </li>
              <li>
                <strong className="text-foreground">Business transfers.</strong> In
                connection with a merger, acquisition, or sale of assets, subject to
                this policy.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              7. Data retention
            </h2>
            <p>
              We retain your information for as long as your account is active or as
              needed to provide the Service. When you disconnect an integration, we
              stop accessing that platform and delete or revoke the associated tokens.
              When you delete your account or request deletion, we delete your data
              within 30 days, except where we are required to retain certain
              information to comply with legal, accounting, or security obligations.
              See our <a href="/data-deletion">Data Deletion Instructions</a>.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              8. Security
            </h2>
            <p>
              We use industry-standard safeguards to protect your information,
              including encryption in transit (TLS) and at rest, access controls, and
              secure storage of OAuth tokens and credentials. No method of
              transmission or storage is completely secure, but we work to protect
              your data and continually improve our safeguards.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              9. International data transfers
            </h2>
            <p>
              We may process and store information in countries other than the one in
              which you reside. Where we transfer personal data internationally, we
              rely on appropriate safeguards such as Standard Contractual Clauses or
              other lawful transfer mechanisms.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              10. Your rights
            </h2>
            <p>
              Depending on your location, you may have the right to access, correct,
              export, or delete your personal data, and to object to or restrict
              certain processing. You can:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>Access and update your account information in your account settings.</li>
              <li>
                Disconnect any integration at any time from your{" "}
                <a href="/integrations">integrations page</a>, which revokes our access
                to that service.
              </li>
              <li>
                Request deletion of your Sentrel data by following our{" "}
                <a href="/data-deletion">Data Deletion Instructions</a> or by
                emailing <a href="mailto:privacy@sentrel.ai">privacy@sentrel.ai</a>.
              </li>
            </ul>
            <p>
              We will respond to your request consistent with applicable law. You may
              also have the right to lodge a complaint with your local data protection
              authority.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              11. Cookies
            </h2>
            <p>
              We use cookies and similar technologies to keep you signed in, remember
              your preferences, and understand how the Service is used. You can control
              cookies through your browser settings; disabling some cookies may affect
              how the Service functions.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              12. Children's privacy
            </h2>
            <p>
              The Service is not directed to and may not be used by anyone under the
              age of 18. We do not knowingly collect personal data from children. If
              you believe a child has provided us with personal data, please contact{" "}
              <a href="mailto:privacy@sentrel.ai">privacy@sentrel.ai</a> and we will
              delete it.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              13. Changes to this policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. When we do, we will
              revise the "Last updated" date above and, where appropriate, notify you.
              Your continued use of the Service after changes take effect constitutes
              acceptance of the updated policy.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">
              14. Contact us
            </h2>
            <p>
              Questions or requests about your privacy can be sent to{" "}
              <a href="mailto:privacy@sentrel.ai">privacy@sentrel.ai</a> or to Sentrel
              at [Company address].
            </p>
          </section>
        </div>
      </main>

      <LandingFooter />
    </div>
  )
}
