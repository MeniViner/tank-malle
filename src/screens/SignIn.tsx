import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Spinner } from "../components/Button";
import { AppMark, GoogleMark } from "../components/icons";
import { LandingBenefitTile, LandingStatsPreview } from "../components/Landing";

/** The hero colour — also what the browser chrome is tinted to while here. */
const HERO = "#0A3A31";

const BENEFITS = [
  ["זיהוי", "תחנה"],
  ["לפי מספר", "לוחית"],
  ["מחיר דלק", "מעודכן"],
];

/**
 * Public landing / sign-in. Google is the only identity provider.
 *
 * The product comes first: a dark hero states what the app does, and a real
 * statistics card straddles it and the white sheet so the very first screen
 * shows the thing being offered rather than describing it. The card's figures
 * are static demo values — see `Landing.tsx`.
 *
 * Unlike the rest of the app this is a fixed branded composition rather than a
 * themed screen, so it does not flip to a light or dark palette with the
 * device setting.
 */
export function SignIn() {
  const { signIn, signingIn, error } = useAuth();

  // The top of the viewport is the dark hero, so the status bar has to match
  // it — ThemeProvider's own value is right for every screen but this one, and
  // is restored on the way out.
  useEffect(() => {
    const tags = document.querySelectorAll('meta[name="theme-color"]');
    const previous = [...tags].map((tag) => tag.getAttribute("content"));
    tags.forEach((tag) => tag.setAttribute("content", HERO));
    return () => {
      tags.forEach((tag, index) => {
        const value = previous[index];
        if (value !== null) tag.setAttribute("content", value);
      });
    };
  }, []);

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col overflow-hidden bg-[#0A3A31]">
      {/* Hero */}
      <div
        className="relative px-[26px]"
        style={{ paddingTop: "max(34px, calc(env(safe-area-inset-top, 0px) + 22px))" }}
      >
        {/* Off-centre wash so the flat fill reads as depth, not as a block. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-[60px] left-[-40px] size-[280px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgb(52 168 133 / 0.35), transparent 70%)",
          }}
        />

        <div className="tm-rise relative flex items-center gap-2.5">
          <span className="flex size-[30px] items-center justify-center rounded-[10px] bg-[rgb(255_255_255/0.12)] text-[#7FE0C4]">
            <AppMark size={18} />
          </span>
          <span className="text-[15px] font-bold text-[rgb(255_255_255/0.9)]">
            טנק מלא
          </span>
        </div>

        <h1
          className="tm-rise relative mt-[30px] text-[clamp(27px,8.2vw,31px)] font-extrabold leading-[1.2] tracking-[-0.6px] text-white"
          style={{ animationDelay: "70ms", textWrap: "pretty" }}
        >
          כל תדלוק, כל שקל,
          <br />
          כל ק״מ — במקום אחד
        </h1>

        <p
          className="tm-rise relative mt-3.5 max-w-[290px] text-[15.5px] leading-[1.55] text-[rgb(255_255_255/0.62)]"
          style={{ animationDelay: "140ms" }}
        >
          האפליקציה מחשבת לכם צריכה אמיתית, עלות חודשית ומועדי טיפול.
        </p>
      </div>

      {/* The gap between the hero copy and the sheet. It absorbs the extra
          height first, but never shrinks past the card's own overhang — below
          that the card would start covering the supporting sentence, so the
          page scrolls instead. */}
      <div className="min-h-[86px] flex-1" />

      {/* Lower sheet — the continuation of the page, not a modal. */}
      <div
        className="relative rounded-t-[30px] bg-white px-[22px]"
        style={{ paddingBottom: "max(30px, calc(env(safe-area-inset-bottom, 0px) + 26px))" }}
      >
        <div className="tm-pop -mt-[78px]" style={{ animationDelay: "200ms" }}>
          <LandingStatsPreview />
        </div>

        <div className="tm-rise mt-5 flex gap-2" style={{ animationDelay: "300ms" }}>
          {BENEFITS.map(([first, second]) => (
            <LandingBenefitTile key={`${first} ${second}`}>
              {first}
              <br />
              {second}
            </LandingBenefitTile>
          ))}
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-5 rounded-[14px] bg-[#FCE7E3] px-4 py-3 text-center text-[13.5px] font-semibold text-[#A93226]"
          >
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void signIn()}
          disabled={signingIn}
          aria-busy={signingIn}
          className="tm-rise mt-5 flex h-[56px] w-full items-center justify-center gap-2.5 rounded-[16px] bg-[#12211D] text-[17px] font-bold text-white transition-[background-color,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.97] active:bg-[#0A3A31] disabled:pointer-events-none disabled:opacity-60"
          style={{ animationDelay: "380ms" }}
        >
          <span className="flex size-6 flex-none items-center justify-center rounded-full bg-white text-[#12211D]">
            {signingIn ? <Spinner size={14} /> : <GoogleMark size={14} />}
          </span>
          המשך עם Google
        </button>

        <p
          className="tm-rise mt-3.5 text-center text-[12.5px] leading-[1.5] text-[rgb(18_33_29/0.5)]"
          style={{ animationDelay: "440ms" }}
        >
          בהמשך אני מאשר את{" "}
          <Link to="/legal/terms" className="font-semibold text-[#0F6B58]">
            תנאי השימוש
          </Link>{" "}
          ו
          <Link to="/legal/privacy" className="font-semibold text-[#0F6B58]">
            מדיניות הפרטיות
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
