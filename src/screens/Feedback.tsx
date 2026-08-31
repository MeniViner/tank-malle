import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { ScreenHeader } from "../components/AppHeader";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { APP_VERSION } from "../lib/version";
import { CheckIcon, HeartIcon, LightbulbIcon, WarningIcon } from "../components/icons";

type Sentiment = "good" | "idea" | "bug";

const OPTIONS: { value: Sentiment; label: string; Icon: (p: { size?: number }) => React.ReactElement }[] =
  [
    { value: "good", label: "מחמאה", Icon: HeartIcon },
    { value: "idea", label: "רעיון", Icon: LightbulbIcon },
    { value: "bug", label: "תקלה", Icon: WarningIcon },
  ];

const PLACEHOLDERS: Record<Sentiment, string> = {
  good: "מה עבד לכם טוב?",
  idea: "מה הייתם רוצים שנוסיף?",
  bug: "מה נשבר, ואיפה בדיוק?",
};

const MAX = 2000;

/** Feedback form. Deliberately one screen, one field, no account questions. */
export function Feedback() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [sentiment, setSentiment] = useState<Sentiment>("idea");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = message.trim();
  const canSend = trimmed.length >= 3 && trimmed.length <= MAX && !sending;

  async function send() {
    if (!canSend || !user) return;
    setSending(true);
    setError(null);
    try {
      await addDoc(collection(db, "feedback"), {
        uid: user.uid,
        displayName: user.displayName ?? null,
        email: user.email ?? null,
        message: trimmed,
        sentiment,
        appVersion: APP_VERSION,
        screen: null,
        createdAt: serverTimestamp(),
      });
      setSent(true);
    } catch {
      setError("השליחה נכשלה. בדקו את החיבור ונסו שוב.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <main className="flex flex-1 flex-col pb-[104px] pt-safe">
        <ScreenHeader title="משוב" onBack={() => navigate("/settings")} />

        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
          <span className="tm-pop flex size-[84px] items-center justify-center rounded-[28px] bg-success-soft text-success-ink">
            <CheckIcon size={38} />
          </span>

          <div className="tm-rise flex flex-col gap-2" style={{ animationDelay: "80ms" }}>
            <h1 className="text-balance text-[23px] font-bold text-ink">תודה על המשוב!</h1>
            <p className="text-pretty max-w-[290px] text-[14.5px] leading-relaxed text-muted">
              קראנו כל מילה. אם השארתם דרך ליצור קשר, ייתכן שנחזור אליכם.
            </p>
          </div>

          <div
            className="tm-rise flex w-full max-w-[280px] flex-col gap-2"
            style={{ animationDelay: "160ms" }}
          >
            <Button full onClick={() => navigate("/settings")}>
              חזרה להגדרות
            </Button>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setMessage("");
              }}
              className="min-h-[44px] text-[14px] font-semibold text-muted transition-transform active:scale-[0.96]"
            >
              שליחת משוב נוסף
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col pb-[104px] pt-safe">
      <ScreenHeader title="משוב" onBack={() => navigate("/settings")} />

      <div className="flex flex-col gap-4 px-5">
        <div className="tm-rise flex flex-col gap-1.5">
          <h1 className="text-balance text-[21px] font-bold text-ink">
            מה דעתכם על טנק מלא?
          </h1>
          <p className="text-pretty text-[14px] leading-relaxed text-muted">
            כל הודעה נקראת. ספרו לנו מה חסר, מה מעצבן או מה עובד מצוין.
          </p>
        </div>

        <div className="tm-rise flex gap-2" style={{ animationDelay: "60ms" }}>
          {OPTIONS.map((option) => {
            const active = option.value === sentiment;
            const { Icon } = option;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setSentiment(option.value)}
                aria-pressed={active}
                className={`flex min-h-[76px] flex-1 flex-col items-center justify-center gap-1.5 rounded-[16px] border text-[13px] font-semibold transition-[background-color,border-color,color,scale] duration-200 active:scale-[0.96] ${
                  active
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-surface text-muted"
                }`}
              >
                <Icon size={20} />
                {option.label}
              </button>
            );
          })}
        </div>

        <Card
          className="tm-rise flex flex-col gap-2 p-3.5"
          style={{ animationDelay: "120ms" }}
        >
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, MAX))}
            placeholder={PLACEHOLDERS[sentiment]}
            rows={7}
            aria-label="תוכן המשוב"
            className="min-h-[150px] w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-muted/70"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] text-muted">
              {user?.email ? `יישלח מהחשבון ${""}` : ""}
              <span dir="ltr">{user?.email ?? ""}</span>
            </span>
            <span className="num text-[11.5px] text-muted/80">
              {trimmed.length}/{MAX}
            </span>
          </div>
        </Card>

        {error ? (
          <p role="alert" className="text-[13px] font-semibold text-danger">
            {error}
          </p>
        ) : null}

        <div className="tm-rise" style={{ animationDelay: "180ms" }}>
          <Button full disabled={!canSend} loading={sending} onClick={() => void send()}>
            שליחת משוב
          </Button>
        </div>

        <p className="text-pretty px-1 text-center text-[11.5px] leading-relaxed text-muted/80">
          המשוב נשמר יחד עם השם והמייל שבחשבון, כדי שנוכל להבין הקשר ולחזור אליכם.
        </p>
      </div>
    </main>
  );
}
