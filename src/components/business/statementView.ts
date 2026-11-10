import type { MonthlyStatement } from "../../lib/business/statement";
import { bizPatch, type VehicleBiz } from "../../lib/vehicle/v3Fields";

/** The business-details form as typed (strings). */
export interface BizForm { company: string; driver: string; usage: string }

export type ParsedBiz = { ok: true; biz: VehicleBiz | null } | { ok: false; error: string };

/**
 * Validate the statement's business details into the stored `biz` shape
 * (`bizPatch`): trimmed names, empty fields dropped, usage 0–100 %. An empty
 * form is `null` (no business details). The typed usage is parsed with the
 * app's decimal parser and kept exact — it is never rounded here.
 */
export function businessForm(form: BizForm, parse: (value: string) => number): ParsedBiz {
  const typed = form.usage.trim();
  const usage = typed === "" ? null : parse(typed);
  if (usage !== null && (!Number.isFinite(usage) || usage < 0 || usage > 100)) return { ok: false, error: "שימוש עסקי בין 0 ל־100%" };
  try {
    return { ok: true, biz: bizPatch({ company: form.company, driver: form.driver, usagePct: usage }) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "פרטי העסק אינם תקינים" };
  }
}

/** File name base for an export: `tank-maleh-statement-<plate or id>-<YYYY-MM>.<ext>` (timestamped on download). */
export function statementFileName(statement: MonthlyStatement, extension: "html" | "csv"): string {
  const vehicle = (statement.vehicle.plate ?? statement.vehicle.id).replace(/[^\w-]+/g, "") || "vehicle";
  return `tank-maleh-statement-${vehicle}-${statement.month}.${extension}`;
}
