"use client";

import { useActionState } from "react";
import { login } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="next" value={next} />
      <label className="f">
        Password
        <input type="password" name="password" autoFocus required autoComplete="current-password" />
      </label>
      {state && !state.ok && <div className="msg bad">{state.message}</div>}
      <button className="btn primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
