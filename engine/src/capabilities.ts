import type {
  Agent,
  Capabilities,
  Capability,
  KnowledgeBaseCapability,
  ImageGenerationCapability,
  TtsCapability,
  SttCapability,
  BrowserCapability,
  WebSearchCapability,
  DocParseCapability,
  VideoGenerationCapability,
  CodeSandboxCapability,
} from "./types.js";

type ResolvedCapabilities = {
  knowledge_base: Required<Pick<KnowledgeBaseCapability, "enabled">> & KnowledgeBaseCapability;
  agent_files:  Capability;
  scheduling:   Capability;
  tasks:        Capability;
  integrations: Capability;
  recall:       Capability;
  send_media:   Capability;
  image_generation: Required<Pick<ImageGenerationCapability, "enabled" | "provider">> & ImageGenerationCapability;
  tts:          Required<Pick<TtsCapability, "enabled" | "provider">> & TtsCapability;
  stt:          Required<Pick<SttCapability, "enabled" | "provider">> & SttCapability;
  browser_access: Required<Pick<BrowserCapability, "enabled" | "provider">> & BrowserCapability;
  web_search:   Required<Pick<WebSearchCapability, "enabled" | "provider">> & WebSearchCapability;
  doc_parse:    Required<Pick<DocParseCapability, "enabled" | "provider">> & DocParseCapability;
  video_generation: Required<Pick<VideoGenerationCapability, "enabled" | "provider">> & VideoGenerationCapability;
  code_sandbox: Required<Pick<CodeSandboxCapability, "enabled" | "provider">> & CodeSandboxCapability;
};

const DEFAULTS: ResolvedCapabilities = {
  knowledge_base: {
    enabled: false,
    always_retrieve: true,
    threshold: 0.75,
    top_k: 5,
  },
  agent_files:  { enabled: false },
  scheduling:   { enabled: true },
  tasks:        { enabled: true },
  integrations: { enabled: true },
  recall:       { enabled: true },
  send_media:   { enabled: true },
  // New multi-provider capabilities. All default-on with provider: "auto"
  // so they Just Work as soon as either an org credential or platform
  // ENV fallback is configured for at least one provider.
  image_generation: { enabled: true, provider: "auto" },
  tts:              { enabled: true, provider: "auto" },
  stt:              { enabled: true, provider: "auto" },
  browser_access:   { enabled: true, provider: "auto" },
  web_search:       { enabled: true, provider: "auto" },
  doc_parse:        { enabled: true, provider: "auto" },
  video_generation: { enabled: true, provider: "auto" },
  code_sandbox:     { enabled: true, provider: "auto" },
};

function mergeCap<T extends Capability>(def: T, override: Partial<T> | undefined): T {
  if (!override) return def;
  return { ...def, ...override };
}

export function resolveCapabilities(agent: Agent): ResolvedCapabilities {
  const caps = agent.capabilities || {};
  return {
    knowledge_base: mergeCap(DEFAULTS.knowledge_base, caps.knowledge_base),
    agent_files:    mergeCap(DEFAULTS.agent_files,    caps.agent_files),
    scheduling:     mergeCap(DEFAULTS.scheduling,     caps.scheduling),
    tasks:          mergeCap(DEFAULTS.tasks,          caps.tasks),
    integrations:   mergeCap(DEFAULTS.integrations,   caps.integrations),
    recall:         mergeCap(DEFAULTS.recall,         caps.recall),
    send_media:     mergeCap(DEFAULTS.send_media,     caps.send_media),
    image_generation: mergeCap(DEFAULTS.image_generation, caps.image_generation),
    tts:              mergeCap(DEFAULTS.tts,              caps.tts),
    stt:              mergeCap(DEFAULTS.stt,              caps.stt),
    browser_access:   mergeCap(DEFAULTS.browser_access,   caps.browser_access),
    web_search:       mergeCap(DEFAULTS.web_search,       caps.web_search),
    doc_parse:        mergeCap(DEFAULTS.doc_parse,        caps.doc_parse),
    video_generation: mergeCap(DEFAULTS.video_generation, caps.video_generation),
    code_sandbox:     mergeCap(DEFAULTS.code_sandbox,     caps.code_sandbox),
  };
}

export function isEnabled(agent: Agent, key: keyof Capabilities): boolean {
  return resolveCapabilities(agent)[key]?.enabled === true;
}

export type { ResolvedCapabilities };
