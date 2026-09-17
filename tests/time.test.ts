import { describe, expect, it } from "vitest";
import { suggestTime, withDefaults } from "@/lib/posting-times";
import { zonedToUtc } from "@/lib/tz";

describe("zonedToUtc (Australia/Adelaide)", () => {
  it("handles daylight saving (ACDT, UTC+10:30)", () => {
    expect(zonedToUtc("2026-11-03", "08:00", "Australia/Adelaide").toISOString()).toBe("2026-11-02T21:30:00.000Z");
  });
  it("handles standard time (ACST, UTC+9:30)", () => {
    expect(zonedToUtc("2026-06-15", "19:00", "Australia/Adelaide").toISOString()).toBe("2026-06-15T09:30:00.000Z");
  });
});

const rules = withDefaults({
  pillars: [{ pillar: "The Science Bit", weekday: "12:30", weekend: "10:00", evening: "19:00" }],
  defaults: { weekday: "18:00", weekend: "11:00", evening: "19:00" },
});
const base = { post_date: "2026-11-04", day: "Wed", slot: null, pillar: "The Science Bit", caption: "", moment_offer: null };

describe("suggestTime", () => {
  it("AM slot is 08:00", () => expect(suggestTime({ ...base, slot: "AM" }, rules).time).toBe("08:00"));
  it("deadline posts are 20:30", () =>
    expect(suggestTime({ ...base, caption: "Sale ends midnight tonight!" }, rules).time).toBe("20:30"));
  it("PM slot uses the pillar evening time", () => expect(suggestTime({ ...base, slot: "PM" }, rules).time).toBe("19:00"));
  it("weekday uses the pillar weekday time", () => expect(suggestTime(base, rules).time).toBe("12:30"));
  it("Sat/Sun uses the weekend time", () =>
    expect(suggestTime({ ...base, post_date: "2026-11-07", day: "Sat" }, rules).time).toBe("10:00"));
  it("unknown pillar falls back to defaults", () => expect(suggestTime({ ...base, pillar: "Other" }, rules).time).toBe("18:00"));
});
