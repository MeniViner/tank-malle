import { describe, expect, it } from "vitest";
import { civilDayAtTime, editCivilDateDraft, formatCivilDay, parseCivilDay } from "./civilDate";

describe("civil date drafts", () => {
  it("reads complete day-first and ISO input without changing the calendar day", () => {
    for (const text of ["05/09/2026", "05/09/26", "2026-09-05", " 05/09/2026 ", "05092026"]) {
      expect(parseCivilDay(text)).toBe("2026-09-05");
    }
    expect(parseCivilDay("03/04/2026")).toBe("2026-04-03");
    expect(formatCivilDay("2026-09-05")).toBe("05/09/2026");
  });

  it("preserves the established two-digit year convention", () => {
    expect(parseCivilDay("01/01/69")).toBe("2069-01-01");
    expect(parseCivilDay("01/01/70")).toBe("1970-01-01");
  });

  it("rejects invalid visible drafts instead of accepting a prefix or date rollover", () => {
    for (const text of ["", " ", "05/", "5/9/2026", "05.09.2026", "05-09-2026", "2026/09/05", "2026-9-05", "31/02/2026", "29/02/1900", "29/02/2100", "2026-13-01", "01/01/1899", "01/01/2200", "2026-09-05T12:00:00Z", "05/09/2026 anything", "46317", "05/09/026"]) {
      expect(parseCivilDay(text)).toBeNull();
    }
    expect(parseCivilDay("29/02/2000")).toBe("2000-02-29");
    expect(parseCivilDay("29/02/2028")).toBe("2028-02-29");
    expect(parseCivilDay("01/01/1900")).toBe("1900-01-01");
    expect(parseCivilDay("31/12/2199")).toBe("2199-12-31");
  });

  it("does not invent a date for absent or malformed source values", () => {
    expect(formatCivilDay(null)).toBe("");
    expect(formatCivilDay(undefined)).toBe("");
    expect(formatCivilDay("2026-02-31")).toBe("");
  });
});

describe("manual day-first date edits", () => {
  it("inserts separators while eight digits are typed without requiring slash keys", () => {
    let draft = "";
    const states: string[] = [];
    for (const digit of "30062027") {
      const raw = draft + digit;
      const edit = editCivilDateDraft(draft, raw, raw.length, raw.length, "insertText");
      draft = edit.text;
      states.push(draft);
      expect(edit.start).toBe(draft.length);
      expect(edit.end).toBe(draft.length);
    }
    expect(states).toEqual(["3", "30", "30/0", "30/06", "30/06/2", "30/06/20", "30/06/202", "30/06/2027"]);
    expect(parseCivilDay(draft)).toBe("2027-06-30");
  });

  it("handles replacing a selection, compact pastes and an ISO paste", () => {
    expect(editCivilDateDraft("01/01/2026", "30062027", 8, 8, "insertFromPaste"))
      .toEqual({ text: "30/06/2027", start: 10, end: 10 });
    expect(editCivilDateDraft("", "03042027", 2, 6, "insertFromPaste"))
      .toEqual({ text: "03/04/2027", start: 2, end: 8 });
    expect(editCivilDateDraft("", "2027-06-30", 10, 10, "insertFromPaste"))
      .toEqual({ text: "30/06/2027", start: 10, end: 10 });
    expect(editCivilDateDraft("30/06/2027", "30/12/2027", 5))
      .toEqual({ text: "30/12/2027", start: 5, end: 5 });
  });

  it("lets backspace and forward delete cross a separator, then repairs the edited segment", () => {
    const backspace = editCivilDateDraft("30/06/2027", "3006/2027", 2, 2, "deleteContentBackward");
    expect(backspace).toEqual({ text: "3/06/2027", start: 1, end: 1 });
    expect(editCivilDateDraft(backspace.text, "30/06/2027", 2))
      .toEqual({ text: "30/06/2027", start: 2, end: 2 });
    expect(editCivilDateDraft("30/06/2027", "3006/2027", 2, 2, "deleteContentForward"))
      .toEqual({ text: "30/6/2027", start: 3, end: 3 });
    expect(editCivilDateDraft("30/06/2027", "30/6/2027", 3, 3, "deleteContentBackward"))
      .toEqual({ text: "30/6/2027", start: 3, end: 3 });
  });

  it("keeps invalid and incomplete drafts instead of truncating or silently repairing a date", () => {
    for (const raw of ["31/02/2027", "30/0/2027", "5/9/2027", "300620279", "2027-02-31", "30/06/no", "", "30/"]) {
      expect(editCivilDateDraft("30/06/2027", raw, raw.length).text).toBe(raw);
    }
    expect(editCivilDateDraft("", "31022027", 8).text).toBe("31/02/2027");
    expect(parseCivilDay("31022027")).toBeNull();
    expect(parseCivilDay("06302027")).toBeNull();
  });
});

describe("fill-up civil dates in local time", () => {
  it("keeps the selected civil day and clock instead of interpreting ISO as UTC", () => {
    const next = civilDayAtTime("2027-06-30", new Date(2026, 10, 5, 18, 47, 35));
    expect(next && [next.getFullYear(), next.getMonth(), next.getDate(), next.getHours(), next.getMinutes(), next.getSeconds()])
      .toEqual([2027, 5, 30, 18, 47, 0]);
    expect(civilDayAtTime("30062027", new Date(2026, 10, 5, 0, 1))?.getDate()).toBe(30);
    expect(civilDayAtTime("31/02/2027", new Date())).toBeNull();
  });
});
