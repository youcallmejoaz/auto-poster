"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AssetKind } from "worker/types";
import { finishAssetUpload, prepareAssetUpload } from "../actions";

/** Uploads straight from the browser to storage via a signed URL (no server size limits). */
export function Uploader() {
  const router = useRouter();
  const [kind, setKind] = useState<AssetKind>("app_demo");
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const prep = await prepareAssetUpload(kind, file.name, file.type);
      if ("error" in prep) throw new Error(prep.error);
      const res = await fetch(prep.url, { method: "PUT", headers: { "content-type": file.type, "x-upsert": "false" }, body: file });
      if (!res.ok) throw new Error(`Upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      await finishAssetUpload(kind, label.trim(), prep.path, file.type);
      setStatus({ ok: true, message: "Uploaded." });
      setFile(null);
      setLabel("");
      router.refresh();
    } catch (e) {
      setStatus({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="grid g3">
        <label className="f">
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>
            <option value="app_demo">App screen recording</option>
            <option value="screenshot">App screenshot</option>
            <option value="broll">B-roll (background footage)</option>
          </select>
        </label>
        <label className="f">
          Label
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. PDF → flashcards" />
        </label>
        <label className="f">
          File
          <input type="file" accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      <div className="row">
        <button className="btn primary" onClick={upload} disabled={!file || busy}>{busy ? "Uploading…" : "Upload"}</button>
        {status && <span className={`msg ${status.ok ? "ok" : "bad"}`}>{status.message}</span>}
      </div>
    </div>
  );
}
