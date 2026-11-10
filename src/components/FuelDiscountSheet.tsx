import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
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
import { useAccountScope } from './account/useAccountScope';

/** Mounted anew on opening, scoped to the selected vehicle. */
export function FuelDiscountSheet({ vehicle, official, onClose }: {
  vehicle: Vehicle; official: number | null; onClose: () => void;
}) {
  const { updateVehicle, captureVehicleAction } = useData();
  const { user } = useAuth();
  const captureScope = useAccountScope(`${user?.uid ?? ''}/${vehicle.id}`);
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
    const current = captureScope();
    const actionCurrent = captureVehicleAction();
    setSaving(true);
    try {
      const receipt = await updateVehicle(vehicle.id, { priceDiscount: discount, priceAdjustment: 0, manualPricePerLiter: null });
      if (!current()) return;
      void receipt.settled.then(acknowledged => {
        if (!actionCurrent()) return;
        showToast(acknowledged ? { tone: 'success', title: 'ההנחה נשמרה' }
          : { tone: 'error', title: 'ההנחה לא אושרה', detail: 'אפשר לבדוק בשינויים שעוד לא עלו לענן.' });
      });
      onClose();
    } catch { if (current()) showToast({ tone: 'error', title: 'ההנחה לא נשמרה', detail: 'אפשר לנסות שוב' }); }
    finally { if (current()) setSaving(false); }
  }

  return <Sheet open onClose={onClose} title="הנחה בתדלוק">
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-muted">המחיר מתעדכן אוטומטית. רק ההנחה נשארת קבועה.</p>
      <Segmented ariaLabel="סוג הנחה" value={kind} onChange={nextKind => { setKind(nextKind); setValue(''); }} options={[
        { value: 'none', label: 'בלי הנחה' }, { value: 'amount', label: '₪ לליטר' }, { value: 'percent', label: 'אחוזים' },
      ]} />
      {kind !== 'none' ? <Field label={kind === 'percent' ? 'שיעור ההנחה' : 'הנחה לליטר'} inputMode="decimal" value={value}
        onChange={event => setValue(event.target.value)} suffix={kind === 'percent' ? '%' : '₪'} placeholder="0"
        error={value.trim() && !valid ? 'הזינו הנחה חיובית הקטנה מהמחיר המלא' : undefined} /> : null}
      <div className="flex items-center justify-between rounded-md bg-surface-2 p-4">
        <span className="text-[14px]">המחיר לתדלוק הבא</span><Num className="text-[24px] font-semibold">{next !== null ? price(next) : '—'}</Num>
      </div>
      <Button full onClick={() => void save()} disabled={!valid || saving} loading={saving}>שמירה</Button>
    </div>
  </Sheet>;
}
