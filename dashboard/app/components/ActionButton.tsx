"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "../actions";

/** Button that runs a server action returning {ok, message} and shows the result inline. */
export function ActionButton({ run, label, className = "btn", pendingLabel }: { run: () => Promise<ActionResult>; label: string; className?: string; pendingLabel?: string }) {
  const [res, setRes] = useState<ActionResult>(null);
  const [pending, start] = useTransition();
  return (
    <span className="stack" style={{ gap: 6, display: "inline-flex" }}>
      <button type="button" className={className} disabled={pending} onClick={() => start(async () => setRes(await run()))}>
        {pending ? pendingLabel ?? "Working…" : label}
      </button>
      {res && <span className={`msg ${res.ok ? "ok" : "bad"}`}>{res.message}</span>}
    </span>
  );
}
