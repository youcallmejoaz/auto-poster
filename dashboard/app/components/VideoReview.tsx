import type { Video } from "worker/types";
import { TEMPLATE_IDS } from "renderer/schema";
import { approveVideo, rejectVideo, requestEdit, updateCaption } from "../actions";
import { scoreBadge } from "@/lib/view";

const TEMPLATE_LABEL: Record<string, string> = { listicle: "Listicle", pov: "POV", studyHack: "Study hack", appDemo: "App demo" };
export const templateLabel = (t: string) => TEMPLATE_LABEL[t] ?? t;

type Critique = { score: number; hook_score?: number; readability_score?: number; issues?: string[]; revision_instructions?: string };

export function VideoReview({ v, url, showActions = true }: { v: Video; url: string | null; showActions?: boolean }) {
  const c = (v.critique ?? null) as Critique | null;
  return (
    <div className="card video-card">
      <div>{url ? <video src={url} controls playsInline preload="metadata" /> : <div className="muted">Not rendered</div>}</div>
      <div className="stack" style={{ minWidth: 0 }}>
        <div className="row between">
          <div className="row">
            <strong style={{ fontSize: 16 }}>{v.title}</strong>
            <span className="badge">{templateLabel(v.template)}</span>
            {v.version > 1 && <span className="badge accent">v{v.version}</span>}
          </div>
          {v.quality_score != null && <span className={`badge ${scoreBadge(v.quality_score)}`}>AI score {v.quality_score.toFixed(1)}/10</span>}
        </div>

        {c?.issues && c.issues.length > 0 && (
          <div className="small">
            <span className="muted">Critic notes: </span>
            {c.issues.join(" · ")}
          </div>
        )}

        <details>
          <summary>Script</summary>
          <ol className="small" style={{ margin: "8px 0", paddingLeft: 18 }}>
            <li><strong>Hook:</strong> {v.script.hook.onScreen ?? v.script.hook.narration}</li>
            {v.script.beats.map((b, i) => <li key={i}>{b.onScreen ?? b.narration} <span className="muted">— “{b.narration}”</span></li>)}
            <li><strong>CTA:</strong> {v.script.cta.onScreen ?? v.script.cta.narration}</li>
          </ol>
        </details>

        <form action={updateCaption.bind(null, v.id!)} className="stack" style={{ gap: 6 }}>
          <label className="f">Caption<textarea name="caption" defaultValue={v.caption} rows={2} /></label>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input name="hashtags" defaultValue={v.hashtags.map((h) => `#${h}`).join(" ")} aria-label="Hashtags" />
            <button className="btn sm">Save caption</button>
          </div>
        </form>

        {showActions && (
          <div className="row" style={{ alignItems: "flex-start", marginTop: 4 }}>
            <form action={approveVideo.bind(null, v.id!)}>
              <button className="btn primary">✓ Approve</button>
            </form>
            <details>
              <summary className="btn">Request edit</summary>
              <form action={requestEdit.bind(null, v.id!)} className="stack" style={{ marginTop: 8, minWidth: 280 }}>
                <textarea name="note" placeholder="e.g. faster hook, swap beat 2 for a stat, finals-week angle" required />
                <select name="template" defaultValue={v.template}>
                  {TEMPLATE_IDS.map((t) => <option key={t} value={t}>{templateLabel(t)}</option>)}
                </select>
                <button className="btn sm">Queue new version</button>
              </form>
            </details>
            <details>
              <summary className="btn danger">Reject</summary>
              <form action={rejectVideo.bind(null, v.id!)} className="stack" style={{ marginTop: 8, minWidth: 280 }}>
                <textarea name="note" placeholder="What's wrong? (also used for the recut)" />
                <label className="check"><input type="checkbox" name="recut" defaultChecked /> Queue a recut with this note</label>
                <button className="btn sm danger">Reject</button>
              </form>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
