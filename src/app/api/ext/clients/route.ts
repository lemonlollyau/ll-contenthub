import { NextResponse } from "next/server";
import { listClients } from "@/lib/clients";
import { db } from "@/lib/db";
import { extRoute } from "@/lib/ext-auth";
import type { BrandProfile } from "@/lib/types";

/** Clients with what the extension needs to design for them: channels and brand look. Never any keys. */
export const GET = extRoute(async () => {
  const clients = await listClients();
  const brands = (await db().from("brand_profiles").select("client_id, colours, fonts, logo_url, standing_hashtags, standing_ctas")).data as
    | Pick<BrandProfile, "client_id" | "colours" | "fonts" | "logo_url" | "standing_hashtags" | "standing_ctas">[]
    | null;
  const byClient = new Map((brands ?? []).map((b) => [b.client_id, b]));
  return NextResponse.json({
    clients: clients.map((c) => {
      const b = byClient.get(c.id);
      return {
        id: c.id,
        name: c.name,
        timezone: c.timezone,
        hasBuffer: !!c.buffer_api_key_enc,
        channels: c.buffer_channels.map((ch) => ({ platform: ch.platform, name: ch.channelName })),
        brand: {
          colours: b?.colours ?? {},
          fonts: b?.fonts ?? {},
          logoUrl: b?.logo_url ?? null,
          hashtags: b?.standing_hashtags ?? [],
          ctas: b?.standing_ctas ?? [],
        },
      };
    }),
  });
});
