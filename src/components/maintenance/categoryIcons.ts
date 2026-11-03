import type { EXPENSES, Job } from "../../lib/maintenance/model";
import type { DesignIconName } from "../icons";

/** One typed mapping for all service and expense categories. */
export const JOB_ICONS: Record<Job, DesignIconName> = {
  periodic: "wrench", oil: "oil", tires: "tire", brakes: "brake",
  battery: "battery", repair: "tools", custom: "wrench",
};
export const EXPENSE_ICONS: Record<keyof typeof EXPENSES, DesignIconName> = {
  insurance: "shield", registration: "doc", parking: "parking",
  toll: "road", wash: "drop", other: "coin", refund: "coin",
};

export function categoryIconName(kind: string): DesignIconName {
  if (Object.hasOwn(JOB_ICONS, kind)) return JOB_ICONS[kind as Job];
  if (Object.hasOwn(EXPENSE_ICONS, kind)) return EXPENSE_ICONS[kind as keyof typeof EXPENSES];
  if (kind === "expense") return "coin";
  if (kind === "reminder") return "calendar";
  return "wrench";
}
