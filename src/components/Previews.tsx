import type { ReactNode } from "react";
import { Label } from "./Card";
import { Num } from "./Num";
import { StationBrandMark } from "./StationBrand";
import { HeroSpark } from "./HeroSpark";
import type { Segment } from "../lib/stats";

/** Non-interactive examples use the same rows, chart and plate as the product. */
export function FillupPreview() {
  return <Preview>
    <Label>תדלוק חדש</Label>
    <div className="mt-2 overflow-hidden rounded-control bg-bg">
      <PreviewRow title="מתי" value={<Num>היום, 08:14</Num>} />
      <div className="tm-preview-row"><StationBrandMark name="פז" size={26} /><span>פז יד מרדכי</span></div>
      <PreviewRow title="מחיר לליטר" value="לפי המחיר הרשמי" />
    </div>
    <p className="mt-3 text-[13.5px] text-muted">נשאר להקליד קילומטראז׳ וליטרים.</p>
  </Preview>;
}

const EXAMPLE_SEGMENTS: Segment[] = [12.6, 14.8, 11.2, 13.3, 9.3].map((value, i) => ({
  startId: String(i), endId: String(i + 1), startDate: Date.UTC(2026, 6, 1 + i * 14), endDate: Date.UTC(2026, 6, 15 + i * 14),
  startOdometer: 10000 + i * 400, endOdometer: 10400 + i * 400,
  km: 400, liters: 400 / value, cost: 200, kmPerLiter: value, litersPer100: 100 / value, costPerKm: .5, fillupCount: 1,
}));

export function StatsPreview() {
  return <Preview>
    <Label>צריכה אחרונה</Label>
    <div className="mb-3 mt-2 flex items-baseline gap-2"><Num className="font-display text-[52px] font-bold leading-none">9.3</Num><span className="text-[15px] text-muted">קמ״ל</span></div>
    <HeroSpark segments={EXAMPLE_SEGMENTS} average={12.2} />
  </Preview>;
}

export function VehiclePreview() {
  return <Preview>
    <div className="tm-plate mb-4" aria-label="לוחית לדוגמה 72-480-78"><span className="tm-plate-il">IL</span><span className="tm-plate-number">72-480-78</span></div>
    <div className="overflow-hidden rounded-control bg-bg">
      <PreviewRow title="יונדאי i20 Inspire" value={<Num>2018</Num>} />
      <PreviewRow title="בנזין 95" value="42 ל׳" />
    </div>
  </Preview>;
}

export function SignInPreview() {
  return <div className="tm-preview mx-auto">
    <div className="tm-statpair">
      <div className="flex min-w-0 flex-col gap-1"><Label>צריכה אחרונה</Label><Num className="self-start font-display text-[26px] font-bold">9.3</Num><span className="text-[13.5px] text-muted">קמ״ל</span></div>
      <span className="tm-statpair-divider" />
      <div className="flex min-w-0 flex-col gap-1"><Label>הוצאה החודש</Label><Num className="self-start font-display text-[26px] font-bold">₪655</Num><span className="text-[13.5px] text-muted">2 תדלוקים</span></div>
    </div>
  </div>;
}

function Preview({ children }: { children: ReactNode }) {
  return <div className="tm-preview" aria-label="תצוגה לדוגמה">{children}</div>;
}
function PreviewRow({ title, value }: { title: string; value: ReactNode }) {
  return <div className="tm-preview-row"><span className="min-w-0 flex-1 font-semibold">{title}</span><span className="text-[13.5px] text-muted">{value}</span></div>;
}
