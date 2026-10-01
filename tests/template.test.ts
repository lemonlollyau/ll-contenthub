import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readWorkbook, rowsToItems, sheetMapping } from "@/lib/calendar/parse";
import { assembleText } from "@/lib/caption";

const file = readFileSync(path.resolve(import.meta.dirname, "../templates/content-calendar-template.xlsx"));

describe("calendar template", () => {
  const sheets = readWorkbook(file);

  it("finds only the Schedule and Email tabs", () => {
    expect(sheets.map((s) => [s.name, s.kind])).toEqual([["Schedule", "social"], ["Email", "email"]]);
  });

  it("maps every template column automatically", () => {
    for (const s of sheets) {
      const m = sheetMapping(s, {});
      expect(Object.entries(m).filter(([, v]) => !v).map(([h]) => h)).toEqual([]);
    }
  });

  it("imports the example social row correctly", () => {
    const s = sheets[0];
    const [item] = rowsToItems(s, sheetMapping(s, {}), "2026-11-01");
    expect(item).toMatchObject({
      type: "social", row_number: 1, post_date: "2026-11-03", post_time: null, slot: "AM",
      channels: ["instagram", "facebook"], format: "carousel", pillar: "The Science Bit",
      asset_group: "Product shots", caption_status: "Approved", warnings: [],
    });
    const text = assembleText(item);
    expect(text.endsWith("Save this for later\n\nAlways read the label and follow the directions for use.\n\n#redlighttherapy #skinscience #fringeheals")).toBe(true);
  });

  it("imports the example email row correctly", () => {
    const s = sheets[1];
    const [item] = rowsToItems(s, sheetMapping(s, {}), "2026-11-01");
    expect(item).toMatchObject({
      type: "email", post_date: "2026-11-27", post_time: "07:00", channels: ["email"],
      email_subject: "Black Friday is here: 30% off every device", email_preview: "Our biggest sale of the year ends Monday.",
    });
    expect(item.caption).toContain("30% off until midnight Monday");
  });
});
