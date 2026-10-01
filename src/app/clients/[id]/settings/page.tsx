import { requireUser } from "@/lib/auth";
import { getBrandProfile, getClient } from "@/lib/clients";
import { maskSecret } from "@/lib/crypto";
import { serviceAccountEmail } from "@/lib/google-drive";
import { withDefaults } from "@/lib/posting-times";
import { PROVIDER_LABEL } from "@/lib/types";
import { ActionButton, ActionForm, Field, inputClass } from "@/components/ui/form";
import { deleteClient, saveBrandProfile, saveBufferKey, saveClientBasics, saveContentStudioKey, savePostingRules, savePushProvider, testDrive } from "../../actions";
import { PillarRows } from "./pillar-rows";
import { BufferChannels } from "./buffer-channels";
import { ContentStudioChannels } from "./contentstudio-channels";

function Section({ title, intro, children }: { title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {intro && <div className="mt-1 text-sm text-stone-500">{intro}</div>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function SettingsPage({ params }: PageProps<"/clients/[id]/settings">) {
  await requireUser();
  const { id } = await params;
  const [client, brand] = await Promise.all([getClient(id), getBrandProfile(id)]);
  const rules = withDefaults(client.posting_rules);
  const saEmail = serviceAccountEmail();

  return (
    <div className="grid max-w-3xl gap-6">
      <Section title="Basics & Google Drive">
        <ActionForm action={saveClientBasics.bind(null, id)} submitLabel="Save">
          <Field label="Client name">
            <input name="name" defaultValue={client.name} required className={inputClass} />
          </Field>
          <Field label="Timezone" hint="Posting times in the calendar are in this timezone.">
            <input name="timezone" defaultValue={client.timezone} className={inputClass} />
          </Field>
          <Field
            label="Drive folder link"
            hint={saEmail ? `The client must share this folder (Viewer) with ${saEmail}` : "Google service account not configured yet."}
          >
            <input name="drive_folder" defaultValue={client.drive_folder_id ?? ""} placeholder="https://drive.google.com/drive/folders/…" className={inputClass} />
          </Field>
          <Field label="Placeholder image URL" hint="Used for Instagram posts without an image in CSV exports only.">
            <input name="placeholder_image_url" defaultValue={client.placeholder_image_url ?? ""} className={inputClass} />
          </Field>
          <Field label="Don't reuse an image within (days)">
            <input name="reuse_window_days" type="number" min={0} defaultValue={client.reuse_window_days} className={`${inputClass} w-32`} />
          </Field>
        </ActionForm>
        <div className="mt-4 border-t border-stone-100 pt-4">
          <ActionButton action={testDrive.bind(null, id)} label="Test Drive connection" />
        </div>
      </Section>

      <Section
        title="Where posts go"
        intro="Each client publishes through one of these. Switching keeps the other one's key and channel mapping, so you can switch back."
      >
        <ActionForm action={savePushProvider.bind(null, id)} submitLabel="Save">
          <div className="flex flex-wrap gap-4">
            {(["buffer", "contentstudio"] as const).map((p) => (
              <label key={p} className="flex items-center gap-2">
                <input type="radio" name="push_provider" value={p} defaultChecked={client.push_provider === p} />
                <span>{PROVIDER_LABEL[p]}</span>
              </label>
            ))}
          </div>
        </ActionForm>
      </Section>

      <Section
        title={`Buffer${client.push_provider === "buffer" ? "" : " (not in use for this client)"}`}
        intro="Each Buffer API key belongs to one Buffer account. Find it in Buffer → Settings → API."
      >
        <p className="mb-3 text-sm">
          Saved key: <span className="font-mono">{maskSecret(client.buffer_api_key_enc) ?? "none"}</span>
        </p>
        <ActionForm action={saveBufferKey.bind(null, id)} submitLabel="Save key">
          <Field label={client.buffer_api_key_enc ? "Replace API key" : "API key"} hint="Stored encrypted. It never leaves the server.">
            <input name="buffer_api_key" type="password" autoComplete="off" className={inputClass} />
          </Field>
        </ActionForm>
        {client.buffer_api_key_enc && (
          <div className="mt-6 border-t border-stone-100 pt-4">
            <BufferChannels clientId={id} saved={client.buffer_channels} />
          </div>
        )}
      </Section>

      <Section
        title={`ContentStudio${client.push_provider === "contentstudio" ? "" : " (not in use for this client)"}`}
        intro="In ContentStudio, open the API section in the sidebar and generate a key. One key covers every workspace that account can see."
      >
        <p className="mb-3 text-sm">
          Saved key: <span className="font-mono">{maskSecret(client.contentstudio_api_key_enc) ?? "none"}</span>
        </p>
        <ActionForm action={saveContentStudioKey.bind(null, id)} submitLabel="Save key">
          <Field label={client.contentstudio_api_key_enc ? "Replace API key" : "API key"} hint="Stored encrypted. It never leaves the server.">
            <input name="contentstudio_api_key" type="password" autoComplete="off" className={inputClass} />
          </Field>
        </ActionForm>
        {client.contentstudio_api_key_enc && (
          <div className="mt-6 border-t border-stone-100 pt-4">
            <ContentStudioChannels
              clientId={id}
              saved={client.contentstudio_channels ?? []}
              savedWorkspaceId={client.contentstudio_workspace_id}
              savedWorkspaceTz={client.contentstudio_workspace_tz}
              clientTz={client.timezone}
            />
          </div>
        )}
      </Section>

      <Section title="Posting times" intro="Used when a calendar row has no time. All times are 24-hour, in the client's timezone.">
        <ActionForm action={savePostingRules.bind(null, id)} submitLabel="Save posting times">
          <div className="grid grid-cols-2 gap-4">
            <Field label="AM slot"><input name="amTime" defaultValue={rules.amTime} className={inputClass} /></Field>
            <Field label="Deadline posts" hint={'"ends midnight", "last day"…'}><input name="deadlineTime" defaultValue={rules.deadlineTime} className={inputClass} /></Field>
          </div>
          <PillarRows defaults={rules.defaults} pillars={rules.pillars} />
        </ActionForm>
      </Section>

      <Section title="Brand profile" intro="Used when Claude writes or checks copy.">
        <ActionForm action={saveBrandProfile.bind(null, id)} submitLabel="Save brand profile">
          <Field label="Voice and tone"><textarea name="voice_notes" rows={4} defaultValue={brand.voice_notes} className={inputClass} /></Field>
          <Field label="Words to avoid" hint="One per line or comma-separated."><textarea name="words_to_avoid" rows={2} defaultValue={brand.words_to_avoid.join("\n")} className={inputClass} /></Field>
          <Field label="Compliance notes" hint="e.g. TGA rules for therapeutic goods."><textarea name="compliance_notes" rows={4} defaultValue={brand.compliance_notes} className={inputClass} /></Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Primary colour"><input name="colour_primary" defaultValue={brand.colours.primary ?? ""} placeholder="#000000" className={inputClass} /></Field>
            <Field label="Secondary colour"><input name="colour_secondary" defaultValue={brand.colours.secondary ?? ""} className={inputClass} /></Field>
            <Field label="Accent colour"><input name="colour_accent" defaultValue={brand.colours.accent ?? ""} className={inputClass} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Heading font"><input name="font_heading" defaultValue={brand.fonts.heading ?? ""} className={inputClass} /></Field>
            <Field label="Body font"><input name="font_body" defaultValue={brand.fonts.body ?? ""} className={inputClass} /></Field>
          </div>
          <Field label="Logo URL"><input name="logo_url" defaultValue={brand.logo_url ?? ""} className={inputClass} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email footer address"><input name="footer_address" defaultValue={brand.email_footer.address ?? ""} className={inputClass} /></Field>
            <Field label="Email footer note"><input name="footer_note" defaultValue={brand.email_footer.note ?? ""} className={inputClass} /></Field>
          </div>
          <Field label="Standing hashtags"><textarea name="standing_hashtags" rows={2} defaultValue={brand.standing_hashtags.join(" ")} className={inputClass} /></Field>
          <Field label="Standing CTAs" hint="One per line."><textarea name="standing_ctas" rows={3} defaultValue={brand.standing_ctas.join("\n")} className={inputClass} /></Field>
        </ActionForm>
      </Section>

      <Section title="Delete client" intro="Removes the client and everything imported for them from this app. Nothing in Drive or Buffer is touched.">
        <form action={deleteClient.bind(null, id)} className="flex gap-2">
          <input name="confirm" placeholder="Type DELETE" className={`${inputClass} w-40`} />
          <button className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50">Delete</button>
        </form>
      </Section>
    </div>
  );
}
