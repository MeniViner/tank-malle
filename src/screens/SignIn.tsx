import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Spinner } from "../components/Button";
import {
  AppMark,
  CheckIcon,
  GoogleMark,
  PinIcon,
  PumpIcon,
  SparkleIcon,
} from "../components/icons";
import { StatsPreview } from "../components/Previews";

const FEATURES = [
  { Icon: SparkleIcon, label: "איתור רכב לפי לוחית" },
  { Icon: PinIcon, label: "זיהוי תחנה אוטומטי" },
  { Icon: PumpIcon, label: "עובד גם בלי אינטרנט" },
];

/** Sign-in. Google is the only identity provider. */
export function SignIn() {
  const { signIn, signingIn, error } = useAuth();
  // Explicit, recorded consent rather than a passive footnote.
  const [accepted, setAccepted] = useState(false);
  const [nudge, setNudge] = useState(false);

  return (
    <div className="tm-aurora relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col justify-between overflow-hidden bg-bg px-6 pb-9 pt-safe">
      <div className="relative flex flex-1 flex-col items-center justify-center gap-7 pt-8 text-center">
        <div className="flex flex-col items-center gap-3.5">
          <span className="tm-pop flex size-[68px] items-center justify-center rounded-[22px] bg-accent text-accent-contrast shadow-[0_2px_4px_rgb(13_35_28/0.12),0_16px_34px_-14px_var(--accent)]">
            <AppMark size={40} />
          </span>

          <div className="flex flex-col gap-1.5">
            <h1
              className="tm-rise text-[28px] font-bold tracking-tight text-ink"
              style={{ animationDelay: "70ms" }}
            >
              טנק מלא
            </h1>
            <p
              className="tm-rise mx-auto max-w-[290px] text-[14.5px] leading-relaxed text-muted"
              style={{ animationDelay: "140ms" }}
            >
              רישום תדלוקים, מעקב צריכה ועלויות — הכול במקום אחד.
            </p>
          </div>
        </div>

        <div className="relative flex w-full justify-center">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-10 top-5 bottom-1 rounded-[32px] bg-accent/25 blur-[38px]"
          />
          <div className="tm-pop relative" style={{ animationDelay: "200ms" }}>
            <StatsPreview />
          </div>
        </div>

        <ul className="flex flex-col gap-2">
          {FEATURES.map((feature, i) => (
            <li
              key={feature.label}
              className="tm-rise flex items-center justify-center gap-2 text-[12.5px] text-muted"
              style={{ animationDelay: `${280 + i * 70}ms` }}
            >
              <span className="flex size-5 items-center justify-center rounded-full bg-accent-soft text-accent">
                <feature.Icon size={12} />
              </span>
              {feature.label}
            </li>
          ))}
        </ul>
      </div>

      <div
        className="tm-rise relative flex flex-col gap-3.5 pt-6"
        style={{ animationDelay: "480ms" }}
      >
        {error ? (
          <p
            role="alert"
            className="rounded-[14px] bg-danger-soft px-4 py-3 text-center text-[13.5px] font-semibold text-danger-ink"
          >
            {error}
          </p>
        ) : null}

        {/* Consent is an affirmative act: the button stays inert until it is
            ticked, and the row shakes rather than silently doing nothing. */}
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-[14px] border p-3 transition-[border-color,background-color] duration-200 ${
            nudge && !accepted
              ? "tm-shake border-danger bg-danger-soft"
              : accepted
                ? "border-accent/40 bg-accent-soft/40"
                : "border-line bg-surface"
          }`}
        >
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => {
              setAccepted(event.target.checked);
              if (event.target.checked) setNudge(false);
            }}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={`mt-px flex size-[22px] flex-none items-center justify-center rounded-[7px] border-2 transition-[background-color,border-color,scale] duration-200 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
              accepted
                ? "scale-100 border-accent bg-accent text-accent-contrast"
                : "border-line bg-surface"
            }`}
          >
            {accepted ? <CheckIcon size={14} /> : null}
          </span>

          <span className="text-[12.5px] leading-relaxed text-ink/85">
            קראתי ואני מסכים{" "}
            <Link
              to="/legal/terms"
              onClick={(event) => event.stopPropagation()}
              className="font-semibold text-accent underline underline-offset-2"
            >
              לתנאי השימוש
            </Link>{" "}
            ו
            <Link
              to="/legal/privacy"
              onClick={(event) => event.stopPropagation()}
              className="font-semibold text-accent underline underline-offset-2"
            >
              למדיניות הפרטיות
            </Link>
            .
          </span>
        </label>

        <button
          type="button"
          onClick={() => {
            if (!accepted) {
              setNudge(true);
              return;
            }
            void signIn();
          }}
          disabled={signingIn}
          aria-disabled={!accepted}
          className={`flex min-h-[56px] w-full items-center justify-center gap-3 rounded-pill border text-[16px] font-bold shadow-raised transition-[background-color,scale,opacity] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 ${
            accepted
              ? "border-line bg-surface text-ink active:bg-surface-2"
              : "border-line/60 bg-surface/70 text-muted"
          }`}
        >
          {signingIn ? <Spinner /> : <GoogleMark size={21} />}
          המשך עם Google
        </button>

        {nudge && !accepted ? (
          <p role="alert" className="text-center text-[12px] font-semibold text-danger">
            יש לאשר את התנאים כדי להמשיך
          </p>
        ) : null}
      </div>
    </div>
  );
}
