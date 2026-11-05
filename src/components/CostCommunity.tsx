import { useNavigate } from 'react-router-dom';
import type { TcoResult } from '../lib/tco';
import { int, percentPlain } from '../lib/format';
import { useCostComparison } from '../hooks/useCostComparison';
import { Money, NumRun } from './Fmt';
import { Button } from './Button';

export function CostCommunity({ tco }: { tco: TcoResult }) {
  const state = useCostComparison(tco), navigate = useNavigate();
  const result = state.comparison;
  return <div className="tm-tco-community" data-testid="tco-community-status" aria-live="polite">
    {!state.sharing ? <><p className="tm-tco-note">שיתוף סיכום העלות כבוי.</p><Button variant="ghost" onClick={() => navigate('/account')}>הגדרות שיתוף עלות</Button></>
      : !state.eligible ? <p className="tm-tco-note">{tco.complete ? 'לא ניתן להציג אחוז השוואה לעלות הזו.' : 'השוואת עלות תופיע אחרי שכל העלויות יושלמו והנתונים יאושרו מהשרת.'}</p>
        : state.status === 'loading' ? <p className="tm-tco-note">טוענים סיכומי עלות מהקהילה…</p>
          : state.status === 'error' ? <><p className="tm-tco-note">לא ניתן לבדוק את סיכומי העלות כרגע. נדרש חיבור לשרת.</p><Button variant="ghost" onClick={state.retry}>ניסיון חוזר</Button></>
            : result?.kind === 'insufficient' ? <p className="tm-tco-note">בסיכומים הזמינים יש <NumRun>{int(result.peers)}</NumRun> {result.peers === 1 ? 'נהג אחר' : 'נהגים אחרים'} עם אותו דגם וסוג דלק. להשוואה נדרשים <NumRun>{int(result.required)}</NumRun>.</p>
              : result?.kind === 'ready' ? <><p className="tm-tco-community-title" data-testid="tco-community-comparison">
                {Math.round(Math.abs(result.differencePercent)) === 0 ? 'העלות שלך דומה לממוצע' : <>אתה משלם <NumRun>{percentPlain(Math.abs(result.differencePercent))}</NumRun> {result.differencePercent < 0 ? 'פחות' : 'יותר'} מהממוצע</>}
              </p><p className="tm-tco-note">מול <NumRun>{int(result.peers)}</NumRun> נהגים אחרים עם אותו דגם וסוג דלק. ממוצע חודשי <Money value={result.peerAverage} />.</p><p className="tm-tco-note">סיכומי עלות חיוביים ומלאים שנהגים בחרו לשתף באותה שיטת חישוב, שעודכנו ב־<NumRun>90</NumRun> הימים האחרונים. תקופת הרישומים של כל נהג יכולה להיות שונה.</p></>
                : <p className="tm-tco-note">לא ניתן לחשב השוואה לנתונים האלה.</p>}
  </div>;
}
