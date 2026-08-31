import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Spinner } from "../components/Button";
import { AppMark, GoogleMark } from "../components/icons";
import { StatsPreview } from "../components/Previews";

/** Sign-in (design 05). Google is the only identity provider. */
export function SignIn() {
  const { signIn, signingIn, error } = useAuth();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col justify-between bg-bg px-6 pb-10 pt-safe">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <span className="flex size-[64px] items-center justify-center rounded-[20px] bg-accent text-accent-contrast">
          <AppMark size={38} />
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="text-[27px] font-bold text-ink">טנק מלא</h1>
          <p className="mx-auto max-w-[300px] text-[14.5px] leading-relaxed text-muted">
            רישום תדלוקים, מעקב צריכה ועלויות — הכול במקום אחד.
          </p>
        </div>

        {/* A glimpse of the real thing beats another marketing sentence. */}
        <div className="tm-fade-in flex w-full justify-center pt-1">
          <StatsPreview />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[11.5px] text-muted">
          <Feature>איתור רכב לפי לוחית</Feature>
          <Feature>זיהוי תחנה אוטומטי</Feature>
          <Feature>עובד גם בלי אינטרנט</Feature>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {error ? (
          <p
            role="alert"
            className="rounded-[14px] bg-danger-soft px-4 py-3 text-center text-[13.5px] font-semibold text-danger-ink"
          >
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void signIn()}
          disabled={signingIn}
          className="flex min-h-[56px] w-full items-center justify-center gap-3 rounded-pill border border-line bg-surface text-[16px] font-bold text-ink shadow-card active:bg-surface-2 disabled:opacity-50"
        >
          {signingIn ? <Spinner /> : <GoogleMark size={21} />}
          המשך עם Google
        </button>

        <p className="text-center text-[12.5px] leading-relaxed text-muted">
          ההתחברות מהווה הסכמה{" "}
          <Link to="/legal/terms" className="font-semibold text-accent underline-offset-2">
            לתנאי השימוש
          </Link>{" "}
          ו
          <Link to="/legal/privacy" className="font-semibold text-accent underline-offset-2">
            למדיניות הפרטיות
          </Link>
          .
        </p>

        <p className="text-center text-[12.5px] text-muted/80">
          בשלב הבא נוסיף את הרכב הראשון שלכם.
        </p>
      </div>
    </div>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <span className="size-1 rounded-full bg-accent" aria-hidden="true" />
      {children}
    </span>
  );
}
