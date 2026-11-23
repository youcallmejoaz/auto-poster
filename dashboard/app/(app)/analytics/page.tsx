import Link from "next/link";
import { getConfig, getRepo } from "@/lib/server";
import { fmtNum, videoPerformance } from "@/lib/view";
import { AttributionForm } from "../../components/AttributionForm";
import { templateLabel } from "../../components/VideoReview";

export default async function AnalyticsPage() {
  const repo = getRepo();
  const cfg = await getConfig();
  const perf = await videoPerformance(repo, 30);
  const clicks = await repo.clickCounts();
  const totalClicks = [...clicks.values()].reduce((a, b) => a + b, 0);
  const hasInstalls = perf.some((p) => p.installs != null);
  const byTemplate = new Map<string, { n: number; score: number; views: number }>();
  for (const p of perf) {
    const t = byTemplate.get(p.video.template) ?? { n: 0, score: 0, views: 0 };
    byTemplate.set(p.video.template, { n: t.n + 1, score: t.score + p.score, views: t.views + p.views });
  }
  const bio = cfg.DASHBOARD_URL?.replace(/\/$/, "");
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h1>Analytics</h1>
        <p className="sub">
          Scores are percentiles within the last 30 days. {hasInstalls ? "Installs per 1k views carry 50% of the score." : "No install data yet, so scores use views and engagement only. Import attribution below."}
        </p>
      </div>

      <div className="grid g3">
        {[...byTemplate.entries()].sort((a, b) => b[1].score / b[1].n - a[1].score / a[1].n).map(([t, s]) => (
          <div key={t} className="card stat">
            <div className="n">{Math.round(s.score / s.n)}</div>
            <div className="l">avg score · {templateLabel(t)} ({s.n} video{s.n === 1 ? "" : "s"}, {fmtNum(s.views)} views)</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Posted videos</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Video</th><th className="num">Score</th><th className="num">Views</th><th className="num">Eng. rate</th><th className="num">Avg watch</th><th className="num">Installs</th><th className="num">Inst/1k</th></tr></thead>
            <tbody>
              {perf.map((p) => (
                <tr key={p.video.id}>
                  <td>
                    <Link href={`/library/${p.video.id}`}>{p.video.title}</Link>
                    <div className="small muted">{templateLabel(p.video.template)} · {p.posts.map((x) => x.platform).join(" + ")} · {Math.round(p.ageHours)}h old</div>
                  </td>
                  <td className="num"><span className={`badge ${p.score >= 67 ? "ok" : p.score >= 34 ? "warn" : "bad"}`}>{p.score}</span></td>
                  <td className="num">{fmtNum(p.views)}</td>
                  <td className="num">{(p.engagementRate * 100).toFixed(1)}%</td>
                  <td className="num">{p.avgWatchSec != null ? `${p.avgWatchSec.toFixed(1)}s` : "–"}</td>
                  <td className="num">{fmtNum(p.installs)}</td>
                  <td className="num">{p.installsPer1k != null ? p.installsPer1k.toFixed(2) : "–"}</td>
                </tr>
              ))}
              {!perf.length && <tr><td colSpan={7} className="muted">No posted videos with metrics yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid g2">
        <div className="card stack">
          <h2>Link in bio</h2>
          {bio ? (
            <>
              <p>Put these in your bios. Each one always redirects to your newest video's tracked link and counts the click.</p>
              <div className="stack" style={{ gap: 6 }}>
                <div>TikTok: <code>{bio}/go?p=tiktok</code></div>
                <div>Instagram: <code>{bio}/go?p=instagram</code></div>
              </div>
              <p className="small muted">{fmtNum(totalClicks)} clicks recorded.</p>
            </>
          ) : (
            <p className="muted">Set <Link href="/settings">Dashboard public URL</Link> to get bio links that track which video drove each click.</p>
          )}
        </div>
        <div className="card"><h2>Import installs</h2><AttributionForm /></div>
      </div>
    </div>
  );
}
