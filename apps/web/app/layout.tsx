import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "lifeagent",
  description: "AI accountability dashboard",
};

const NAV: Array<{ href: string; label: string }> = [
  { href: "/", label: "today" },
  { href: "/week", label: "week" },
  { href: "/history", label: "history" },
  { href: "/memory", label: "memory" },
  { href: "/settings", label: "settings" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-zinc-800 px-6 py-4">
          <div className="mx-auto flex max-w-5xl items-center justify-between">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              lifeagent
            </Link>
            <nav className="flex gap-4 text-sm text-zinc-400">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-zinc-100">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
