import Link from "next/link";
import type { VideoStatus } from "worker/types";
import { getRepo } from "@/lib/server";
import { ago, scoreBadge, videoUrl } from "@/lib/view";
import { templateLabel } from "../../components/VideoReview";

const TABS: { id: VideoStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "review", label: "In review" },
  { id: "approved", label: "Approved" },
  { id: "posted", label: "Posted" },
  { id: "rejected", label: "Rejected" },
];

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = "all" } = await searchParams;
  const repo = getRepo();
  const videos = await repo.listVideos({ status: status === "all" ? undefined : (status as VideoStatus), limit: 120 });
  const urls = await Promise.all(videos.map((v) => videoUrl(repo, v.storage_path)));
  return (
    <div>
      <h1>Library</h1>
      <p className="sub">Every video the pipeline has made, with versions.</p>
      <div className="tabs">
        {TABS.map((t) => (
          <Link key={t.id} href={t.id === "all" ? "/library" : `/library?status=${t.id}`} className={status === t.id ? "on" : ""}>{t.label}</Link>
        ))}
      </div>
      {videos.length === 0 && <div className="card muted">No videos here yet.</div>}
      <div className="thumbs">
        {videos.map((v, i) => (
          <Link key={v.id} href={`/library/${v.id}`} className="thumb">
            {urls[i] ? <video src={`${urls[i]}#t=1`} muted playsInline preload="metadata" /> : <div className="card muted">no render</div>}
            <div className="t">{v.title}</div>
            <div className="row small muted" style={{ gap: 6 }}>
              <span className="badge">{v.status}</span>
              <span>{templateLabel(v.template)}</span>
              {v.version > 1 && <span>v{v.version}</span>}
              {v.quality_score != null && <span className={`badge ${scoreBadge(v.quality_score)}`}>{v.quality_score.toFixed(1)}</span>}
              <span>{ago(v.created_at)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
