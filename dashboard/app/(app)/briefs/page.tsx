import Link from "next/link";
import type { Brief } from "worker/types";
import { getRepo } from "@/lib/server";
import { ago } from "@/lib/view";
import { setBriefStatus } from "../../actions";
import { BriefForm } from "../../components/BriefForm";
import { templateLabel } from "../../components/VideoReview";

const ORIGIN: Record<Brief["origin"], string> = { research: "Research", analytics: "Analytics", manual: "You", rejection: "Rejection" };

export default async function BriefsPage() {
  const repo = getRepo();
  const [open, active, done] = await Promise.all([repo.listBriefs("open"), repo.listBriefs("in_progress"), repo.listBriefs("done", 20)]);
  const list = (items: Brief[], showDrop: boolean) => (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Brief</th><th>From</th><th>Template</th><th className="num">Priority</th><th>Created</th>{showDrop && <th />}</tr></thead>
        <tbody>
          {items.map((b) => (
            <tr key={b.id}>
              <td style={{ whiteSpace: "pre-wrap", maxWidth: 560 }}>
                {b.instruction}
                {b.parent_video_id && <div className="small"><Link href={`/library/${b.parent_video_id}`}>edits an existing video →</Link></div>}
              </td>
              <td><span className="badge">{ORIGIN[b.origin]}</span></td>
              <td>{b.template ? templateLabel(b.template) : <span className="muted">any</span>}</td>
              <td className="num">{b.priority}</td>
              <td className="muted">{ago(b.created_at)}</td>
              {showDrop && (
                <td>
                  <form action={setBriefStatus.bind(null, b.id!, "dropped")}><button className="btn sm">Drop</button></form>
                </td>
              )}
            </tr>
          ))}
          {!items.length && <tr><td colSpan={6} className="muted">None.</td></tr>}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h1>Briefs</h1>
        <p className="sub">The creator works through these, highest priority first. Research, analytics and your rejections add to the queue automatically.</p>
      </div>
      <div className="card"><h2>New brief</h2><BriefForm /></div>
      <div className="card"><h2>Queued ({open.length})</h2>{list(open, true)}</div>
      {active.length > 0 && <div className="card"><h2>Being made now</h2>{list(active, false)}</div>}
      <div className="card"><h2>Recently done</h2>{list(done, false)}</div>
    </div>
  );
}
