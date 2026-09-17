// Calendar spreadsheet columns → content item fields, matched by header name.
// Aliases are compared after normalising (lower case, punctuation removed).

export const FIELDS = {
  row_number: { label: "#", aliases: ["#", "no", "number", "post", "post #", "id"] },
  post_date: { label: "Date", aliases: ["date", "post date", "publish date", "go live date"] },
  post_time: { label: "Time", aliases: ["time", "post time", "posting time", "publish time"] },
  day: { label: "Day", aliases: ["day", "weekday"] },
  phase: { label: "Phase", aliases: ["phase", "stage", "week"] },
  slot: { label: "Slot", aliases: ["slot", "am pm", "time slot"] },
  channels: { label: "Platform", aliases: ["platform", "platforms", "channel", "channels", "network"] },
  format: { label: "Format", aliases: ["format", "post type", "type", "content type"] },
  pillar: { label: "Pillar", aliases: ["pillar", "content pillar", "theme"] },
  moment_offer: { label: "Moment / Offer", aliases: ["moment offer", "moment", "offer", "campaign", "moment / offer"] },
  hook: { label: "Hook", aliases: ["hook", "headline", "title"] },
  caption: { label: "Caption", aliases: ["caption draft", "caption", "copy", "post copy", "caption (draft)"] },
  hashtags: { label: "Hashtags", aliases: ["hashtags", "tags", "hash tags"] },
  first_comment: { label: "First comment", aliases: ["first comment", "comment"] },
  cta: { label: "CTA", aliases: ["cta", "call to action"] },
  asset_brief: { label: "Asset brief", aliases: ["asset brief", "image brief", "visual brief", "creative brief", "visual"] },
  asset_group: { label: "Asset group", aliases: ["asset group", "asset folder", "folder"] },
  asset_ref: { label: "Asset file / link", aliases: ["asset", "asset file", "asset link", "image", "image link", "file", "drive link"] },
  asset_status: { label: "Asset status", aliases: ["asset status", "creative status"] },
  caption_status: { label: "Caption status", aliases: ["caption status", "copy status"] },
  owner: { label: "Owner", aliases: ["owner", "assignee", "responsible"] },
  scheduled: { label: "Scheduled", aliases: ["scheduled"] },
  live: { label: "Live", aliases: ["live", "published"] },
  compliance_note: { label: "Compliance note", aliases: ["compliance note", "compliance", "compliance notes", "tga"] },
  // email tab
  email_subject: { label: "Email subject", aliases: ["subject", "subject line", "email subject"] },
  email_preview: { label: "Email preview text", aliases: ["preview", "preview text", "preheader"] },
} as const;

export type FieldKey = keyof typeof FIELDS;
export const FIELD_KEYS = Object.keys(FIELDS) as FieldKey[];

export function normaliseHeader(h: unknown): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9#/ ]+/g, " ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIAS_INDEX = new Map<string, FieldKey>();
for (const key of FIELD_KEYS) {
  for (const a of FIELDS[key].aliases) ALIAS_INDEX.set(normaliseHeader(a), key);
}
// "Moment / Offer" also normalises without the slash spacing.
ALIAS_INDEX.set("moment offer", "moment_offer");

/** Suggest a mapping header → field, preferring a saved mapping. Each field is used once. */
export function autoMap(headers: string[], saved: Record<string, string> = {}): Record<string, FieldKey | ""> {
  const used = new Set<string>();
  const out: Record<string, FieldKey | ""> = {};
  for (const h of headers) {
    const s = saved[h];
    if (s !== undefined && (s === "" || FIELD_KEYS.includes(s as FieldKey)) && !used.has(s)) {
      out[h] = s as FieldKey | "";
      if (s) used.add(s);
    }
  }
  for (const h of headers) {
    if (h in out) continue;
    const n = normaliseHeader(h);
    const key = ALIAS_INDEX.get(n) ?? ALIAS_INDEX.get(n.replace(/ \/ /g, " "));
    if (key && !used.has(key)) {
      out[h] = key;
      used.add(key);
    } else {
      out[h] = "";
    }
  }
  return out;
}

/** How many headers in a row look like calendar columns (used to find the header row). */
export function headerScore(row: unknown[]): number {
  return row.filter((c) => {
    const n = normaliseHeader(c);
    return n && (ALIAS_INDEX.has(n) || ALIAS_INDEX.has(n.replace(/ \/ /g, " ")));
  }).length;
}
