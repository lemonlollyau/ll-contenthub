import { describe, expect, it } from "vitest";
import { autoMap } from "@/lib/calendar/columns";
import { findAssetRef, parseChannels, parseDate, parseFormat, parseTime } from "@/lib/calendar/values";
import { carouselCount, recentlyUsed } from "@/lib/matching/rules";

const HEADERS = ["#", "Date", "Day", "Phase", "Slot", "Platform", "Format", "Pillar", "Moment / Offer", "Hook", "Caption (draft)", "Hashtags", "CTA", "Asset brief", "Asset group", "Asset status", "Caption status", "Owner", "Scheduled", "Live", "Compliance note"];

describe("autoMap", () => {
  it("maps lemonlolly's standard headers", () => {
    const m = autoMap(HEADERS);
    expect(m).toMatchObject({
      "#": "row_number", Date: "post_date", Day: "day", Phase: "phase", Slot: "slot", Platform: "channels", Format: "format",
      Pillar: "pillar", "Moment / Offer": "moment_offer", Hook: "hook", "Caption (draft)": "caption", Hashtags: "hashtags",
      CTA: "cta", "Asset brief": "asset_brief", "Asset group": "asset_group", "Asset status": "asset_status",
      "Caption status": "caption_status", Owner: "owner", Scheduled: "scheduled", Live: "live", "Compliance note": "compliance_note",
    });
  });
  it("prefers a saved mapping", () => {
    expect(autoMap(["Copy", "Caption (draft)"], { Copy: "caption", "Caption (draft)": "" })).toEqual({ Copy: "caption", "Caption (draft)": "" });
  });
});

describe("value parsing", () => {
  it("reads Excel serial dates", () => expect(parseDate(46329, 2026)).toBe("2026-11-03"));
  it("reads AU text dates", () => {
    expect(parseDate("3/11/2026", 2026)).toBe("2026-11-03");
    expect(parseDate("Tue 3 Nov", 2026)).toBe("2026-11-03");
    expect(parseDate("2026-11-03", 2025)).toBe("2026-11-03");
  });
  it("rejects nonsense dates", () => expect(parseDate("31/02/2026", 2026)).toBeNull());
  it("reads times", () => {
    expect(parseTime("8pm")).toBe("20:00");
    expect(parseTime("8:30 am")).toBe("08:30");
    expect(parseTime(0.75)).toBe("18:00");
    expect(parseTime("AM")).toBeNull();
  });
  it("normalises platforms", () => expect(parseChannels("IG / FB")).toEqual(["instagram", "facebook"]));
  it("normalises formats", () => {
    expect(parseFormat("Carousel (5 slides)")).toBe("carousel");
    expect(parseFormat("Reel")).toBe("reel");
    expect(parseFormat("Stories")).toBe("story");
    expect(parseFormat("Static")).toBe("feed");
  });
  it("finds asset references", () => {
    expect(findAssetRef("Use IMG_2041.HEIC from the shoot")).toBe("IMG_2041.HEIC");
    expect(findAssetRef("https://drive.google.com/file/d/abc123/view please")).toBe("https://drive.google.com/file/d/abc123/view");
  });
});

describe("matching rules", () => {
  it("reads carousel counts", () => expect(carouselCount("Carousel, 5 slides: protocol steps")).toBe(5));
  it("enforces the reuse window", () => {
    const usage = { a: ["2026-11-01"] };
    expect(recentlyUsed(usage, "a", "2026-11-10", 14)).toBe(true);
    expect(recentlyUsed(usage, "a", "2026-11-20", 14)).toBe(false);
  });
});
