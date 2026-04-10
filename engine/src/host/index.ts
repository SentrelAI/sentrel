// Host singleton — chooses an implementation at startup based on env, exposes
// it as `host` for the rest of the engine to import.
//
// Today: always PostgresHost. Future: SqliteHost when standalone mode lands,
// or a remote HTTP-backed host for fully decoupled deployments.

import type { Host } from "./host.js";
import { PostgresHost } from "./postgres.js";
import { logger } from "../logger.js";

let instance: Host | null = null;

export function getHost(): Host {
  if (!instance) {
    // In the future: pick based on process.env.ALCHEMY_HOST_BACKEND
    instance = new PostgresHost();
    logger.info("Host: PostgresHost initialized");
  }
  return instance;
}

// Convenience export — most callers just want `host.foo()`
export const host: Host = new Proxy({} as Host, {
  get(_target, prop) {
    const real = getHost() as any;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export type { Host } from "./host.js";
export type { ChannelConfig, PendingApproval } from "./host.js";
