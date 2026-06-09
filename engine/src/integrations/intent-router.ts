import { getSupportedLabel, getSupportedSlugs } from "./supported-cache.js";
import { routeToolkits } from "./router.js";

export type IntegrationIntentKey =
  | "spreadsheet"
  | "lead_enrichment"
  | "email"
  | "calendar"
  | "document";

export interface IntegrationIntentRule {
  key: IntegrationIntentKey;
  label: string;
  patterns: RegExp[];
  preferredToolkits: string[];
  incompatibleToolkits?: string[];
  missingMessage: string;
}

export const INTEGRATION_INTENTS: IntegrationIntentRule[] = [
  {
    key: "spreadsheet",
    label: "spreadsheet",
    patterns: [
      /\b(google\s*sheets?|spreadsheet|workbook|excel|csv table)\b/i,
      /\bsheet\b/i,
    ],
    preferredToolkits: ["googlesheets", "airtable"],
    incompatibleToolkits: ["googledocs"],
    missingMessage:
      "A spreadsheet deliverable was requested, but no spreadsheet integration is connected. Do not use Google Docs as a substitute.",
  },
  {
    key: "lead_enrichment",
    label: "lead/contact enrichment",
    patterns: [
      /\b(apollo|lead|prospect|find contacts?|find emails?|verify emails?|enrich|people search|decision.?makers?)\b/i,
    ],
    preferredToolkits: ["apollo", "linkedin", "hubspot", "salesforce", "pipedrive", "zoho", "outreach", "salesloft"],
    missingMessage:
      "Lead/contact enrichment was requested, but no lead-generation or CRM integration is connected. Ask for a connection or explicit approval to use web fallback.",
  },
  {
    key: "email",
    label: "email",
    patterns: [/\b(gmail|email|inbox|send mail|reply to)\b/i],
    preferredToolkits: ["gmail", "outlook"],
    missingMessage:
      "Email work was requested, but no email integration is connected.",
  },
  {
    key: "calendar",
    label: "calendar",
    patterns: [/\b(calendar|meeting|invite|appointment|book a time|schedule a call)\b/i],
    preferredToolkits: ["googlecalendar", "calendly", "zoom"],
    missingMessage:
      "Calendar or scheduling work was requested, but no calendar integration is connected.",
  },
  {
    key: "document",
    label: "document",
    patterns: [/\b(google\s*docs?|document|docx|write a doc)\b/i],
    preferredToolkits: ["googledocs", "notion", "googledrive"],
    missingMessage:
      "Document creation/editing was requested, but no document integration is connected.",
  },
];

export interface IntegrationRoutingDecision {
  matches: string[];
  intents: IntegrationIntentKey[];
  errors: string[];
}

export function detectIntegrationIntents(text: string): IntegrationIntentRule[] {
  return INTEGRATION_INTENTS.filter((rule) => rule.patterns.some((pattern) => pattern.test(text)));
}

export function hasIntegrationIntent(text: string, key: IntegrationIntentKey): boolean {
  return detectIntegrationIntents(text).some((intent) => intent.key === key);
}

export function routeIntegrationRequest(
  query: string,
  availableToolkits: string[],
  semanticMatches: string[] = [],
  toolkitStatuses: Map<string, string> = new Map(),
): IntegrationRoutingDecision {
  const available = new Set(availableToolkits);
  const matches = new Set<string>();
  const errors: string[] = [];

  for (const match of semanticMatches) {
    if (available.has(match)) matches.add(match);
  }
  for (const match of routeToolkits(query, availableToolkits)) {
    matches.add(match);
  }
  for (const match of namedToolkitsFrom(query, availableToolkits)) {
    matches.add(match);
  }

  const intents = detectIntegrationIntents(query);
  for (const intent of intents) {
    const preferred = intent.preferredToolkits.filter((toolkit) => available.has(toolkit));
    for (const toolkit of preferred) matches.add(toolkit);

    if (preferred.length === 0 && intent.key === "spreadsheet") {
      errors.push(intent.missingMessage);
    }

    if (intent.key === "spreadsheet" && !mentionsToolkit(query, "googledocs")) {
      for (const incompatible of intent.incompatibleToolkits || []) {
        matches.delete(incompatible);
      }
    }
  }

  const missingNamed = namedToolkitsFrom(query, getSupportedSlugs()).filter((toolkit) => !available.has(toolkit));
  for (const toolkit of missingNamed) {
    const label = getSupportedLabel(toolkit) || humanizeToolkit(toolkit);
    // Status-specific framing if Composio knows about a connection
    // that just isn't ACTIVE (REVOKED, EXPIRED, INACTIVE, FAILED).
    // Cuts the confusion when /integrations still claims "Connected"
    // but the agent reports "not connected" — actually it's revoked,
    // user needs to RECONNECT not first-connect.
    const status = toolkitStatuses.get(toolkit);
    if (status === "REVOKED") {
      errors.push(`${label} was REVOKED on Composio's side (user or admin revoked the OAuth token). Ask the user to RECONNECT ${label} via propose_connection.`);
    } else if (status === "EXPIRED") {
      errors.push(`${label} connection EXPIRED (refresh token failed or hit max lifetime). Ask the user to RECONNECT ${label} via propose_connection.`);
    } else if (status === "FAILED") {
      errors.push(`${label} connection FAILED on Composio's side (last token exchange errored). Ask the user to RECONNECT ${label} via propose_connection.`);
    } else if (status === "INITIATED" || status === "INITIALIZING") {
      errors.push(`${label} OAuth was started but never completed. Ask the user to finish the connect flow at /integrations/${toolkit}.`);
    } else if (status === "INACTIVE") {
      errors.push(`${label} connection is INACTIVE on Composio. Ask the user to reconnect ${label} via propose_connection.`);
    } else {
      errors.push(`${label} is supported but not connected. Ask the user to connect ${label} via propose_connection.`);
    }
  }

  return {
    matches: [...matches],
    intents: intents.map((intent) => intent.key),
    errors: [...new Set(errors)],
  };
}

export function toolkitsForIntent(key: IntegrationIntentKey): string[] {
  return INTEGRATION_INTENTS.find((intent) => intent.key === key)?.preferredToolkits || [];
}

export function namedToolkitsFrom(text: string, toolkits: string[]): string[] {
  return toolkits.filter((toolkit) => mentionsToolkit(text, toolkit));
}

export function mentionsToolkit(text: string, toolkit: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerToolkit = toolkit.toLowerCase();
  if (new RegExp(`\\b${escapeRegex(lowerToolkit)}\\b`, "i").test(lowerText)) return true;

  const spaced = lowerToolkit
    .replace(/^google/, "google ")
    .replace(/^micro/, "micro ")
    .replace(/^hub/, "hub ")
    .replace(/^sales/, "sales ")
    .replace(/^click/, "click ");
  return spaced !== lowerToolkit && lowerText.includes(spaced);
}

function humanizeToolkit(slug: string): string {
  return slug
    .replace(/^google/, "Google ")
    .replace(/^hubspot$/, "HubSpot")
    .replace(/^linkedin$/, "LinkedIn")
    .replace(/^github$/, "GitHub")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
