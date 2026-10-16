import { useState } from 'react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { parseDecimal, price } from '../lib/format';
import { discountedPrice, vehicleDiscount, type FuelDiscount } from '../lib/prices/discount';
import type { Vehicle } from '../lib/stats';
import { Button } from './Button';
import { Field } from './Field';
import { Num } from './Num';
import { Segmented } from './Segmented';
import { Sheet } from './Sheet';

/** Mounted anew on opening, scoped to the selected vehicle. */
export function FuelDiscountSheet({ vehicle, official, onClose }: {
  vehicle: Vehicle; official: number | null; onClose: () => void;
}) {
  const { updateVehicle } = useData();
  const { showToast } = useToast();
  const initial = vehicleDiscount(vehicle);
  const [kind, setKind] = useState<'none' | FuelDiscount['kind']>(initial?.value ? initial.kind : 'none');
  const [value, setValue] = useState(initial ? String(initial.value) : '');
  const [saving, setSaving] = useState(false);
  const amount = parseDecimal(value);
  const valid = kind === 'none' || Number.isFinite(amount) && amount >= 0 &&
    (kind === 'percent' ? amount < 100 : amount <= 20 && (official === null || amount < official));
  const discount: FuelDiscount | null = kind === 'none' ? null : { kind, value: amount };
  const next = official !== null && valid ? discountedPrice(official, discount) : null;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const receipt = await updateVehicle(vehicle.id, { priceDiscount: discount, priceAdjustment: 0, manualPricePerLiter: null });
      const acknowledged = await Promise.race([receipt.settled, new Promise<null>(resolve => setTimeout(() => resolve(null), 6000))]);
      if (acknowledged === false) throw new Error('discount-rejected');
      showToast({ tone: acknowledged ? 'success' : 'info', title: acknowledged ? 'ההנחה נשמרה' : 'ההנחה נשמרה במכשיר', detail: acknowledged ? undefined : 'תסתנכרן כשיהיה חיבור לשרת' });
      onClose();
    } catch { showToast({ tone: 'error', title: 'ההנחה לא נשמרה', detail: 'אפשר לנסות שוב' }); }
    finally { setSaving(false); }
  }

  return <Sheet open onClose={onClose} title={<h2 className="text-[18px] font-semibold">הנחה מהמחיר הרשמי</h2>}>
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-muted">המחיר מתעדכן אוטומטית. רק ההנחה נשארת קבועה.</p>
      <Segmented ariaLabel="סוג הנחה" value={kind} onChange={nextKind => { setKind(nextKind); setValue(''); }} options={[
        { value: 'none', label: 'בלי הנחה' }, { value: 'amount', label: '₪ לליטר' }, { value: 'percent', label: 'אחוזים' },
      ]} />
      {kind !== 'none' ? <Field label={kind === 'percent' ? 'שיעור ההנחה' : 'הנחה לליטר'} inputMode="decimal" value={value}
        onChange={event => setValue(event.target.value)} suffix={kind === 'percent' ? '%' : '₪'} placeholder="0"
        error={value.trim() && !valid ? 'הזינו הנחה חיובית הקטנה מהמחיר המלא' : undefined} /> : null}
      <div className="flex items-center justify-between rounded-[14px] bg-surface-2 p-4">
        <span className="text-[14px]">המחיר לתדלוק הבא</span><Num className="text-[24px] font-semibold">{next !== null ? price(next) : '—'}</Num>
      </div>
      <Button full onClick={() => void save()} disabled={!valid || saving} loading={saving}>שמירה</Button>
    </div>
  </Sheet>;
}
