// Modal — serverless code execution. We talk to it via a thin lookup
// of a deployed `code-exec` function and invoke it. Requires the org
// to have deployed our reference Modal function (out of scope here —
// stub provider, throws "not configured" until someone wires the
// function endpoint via Modal's web URL feature).
//
// In practice most teams will pick e2b for ad-hoc code execution;
// Modal is here as a fallback for orgs that already use it for other
// serverless workflows and want their LLM-run code on the same infra.

import { fetchSecret } from "../../tools/secrets.js";
import type { ExecuteCodeInput, ExecuteCodeOutput } from "./types.js";

async function getCreds(agentId: number): Promise<{ tokenId: string; tokenSecret: string; functionUrl?: string } | null> {
  const cred = await fetchSecret({ agentId, provider: "modal", kind: "generic" });
  if (!cred) return null;
  const tokenId = cred.fields?.token_id;
  const tokenSecret = cred.fields?.token_secret;
  if (!tokenId || !tokenSecret) return null;
  return { tokenId, tokenSecret, functionUrl: cred.fields?.function_url };
}

export const ModalProvider = {
  name: "modal" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getCreds(agentId)) !== null;
  },

  async execute(input: ExecuteCodeInput, agentId: number): Promise<ExecuteCodeOutput> {
    const creds = await getCreds(agentId);
    if (!creds) throw new Error("modal: no credential resolved");
    if (!creds.functionUrl) {
      throw new Error(
        "modal: credential is configured but no function_url is set. Deploy the reference code-exec function " +
        "and add its web URL as `function_url` on the credential. See docs/modal-sandbox.md.",
      );
    }

    const res = await fetch(creds.functionUrl, {
      method: "POST",
      headers: {
        "Modal-Token-Id": creds.tokenId,
        "Modal-Token-Secret": creds.tokenSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code: input.code,
        language: input.language || "python",
        timeout: input.timeout ?? 30,
        files: input.files || {},
      }),
    });
    if (!res.ok) throw new Error(`modal exec failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as ExecuteCodeOutput;
    return data;
  },
};
