import { useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Spinner } from "../components/Button";
import { NumericText } from "../components/Fmt";
import { CheckIcon, GoogleMark, TabPumpIcon } from "../components/icons";
import "../entry-design.css";

export function SignIn() {
  const { signIn, signingIn, error } = useAuth();
  const [consent, setConsent] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [shake, setShake] = useState(false);
  const checkbox = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const consentId = useId();
  const invalidConsent = attempted && !consent;

  function submit() {
    if (submitting.current || signingIn) return;
    if (!consent) {
      setAttempted(true);
      setShake(true);
      checkbox.current?.focus();
      return;
    }
    // Keep the actual popup call in this user gesture, including installed Safari.
    submitting.current = true;
    void signIn().finally(() => { submitting.current = false; });
  }

  return <main className="entry-page entry-signin" data-testid="signin">
    <div className="entry-brand"><span className="entry-brand-mark"><TabPumpIcon size={22}/></span><span>טנק מלא</span></div>
    <h1 className="entry-signin-title">כל תדלוק, כל שקל, כל ק״מ.</h1>
    <p className="entry-intro">צריכה אמיתית, הוצאה חודשית, ומתי לתדלק. במקום אחד, גם בלי קליטה.</p>
    <div className="entry-signin-space"/>
    <form className="entry-signin-form" noValidate onSubmit={event => { event.preventDefault(); submit(); }}>
      <div className={"entry-consent" + (shake ? " entry-consent-shake" : "")}
        onAnimationEnd={() => setShake(false)}>
        <label className="entry-consent-control" htmlFor={consentId}>
          <input ref={checkbox} id={consentId} type="checkbox" data-testid="signin-consent"
            checked={consent} disabled={signingIn} aria-invalid={invalidConsent || undefined}
            aria-label="קראתי ואני מסכים/ה לתנאי השימוש ולמדיניות הפרטיות"
            aria-describedby={invalidConsent ? consentId + "-error" : undefined}
            onChange={event => { setConsent(event.currentTarget.checked); setShake(false); }}/>
          <span aria-hidden="true"><CheckIcon size={19}/></span>
        </label>
        <div className="entry-consent-copy">
          <label htmlFor={consentId}>קראתי ואני מסכים/ה</label>
          <Link to="/legal/terms">לתנאי השימוש</Link>
          <Link to="/legal/privacy">ולמדיניות הפרטיות</Link>
        </div>
      </div>
      {invalidConsent ? <p id={consentId + "-error"} data-testid="signin-consent-error" className="entry-error" role="alert">
        צריך לסמן את התיבה כדי להמשיך
      </p> : null}
      <button type="submit" className="entry-google" data-testid="signin-google" disabled={signingIn} aria-busy={signingIn || undefined}>
        {signingIn ? <Spinner/> : <GoogleMark size={22}/>}
        <span>{signingIn ? "מתחברים…" : <>התחברות עם <bdi dir="ltr">Google</bdi></>}</span>
      </button>
      {error ? <p data-testid="signin-auth-error" className="entry-error" role="alert"><NumericText>{error}</NumericText></p> : null}
      <p className="entry-trust">הנתונים נשמרים בחשבון שלכם.</p>
    </form>
  </main>;
}
