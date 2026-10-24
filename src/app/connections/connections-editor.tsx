"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteConnection, fetchAllChannels, saveConnection, setConnectionWorkspace, type ConnectionChannels } from "../clients/actions";
import { ActionForm, Field, Result, inputClass } from "@/components/ui/form";

type View = {
  id: string;
  name: string;
  provider: string;
  workspaceId: string | null;
  workspaceTz: string | null;
  masked: string;
  usedBy: string[];
};

export function ConnectionsEditor({ connections }: { connections: View[] }) {
  const [adding, setAdding] = useState(connections.length === 0);
  const [checked, setChecked] = useState<ConnectionChannels[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function testAll() {
    start(async () => {
      try {
        setChecked(await fetchAllChannels());
        setError(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't reach the APIs");
      }
    });
  }

  function remove(id: string, name: string) {
    start(async () => {
      try {
        await deleteConnection(id);
        router.refresh();
      } catch (e) {
        setError(`${name}: ${e instanceof Error ? e.message : "couldn't delete"}`);
      }
    });
  }

  return (
    <div className="mt-6 max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={testAll} disabled={pending} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-100 disabled:opacity-50">
          {pending ? "Checking…" : "Test all connections"}
        </button>
        {!adding && (
          <button onClick={() => setAdding(true)} className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white">
            Add connection
          </button>
        )}
        {error && <span className="text-sm text-red-700">{error}</span>}
      </div>

      {connections.map((c) => {
        const result = checked?.find((x) => x.connectionId === c.id);
        return (
          <section key={c.id} className="rounded-2xl border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{c.name}</h2>
              <span className="rounded bg-stone-100 px-2 text-xs capitalize">{c.provider}</span>
              <span className="font-mono text-xs text-stone-500">{c.masked}</span>
              <button onClick={() => remove(c.id, c.name)} disabled={pending} className="ml-auto text-sm text-stone-400 hover:text-red-700">
                Delete
              </button>
            </div>
            <p className="mt-1 text-xs text-stone-500">
              {c.usedBy.length ? `Used by ${c.usedBy.join(", ")}` : "Not used by any client yet"}
              {c.workspaceTz ? ` · workspace timezone ${c.workspaceTz}` : ""}
            </p>

            {result && (
              <div className="mt-2 text-sm">
                {result.error ? (
                  <p className="rounded bg-red-50 p-2 text-red-700">{result.error}</p>
                ) : (
                  <>
                    <p className="text-green-700">✓ {result.channels.length} channel(s) found</p>
                    {result.workspaces && result.workspaces.length > 1 && (
                      <WorkspacePicker connectionId={c.id} current={c.workspaceId} workspaces={result.workspaces} />
                    )}
                    <p className="mt-1 text-xs text-stone-500">
                      {result.channels.map((ch) => `${ch.platform}: ${ch.channelName}${ch.note ? ` (${ch.note})` : ""}`).join(" · ")}
                    </p>
                  </>
                )}
              </div>
            )}

            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-stone-500">Rename or replace the key</summary>
              <div className="mt-2">
                <ConnectionForm connection={c} />
              </div>
            </details>
          </section>
        );
      })}

      {adding && (
        <section className="rounded-2xl border-2 border-amber-300 bg-white p-4">
          <h2 className="font-semibold">New connection</h2>
          <p className="mb-3 text-xs text-stone-500">
            Buffer: Settings → API → create a key (one key covers that whole Buffer account).
            ContentStudio: sidebar → API → Generate API Key.
          </p>
          <ConnectionForm onDone={() => setAdding(false)} />
        </section>
      )}
    </div>
  );
}

function ConnectionForm({ connection, onDone }: { connection?: View; onDone?: () => void }) {
  return (
    <ActionForm
      action={async (prev, formData) => {
        const r = await saveConnection(prev, formData);
        if (r?.ok) onDone?.();
        return r;
      }}
      submitLabel={connection ? "Save" : "Add connection"}
    >
      {connection && <input type="hidden" name="id" value={connection.id} />}
      <Field label="Name" hint="How you'll recognise it, e.g. &quot;lemonlolly Buffer&quot; or &quot;Fringe Heals ContentStudio&quot;.">
        <input name="name" defaultValue={connection?.name} required className={inputClass} />
      </Field>
      <Field label="Service">
        <select name="provider" defaultValue={connection?.provider ?? "buffer"} className={inputClass}>
          <option value="buffer">Buffer</option>
          <option value="contentstudio">ContentStudio</option>
        </select>
      </Field>
      <Field label={connection ? "Replace API key (leave blank to keep)" : "API key"} hint="Stored encrypted. It never leaves the server.">
        <input name="api_key" type="password" autoComplete="off" className={inputClass} />
      </Field>
    </ActionForm>
  );
}

function WorkspacePicker({
  connectionId, current, workspaces,
}: {
  connectionId: string;
  current: string | null;
  workspaces: { id: string; name: string; timezone?: string }[];
}) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <label className="mt-2 flex items-center gap-2 text-sm">
      <span>Workspace</span>
      <select
        defaultValue={current ?? ""}
        disabled={pending}
        onChange={(e) => {
          const w = workspaces.find((x) => x.id === e.target.value);
          start(async () => setResult(await setConnectionWorkspace(connectionId, e.target.value, w?.timezone ?? null)));
        }}
        className={inputClass}
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>{w.name}{w.timezone ? ` · ${w.timezone}` : ""}</option>
        ))}
      </select>
      <Result result={result} />
    </label>
  );
}
