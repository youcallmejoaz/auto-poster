import { getConfig, getRepo } from "@/lib/server";
import { videoUrl } from "@/lib/view";
import { VideoReview } from "../../components/VideoReview";

export default async function ReviewPage() {
  const repo = getRepo();
  const cfg = await getConfig();
  const videos = await repo.videosByStatus("review", 50);
  const urls = await Promise.all(videos.map((v) => videoUrl(repo, v.storage_path)));
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h1>Review</h1>
        <p className="sub">
          Approved videos post automatically at {cfg.POST_SLOTS_UTC} UTC (max {cfg.DAILY_POST_CAP}/day).{" "}
          {cfg.AUTO_APPROVE ? `Auto-approve is ON for scores ≥ ${cfg.QUALITY_THRESHOLD}; only lower scorers land here.` : "Auto-approve is off, so every video waits for you."}
        </p>
      </div>
      {videos.length === 0 && <div className="card muted">Nothing to review. New videos appear here after each create run.</div>}
      {videos.map((v, i) => <VideoReview key={v.id} v={v} url={urls[i]} />)}
    </div>
  );
}
