import { useEffect, useState } from 'react';
import { GroupRow } from '../../DesignPrimitives';
import { NumRun } from '../../Fmt';
import { DownloadIcon, SparkleIcon, TrashIcon } from '../../icons';
import { Toggle } from '../../Segmented';
import { clearCorrections, countCorrections, exportCorrections } from '../../../lib/scan/v2/correctionLog';
import { exportFilename } from '../../../lib/exportFilename';
import { useScanV2 } from './useScanV2';

/**
 * Self-contained Account rows for the scan A/B switch: the `scanV2` choice
 * (per device, default off) and, once there are entries, the export of the
 * on-device correction log. Mounted beside "כפתור תדלקתי פותח מצלמה".
 */
export function ScanV2Toggle() {
  const [on, setOn] = useScanV2();
  const [count, setCount] = useState<number | null>(null), [failed, setFailed] = useState(false), [arming, setArming] = useState(false);
  useEffect(() => {
    let live = true;
    countCorrections().then(n => { if (live) setCount(n); }, () => { if (live) setCount(null); });
    return () => { live = false; };
  }, [on]);
  async function download() {
    try {
      const json = await exportCorrections();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = exportFilename('tank-malle-scan-corrections.json');
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setFailed(false);
    } catch { setFailed(true); }
  }
  return <>
    <GroupRow testId="account-scan-v2" icon={<SparkleIcon />} title="זיהוי ספרות משופר (ניסיוני)"
      subtitle={on ? 'מסגרת כיוון ומסך אימות אחרי כל צילום. במכשיר זה בלבד.' : 'כבוי: הסריקה הרגילה. במכשיר זה בלבד.'}>
      <Toggle checked={on} ariaLabel="זיהוי ספרות משופר (ניסיוני)" onChange={next => { if (!setOn(next)) setFailed(true); }} />
    </GroupRow>
    {count ? <GroupRow testId="account-scan-v2-export" icon={<DownloadIcon />} title="ייצוא תיקוני סריקה"
      subtitle={failed ? 'הייצוא לא הצליח. נסו שוב.' : 'קובץ JSON שנשמר רק במכשיר, לשיפור הזיהוי.'}
      value={<NumRun>{count}</NumRun>} onClick={() => void download()} /> : null}
    {count ? <GroupRow testId="account-scan-v2-clear" icon={<TrashIcon />} danger chevron={false}
      title={arming ? 'לחצו שוב למחיקה סופית' : 'מחיקת תיקוני הסריקה מהמכשיר'}
      onClick={() => {
        if (!arming) { setArming(true); return; }
        setArming(false);
        clearCorrections().then(() => setCount(0), () => setFailed(true));
      }} /> : null}
  </>;
}
