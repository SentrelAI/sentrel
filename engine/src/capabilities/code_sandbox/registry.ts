// Code sandbox registry. Preference: E2B (ergonomic, free tier) → Modal
// (for orgs already running on Modal infra).

import { E2bProvider } from "./e2b.js";
import { ModalProvider } from "./modal.js";
import { resolveCapabilities } from "../../capabilities.js";
import type { Agent } from "../../types.js";

type CodeSandboxProvider = typeof E2bProvider | typeof ModalProvider;

const REGISTRY: ReadonlyArray<CodeSandboxProvider> = [E2bProvider, ModalProvider];

export async function getActiveCodeSandboxProvider(agent: Agent): Promise<CodeSandboxProvider> {
  const cap = resolveCapabilities(agent).code_sandbox;
  const desired = cap.provider || "auto";

  if (desired !== "auto") {
    const explicit = REGISTRY.find((p) => p.name === desired);
    if (!explicit) throw new Error(`code_sandbox provider "${desired}" not registered`);
    if (!(await explicit.isAvailable(agent.id))) {
      throw new Error(`code_sandbox provider "${desired}" unavailable — add a credential at /settings/credentials.`);
    }
    return explicit;
  }
  for (const p of REGISTRY) {
    if (await p.isAvailable(agent.id)) return p;
  }
  throw new Error("code_sandbox: no provider available — add an E2B or Modal credential at /settings/credentials.");
}

export const CODE_SANDBOX_REGISTRY = REGISTRY;
