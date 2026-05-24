// Doc parse registry. Preference: Llamaparse → Mistral OCR → Reducto
// (Llamaparse has the most generous free tier; Mistral is fast +
// multi-language; Reducto is the heavy hitter for table-dense docs.)

import { LlamaparseProvider } from "./llamaparse.js";
import { MistralOcrProvider } from "./mistral_ocr.js";
import { ReductoProvider } from "./reducto.js";
import { resolveCapabilities } from "../../capabilities.js";
import type { Agent } from "../../types.js";

type DocParseProvider =
  | typeof LlamaparseProvider
  | typeof MistralOcrProvider
  | typeof ReductoProvider;

const REGISTRY: ReadonlyArray<DocParseProvider> = [
  LlamaparseProvider,
  MistralOcrProvider,
  ReductoProvider,
];

export async function getActiveDocParseProvider(agent: Agent): Promise<DocParseProvider> {
  const cap = resolveCapabilities(agent).doc_parse;
  const desired = cap.provider || "auto";

  if (desired !== "auto") {
    const explicit = REGISTRY.find((p) => p.name === desired);
    if (!explicit) throw new Error(`doc_parse provider "${desired}" not registered`);
    if (!(await explicit.isAvailable(agent.id))) {
      throw new Error(`doc_parse provider "${desired}" unavailable — add a credential at /settings/credentials.`);
    }
    return explicit;
  }
  for (const p of REGISTRY) {
    if (await p.isAvailable(agent.id)) return p;
  }
  throw new Error("doc_parse: no provider available — add a key for llamaparse / mistral_ocr / reducto at /settings/credentials.");
}

export const DOC_PARSE_REGISTRY = REGISTRY;
