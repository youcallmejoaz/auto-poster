import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "worker/env";

export type IntegrationId = "anthropic" | "elevenlabs" | "apify" | "instagram" | "tiktok" | "github";

export const INTEGRATIONS: { id: IntegrationId; label: string; needs: (keyof Config)[]; required?: boolean }[] = [
  { id: "anthropic", label: "Claude (scripts, critique, analytics)", needs: ["ANTHROPIC_API_KEY"], required: true },
  { id: "elevenlabs", label: "ElevenLabs voiceover", needs: ["ELEVENLABS_API_KEY"] },
  { id: "apify", label: "Apify research", needs: ["APIFY_TOKEN"] },
  { id: "instagram", label: "Instagram Reels", needs: ["IG_USER_ID", "IG_ACCESS_TOKEN"] },
  { id: "tiktok", label: "TikTok", needs: ["TIKTOK_ACCESS_TOKEN"] },
  { id: "github", label: "GitHub Actions (Run buttons)", needs: ["GITHUB_REPO", "GITHUB_TOKEN"] },
];

export const isConfigured = (cfg: Config, id: IntegrationId) => INTEGRATIONS.find((i) => i.id === id)!.needs.every((k) => !!cfg[k]);

async function get(url: string, headers: Record<string, string> = {}, init: RequestInit = {}) {
  const r = await fetch(url, { headers, ...init, cache: "no-store" });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

/** Makes one cheap, read-only call per service to confirm the saved key works. */
export async function testIntegration(cfg: Config, id: IntegrationId): Promise<string> {
  switch (id) {
    case "anthropic": {
      const page = await new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY }).models.list({ limit: 5 });
      return `OK — ${page.data.length} models visible`;
    }
    case "elevenlabs": {
      const u = await get("https://api.elevenlabs.io/v1/user/subscription", { "xi-api-key": cfg.ELEVENLABS_API_KEY! });
      return `OK — ${u.tier ?? "account"}, ${u.character_count ?? "?"}/${u.character_limit ?? "?"} characters used`;
    }
    case "apify": {
      const u = await get("https://api.apify.com/v2/users/me", { authorization: `Bearer ${cfg.APIFY_TOKEN}` });
      return `OK — ${u.data?.username ?? "account"}`;
    }
    case "instagram": {
      const u = await get(`https://graph.facebook.com/${cfg.META_GRAPH_VERSION}/${cfg.IG_USER_ID}?fields=username&access_token=${encodeURIComponent(cfg.IG_ACCESS_TOKEN!)}`);
      return `OK — @${u.username}`;
    }
    case "tiktok": {
      const u = await get("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", { authorization: `Bearer ${cfg.TIKTOK_ACCESS_TOKEN}`, "content-type": "application/json" }, { method: "POST", body: "{}" });
      return `OK — @${u.data?.creator_username}; privacy options: ${(u.data?.privacy_level_options ?? []).join(", ")}`;
    }
    case "github": {
      const r = await get(`https://api.github.com/repos/${cfg.GITHUB_REPO}/actions/workflows/pipeline.yml`, { authorization: `Bearer ${cfg.GITHUB_TOKEN}`, accept: "application/vnd.github+json" });
      return `OK — workflow "${r.name}" is ${r.state}`;
    }
  }
}
