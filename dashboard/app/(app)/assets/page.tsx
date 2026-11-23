import type { Asset } from "worker/types";
import { getRepo } from "@/lib/server";
import { ago } from "@/lib/view";
import { deleteAsset } from "../../actions";
import { Uploader } from "../../components/Uploader";

const SECTIONS: { kind: Asset["kind"]; title: string; help: string }[] = [
  { kind: "app_demo", title: "App screen recordings", help: "Used by the App demo template (shown in a phone frame) and on CTA end cards. Vertical, 10–40s, no personal data on screen. Recordings loop if the video is longer." },
  { kind: "screenshot", title: "App screenshots", help: "Used on CTA end cards when there's no recording." },
  { kind: "broll", title: "B-roll", help: "Background footage (desk, library, laptop, handwriting) behind listicle, POV and study-hack videos. Darkened automatically. Only upload footage you own or have licensed." },
];

export default async function AssetsPage() {
  const repo = getRepo();
  const assets = await repo.listAssets();
  const urls = new Map(await Promise.all(assets.map(async (a) => [a.id!, await repo.signedAssetUrl(a.storage_path, 3600)] as const)));
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h1>Media</h1>
        <p className="sub">Real footage of your app is the biggest quality upgrade. The creator picks from these automatically.</p>
      </div>
      <div className="card"><h2>Upload</h2><Uploader /></div>
      {SECTIONS.map((s) => {
        const items = assets.filter((a) => a.kind === s.kind);
        return (
          <div key={s.kind} className="card">
            <h2>{s.title} ({items.length})</h2>
            <p className="small muted">{s.help}</p>
            <div className="thumbs" style={{ marginTop: 12 }}>
              {items.map((a) => (
                <div key={a.id} className="thumb">
                  {a.content_type.startsWith("video") ? (
                    <video src={urls.get(a.id!)} muted playsInline controls preload="metadata" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={urls.get(a.id!)} alt={a.label} style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", borderRadius: 10 }} />
                  )}
                  <div className="t">{a.label}</div>
                  <div className="row between small muted">
                    <span>{ago(a.created_at)}</span>
                    <form action={deleteAsset.bind(null, a.id!)}><button className="btn sm danger">Delete</button></form>
                  </div>
                </div>
              ))}
              {!items.length && <p className="muted">None yet.</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
