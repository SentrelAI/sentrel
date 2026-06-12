#!/usr/bin/env node
// agentmanifest — CLI for the Agent Bundle spec (agent-bundle/v1).
//
//   npx @manifestagent/agentmanifest generate [output-dir]   interactive wizard → scaffolds a bundle
//   npx @manifestagent/agentmanifest validate <bundle-dir>   check a bundle against the spec
//   npx @manifestagent/agentmanifest deploy [bundle-dir]     validate, upload, deploy via double.md

const [cmd, ...rest] = process.argv.slice(2);

const usage = `agentmanifest — the Dockerfile of AI agents (agent-bundle/v1)

Usage:
  agentmanifest generate [output-dir]   Interactive wizard: asks everything needed
                                    to produce a complete agent spec, then
                                    scaffolds and validates the bundle.
  agentmanifest validate <bundle-dir>   Validate a bundle (schema, referenced
                                    files, secret-value scan). [--json]
  agentmanifest deploy [bundle-dir]     Validate the bundle (default: current
                                    folder), upload it, and open the
                                    double.md deploy wizard in your browser.
                                    [--server <url>] [--no-open]
`;

switch (cmd) {
  case "generate":
  case "init":
    process.argv = [process.argv[0], process.argv[1], ...rest];
    await import("./generate.mjs");
    break;
  case "validate":
    process.argv = [process.argv[0], process.argv[1], ...rest];
    await import("./validate.mjs");
    break;
  case "deploy":
    process.argv = [process.argv[0], process.argv[1], ...rest];
    await import("./deploy.mjs");
    break;
  case "--help":
  case "-h":
  case "help":
  case undefined:
    console.log(usage);
    process.exit(cmd ? 0 : 2);
    break;
  default:
    console.error(`Unknown command: ${cmd}\n\n${usage}`);
    process.exit(2);
}
