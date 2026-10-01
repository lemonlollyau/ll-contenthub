import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getClient, listClients } from "@/lib/clients";
import { db } from "@/lib/db";
import { libraryFolders, libraryStats, openPicks, postPhotos, todayIn, upcomingPosts } from "@/lib/studio";
import { Board, type BoardJob } from "./board";

export const metadata: Metadata = {
  title: "Content · lemonlolly",
  appleWebApp: { capable: true, title: "Content", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fafaf9",
};

/**
 * Phone page: scroll a client's upcoming posts with the photo attached to
 * each, approve it or swap it for another from the client's Drive library.
 * Add to Home Screen to use it like an app.
 */
export default async function PhonePage() {
  await requireUser();
  const clients = (await listClients()).map((c) => ({ id: c.id, name: c.name }));
  const last = (await cookies()).get("pick_client")?.value;
  const clientId = clients.some((c) => c.id === last) ? last! : clients[0]?.id;
  if (!clientId) return <p className="p-6">Add a client in Content Hub first.</p>;

  const client = await getClient(clientId);
  const since = new Date(Date.parse(todayIn(client.timezone)) - 86400_000).toISOString();
  const posts = await upcomingPosts(client);
  const [photos, folders, stats, picks, jobsRes] = await Promise.all([
    postPhotos(posts.map((p) => p.id)),
    libraryFolders(client.id),
    libraryStats(client.id),
    // Phone uploads need migration 0004; don't let a missing table blank the page.
    openPicks(client.id).catch((err) => {
      console.error("photo picks unavailable", err);
      return [];
    }),
    db()
      .from("jobs")
      .select("id, kind, status, total, done, message, error, created_at")
      .eq("client_id", client.id)
      .in("kind", ["drive_index", "ai_analyse", "match"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(6),
  ]);
  // The newest job of each kind, if it's still going or stopped with an error.
  const seen = new Set<string>();
  const jobs = ((jobsRes.data ?? []) as BoardJob[]).filter((j) => {
    if (seen.has(j.kind)) return false;
    seen.add(j.kind);
    return ["queued", "running", "failed"].includes(j.status);
  });

  return (
    <Board
      key={client.id}
      clients={clients}
      clientId={client.id}
      hasDrive={!!client.drive_folder_id}
      posts={posts.map((p) => ({ ...p, photos: photos[p.id] ?? [], phonePicks: picks.filter((k) => k.postId === p.id) }))}
      folders={folders}
      stats={stats}
      jobs={jobs}
    />
  );
}
