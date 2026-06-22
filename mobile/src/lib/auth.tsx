import React, { createContext, useContext, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Platform } from "react-native";
import { api, ApiError, getApiBaseUrl } from "./api";
import { initServerEnv } from "./server";
import type { User } from "./types";

// Ensures the auth browser session resolves cleanly when control returns.
WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = "sentrel.token";
const USER_KEY = "sentrel.user";

// SecureStore is unavailable on web; fall back to a tiny in-memory shim so the
// app still runs in `expo start --web` during development.
const store = {
  async get(key: string) {
    if (Platform.OS === "web") return webStore[key] ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string) {
    if (Platform.OS === "web") {
      webStore[key] = value;
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async del(key: string) {
    if (Platform.OS === "web") {
      delete webStore[key];
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};
const webStore: Record<string, string> = {};

interface AuthState {
  token: string | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signUp: (input: { name: string; email: string; password: string; organizationName?: string }) => Promise<boolean>;
  applyUser: (user: User) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On launch: restore a stored token and validate it against /me. If the
  // token was revoked server-side, clear it and fall back to login.
  useEffect(() => {
    (async () => {
      try {
        await initServerEnv();
        const saved = await store.get(TOKEN_KEY);
        if (saved) {
          // Optimistically restore from cache so a transient network error on
          // launch doesn't bounce the user to login. Validate against /me, and
          // only hard-clear the session on a real 401 (revoked token).
          const cachedUser = await store.get(USER_KEY);
          if (cachedUser) {
            setToken(saved);
            try {
              setUser(JSON.parse(cachedUser));
            } catch {
              /* ignore malformed cache */
            }
          }
          try {
            const { user } = await api.me(saved);
            setToken(saved);
            setUser(user);
            await store.set(USER_KEY, JSON.stringify(user));
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) {
              setToken(null);
              setUser(null);
              await store.del(TOKEN_KEY);
              await store.del(USER_KEY);
            }
            // else: keep the optimistic session; next request will retry.
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function signIn(email: string, password: string) {
    const res = await api.login(email.trim(), password, {
      platform: Platform.OS,
      device_name: `${Platform.OS} device`,
    });
    await store.set(TOKEN_KEY, res.token);
    await store.set(USER_KEY, JSON.stringify(res.user));
    setToken(res.token);
    setUser(res.user);
  }

  // Email/password signup → creates user + org, returns a token. Returns
  // whether the new org still needs onboarding so the caller can route there.
  async function signUp(input: { name: string; email: string; password: string; organizationName?: string }) {
    const res = await api.signup({
      name: input.name.trim(),
      email: input.email.trim(),
      password: input.password,
      organization_name: input.organizationName?.trim(),
      platform: Platform.OS,
      device_name: `${Platform.OS} device`,
    });
    await store.set(TOKEN_KEY, res.token);
    await store.set(USER_KEY, JSON.stringify(res.user));
    setToken(res.token);
    setUser(res.user);
    return !!res.onboarding_required;
  }

  // Update the cached user (e.g. after switching org) without re-auth.
  function applyUser(next: User) {
    setUser(next);
    store.set(USER_KEY, JSON.stringify(next)).catch(() => {});
  }

  // Browser-based Google OAuth. Opens the backend's start endpoint in an
  // in-app auth session; the backend completes Google sign-in and redirects to
  // our deep link with `?token=…`, which closes the session and hands the URL
  // back here.
  async function signInWithGoogle() {
    const redirectUrl = Linking.createURL("auth-callback");
    const startUrl = `${getApiBaseUrl()}/api/mobile/oauth/google/start?redirect=${encodeURIComponent(
      redirectUrl
    )}`;

    const result = await WebBrowser.openAuthSessionAsync(startUrl, redirectUrl);
    if (result.type === "cancel" || result.type === "dismiss") {
      const err = new Error("cancelled");
      (err as any).cancelled = true;
      throw err;
    }
    if (result.type !== "success" || !result.url) {
      throw new Error("Google sign-in didn’t complete.");
    }

    const { queryParams } = Linking.parse(result.url);
    const newToken = queryParams?.token as string | undefined;
    const error = queryParams?.error as string | undefined;
    if (error || !newToken) {
      throw new Error(error === "not_configured" ? "Google sign-in isn’t configured on the server." : "Google sign-in failed.");
    }

    const { user } = await api.me(newToken);
    await store.set(TOKEN_KEY, newToken);
    await store.set(USER_KEY, JSON.stringify(user));
    setToken(newToken);
    setUser(user);
  }

  async function signOut() {
    const current = token;
    setToken(null);
    setUser(null);
    await store.del(TOKEN_KEY);
    await store.del(USER_KEY);
    if (current) api.logout(current).catch(() => {});
  }

  return (
    <AuthContext.Provider value={{ token, user, loading, signIn, signInWithGoogle, signUp, applyUser, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
