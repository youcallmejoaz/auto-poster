import { Nav } from "../components/Nav";
import { getRepo, SetupError } from "@/lib/server";
import { isDemo } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let reviewCount = 0;
  let setupError: string | null = null;
  try {
    reviewCount = (await getRepo().videosByStatus("review", 200)).length;
  } catch (e) {
    setupError = e instanceof SetupError ? e.message : `Can't reach the database: ${(e as Error).message}. Did you run the SQL migrations?`;
  }
  return (
    <div className="shell">
      <Nav reviewCount={reviewCount} demo={isDemo()} />
      <main className="main">
        {setupError ? (
          <div className="card stack">
            <h1>Setup needed</h1>
            <p className="muted">{setupError}</p>
            <p className="small muted">See the README → “Dashboard” for the four environment variables the dashboard needs.</p>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
