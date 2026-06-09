// Per-toolkit tool allowlist. Only these tools are loaded when the toolkit
// matches in the router. Users wanting other tools can call
// COMPOSIO_SEARCH_TOOLS to discover them, then invoke by name.
//
// Rationale: Google Sheets has 48 tools but agents need CREATE, READ, WRITE
// 95% of the time. Same for Gmail (send/search/draft). Shrinks token cost
// from ~40 tool schemas to ~5 per matched toolkit.

export const CURATED_TOOLS: Record<string, string[]> = {
  googlesheets: [
    "GOOGLESHEETS_CREATE_GOOGLE_SHEET1",
    "GOOGLESHEETS_BATCH_UPDATE",
    "GOOGLESHEETS_BATCH_GET",
    "GOOGLESHEETS_GET_SPREADSHEET_INFO",
    "GOOGLESHEETS_SEARCH_SPREADSHEETS",
    "GOOGLESHEETS_APPEND_DIMENSION",
    "GOOGLESHEETS_ADD_SHEET",
  ],
  googlecalendar: [
    "GOOGLECALENDAR_CREATE_EVENT",
    "GOOGLECALENDAR_LIST_EVENTS",
    "GOOGLECALENDAR_UPDATE_EVENT",
    "GOOGLECALENDAR_DELETE_EVENT",
    "GOOGLECALENDAR_FIND_FREE_SLOTS",
  ],
  googledrive: [
    "GOOGLEDRIVE_UPLOAD_FILE",
    "GOOGLEDRIVE_CREATE_FOLDER",
    "GOOGLEDRIVE_LIST_FILES",
    "GOOGLEDRIVE_GET_FILE",
    "GOOGLEDRIVE_SHARE_FILE",
  ],
  googledocs: [
    "GOOGLEDOCS_CREATE_DOCUMENT",
    "GOOGLEDOCS_GET_DOCUMENT",
    "GOOGLEDOCS_INSERT_TEXT",
    "GOOGLEDOCS_BATCH_UPDATE",
  ],
  gmail: [
    "GMAIL_SEND_EMAIL",
    "GMAIL_FETCH_EMAILS",
    "GMAIL_CREATE_DRAFT",
    "GMAIL_SEND_DRAFT",
    "GMAIL_SEARCH",
    "GMAIL_REPLY_TO_EMAIL",
  ],
  github: [
    "GITHUB_CREATE_ISSUE",
    "GITHUB_LIST_REPOSITORIES",
    "GITHUB_GET_ISSUE",
    "GITHUB_LIST_ISSUES",
    "GITHUB_ADD_COMMENT_TO_ISSUE",
    "GITHUB_UPDATE_ISSUE",
    "GITHUB_CREATE_PULL_REQUEST",
  ],
  slack: [
    "SLACK_SEND_MESSAGE",
    "SLACK_LIST_CHANNELS",
    "SLACK_SEARCH_MESSAGES",
    "SLACK_UPLOAD_FILE",
    "SLACK_REPLY_TO_THREAD",
  ],
  vercel: [
    "VERCEL_LIST_DEPLOYMENTS",
    "VERCEL_GET_DEPLOYMENT",
    "VERCEL_CREATE_DEPLOYMENT",
    "VERCEL_LIST_PROJECTS",
    "VERCEL_GET_PROJECT",
  ],
  apollo: [
    // Verified Composio tool names — noun BEFORE verb.
    // (Old list had APOLLO_SEARCH_PEOPLE / APOLLO_ENRICH_PERSON /
    // APOLLO_SEARCH_COMPANIES which DON'T EXIST; Composio silently
    // dropped them so only ADD_CONTACTS_TO_SEQUENCE made it into
    // the agent's tool set — the source of weeks of confusion.)
    "APOLLO_PEOPLE_SEARCH",
    "APOLLO_ORGANIZATION_SEARCH",
    "APOLLO_MIXED_PEOPLE_AND_ACCOUNTS_SEARCH",
    "APOLLO_BULK_PEOPLE_ENRICHMENT",
    "APOLLO_ADD_CONTACTS_TO_SEQUENCE",
    "APOLLO_GET_AUTH_STATUS",
  ],
  hubspot: [
    "HUBSPOT_CREATE_CONTACT",
    "HUBSPOT_GET_CONTACT",
    "HUBSPOT_LIST_CONTACTS",
    "HUBSPOT_CREATE_DEAL",
    "HUBSPOT_UPDATE_DEAL",
    "HUBSPOT_SEARCH_CONTACTS",
  ],
  stripe: [
    "STRIPE_CREATE_INVOICE",
    "STRIPE_LIST_CUSTOMERS",
    "STRIPE_GET_CUSTOMER",
    "STRIPE_LIST_CHARGES",
    "STRIPE_CREATE_PAYMENT_LINK",
  ],
  linear: [
    "LINEAR_CREATE_ISSUE",
    "LINEAR_LIST_ISSUES",
    "LINEAR_UPDATE_ISSUE",
    "LINEAR_GET_ISSUE",
    "LINEAR_LIST_PROJECTS",
  ],
  notion: [
    "NOTION_CREATE_PAGE",
    "NOTION_QUERY_DATABASE",
    "NOTION_UPDATE_PAGE",
    "NOTION_SEARCH",
    "NOTION_APPEND_BLOCKS",
  ],
  // Fallback: for toolkits without a curated list, take first N tools alphabetically
};

/**
 * Get the curated tool name list for a toolkit. Returns [] if no curation
 * exists — caller should load all tools for that toolkit (safe default).
 */
export function curatedToolsFor(toolkit: string): string[] {
  return CURATED_TOOLS[toolkit] || [];
}
