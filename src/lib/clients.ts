import "server-only";
import { notFound } from "next/navigation";
import { db, must } from "./db";
import type { BrandProfile, Client } from "./types";

export async function listClients(): Promise<Client[]> {
  return must(await db().from("clients").select("*").order("name"), "load clients") as Client[];
}

export async function getClient(id: string): Promise<Client> {
  const { data, error } = await db().from("clients").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Couldn't load client: ${error.message}`);
  if (!data) notFound();
  return data as Client;
}

export async function getBrandProfile(clientId: string): Promise<BrandProfile> {
  const { data } = await db().from("brand_profiles").select("*").eq("client_id", clientId).maybeSingle();
  return (data as BrandProfile) ?? {
    client_id: clientId,
    voice_notes: "",
    words_to_avoid: [],
    compliance_notes: "",
    colours: {},
    fonts: {},
    logo_url: null,
    email_footer: {},
    standing_hashtags: [],
    standing_ctas: [],
  };
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "client";
}
