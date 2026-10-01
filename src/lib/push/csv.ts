// Buffer bulk-upload CSV, exactly to spec:
// headers Text,Image URL,Tags,Posting Time · UTF-8 with BOM · every field quoted
// · no blank rows · "YYYY-MM-DD HH:mm" 24-hour · Tags blank · ≤100 rows per file.

export const CSV_HEADERS = ["Text", "Image URL", "Tags", "Posting Time"] as const;
export const CSV_MAX_ROWS = 100;

export type CsvRow = { text: string; imageUrl: string; postingTime: string };

const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;

export function toBufferCsv(rows: CsvRow[]): string {
  const lines = [CSV_HEADERS.map(quote).join(",")];
  for (const r of rows) {
    if (!r.text.trim()) continue; // blank rows abort Buffer's upload
    lines.push([r.text, r.imageUrl, "", r.postingTime].map(quote).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function csvPostingTime(date: string, time: string): string {
  const [y, m, d] = date.split("-");
  const [hh, mm] = time.split(":");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")} ${hh.padStart(2, "0")}:${mm.padStart(2, "0")}`;
}

/** Buffer only accepts direct .jpg/.png links in bulk upload. */
export function csvImageOk(url: string): boolean {
  return /^https:\/\/\S+\.(jpe?g|png)$/i.test(url);
}

export function chunk<T>(rows: T[], size = CSV_MAX_ROWS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// --- ContentStudio bulk upload -------------------------------------------
// Columns per ContentStudio's help centre (article 564): "Date and Time",
// "Message", "Image URL", "Link"; date as dd/mm/yyyy hh:mm; 500 posts per file.
// Their downloadable template is the final word on spelling, so check the first
// upload for a new account.

export const CS_CSV_HEADERS = ["Date and Time", "Message", "Image URL", "Link"] as const;
export const CS_CSV_MAX_ROWS = 500;

export function toContentStudioCsv(rows: CsvRow[]): string {
  const lines = [CS_CSV_HEADERS.map(quote).join(",")];
  for (const r of rows) {
    if (!r.text.trim()) continue;
    lines.push([r.postingTime, r.text, r.imageUrl, ""].map(quote).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** ContentStudio wants dd/mm/yyyy hh:mm. */
export function csPostingTime(date: string, time: string): string {
  const [y, m, d] = date.split("-");
  const [hh, mm] = time.split(":");
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y} ${hh.padStart(2, "0")}:${mm.padStart(2, "0")}`;
}
