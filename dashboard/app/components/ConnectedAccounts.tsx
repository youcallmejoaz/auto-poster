"use client";

import { refreshTokenNow } from "../actions";
import { ActionButton } from "./ActionButton";

export type AccountView = {
  id: "tiktok" | "instagram";
  name: string;
  appReady: boolean;
  connected: boolean;
  autoRefresh: boolean;
  expires: string | null; // ISO, "never", or null (unknown)
  extra: string | null;
  redirectUri: string;
  appHelp: string;
};

function expiryText(e: string | null) {
  if (e === "never") return { text: "Never expires", tone: "ok" };
  if (!e) return { text: "Expiry unknown", tone: "warn" };
  const ms = Date.parse(e) - Date.now();
  if (ms <= 0) return { text: "Expired", tone: "bad" };
  const h = ms / 3600e3;
  return { text: `Expires in ${h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)} days`}`, tone: h < 2 ? "bad" : "ok" };
}

export function ConnectedAccounts({ accounts, warnings, dashboardUrlSet, siteUrl }: { accounts: AccountView[]; warnings: string[]; dashboardUrlSet: boolean; siteUrl: string }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Connected accounts</h2>
      <p className="small muted">Connect once and tokens renew themselves: TikTok every day, Instagram before its 60 days run out. You'll get an alert if a renewal fails.</p>
      {warnings.map((w) => <div key={w} className="issue warn" style={{ marginBottom: 8 }}>{w}</div>)}
      <div className="grid g2" style={{ marginTop: 8 }}>
        {accounts.map((a) => {
          const exp = expiryText(a.expires);
          return (
            <div key={a.id} className="stack" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, gap: 8 }}>
              <div className="row between">
                <strong>{a.name}</strong>
                {a.connected ? <span className={`badge ${exp.tone}`}>{exp.text}</span> : <span className="badge">Not connected</span>}
              </div>
              {a.connected && <div className="small">{a.autoRefresh ? <span className="badge ok">Auto-refresh on</span> : <span className="badge warn">Auto-refresh off</span>}</div>}
              {a.extra && <div className="small muted">{a.extra}</div>}
              <div className="row">
                {a.appReady ? (
                  <a className="btn primary" href={`/api/oauth/${a.id}/start`}>{a.connected ? "Reconnect" : "Connect"} {a.name}</a>
                ) : (
                  <span className="small muted">Save the {a.appHelp} below to enable Connect.</span>
                )}
                {a.connected && <ActionButton className="btn" label="Refresh now" pendingLabel="Refreshing…" run={() => refreshTokenNow(a.id)} />}
              </div>
              <details className="small">
                <summary>URLs for the {a.name} developer portal (redirect, terms, privacy)</summary>
                <div style={{ marginTop: 6 }}><code>{a.redirectUri}</code></div>
                <div style={{ marginTop: 8 }}>Terms of Service URL: <code>{siteUrl}/terms</code></div>
                <div style={{ marginTop: 4 }}>Privacy Policy URL: <code>{siteUrl}/privacy</code></div>
                {!dashboardUrlSet && <div className="muted" style={{ marginTop: 4 }}>Set “Dashboard public URL” below so these use your real domain.</div>}
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
