import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/Button';
import { AppMark, GoogleMark } from '../components/icons';

export function SignIn() {
  const { signIn, signingIn, error } = useAuth();
  return <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-bg px-7 pb-safe pt-safe">
    <div className="flex flex-1 flex-col justify-center py-12">
      <span className="mb-7 flex size-16 items-center justify-center rounded-[18px] bg-accent text-accent-contrast"><AppMark size={35} /></span>
      <h1 className="text-[42px] font-semibold leading-tight text-ink">טנק מלא</h1>
      <p className="mt-3 text-[20px] leading-relaxed text-muted">צריכה, הוצאות ומצב המיכל.<br />כל התדלוקים במקום אחד.</p>
      <div className="mt-12 flex flex-col gap-4">
        <button type="button" disabled={signingIn} onClick={() => void signIn()} className="flex min-h-[56px] w-full items-center justify-center gap-3 rounded-[14px] border border-line bg-surface px-4 text-[17px] font-semibold text-ink shadow-card transition-colors hover:bg-surface-2 disabled:opacity-60">
          {signingIn ? <Spinner /> : <GoogleMark size={22} />}
          {signingIn ? 'מתחברים…' : 'התחברות עם Google'}
        </button>
        {error ? <p role="alert" className="text-[15px] leading-relaxed text-danger-ink">{error}</p> : null}
        <p className="text-center text-[14px] text-muted">הנתונים נשמרים בחשבון שלך.</p>
      </div>
    </div>
    <footer className="flex items-center justify-center gap-5 py-6 text-[14px] text-muted">
      <Link className="flex min-h-[44px] items-center" to="/legal/privacy">פרטיות</Link>
      <Link className="flex min-h-[44px] items-center" to="/legal/terms">תנאי שימוש</Link>
    </footer>
  </main>;
}
