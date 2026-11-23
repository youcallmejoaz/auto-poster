import "server-only";
import Link from "next/link";
import { loadConfig } from "worker/env";
import { getConfig } from "@/lib/server";

export const LAST_UPDATED = "23 November 2026";

/** Never throws: TikTok/Meta crawl these pages, so fall back to env defaults if the DB is unreachable. */
export async function legalInfo() {
  let cfg;
  try {
    cfg = await getConfig();
  } catch {
    cfg = loadConfig();
  }
  return {
    app: cfg.APP_NAME,
    operator: cfg.LEGAL_ENTITY_NAME || cfg.APP_NAME,
    email: cfg.CONTACT_EMAIL || null,
    site: cfg.DASHBOARD_URL?.replace(/\/$/, "") || null,
  };
}

export function LegalLayout({ title, app, children }: { title: string; app: string; children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px 80px", lineHeight: 1.65 }}>
      <p className="small muted" style={{ marginBottom: 6 }}>{app}</p>
      <h1 style={{ fontSize: 30, marginBottom: 6 }}>{title}</h1>
      <p className="muted" style={{ marginBottom: 32 }}>Last updated: {LAST_UPDATED}</p>
      <div className="legal">{children}</div>
      <p className="small muted" style={{ marginTop: 48, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <Link href="/terms">Terms of Service</Link> · <Link href="/privacy">Privacy Policy</Link>
      </p>
      <style>{`.legal h2{font-size:18px;margin:28px 0 8px}.legal p,.legal li{font-size:15px}.legal ul{padding-left:20px;margin:0 0 10px}.legal li{margin-bottom:4px}`}</style>
    </div>
  );
}

export function Contact({ email, operator }: { email: string | null; operator: string }) {
  return email ? (
    <>
      email <a href={`mailto:${email}`}>{email}</a>
    </>
  ) : (
    <>contact {operator} through the channels listed in the app store listing</>
  );
}
