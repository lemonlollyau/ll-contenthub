import Link from "next/link";
import type { AppUser } from "@/lib/auth";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/clients", label: "Clients" },
  { href: "/pick", label: "Pick photos" },
  { href: "/logs", label: "Activity log" },
];

export function AppShell({ user, children }: { user: AppUser; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <Link href="/" className="font-semibold">
            <span className="text-amber-600">lemonlolly</span> Content Hub
          </Link>
          <nav className="flex gap-4 text-sm text-stone-600">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-stone-900">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-stone-500">
            <span>{user.email}</span>
            <form action="/auth/signout" method="post">
              <button className="rounded-md border border-stone-200 px-2 py-1 hover:bg-stone-100">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
