import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { AppShell } from "@/components/app-shell";
import { PROVIDER_LABEL } from "@/lib/types";

const tabs = (providerLabel: string) => [
  { href: "", label: "Calendar" },
  { href: "/review", label: "Review imagery" },
  { href: "/library", label: "Library" },
  { href: "/push", label: `Push to ${providerLabel}` },
  { href: "/settings", label: "Settings" },
];

export default async function ClientLayout({ children, params }: LayoutProps<"/clients/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const client = await getClient(id);
  return (
    <AppShell user={user}>
      <p className="text-sm text-stone-500">
        <Link href="/clients" className="hover:underline">Clients</Link> /
      </p>
      <h1 className="text-2xl font-semibold">{client.name}</h1>
      <nav className="mt-4 flex gap-1 border-b border-stone-200 text-sm">
        {tabs(PROVIDER_LABEL[client.push_provider] ?? "Buffer").map((t) => (
          <Link key={t.href} href={`/clients/${id}${t.href}`} className="rounded-t-lg px-3 py-2 text-stone-600 hover:bg-white hover:text-stone-900">
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="pt-6">{children}</div>
    </AppShell>
  );
}
