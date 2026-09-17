import { describe, expect, it } from "vitest";
import { chunk, csvImageOk, csvPostingTime, toBufferCsv } from "@/lib/push/csv";

describe("toBufferCsv", () => {
  const csv = toBufferCsv([
    { text: 'Line one\nLine "two"', imageUrl: "https://x.co/a.jpg", postingTime: "2026-11-03 08:00" },
    { text: "   ", imageUrl: "", postingTime: "2026-11-04 08:00" },
  ]);
  it("starts with a BOM and exact quoted headers", () => {
    expect(csv.startsWith('﻿"Text","Image URL","Tags","Posting Time"\r\n')).toBe(true);
  });
  it("quotes every field, escapes quotes, leaves Tags blank, and drops blank rows", () => {
    const lines = csv.slice(1).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(csv).toContain('"Line one\nLine ""two""","https://x.co/a.jpg","","2026-11-03 08:00"');
  });
});

describe("helpers", () => {
  it("zero-pads posting times", () => {
    expect(csvPostingTime("2026-1-3", "8:5")).toBe("2026-01-03 08:05");
  });
  it("accepts only direct https jpg/png links", () => {
    expect(csvImageOk("https://a.supabase.co/x/y.jpg")).toBe(true);
    expect(csvImageOk("https://a.supabase.co/x/y.mp4")).toBe(false);
    expect(csvImageOk("http://a.co/y.png")).toBe(false);
  });
  it("chunks at 100", () => {
    expect(chunk(Array.from({ length: 205 }, (_, i) => i)).map((c) => c.length)).toEqual([100, 100, 5]);
  });
});
