/** Triggers the pipeline workflow (workflow_dispatch) so the dashboard's Run buttons work. */
export const STAGES = ["research", "create", "publish", "analytics", "tokens", "supervisor"] as const;
export type StageName = (typeof STAGES)[number];

export async function dispatchStage(repo: string, token: string, stage: StageName, ref = "main") {
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/pipeline.yml/dispatches`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28" },
    body: JSON.stringify({ ref, inputs: { stage } }),
  });
  if (res.status !== 204) throw new Error(`GitHub dispatch failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
}
