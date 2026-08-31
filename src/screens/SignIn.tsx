import { useAuth } from "../context/AuthContext";
import { Spinner } from "../components/Button";
import { AppMark, GoogleMark } from "../components/icons";

/** Sign-in (design 05). Google is the only identity provider. */
export function SignIn() {
  const { signIn, signingIn, error } = useAuth();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col justify-between bg-bg px-6 pb-10 pt-safe">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <span className="flex size-[76px] items-center justify-center rounded-[24px] bg-accent text-accent-contrast">
          <AppMark size={46} />
        </span>

        <div className="flex flex-col gap-2.5">
          <h1 className="text-[30px] font-bold text-ink">טנק מלא</h1>
          <p className="mx-auto max-w-[300px] text-[15px] leading-relaxed text-muted">
            רישום תדלוקים, מעקב צריכה ועלויות — הכול במקום אחד.
          </p>
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
          ההתחברות מהווה הסכמה <span className="font-semibold text-accent">לתנאי השימוש</span>{" "}
          ו<span className="font-semibold text-accent">למדיניות הפרטיות</span>.
        </p>

        <p className="text-center text-[12.5px] text-muted/80">
          בשלב הבא נוסיף את הרכב הראשון שלכם.
        </p>
      </div>
    </div>
  );
}
