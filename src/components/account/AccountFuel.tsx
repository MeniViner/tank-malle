import { useMemo, useState } from "react";
import { useData } from "../../context/DataContext";
import { FUEL_TYPE_LABELS, dayMonthShort, price } from "../../lib/format";
import { vehicleDiscount } from "../../lib/prices/discount";
import { describeOfficialPrice, officialPriceFor } from "../../lib/prices/regulated";
import type { MarketFuelType } from "../../lib/prices/marketSource";
import { useMarketFuelPrice } from "../../hooks/useMarketFuelPrice";
import { GroupRow } from "../DesignPrimitives";
import { FuelDiscountSheet } from "../FuelDiscountSheet";
import { NumericText, NumRun, Percent, PricePerLiter } from "../Fmt";
import { CoinIcon, TagIcon } from "../icons";
import { MarketFuelPrice } from "../MarketFuelPrice";
import { Sheet } from "../Sheet";

export function AccountFuel() {
  const { activeVehicle, prices } = useData();
  const [today] = useState(() => Date.now());
  const [priceOpen, setPriceOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const fuel = activeVehicle?.fuelType ?? "95";
  const official = useMemo(() => officialPriceFor(prices, fuel, today), [prices, fuel, today]);
  const discount = vehicleDiscount(activeVehicle);
  const title = fuel === "95" ? "מחיר בנזין 95" : fuel === "98" ? "מחיר בנזין 98" : fuel === "diesel" ? "מחיר סולר" : "מחיר הדלק";
  const marketFuel = fuel === "98" || fuel === "diesel" ? fuel : null;

  return <section className="account-section" aria-labelledby="account-fuel-heading">
    <h2 id="account-fuel-heading" className="account-section-title">דלק ומחיר</h2>
    <div className="tm-group">
      {activeVehicle?.fuelType === "95" ? <GroupRow testId="account-discount" icon={<TagIcon />} title="הנחה בתדלוק"
        value={discount && discount.value > 0 ? discount.kind === "percent" ? <Percent value={discount.value} /> : <PricePerLiter value={discount.value} /> : "אין"}
        onClick={() => setDiscountOpen(true)} /> : null}
      {official.price === null && marketFuel ? <MarketPriceRow fuel={marketFuel} onOpen={() => setPriceOpen(true)} />
        : <GroupRow testId="account-fuel-price" icon={<CoinIcon />} title={<NumericText>{title}</NumericText>}
          ariaLabel={`${title}, ${official.price === null ? "לא ידוע" : price(official.price)}`}
          value={<NumRun>{official.price === null ? "—" : price(official.price)}</NumRun>} onClick={() => setPriceOpen(true)} />}
    </div>
    <Sheet open={priceOpen} onClose={() => setPriceOpen(false)} title={<h2><NumericText>{title}</NumericText></h2>}>
      <div className="account-sheet-stack">
        {official.price !== null || !marketFuel ? <>
          <NumRun block className="account-price-reading">{official.price === null ? "—" : price(official.price)}</NumRun>
          <p><NumericText>{`${FUEL_TYPE_LABELS[fuel] ?? "דלק"} · ${official.price === null ? "אין מחיר רשמי לסוג הדלק הזה" : describeOfficialPrice(official)}`}</NumericText></p>
          {official.updatedAt ? <p className="account-note"><NumericText>{`עודכן ${dayMonthShort(official.updatedAt)}`}</NumericText></p> : null}
          {fuel === "95" ? <p className="account-note">המחיר הרשמי הוא תקרה. המחיר ששולם בפועל נשמר בכל תדלוק, והנחה אישית נשארת נפרדת ממנו.</p> : null}
        </> : null}
        {marketFuel ? <MarketFuelPrice fuelType={marketFuel} /> : null}
      </div>
    </Sheet>
    {discountOpen && activeVehicle?.fuelType === "95" ? <FuelDiscountSheet key={activeVehicle.id} vehicle={activeVehicle}
      official={official.price} onClose={() => setDiscountOpen(false)} /> : null}
  </section>;
}

function MarketPriceRow({ fuel, onOpen }: { fuel: MarketFuelType; onOpen: () => void }) {
  const { reading } = useMarketFuelPrice();
  const title = fuel === "diesel" ? "מחירון סולר" : "מחירון בנזין 98";
  return <GroupRow testId="account-fuel-price" icon={<CoinIcon />} title={<NumericText>{title}</NumericText>}
    ariaLabel={`${title}, ${reading ? price(reading.prices[fuel]) : "לא ידוע"}`}
    value={<NumRun>{reading ? price(reading.prices[fuel]) : "—"}</NumRun>} onClick={onOpen} />;
}
