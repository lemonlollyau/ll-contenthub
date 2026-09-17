import type { PillarTimes, PostingRules } from "./types";

// Fills in a posting time when the calendar row doesn't have one:
//   AM slot → amTime (8:00)
//   deadline wording ("ends midnight", "last day"…) → deadlineTime (20:30)
//   PM / evening slot → the pillar's evening time
//   otherwise → the pillar's weekday or weekend time

export const DEFAULT_RULES: PostingRules = {
  amTime: "08:00",
  deadlineTime: "20:30",
  defaults: { weekday: "12:00", weekend: "10:00", evening: "19:00" },
  pillars: [],
};

export function withDefaults(rules: Partial<PostingRules> | null | undefined): PostingRules {
  return {
    ...DEFAULT_RULES,
    ...rules,
    defaults: { ...DEFAULT_RULES.defaults, ...rules?.defaults },
    pillars: rules?.pillars ?? [],
  };
}

const DEADLINE =
  /(midnight tonight|last few hours|before midnight|ends? (at )?midnight|ends? tonight|last day|last chance|final hours|closes? tonight)/i;

export function isDeadlinePost(text: string): boolean {
  return DEADLINE.test(text);
}

export function suggestTime(
  item: {
    post_date: string | null;
    day?: string | null;
    slot: string | null;
    pillar: string | null;
    caption: string | null;
    moment_offer: string | null;
  },
  rulesIn: Partial<PostingRules>,
): { time: string; rule: string } {
  const rules = withDefaults(rulesIn);
  const slot = (item.slot ?? "").trim().toLowerCase();
  if (slot === "am" || slot === "morning") return { time: rules.amTime, rule: "AM slot" };

  const text = [item.caption, item.moment_offer].filter(Boolean).join(" ");
  if (isDeadlinePost(text)) return { time: rules.deadlineTime, rule: "deadline post" };

  const pillar = rules.pillars.find((p) => p.pillar.trim().toLowerCase() === (item.pillar ?? "").trim().toLowerCase());
  const times: PillarTimes = pillar ?? rules.defaults;
  const source = pillar ? `pillar "${pillar.pillar}"` : "default";

  if (slot === "pm" || slot === "evening" || slot === "night") return { time: times.evening, rule: `${source} evening` };

  const dow = item.post_date ? new Date(`${item.post_date}T12:00:00Z`).getUTCDay() : 1;
  const weekend = /^(sat|sun)/i.test(item.day ?? "") || (!item.day && (dow === 0 || dow === 6));
  return weekend
    ? { time: times.weekend, rule: `${source} weekend` }
    : { time: times.weekday, rule: `${source} weekday` };
}
