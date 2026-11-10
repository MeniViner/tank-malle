import { Button } from '../Button';
import { Sheet } from '../Sheet';

/** DESIGN-V3 §7.1 — what "לכלול בעלות הרכב" changes. Copy follows the prototype's explainer. */
export function ExcludeInfoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Sheet open={open} onClose={onClose} title="לכלול בעלות הרכב?">
    <div className="v3-sheet-copy" data-testid="exclude-info-sheet">
      <p>כברירת מחדל כל הוצאה נכנסת ל״כמה הרכב עולה לך״ ולממוצעים החודשיים והשנתיים — כי זה מה שהרכב באמת עולה.</p>
      <p>כיבוי מתאים להוצאה שנרשמה ליומן בשביל התיעוד, אבל לא מייצגת את עלות התפעול: דוח חניה חד־פעמי, אביזר שקניתם במתנה, הוצאה שהעסק מחזיר לכם במלואה.</p>
      <p>ההוצאה תישאר ביומן ובסכום של היומן, עם סימון ״לא בעלות הרכב״. היא לא תיכנס לעלות החודשית, לעלות לק״מ, לממוצעים ולסיכום שמשותף להשוואה.</p>
      <Button full onClick={onClose}>הבנתי</Button>
    </div>
  </Sheet>;
}
