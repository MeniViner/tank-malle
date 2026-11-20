import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { exitDemo, startDemo, type DemoKind } from "../lib/demo/demo";
import { BatteryIcon, PumpIcon } from "./icons";
import { Sheet } from "./Sheet";
import "../demo-design.css";

/** "See it with sample data": a fuel car or an electric one, kept on this device only. */
export function DemoStart({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const start = (kind: DemoKind) => { setOpen(false); startDemo(user.uid, kind); navigate("/", { replace: true }); };
  const options = <div className="demo-start-options">
    <button type="button" className="tm-chip" data-testid="demo-start-fuel" onClick={() => start("fuel")}><PumpIcon size={18} />רכב בנזין</button>
    <button type="button" className="tm-chip" data-testid="demo-start-ev" onClick={() => start("ev")}><BatteryIcon size={18} />רכב חשמלי</button>
  </div>;
  // In the first-run wizard a single line, so the plate keypad keeps its room.
  if (compact) return <>
    <button type="button" className="wizard-text-action demo-start-link" data-testid="demo-start" onClick={() => setOpen(true)}>אין עדיין רכב? צפייה בנתוני דוגמה</button>
    <Sheet open={open} onClose={() => setOpen(false)} title="נתוני דוגמה">
      <div className="demo-start demo-start-sheet">
        <p>האפליקציה תיפתח עם רכב לדוגמה ושנה של תדלוקים, כדי לראות איך הכל נראה. שום דבר לא נשמר בחשבון, ואפשר לצאת בכל רגע.</p>
        {options}
      </div>
    </Sheet>
  </>;
  return <div className="demo-start" data-testid="demo-start">
    <p>רוצים לראות קודם איך זה נראה? אפשר לפתוח את האפליקציה עם נתוני דוגמה:</p>
    {options}
  </div>;
}

/** Shown on every screen while the sample stands in for the account. */
export function DemoBanner() {
  const { user } = useAuth();
  const { demo } = useData();
  const navigate = useNavigate();
  if (!demo || !user) return null;
  return <div className="demo-banner" role="status" data-testid="demo-banner">
    <div>
      <b>מוצגים נתוני דוגמה</b>
      <span>מה שתשנו כאן לא נשמר בחשבון, רק במכשיר הזה, ונמחק ביציאה מהדוגמה.</span>
    </div>
    <button type="button" data-testid="demo-exit" onClick={() => { exitDemo(user.uid); navigate("/", { replace: true }); }}>יציאה</button>
  </div>;
}
