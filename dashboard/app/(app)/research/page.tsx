import { researchScore } from "worker/research";
import { getConfig, getRepo } from "@/lib/server";
import { ago, fmtNum } from "@/lib/view";
import { templateLabel } from "../../components/VideoReview";

export default async function ResearchPage() {
  const repo = getRepo();
  const cfg = await getConfig();
  const [insights, items] = await Promise.all([repo.topInsights(20, 30), repo.recentResearch(30)]);
  const top = [...items].sort((a, b) => researchScore(b) - researchScore(a)).slice(0, 30);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h1>Research</h1>
        <p className="sub">What's working in the niche right now. Tracking #{cfg.NICHE_HASHTAGS.split(",").join(" #")}{cfg.COMPETITOR_ACCOUNTS ? ` and @${cfg.COMPETITOR_ACCOUNTS.split(",").join(", @")}` : ""}.</p>
      </div>
      <div className="card">
        <h2>Winning patterns</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Pattern</th><th>Hook</th><th>Template</th><th>CTA style</th><th className="num">Evidence</th></tr></thead>
            <tbody>
              {insights.map((i) => (
                <tr key={i.id}>
                  <td>{i.pattern}<div className="small muted">{i.topic} · {ago(i.created_at)}</div></td>
                  <td>{i.hook_type}</td>
                  <td>{templateLabel(i.format)}</td>
                  <td>{i.cta_style}</td>
                  <td className="num"><span className={`badge ${i.evidence_score >= 0.75 ? "ok" : i.evidence_score >= 0.5 ? "warn" : ""}`}>{Math.round(i.evidence_score * 100)}%</span></td>
                </tr>
              ))}
              {!insights.length && <tr><td colSpan={5} className="muted">No insights yet. Run Research (needs an Apify token, or import a CSV with the CLI).</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2>Top niche posts (30 days)</h2>
        <p className="small muted">Ranked by how far each post beat its account's follower count, blended with engagement, so big accounts don't win just for being big.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Post</th><th className="num">Views</th><th className="num">Followers</th><th className="num">Likes</th><th className="num">Shares</th><th className="num">Score</th></tr></thead>
            <tbody>
              {top.map((r) => (
                <tr key={r.url}>
                  <td style={{ maxWidth: 520 }}>
                    <a href={r.url} target="_blank" rel="noreferrer">{r.hook_text || r.caption?.slice(0, 90) || r.url}</a>
                    <div className="small muted">{r.platform} · @{r.author ?? "?"} · {ago(r.posted_at)}</div>
                  </td>
                  <td className="num">{fmtNum(r.views)}</td>
                  <td className="num">{fmtNum(r.author_followers)}</td>
                  <td className="num">{fmtNum(r.likes)}</td>
                  <td className="num">{fmtNum(r.shares)}</td>
                  <td className="num">{researchScore(r).toFixed(2)}</td>
                </tr>
              ))}
              {!top.length && <tr><td colSpan={6} className="muted">No research data yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
