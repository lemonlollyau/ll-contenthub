import { requireUser } from "@/lib/auth";
import { db, must } from "@/lib/db";
import { maskSecret } from "@/lib/crypto";
import type { Client, PushConnection } from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { ConnectionsEditor } from "./connections-editor";

export default async function ConnectionsPage() {
  const user = await requireUser();
  const connections = must(await db().from("push_connections").select("*").order("name"), "load connections") as PushConnection[];
  const clients = must(await db().from("clients").select("id, name, channels").order("name"), "load clients") as Pick<Client, "id" | "name" | "channels">[];

  const usage = connections.map((c) => ({
    id: c.id,
    clients: clients.filter((cl) => (cl.channels ?? []).some((ch) => ch.connectionId === c.id)).map((cl) => cl.name),
  }));

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">Connections</h1>
      <p className="mt-1 max-w-2xl text-sm text-stone-500">
        Each connection is one Buffer account or ContentStudio workspace. Add a key once here, then map a client&apos;s channels
        to whichever connections they live in: a client can have Instagram in your agency Buffer and LinkedIn in their own
        ContentStudio at the same time.
      </p>
      <ConnectionsEditor
        connections={connections.map((c) => ({
          id: c.id,
          name: c.name,
          provider: c.provider,
          workspaceId: c.workspace_id,
          workspaceTz: c.workspace_tz,
          masked: maskSecret(c.api_key_enc) ?? "saved",
          usedBy: usage.find((u) => u.id === c.id)?.clients ?? [],
        }))}
      />
    </AppShell>
  );
}
