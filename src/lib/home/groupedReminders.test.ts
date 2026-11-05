import { describe, expect, it } from "vitest";
import type { Vehicle } from "../stats";
import { groupedReminderSpotlights } from "./groupedReminders";
import type { ReminderInput, SpotlightItem } from "./spotlight";

const today = "2026-11-05";
const vehicle: Vehicle = { id: "car", make: "מאזדה", model: "3", fuelType: "95", priceAdjustment: 0, archived: false,
  docs: { test: { due: "2026-11-20", cost: 1200 }, mandatory: { due: "2026-11-25", cost: 4500 } } };
const reminder = (id = "oil", day: string | null = "2026-11-18"): ReminderInput => ({
  plan: { id, schemaVersion: 1, version: 1, title: "שמן ומסננים", job: "oil", dueDay: "2026-10-01", dueOdometer: null,
    intervalMonths: 1, intervalKm: null, basis: "completion", source: "owner", notes: "", active: true },
  due: { day, odometer: null, completed: false }, occurrence: `reminder:${id}:${day}:cycle`,
});
const cards = (patch: Partial<Parameters<typeof groupedReminderSpotlights>[0]> = {}) =>
  groupedReminderSpotlights({ vehicle, today, reminders: [], mileageCards: [], ...patch });

describe("grouped upcoming reminders", () => {
  it("combines date-matched deadlines without repeating them or inventing renewal costs", () => {
    const result = cards({ reminders: [reminder()] });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("3 תזכורות ב-30 הימים הקרובים");
    expect(result[0].body).toContain("שמן ומסננים");
    expect(result[0].body).toContain("18 בנוב׳ 2026");
    expect(result[0].body).not.toContain("₪");
    expect(result[0].dismisses).toHaveLength(3);
    expect(result[0].target).toEqual({ kind: "route", to: "/vehicle?tab=due" });
  });

  it("uses the next derived recurrence rather than the original plan deadline", () => {
    const result = cards({ vehicle: { ...vehicle, docs: {} }, reminders: [reminder()] });
    expect(result).toHaveLength(1);
    expect(result[0].body).toContain("18 בנוב׳ 2026");
    expect(result[0].body).not.toContain("אוק׳");
  });

  it("keeps urgent and expired documents independent of the group", () => {
    const docs = { test: { due: "2026-11-04" }, mandatory: { due: "2026-11-20" }, coverage: { type: "third", due: "2026-11-25" } };
    const result = cards({ vehicle: { ...vehicle, docs } });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ sticky: true, tone: "danger" });
    expect(result[0].title).toContain("פג תוקף");
    expect(result[1].dismisses).toHaveLength(2);
    expect(result[1].body).not.toContain("טסט");
  });

  it("preserves a near mileage trigger instead of hiding it behind a later date", () => {
    const due = reminder();
    const mileage: SpotlightItem = { id: due.occurrence, tone: "warn", icon: "wrench", title: "שמן ומסננים בעוד 200 ק״מ",
      body: "לפי הקילומטראז׳", target: { kind: "route", to: "/vehicle/reminders/oil" } };
    const result = cards({ reminders: [due], mileageCards: [mileage] });
    expect(result[0]).toEqual(mileage);
    expect(result[1].dismisses).toHaveLength(2);
    expect(result[1].body).not.toContain("שמן");
  });

  it("does not revive an individually dismissed member through a group", () => {
    const result = cards({ dismissedIds: ["doc:test:2026-11-20:month"] });
    expect(result.some(card => card.id.startsWith("upcoming:"))).toBe(false);
    // Normal visibility filtering still removes the previously dismissed card.
    expect(result.some(card => card.id === "doc:mandatory:2026-11-25:month")).toBe(true);
  });

  it("keeps an overdue date urgent even when the same plan also has kilometres remaining", () => {
    const due = reminder("oil", "2026-11-04");
    const mileage: SpotlightItem = { id: due.occurrence, tone: "warn", icon: "wrench", title: "שמן ומסננים בעוד 200 ק״מ",
      body: "לפי הקילומטראז׳", target: { kind: "route", to: "/vehicle/reminders/oil" } };
    const result = cards({ vehicle: { ...vehicle, docs: {} }, reminders: [due], mileageCards: [mileage] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sticky: true, tone: "danger", id: due.occurrence });
    expect(result[0].title).toContain("המועד עבר");
    expect(result[0].body).toContain("200 ק״מ");
  });

  it("puts an urgent date ahead of mileage reminders so the four-card cap cannot bury it", () => {
    const mileageCards: SpotlightItem[] = Array.from({ length: 4 }, (_, index) => ({
      id: `reminder:km-${index}`, tone: "warn", icon: "wrench", title: "בעוד 200 ק״מ", body: "",
      target: { kind: "route", to: `/vehicle/reminders/km-${index}` },
    }));
    const result = cards({ vehicle: { ...vehicle, docs: {} }, reminders: [reminder("urgent", "2026-11-04")], mileageCards });
    expect(result[0]).toMatchObject({ sticky: true, tone: "danger" });
    expect(result[0].title).toContain("המועד עבר");
  });

  it("gives a renewed deadline a new dismissal identity but ignores past cost edits", () => {
    const original = cards()[0];
    expect(cards({ vehicle: { ...vehicle, docs: { test: { due: "2026-11-20", cost: 1 }, mandatory: { due: "2026-11-25", cost: 999 } } } })[0].id).toBe(original.id);
    expect(cards({ vehicle: { ...vehicle, docs: { test: { due: "2026-11-21" }, mandatory: { due: "2026-11-25" } } } })[0].id).not.toBe(original.id);
  });

  it("keeps a newly urgent deadline visible after the group was dismissed", () => {
    const group = cards()[0];
    const next = cards({ today: "2026-11-15", dismissedIds: [group.id, ...group.dismisses!] });
    expect(next[0]).toMatchObject({ sticky: true, id: "doc:test:2026-11-20:week" });
  });

  it("silently excludes missing, distant, completed and inactive deadlines", () => {
    const completed = reminder("done"); completed.due.completed = true;
    const inactive = reminder("paused"); inactive.plan.active = false;
    const result = cards({ vehicle: { ...vehicle, docs: { coverage: { type: "none", due: "2026-11-20" } } },
      reminders: [completed, inactive, reminder("missing", null), reminder("far", "2026-12-06"), reminder("invalid", "2026-02-30")] });
    expect(result).toEqual([]);
  });

  it("uses calendar days across year changes and includes the 30-day boundary", () => {
    const result = cards({ today: "2026-12-20", vehicle: { ...vehicle, docs: { test: { due: "2027-01-19" }, mandatory: { due: "2027-01-10" } } } });
    expect(result).toHaveLength(1);
    expect(result[0].dismisses).toHaveLength(2);
  });

  it("bounds the group identity and preview without dropping member dismissal keys", () => {
    const result = cards({ reminders: Array.from({ length: 25 }, (_, index) => reminder(`plan-${index}`)) });
    expect(result[0].id.length).toBeLessThan(100);
    expect(result[0].body).toContain("ועוד 24");
    expect(result[0].dismisses).toHaveLength(27);
    expect(cards({ reminders: [reminder("b"), reminder("a")] })[0].id)
      .toBe(cards({ reminders: [reminder("a"), reminder("b")] })[0].id);
  });
});
