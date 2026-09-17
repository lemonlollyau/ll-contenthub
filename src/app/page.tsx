import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export default async function Home() {
  const user = await requireUser();
  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">G&apos;day 👋</h1>
      <p className="mt-2 text-stone-600">Pick a client to import a calendar, match imagery and push to Buffer.</p>
      <Link
        href="/clients"
        className="mt-6 inline-block rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
      >
        Go to clients
      </Link>
    </AppShell>
  );
}
