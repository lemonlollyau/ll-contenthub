import { describe, expect, it } from "vitest";
import { assembleText, findPlaceholders } from "@/lib/caption";

const COMPLIANCE = "Always read the label and follow the directions for use.";

describe("assembleText", () => {
  it("appends CTA then hashtags, joined by blank lines", () => {
    expect(assembleText({ caption: "Hello there.", cta: "Shop now at fringeheals.com", hashtags: "#redlight #skin" })).toBe(
      "Hello there.\n\nShop now at fringeheals.com\n\n#redlight #skin",
    );
  });

  it("puts the CTA before a trailing compliance paragraph", () => {
    const caption = `Glow up.\n\n${COMPLIANCE}`;
    expect(assembleText({ caption, cta: "Tap the link in bio", hashtags: "#glow" })).toBe(
      `Glow up.\n\nTap the link in bio\n\n${COMPLIANCE}\n\n#glow`,
    );
  });

  it("skips the CTA when the caption already contains it (alphanumeric compare)", () => {
    const caption = "Read our guides at ruok.org.au today.";
    expect(assembleText({ caption, cta: "ruok.org.au", hashtags: null })).toBe(caption);
  });

  it("preserves single line breaks inside paragraphs", () => {
    const caption = "Prices:\nMini $199\nPro $399\n\nEnds Sunday.";
    expect(assembleText({ caption, cta: null, hashtags: null })).toBe(caption);
  });

  it("normalises CRLF and extra blank lines without rewriting words", () => {
    expect(assembleText({ caption: "One\r\n\r\n\r\nTwo  ", cta: null, hashtags: null })).toBe("One\n\nTwo");
  });

  it("does not duplicate hashtags already in the caption", () => {
    expect(assembleText({ caption: "Hi #glow", cta: null, hashtags: "#glow" })).toBe("Hi #glow");
  });
});

describe("findPlaceholders", () => {
  it("finds bracketed placeholders", () => {
    expect(findPlaceholders('"[DROP IN REAL REVIEW]" — Sam')).toEqual(["[DROP IN REAL REVIEW]"]);
  });
  it("ignores normal text", () => {
    expect(findPlaceholders("Nothing to see here.")).toEqual([]);
  });
});
