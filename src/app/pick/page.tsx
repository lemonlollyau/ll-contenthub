import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { listClients } from "@/lib/clients";
import { Picker } from "./picker";

export const metadata: Metadata = {
  title: "Pick photos · Content Hub",
  appleWebApp: { capable: true, title: "Pick", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fafaf9",
};

/**
 * Phone page: choose a client and calendar post, pick photos from the client's
 * Drive library or the camera roll, and send them to the Content Studio
 * extension's inbox to design later. Add to Home Screen to use it like an app.
 */
export default async function PickPage() {
  await requireUser();
  const clients = (await listClients()).map((c) => ({ id: c.id, name: c.name }));
  const last = (await cookies()).get("pick_client")?.value;
  const initialClientId = clients.some((c) => c.id === last) ? last! : clients[0]?.id ?? "";
  return <Picker clients={clients} initialClientId={initialClientId} />;
}
