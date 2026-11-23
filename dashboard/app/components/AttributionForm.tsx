"use client";

import { useActionState } from "react";
import { importAttribution } from "../actions";

export function AttributionForm() {
  const [state, action, pending] = useActionState(importAttribution, null);
  return (
    <form action={action} className="stack">
      <label className="f">
        Paste installs per link
        <span className="help">CSV with columns like <code>utm_content,clicks,installs</code> (Branch/AppsFlyer export) or App Store Connect campaign rows (<code>ss_xxxx</code> codes work). JSON <code>{`{"code": {"installs": 3}}`}</code> also works.</span>
        <textarea name="data" rows={5} placeholder={"utm_content,clicks,installs\n1a2b3c4d5e,120,9"} />
      </label>
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Importing…" : "Import"}</button>
        {state && <span className={`msg ${state.ok ? "ok" : "bad"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
