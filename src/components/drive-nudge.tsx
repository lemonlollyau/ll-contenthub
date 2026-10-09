"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Check = { ok: boolean; message?: string; total?: number; added?: number; changed?: number; removed?: number; inLibrary?: number; lastSync?: string | null };

/**
 * Quietly checks Drive against the library and only says something when there's
 * something to do. Runs after the page renders, so it never slows it down.
 */
export function DriveNudge({ clientId, syncHere }: { clientId: string; syncHere?: boolean }) {
  const [check, setCheck] = useState<Check | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/clients/${clientId}/drive-check`)
      .then((r) => r.json())
      .then((d) => live && setCheck(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [clientId]);

  if (!check) return null;
  if (!check.ok) {
    return <p className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">Couldn&apos;t check Drive: {check.message}</p>;
  }
  const added = check.added ?? 0;
  const changed = check.changed ?? 0;
  const removed = check.removed ?? 0;
  if (!added && !changed && !removed) return null;

  const bits = [
    added && `${added} new file${added === 1 ? "" : "s"}`,
    changed && `${changed} changed`,
    removed && `${removed} no longer in Drive`,
  ].filter(Boolean) as string[];

  return (
    <div className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <b>Drive has {bits.join(", ")}.</b>{" "}
      {syncHere ? (
        <>Click <b>Sync from Drive</b> below to bring them in, and leave the page open while it runs.</>
      ) : (
        <Link href={`/clients/${clientId}/library`} className="underline">
          Sync the library →
        </Link>
      )}
    </div>
  );
}
