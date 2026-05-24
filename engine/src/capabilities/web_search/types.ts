export interface WebSearchInput {
  query: string;
  /** How many results to return. Default 5, max 20. */
  max_results?: number;
  /** Filter to results from the last N days. */
  days_back?: number;
  /** "general" | "news" | "academic". Provider may downgrade if unsupported. */
  topic?: "general" | "news" | "academic";
  /** When true, ask the provider for short LLM-friendly content snippets. */
  include_content?: boolean;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
  content?: string;
  published_at?: string;
  score?: number;
}

export interface WebSearchOutput {
  /** When the provider supports answers-with-citations (Perplexity), this is filled. */
  answer?: string;
  results: WebSearchResult[];
}
