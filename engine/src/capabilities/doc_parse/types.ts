export interface ParseDocInput {
  /** Either a workspace file path OR a public URL. Exactly one. */
  file_path?: string;
  url?: string;
  /** Markdown is the most agent-friendly default. */
  output_format?: "markdown" | "text" | "json";
}

export interface ParseDocOutput {
  format: "markdown" | "text" | "json";
  /** The extracted content. For json, this is the JSON-stringified payload. */
  content: string;
  /** Provider that ran. */
  provider: string;
  pages?: number;
  /** Optional structured tables/sections when the provider returns them. */
  metadata?: Record<string, unknown>;
}
