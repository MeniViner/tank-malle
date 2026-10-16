import { SignInPreview } from '../components/Previews';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/Button';
import { AppMark, GoogleMark } from '../components/icons';

export function SignIn() {
  const { signIn, signingIn, error } = useAuth();
  return <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-bg pb-safe">
    <div className="flex flex-1 flex-col">
      <header className="flex min-h-[40dvh] flex-col justify-center bg-[#101416] px-6 pb-12 pt-safe text-[#e8ebec]">
      <span className="mb-5 flex items-center gap-2 text-[#4fd3bc]"><AppMark size={24} /><span className="text-[15px] font-bold text-[#e8ebec]">טנק מלא</span></span>
      <h1 className="font-display text-[36px] font-bold leading-tight">כל תדלוק, כל שקל,<br />כל ק״מ — במקום אחד</h1>
      <p className="mt-3 text-[17px] leading-relaxed text-[#959ca1]">צריכת דלק אמיתית, הוצאה חודשית,<br />והערכת מצב המיכל.</p>
      </header>
      <div className="-mt-4 flex flex-1 flex-col gap-5 rounded-t-sheet bg-bg px-6 py-8">
        <SignInPreview />
        <p className="-mt-3 text-center text-[12px] text-muted">נתונים לדוגמה</p>
        <p className="py-1 text-center text-[14px] text-muted">זיהוי תחנה · איתור לפי לוחית · מחיר דלק מעודכן</p>
        <button type="button" disabled={signingIn} onClick={() => void signIn()} className="flex min-h-[56px] w-full items-center justify-center gap-3 rounded-control bg-[#14171a] px-4 text-[17px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60">
          {signingIn ? <Spinner /> : <GoogleMark size={22} />}
          {signingIn ? 'מתחברים…' : 'התחברות עם Google'}
        </button>
        {error ? <p role="alert" className="text-[15px] leading-relaxed text-danger-ink">{error}</p> : null}
        <p className="text-center text-[14px] text-muted">הנתונים נשמרים בחשבון שלך.</p>
      </div>
    </div>
    <footer className="flex items-center justify-center gap-5 px-6 py-6 text-[14px] text-muted">
      <Link className="flex min-h-[44px] items-center" to="/legal/privacy">פרטיות</Link>
      <Link className="flex min-h-[44px] items-center" to="/legal/terms">תנאי שימוש</Link>
    </footer>
  </main>;
}
