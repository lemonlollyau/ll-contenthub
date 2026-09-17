import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listClients } from "@/lib/clients";
import { AppShell } from "@/components/app-shell";
import { createClientAction } from "./actions";
import { inputClass } from "@/components/ui/form";

export default async function ClientsPage() {
  const user = await requireUser();
  const clients = await listClients();
  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">Clients</h1>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((c) => (
          <Link key={c.id} href={`/clients/${c.id}`} className="rounded-xl border border-stone-200 bg-white p-4 hover:border-amber-400">
            <p className="font-medium">{c.name}</p>
            <p className="mt-1 text-xs text-stone-500">
              {c.drive_folder_id ? "Drive connected" : "No Drive folder"} · {c.buffer_api_key_enc ? "Buffer key saved" : "No Buffer key"}
            </p>
          </Link>
        ))}
        {clients.length === 0 && <p className="text-sm text-stone-500">No clients yet. Add your first one below.</p>}
      </div>
      <form action={createClientAction} className="mt-8 flex max-w-md gap-2">
        <input name="name" required placeholder="Client name, e.g. Fringe Heals" className={inputClass} />
        <button className="shrink-0 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700">Add client</button>
      </form>
    </AppShell>
  );
}
