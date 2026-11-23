import "./globals.css";
import type { Metadata } from "next";
import { isDemo } from "@/lib/session";

export const metadata: Metadata = { title: "StudyShorts", description: "Short-video pipeline control room" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {isDemo() && <div className="demo-banner">Demo mode: sample data. Changes last until the server restarts and nothing is posted.</div>}
        {children}
      </body>
    </html>
  );
}
