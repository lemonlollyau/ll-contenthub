import { describe, expect, it } from "vitest";
import { csMediaPlan, fromCsPlatform, toCsPlatform } from "@/lib/contentstudio";
import { csPostingTime, toContentStudioCsv } from "@/lib/push/csv";
import { formatInZone, zonedToUtc } from "@/lib/tz";

describe("platform names", () => {
  it("translates both ways", () => {
    expect(toCsPlatform("googlebusiness")).toBe("gmb");
    expect(fromCsPlatform("gmb")).toBe("googlebusiness");
    expect(toCsPlatform("instagram")).toBe("instagram");
  });
});

describe("scheduling across timezones", () => {
  it("sends the workspace's local wall-clock time", () => {
    // 8:00 in Adelaide during daylight saving = 21:30 UTC the day before.
    const utc = zonedToUtc("2026-11-03", "08:00", "Australia/Adelaide");
    expect(utc.toISOString()).toBe("2026-11-02T21:30:00.000Z");
    // A workspace set to Adelaide sees 08:00; one set to Sydney sees 08:30.
    expect(formatInZone(utc, "Australia/Adelaide")).toBe("2026-11-03 08:00:00");
    expect(formatInZone(utc, "Australia/Sydney")).toBe("2026-11-03 08:30:00");
    expect(formatInZone(utc, "UTC")).toBe("2026-11-02 21:30:00");
  });
});

describe("ContentStudio CSV", () => {
  it("uses their headers, day-first dates and quoted fields", () => {
    const csv = toContentStudioCsv([
      { text: "Hello\nthere", imageUrl: "https://x.co/a.jpg", postingTime: csPostingTime("2026-11-03", "08:00") },
      { text: "   ", imageUrl: "", postingTime: csPostingTime("2026-11-04", "09:00") },
    ]);
    expect(csv.startsWith('﻿"Date and Time","Message","Image URL","Link"\r\n')).toBe(true);
    expect(csv).toContain('"03/11/2026 08:00","Hello\nthere","https://x.co/a.jpg",""');
    expect(csv.slice(1).split("\r\n").filter(Boolean)).toHaveLength(2); // blank row dropped
  });
});

describe("ContentStudio media rules", () => {
  const img = (n = 1) => Array.from({ length: n }, (_, i) => ({ url: `https://x.co/${i}.jpg`, kind: "image" as const }));
  const vid = [{ url: "https://x.co/v.mp4", kind: "video" as const }];

  it("sends a reel as a reel when there's a video", () => {
    const p = csMediaPlan("instagram", "reel", vid);
    expect(p).toMatchObject({ postType: "reel", images: [], video: "https://x.co/v.mp4", note: null });
  });

  it("falls back to the feed when a reel has only a still (ContentStudio rejects that)", () => {
    const p = csMediaPlan("instagram", "reel", img());
    expect(p.postType).toBe("feed");
    expect(p.images).toHaveLength(1);
    expect(p.video).toBeUndefined();
    expect(p.note).toMatch(/only a still image/i);
  });

  it("never sends images and video together", () => {
    const p = csMediaPlan("facebook", "feed", [...img(2), ...vid]);
    expect(p.images).toEqual([]);
    expect(p.video).toBe("https://x.co/v.mp4");
    expect(p.note).toMatch(/video is used/i);
  });

  it("needs two images for a carousel, otherwise sends one image", () => {
    expect(csMediaPlan("instagram", "carousel", img(3)).postType).toBe("carousel");
    const single = csMediaPlan("instagram", "carousel", img(1));
    expect(single.postType).toBe("feed");
    expect(single.note).toMatch(/one image/i);
  });

  it("keeps stories as stories with a single image", () => {
    expect(csMediaPlan("instagram", "story", img(2))).toMatchObject({ postType: "story", images: ["https://x.co/0.jpg"] });
  });
});
