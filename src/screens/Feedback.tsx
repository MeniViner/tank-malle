import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useAccountScope } from "../components/account/useAccountScope";
import { ScreenHeader } from "../components/AppHeader";
import { Button } from "../components/Button";
import { Segmented } from "../components/Segmented";
import { Num } from "../components/Num";
import { ChevronDown } from "../components/icons";
import { APP_VERSION } from "../lib/version";
import "../secondary-design.css";

type Sentiment = "good" | "idea" | "bug";
const OPTIONS: { value: Sentiment; label: string }[] = [
  { value: "idea", label: "רעיון" },
  { value: "bug", label: "תקלה" },
  { value: "good", label: "מחמאה" },
];
const PLACEHOLDERS: Record<Sentiment, string> = {
  good: "מה עובד לכם טוב?",
  idea: "מה הייתם רוצים שיהיה?",
  bug: "מה קרה, ובאיזה מסך?",
};
const MAX = 2000;

/** A new account gets a fresh form; an old completion cannot acknowledge its message. */
export function Feedback() {
  const { user } = useAuth();
  return <AccountFeedback key={user?.uid ?? "signed-out"} />;
}

function AccountFeedback() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { captureAccountAction } = useData();
  const captureMount = useAccountScope(user?.uid);
  const inFlight = useRef(false);
  const [sentiment, setSentiment] = useState<Sentiment>("idea");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = message.trim();
  const canSend = !!user && trimmed.length >= 3 && trimmed.length <= MAX && !sending;

  async function send() {
    const accountCurrent = captureAccountAction();
    const mounted = captureMount();
    const current = () => accountCurrent() && mounted();
    if (!canSend || !user || inFlight.current || !current()) return;
    const sender = user;
    const submitted = { message: trimmed, sentiment };
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      // Keep the existing append-only feedback contract. No handled/read state is written.
      await addDoc(collection(db, "feedback"), {
        uid: sender.uid,
        displayName: sender.displayName ?? null,
        email: sender.email ?? null,
        message: submitted.message,
        sentiment: submitted.sentiment,
        appVersion: APP_VERSION,
        screen: null,
        createdAt: serverTimestamp(),
      });
      if (current()) setSent(true);
    } catch {
      if (current()) setError("השליחה נכשלה. המשוב נשאר כאן, ואפשר לנסות שוב.");
    } finally {
      inFlight.current = false;
      if (current()) setSending(false);
    }
  }

  return <main className="tm-secondary-page" data-testid="feedback-page">
    <ScreenHeader title="משוב" onBack={() => navigate("/account")} />
    {sent ? <div className="tm-secondary-body tm-feedback-result" role="status">
      <h2 className="tm-secondary-title tm-secondary-title-result">תודה!</h2>
      <p className="tm-secondary-copy">ההודעה התקבלה. תודה שעזרתם לשפר את טנק מלא.</p>
      <Button full variant="ink" onClick={() => navigate("/account")}>חזרה לחשבון</Button>
      <button type="button" className="tm-secondary-link" onClick={() => { setSent(false); setMessage(""); setError(null); }}>
        שליחת משוב נוסף
      </button>
    </div> : <div className="tm-secondary-body">
      <h2 className="tm-secondary-title">מה חסר לכם?</h2>
      <Segmented ariaLabel="סוג המשוב" value={sentiment} onChange={setSentiment} options={OPTIONS} />
      <div className="tm-secondary-stack">
        <textarea value={message} onChange={event => setMessage(event.target.value.slice(0, MAX))}
          placeholder={PLACEHOLDERS[sentiment]} rows={7} maxLength={MAX} disabled={sending}
          aria-label="תוכן המשוב" aria-describedby="feedback-counter" className="tm-feedback-input" />
        <span id="feedback-counter" className="tm-feedback-counter"><Num>{message.length}/{MAX}</Num></span>
      </div>
      {error ? <p role="alert" className="tm-secondary-notice tm-secondary-notice-error">{error}</p> : null}
      {sending ? <p role="status" className="tm-secondary-note">ממתינים לאישור השליחה. ההודעה תישלח כשהחיבור זמין.</p> : null}
      <details className="tm-secondary-disclosure">
        <summary>מה נשמר עם המשוב?<ChevronDown size={18} /></summary>
        <div className="tm-secondary-disclosure-content tm-secondary-note">
          <p>השם והמייל שבחשבון נשמרים עם ההודעה, כדי שנוכל להבין את ההקשר ולחזור אליכם.</p>
          {user?.email ? <p className="tm-feedback-account">החשבון השולח: <bdi dir="ltr">{user.email}</bdi></p> : null}
        </div>
      </details>
      <div className="tm-secondary-bottom">
        <Button full disabled={!canSend} loading={sending} onClick={() => void send()}>שליחת משוב</Button>
      </div>
    </div>}
  </main>;
}
