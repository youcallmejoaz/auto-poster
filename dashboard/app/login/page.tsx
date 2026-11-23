import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <div className="card" style={{ width: "100%", maxWidth: 360 }}>
        <h1>🎬 StudyShorts</h1>
        <p className="sub">Sign in to the control room.</p>
        <LoginForm next={next ?? "/"} />
      </div>
    </div>
  );
}
