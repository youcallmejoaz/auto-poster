"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "../actions";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/review", label: "Review" },
  { href: "/library", label: "Library" },
  { href: "/briefs", label: "Briefs" },
  { href: "/research", label: "Research" },
  { href: "/analytics", label: "Analytics" },
  { href: "/assets", label: "Media" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ reviewCount, demo }: { reviewCount: number; demo: boolean }) {
  const path = usePathname();
  return (
    <nav className="nav">
      <div className="brand">🎬 StudyShorts</div>
      {LINKS.map((l) => {
        const on = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={on ? "active" : ""}>
            {l.label}
            {l.href === "/review" && reviewCount > 0 && <span className="badge accent">{reviewCount}</span>}
          </Link>
        );
      })}
      <div className="spacer" />
      {!demo && (
        <form action={logout}>
          <button className="btn sm" style={{ width: "100%" }}>Log out</button>
        </form>
      )}
    </nav>
  );
}
