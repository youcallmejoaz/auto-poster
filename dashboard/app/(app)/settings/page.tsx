import { SETTINGS, maskSecret } from "worker/settings";
import { getConfig, getRepo, encKey } from "@/lib/server";
import { INTEGRATIONS, isConfigured } from "@/lib/integrations";
import { ago } from "@/lib/view";
import { SettingsForm, type FieldView } from "../../components/SettingsForm";
import { ConnectedAccounts } from "../../components/ConnectedAccounts";
import { ZernioPanel } from "../../components/ZernioPanel";
import { appConfigured, redirectUri } from "@/lib/oauth";
import { igTokenKind, tokenWarnings } from "worker/tokens";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ oauth?: string; msg?: string }> }) {
  const { oauth, msg } = await searchParams;
  const repo = getRepo();
  const cfg = await getConfig();
  const stored = new Map((await repo.getSettings()).map((s) => [s.key, s]));
  const fields: FieldView[] = SETTINGS.filter((d) => !d.internal).map((d) => {
    const s = stored.get(d.key);
    const effective = String((cfg as Record<string, unknown>)[d.key] ?? "");
    return {
      ...d,
      // Secrets never leave the server; only a mask and where the value comes from.
      value: d.secret ? "" : s?.value ?? "",
      fromEnv: !s && !!process.env[d.key],
      envValue: d.secret || s ? "" : process.env[d.key] ? `${process.env[d.key]} (from environment)` : effective ? `${effective} (default)` : "",
      secretState: d.secret ? (s ? `Saved ${ago(s.updated_at)}${effective ? ` · ${maskSecret(effective)}` : " · can't decrypt (wrong SETTINGS_ENCRYPTION_KEY?)"}` : effective ? "Set via environment" : "Not set") : undefined,
      checked: d.type === "bool" ? effective === "true" : undefined,
    };
  });
  const integrations = INTEGRATIONS.map((i) => ({ id: i.id, label: i.label, configured: isConfigured(cfg, i.id) }));
  const ig = cfg.IG_ACCESS_TOKEN ? igTokenKind(cfg.IG_ACCESS_TOKEN, cfg.IG_TOKEN_KIND) : null;

  // The direct-API panel (own TikTok/Meta apps). Secondary once Zernio is set up.
  const direct = (
    <ConnectedAccounts
      warnings={tokenWarnings(cfg).map((w) => w.message)}
      accounts={[
        {
          id: "tiktok",
          name: "TikTok",
          appReady: appConfigured(cfg, "tiktok"),
          connected: !!cfg.TIKTOK_ACCESS_TOKEN,
          autoRefresh: !!(cfg.TIKTOK_REFRESH_TOKEN && cfg.TIKTOK_CLIENT_KEY && cfg.TIKTOK_CLIENT_SECRET),
          expires: cfg.TIKTOK_TOKEN_EXPIRES_AT ?? null,
          extra: cfg.TIKTOK_REFRESH_EXPIRES_AT ? `Refresh token valid until ${new Date(cfg.TIKTOK_REFRESH_EXPIRES_AT).toUTCString().slice(5, 16)}` : null,
          redirectUri: redirectUri(cfg, "tiktok"),
          appHelp: "TikTok client key + secret",
        },
        {
          id: "instagram",
          name: "Instagram",
          appReady: appConfigured(cfg, "instagram"),
          connected: !!cfg.IG_ACCESS_TOKEN,
          autoRefresh: !!ig && (ig !== "facebook_user" || !!(cfg.META_APP_ID && cfg.META_APP_SECRET)),
          expires: ig === "facebook_page" ? "never" : cfg.IG_TOKEN_EXPIRES_AT || null,
          extra: ig ? `Token type: ${{ instagram: "Instagram Login", facebook_user: "Facebook user token (will be converted to a Page token)", facebook_page: "Facebook Page token" }[ig]}${cfg.IG_USER_ID ? ` · account ${cfg.IG_USER_ID}` : ""}` : null,
          redirectUri: redirectUri(cfg, "instagram"),
          appHelp: "Instagram app ID + secret",
        },
      ]}
      dashboardUrlSet={!!cfg.DASHBOARD_URL}
      siteUrl={(cfg.DASHBOARD_URL ?? "").replace(/\/$/, "")}
    />
  );

  return (
    <div>
      <h1>Settings</h1>
      <p className="sub">Keys are encrypted (AES-256-GCM) before they're stored and are never sent back to the browser. Changes apply on each stage's next run.</p>
      {oauth && msg && <div className={`msg ${oauth === "ok" ? "ok" : "bad"}`} style={{ marginBottom: 16 }}>{msg}</div>}
      <ZernioPanel />
      {cfg.ZERNIO_API_KEY ? (
        <details className="card" style={{ marginBottom: 20 }}>
          <summary>Direct TikTok / Instagram connection (advanced, not needed with Zernio)</summary>
          <div style={{ marginTop: 12 }}>{direct}</div>
        </details>
      ) : (
        direct
      )}
      {!encKey() && <div className="msg bad" style={{ marginBottom: 16 }}>SETTINGS_ENCRYPTION_KEY isn't set on the dashboard server, so API keys can't be saved here yet. Non-secret settings still work.</div>}
      <SettingsForm fields={fields} integrations={integrations} canSaveSecrets={!!encKey()} />
    </div>
  );
}
