// Builds the final post text from a calendar row, following lemonlolly's rules:
//   1. caption verbatim (approved copy is never rewritten)
//   2. CTA as its own paragraph — skipped if the caption already contains it,
//      and placed before a trailing compliance paragraph so compliance stays last
//   3. hashtags as the final paragraph
// Paragraphs are joined with a blank line; single line breaks are preserved.

const COMPLIANCE_PATTERNS = [
  /always read the label/i,
  /follow the directions for use/i,
  /if symptoms persist/i,
  /see your (doctor|health ?care professional)/i,
  /t&cs? apply/i,
];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/\s+$/g, "").replace(/^\n+/, ""))
    .filter((p) => p.trim() !== "");
}

export function isComplianceParagraph(p: string, complianceLine?: string | null): boolean {
  if (complianceLine && squash(complianceLine).length > 8 && squash(p).includes(squash(complianceLine))) return true;
  return COMPLIANCE_PATTERNS.some((re) => re.test(p));
}

export function assembleText(item: {
  caption: string | null;
  cta: string | null;
  hashtags: string | null;
}, opts: { complianceLine?: string | null } = {}): string {
  const paragraphs = splitParagraphs(item.caption ?? "");
  const cta = item.cta?.trim();

  if (cta && !squash(item.caption ?? "").includes(squash(cta))) {
    const last = paragraphs[paragraphs.length - 1];
    if (last && isComplianceParagraph(last, opts.complianceLine)) {
      paragraphs.splice(paragraphs.length - 1, 0, cta);
    } else {
      paragraphs.push(cta);
    }
  }

  const tags = item.hashtags?.trim().replace(/[ \t]+/g, " ");
  if (tags) {
    const already = tags.split(/\s+/).every((t) => (item.caption ?? "").toLowerCase().includes(t.toLowerCase()));
    if (!already) paragraphs.push(tags);
  }

  return paragraphs.join("\n\n");
}

/** Placeholder text that must never go out, e.g. "[DROP IN REAL REVIEW]". */
export function findPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\[[^\]\n]{2,80}\]|\{\{[^}\n]+\}\}|\b(?:TBC|TBD|XXX+|lorem ipsum)\b/gi)) {
    found.add(m[0]);
  }
  return [...found];
}
