import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/server";
import { ago, fmtNum, videoUrl } from "@/lib/view";
import { VideoReview } from "../../../components/VideoReview";
import { setVideoStatus } from "../../../actions";

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = getRepo();
  const v = await repo.getVideo(id);
  if (!v) notFound();
  const [posts, all] = await Promise.all([repo.postsForVideo(id), repo.listVideos({ limit: 500 })]);
  const metrics = await repo.latestMetrics(posts.map((p) => p.id!));
  const url = await videoUrl(repo, v.storage_path);
  // Version chain: walk up to the root, then everything descending from it.
  let root = v;
  while (root.parent_video_id) {
    const p = all.find((x) => x.id === root.parent_video_id);
    if (!p) break;
    root = p;
  }
  const family = all.filter((x) => x.id === root.id || descendsFrom(x, root.id!, all)).sort((a, b) => a.version - b.version);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Link href="/library" className="small">← Library</Link>
      <VideoReview v={v} url={url} showActions={v.status === "review"} />

      <div className="row">
        <span className="muted small">Status: <span className="badge">{v.status}</span></span>
        {v.status === "approved" && <form action={setVideoStatus.bind(null, id, "review")}><button className="btn sm">Move back to review</button></form>}
        {v.status === "rejected" && <form action={setVideoStatus.bind(null, id, "review")}><button className="btn sm">Restore to review</button></form>}
        {v.review_note && <span className="small muted">Note: {v.review_note}</span>}
      </div>

      <div className="card">
        <h2>Posts</h2>
        {posts.length === 0 ? <p className="muted">Not posted yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Platform</th><th>Posted</th><th className="num">Views</th><th className="num">Likes</th><th className="num">Shares</th><th className="num">Saves</th><th className="num">Installs</th><th>Tracked link</th></tr></thead>
              <tbody>
                {posts.map((p) => {
                  const m = metrics.get(p.id!);
                  return (
                    <tr key={p.id}>
                      <td>{p.platform}</td>
                      <td className="muted">{ago(p.posted_at)}</td>
                      <td className="num">{fmtNum(m?.views)}</td>
                      <td className="num">{fmtNum(m?.likes)}</td>
                      <td className="num">{fmtNum(m?.shares)}</td>
                      <td className="num">{fmtNum(m?.saves)}</td>
                      <td className="num">{fmtNum(m?.installs)}</td>
                      <td><code>{p.tracked_link}</code></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {family.length > 1 && (
        <div className="card">
          <h2>Versions</h2>
          <div className="stack" style={{ gap: 6 }}>
            {family.map((f) => (
              <div key={f.id} className="row">
                <span className="badge">v{f.version}</span>
                {f.id === v.id ? <strong>{f.title}</strong> : <Link href={`/library/${f.id}`}>{f.title}</Link>}
                <span className="small muted">{f.status} · {ago(f.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function descendsFrom(v: { parent_video_id?: string | null }, rootId: string, all: { id?: string; parent_video_id?: string | null }[]): boolean {
  let cur = v;
  for (let i = 0; i < 20 && cur.parent_video_id; i++) {
    if (cur.parent_video_id === rootId) return true;
    const next = all.find((x) => x.id === cur.parent_video_id);
    if (!next) return false;
    cur = next;
  }
  return false;
}
