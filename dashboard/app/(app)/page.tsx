import Link from "next/link";
import { checkHealth } from "worker/supervisor";
import { getConfig, getRepo } from "@/lib/server";
import { INTEGRATIONS, isConfigured } from "@/lib/integrations";
import { ago, fmtNum, videoPerformance } from "@/lib/view";
import { RunStages } from "../components/RunStages";

export default async function Overview() {
  const repo = getRepo();
  const cfg = await getConfig();
  const [runs48, review, approved, posted, recentRuns, openBriefs, perf, assets] = await Promise.all([
    repo.runsSince(48),
    repo.videosByStatus("review", 200),
    repo.videosByStatus("approved", 200),
    repo.listVideos({ status: "posted", limit: 50 }),
    repo.listRuns(12),
    repo.listBriefs("open"),
    videoPerformance(repo, 7),
    repo.listAssets(),
  ]);
  const health = checkHealth({ runs: runs48.filter((r) => r.stage !== "supervisor"), reviewQueue: review, recentVideos: [...review, ...approved, ...posted], dailyBudgetUsd: cfg.DAILY_BUDGET_USD });
  const views7 = perf.reduce((a, p) => a + p.views, 0);
  const installs7 = perf.reduce((a, p) => a + (p.installs ?? 0), 0);
  const hasInstalls = perf.some((p) => p.installs != null);
  const missing = INTEGRATIONS.filter((i) => !isConfigured(cfg, i.id));

  const setup = [
    { done: isConfigured(cfg, "anthropic"), text: "Add your Anthropic API key", href: "/settings" },
    { done: cfg.APP_DESCRIPTION !== "AI study app that turns notes into flashcards and quizzes", text: "Describe your app (scripts only claim what you write)", href: "/settings" },
    { done: assets.some((a) => a.kind === "app_demo"), text: "Upload an app screen recording (unlocks the App demo template)", href: "/assets" },
    { done: isConfigured(cfg, "instagram") || isConfigured(cfg, "tiktok"), text: "Connect Instagram and/or TikTok", href: "/settings" },
    { done: !!cfg.DASHBOARD_URL, text: "Set the dashboard URL and put /go in your bio for install tracking", href: "/settings" },
    { done: isConfigured(cfg, "github"), text: "Connect GitHub so the Run buttons work", href: "/settings" },
  ];
  const todo = setup.filter((s) => !s.done);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1>Overview</h1>
        <p className="sub">{cfg.APP_NAME} · last 7 days</p>
      </div>

      <div className="grid g4">
        <Link href="/review" className="card stat" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="n">{review.length}</div>
          <div className="l">waiting for review</div>
        </Link>
        <div className="card stat"><div className="n">{approved.length}</div><div className="l">approved, queued to post</div></div>
        <div className="card stat"><div className="n">{fmtNum(views7)}</div><div className="l">views on recent posts</div></div>
        <div className="card stat">
          <div className="n">{hasInstalls ? fmtNum(installs7) : "–"}</div>
          <div className="l">{hasInstalls ? "attributed installs" : "installs (import attribution)"}</div>
        </div>
      </div>

      {todo.length > 0 && (
        <div className="card">
          <h2>Finish setup ({setup.length - todo.length}/{setup.length})</h2>
          <div className="stack" style={{ gap: 6 }}>
            {todo.map((s) => (
              <Link key={s.text} href={s.href}>○ {s.text}</Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid g2">
        <div className="card">
          <div className="row between"><h2>Health</h2><span className="small muted">AI spend 24h: ${health.spend24h.toFixed(2)} / ${cfg.DAILY_BUDGET_USD}</span></div>
          {health.issues.length === 0 ? (
            <p className="msg ok">All stages ran on schedule.</p>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {health.issues.map((i, n) => (
                <div key={n} className={`issue ${i.severity}`}>{i.message}</div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h2>Run now</h2>
          <RunStages enabled={isConfigured(cfg, "github")} />
          <p className="small muted" style={{ marginTop: 12 }}>
            {openBriefs.length} brief{openBriefs.length === 1 ? "" : "s"} queued · next create run makes {cfg.VIDEOS_PER_RUN} · posting at {cfg.POST_SLOTS_UTC} UTC, max {cfg.DAILY_POST_CAP}/day
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Recent runs</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Stage</th><th>Status</th><th>Started</th><th className="num">Items</th><th className="num">Cost</th><th>Error</th></tr></thead>
            <tbody>
              {recentRuns.map((r) => (
                <tr key={r.id}>
                  <td>{r.stage}</td>
                  <td><span className={`badge ${r.status === "ok" ? "ok" : r.status === "error" ? "bad" : "warn"}`}>{r.status}</span></td>
                  <td className="muted">{ago(r.started_at)}</td>
                  <td className="num">{r.items}</td>
                  <td className="num">${Number(r.cost_usd).toFixed(2)}</td>
                  <td className="small" style={{ color: "var(--bad)", maxWidth: 420 }}>{r.error?.split("\n")[0]}</td>
                </tr>
              ))}
              {!recentRuns.length && <tr><td colSpan={6} className="muted">No runs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {missing.length > 0 && (
        <p className="small muted">
          Not connected: {missing.map((m) => m.label).join(" · ")}. <Link href="/settings">Settings →</Link>
        </p>
      )}
    </div>
  );
}
