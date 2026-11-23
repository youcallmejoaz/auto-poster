import "server-only";
import type { NextRequest } from "next/server";
import type { Config } from "worker/env";

export type Provider = "tiktok" | "instagram";
export const isProvider = (p: string): p is Provider => p === "tiktok" || p === "instagram";
export const STATE_COOKIE = (p: Provider) => `oauth_state_${p}`;

/** Must exactly match the redirect URI registered in the TikTok / Meta developer portal. */
export function redirectUri(cfg: Config, p: Provider, req?: NextRequest) {
  const base = (cfg.DASHBOARD_URL || req?.nextUrl.origin || "").replace(/\/$/, "");
  return `${base}/api/oauth/${p}/callback`;
}

export function randomState() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString("base64url");
}

export const appConfigured = (cfg: Config, p: Provider) => (p === "tiktok" ? !!(cfg.TIKTOK_CLIENT_KEY && cfg.TIKTOK_CLIENT_SECRET) : !!(cfg.IG_APP_ID && cfg.IG_APP_SECRET));
