import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Spinner } from "../components/Button";
import { NumericText } from "../components/Fmt";
import { CheckIcon, GoogleMark, TabPumpIcon } from "../components/icons";
import "../entry-design.css";

import { measurementAvailable, measurementEnabled, setMeasurement, subscribeMeasurement, trackUsage } from "../lib/monitoring/usage";

export function SignIn() {
  const { signIn, signInEmail, signingIn, error } = useAuth();
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [credentialsInvalid, setCredentialsInvalid] = useState(false);
  const [consent, setConsent] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [shake, setShake] = useState(false);
  const checkbox = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const consentId = useId();
  const invalidConsent = attempted && !consent;

  const measuring = useSyncExternalStore(subscribeMeasurement, measurementEnabled, () => false);
  const viewReported = useRef(false);
  useEffect(() => {
    if (measuring && !viewReported.current) trackUsage('signin_viewed');
    viewReported.current = measuring;
  }, [measuring]);

  function submit(withEmail = false) {
    if (submitting.current || signingIn) return;
    if (!consent) {
      setAttempted(true);
      setShake(true);
      checkbox.current?.focus();
      return;
    }
    if (withEmail && (!email.trim() || !password)) {
      setCredentialsInvalid(true);
      return;
    }
    // Keep the actual popup call in this user gesture, including installed Safari.
    submitting.current = true;
    trackUsage('signin_started');
    void (withEmail ? signInEmail(email, password) : signIn()).finally(() => {
      submitting.current = false;
      setPassword("");
    });
  }

  return <main className="entry-page entry-signin" data-testid="signin">
    <div className="entry-brand"><span className="entry-brand-mark"><TabPumpIcon size={22}/></span><span>טנק מלא</span></div>
    <h1 className="entry-signin-title" data-testid="signin-title">כל מה שהרכב עולה. במקום אחד.</h1>
    <p className="entry-intro">דלק או חשמל, טיפולים, ביטוח וטסט; צריכה אמיתית ותזכורות. לרכב פרטי ולרכב של העסק, גם בלי קליטה.</p>
    <div className="entry-signin-space"/>
    <form className="entry-signin-form" noValidate onSubmit={event => { event.preventDefault(); submit(emailOpen); }}>
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
      {measurementAvailable && <label className="entry-consent-copy">
        <input type="checkbox" checked={measuring} onChange={e => setMeasurement(e.currentTarget.checked)} />
        שיתוף נתוני שימוש וביצועים עם Google מהמכשיר הזה (רשות)
      </label>}
      {invalidConsent ? <p id={consentId + "-error"} data-testid="signin-consent-error" className="entry-error" role="alert">
        צריך לסמן את התיבה כדי להמשיך
      </p> : null}
      <button type={emailOpen ? "button" : "submit"} onClick={emailOpen ? () => submit() : undefined} className="entry-google" data-testid="signin-google" disabled={signingIn} aria-busy={signingIn || undefined}>
        {signingIn ? <Spinner/> : <GoogleMark size={22}/>}
        <span>{signingIn ? "מתחברים…" : <>התחברות עם <bdi dir="ltr">Google</bdi></>}</span>
      </button>
      <button type="button" className="entry-email-toggle" data-testid="signin-email-toggle" aria-expanded={emailOpen} aria-controls={consentId + "-email"} disabled={signingIn}
        onClick={() => { setEmailOpen(open => !open); setPassword(""); setCredentialsInvalid(false); }}>
        {emailOpen ? "סגירת כניסה באימייל" : "התחברות עם אימייל וסיסמה"}
      </button>
      {emailOpen ? <div id={consentId + "-email"} className="entry-email-fields">
        <label>אימייל<input type="email" name="email" dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} disabled={signingIn}
          onChange={event => { setEmail(event.currentTarget.value); setCredentialsInvalid(false); }}/></label>
        <label>סיסמה<input type="password" name="password" dir="ltr" autoComplete="current-password" value={password} disabled={signingIn}
          onChange={event => { setPassword(event.currentTarget.value); setCredentialsInvalid(false); }}/></label>
        {credentialsInvalid ? <p className="entry-error" role="alert">יש להזין אימייל וסיסמה.</p> : null}
        <button type="submit" className="entry-email-submit" data-testid="signin-email-submit" disabled={signingIn}>{signingIn ? "מתחברים…" : "כניסה"}</button>
        <p className="entry-trust">לחשבון קיים עם סיסמה. אפשר גם להמשיך עם Google.</p>
      </div> : null}
      {error ? <p data-testid="signin-auth-error" className="entry-error" role="alert"><NumericText>{error}</NumericText></p> : null}
      <p className="entry-trust">הנתונים נשמרים בחשבון שלכם.</p>
    </form>
  </main>;
}
