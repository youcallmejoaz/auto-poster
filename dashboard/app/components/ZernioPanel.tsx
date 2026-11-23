import { ZernioClient, postPlatforms, zernioAccountIssues, type ZernioAccount } from "worker/zernio";
import { getConfig } from "@/lib/server";

/** Server component: shows which TikTok/Instagram accounts Zernio will post to, read live from Zernio. */
export async function ZernioPanel() {
  const cfg = await getConfig();
  if (!cfg.ZERNIO_API_KEY) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Posting to TikTok &amp; Instagram</h2>
        <p className="small">
          Easiest route: create a free account at <a href="https://zernio.com" target="_blank" rel="noreferrer">zernio.com</a>, connect your TikTok and Instagram there, then paste your Zernio API key in the <strong>Zernio</strong> section below. No developer apps, custom domain or TikTok audit needed.
        </p>
      </div>
    );
  }

  let accounts: ZernioAccount[] = [];
  let error: string | null = null;
  try {
    accounts = await new ZernioClient(cfg.ZERNIO_API_KEY, cfg.ZERNIO_BASE_URL).listAccounts();
  } catch (e) {
    error = (e as Error).message;
  }
  const issues = error ? [] : zernioAccountIssues(accounts, cfg);
  const wanted = postPlatforms(cfg);
  const shown = accounts.filter((a) => a.platform === "tiktok" || a.platform === "instagram");

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>Posting via Zernio</h2>
        <a className="btn" href="https://zernio.com" target="_blank" rel="noreferrer">Manage accounts on zernio.com ↗</a>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Videos are uploaded to Zernio and published to {wanted.map((p) => (p === "tiktok" ? "TikTok" : "Instagram")).join(" and ")} through Zernio's approved apps. Stats come back through Zernio too. No tokens to refresh.
      </p>
      {error && <div className="msg bad">Can't reach Zernio: {error}</div>}
      {issues.map((i) => <div key={i} className="issue warn" style={{ marginBottom: 6 }}>{i}</div>)}
      {!error && (
        <div className="grid g2" style={{ marginTop: 8 }}>
          {shown.map((a) => (
            <div key={a._id} className="row between" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px" }}>
              <div>
                <strong>{a.platform === "tiktok" ? "TikTok" : "Instagram"}</strong> · @{a.username ?? a.displayName ?? "?"}
                <div className="small muted">ID {a._id}</div>
              </div>
              <span className={`badge ${a.needsReconnect || a.isActive === false ? "bad" : "ok"}`}>{a.needsReconnect || a.isActive === false ? "Reconnect" : "Connected"}</span>
            </div>
          ))}
          {!shown.length && <p className="muted small">No TikTok or Instagram account connected in Zernio yet.</p>}
        </div>
      )}
    </div>
  );
}
