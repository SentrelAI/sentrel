import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";

// Which backend the app talks to. `dev` auto-targets the Mac running Metro
// (LAN IP : 3200); `prod` points at the live control plane. Persisted so the
// choice survives restarts. Toggled from Settings (for testing prod data).
export type ServerEnv = "dev" | "prod";

const KEY = "sentrel.serverEnv";
export const PROD_URL = "https://www.sentrel.ai";

let currentEnv: ServerEnv = "dev";

function devUrl(): string {
  const hostUri =
    Constants.expoConfig?.hostUri || (Constants as any).expoGoConfig?.debuggerHost || "";
  const lanHost = hostUri.split(":")[0];
  if (lanHost && lanHost !== "localhost" && lanHost !== "127.0.0.1") {
    return `http://${lanHost}:3200`;
  }
  const configured = (Constants.expoConfig?.extra as any)?.apiBaseUrl as string | undefined;
  return configured || "http://localhost:3200";
}

export function baseUrlFor(env: ServerEnv): string {
  return env === "prod" ? PROD_URL : devUrl();
}

export function getServerEnv(): ServerEnv {
  return currentEnv;
}

export function getApiBaseUrl(): string {
  return baseUrlFor(currentEnv);
}

// Load the persisted env. Call once at startup BEFORE any API request so token
// validation hits the right server.
export async function initServerEnv(): Promise<void> {
  try {
    const saved = Platform.OS === "web" ? null : await SecureStore.getItemAsync(KEY);
    if (saved === "prod" || saved === "dev") currentEnv = saved;
  } catch {
    // default to dev
  }
}

export async function setServerEnv(env: ServerEnv): Promise<void> {
  currentEnv = env;
  try {
    if (Platform.OS !== "web") await SecureStore.setItemAsync(KEY, env);
  } catch {
    // ignore persistence failures
  }
}
