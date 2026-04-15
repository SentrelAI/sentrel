import * as Sentry from "@sentry/node";
import { logger } from "./logger.js";

let initialized = false;

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info("Sentry: disabled (no SENTRY_DSN)");
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.GIT_SHA || "dev",
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_RATE || "0.1"),
    beforeSend(event) {
      // Scrub sensitive data from breadcrumbs
      if (event.breadcrumbs) {
        for (const crumb of event.breadcrumbs) {
          if (crumb.data) {
            delete crumb.data.password;
            delete crumb.data.access_token;
            delete crumb.data.api_key;
          }
        }
      }
      return event;
    },
  });

  initialized = true;
  logger.info("Sentry: initialized");
}

export function setAgentContext(agent: { id: number; name: string; role: string; organization?: { id: number; name: string; slug?: string } | null }) {
  if (!initialized) return;

  Sentry.setTag("agent_id", agent.id);
  Sentry.setTag("agent_name", agent.name);
  Sentry.setTag("agent_role", agent.role);
  if (agent.organization) {
    Sentry.setTag("org_id", agent.organization.id);
    Sentry.setTag("org_slug", agent.organization.slug || "");
  }
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
  if (!initialized) return;

  Sentry.captureException(error, {
    extra: context,
  });
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "info") {
  if (!initialized) return;
  Sentry.captureMessage(message, level);
}

export async function flush(timeout = 2000) {
  if (!initialized) return;
  await Sentry.flush(timeout);
}
