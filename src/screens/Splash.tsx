import { AppMark } from "../components/icons";
import { APP_VERSION } from "../lib/version";

/**
 * Boot screen.
 *
 * A flat accent fill read as unfinished, so the mark now sits inside a soft
 * radial wash with a slow breathing halo. Everything is staggered rather than
 * fading in as one block.
 */
export function Splash() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-accent px-8 text-accent-contrast">
      {/* Depth wash — two offset radial highlights, not a flat colour. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(38rem 26rem at 72% 12%, rgb(255 255 255 / 0.18), transparent 60%)," +
            "radial-gradient(30rem 22rem at 18% 88%, rgb(0 0 0 / 0.16), transparent 62%)",
        }}
      />

      <div className="relative flex flex-col items-center gap-6">
        <span className="relative flex items-center justify-center">
          {/* Slow halo gives the screen a pulse without a spinner. */}
          <span
            aria-hidden="true"
            className="tm-breathe absolute size-[128px] rounded-full bg-[rgb(255_255_255/0.22)] blur-[2px]"
          />
          <span className="tm-pop relative flex size-[92px] items-center justify-center rounded-[30px] bg-[rgb(255_255_255/0.16)] shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_18px_40px_-16px_rgb(0_0_0/0.45)] backdrop-blur-sm">
            <AppMark size={54} />
          </span>
        </span>

        <div className="flex flex-col items-center gap-2">
          <h1
            className="tm-rise text-[32px] font-bold tracking-tight"
            style={{ animationDelay: "90ms" }}
          >
            טנק מלא
          </h1>
          <p
            className="tm-rise text-[15px] opacity-85"
            style={{ animationDelay: "170ms" }}
          >
            יומן התדלוקים החכם שלך
          </p>
        </div>
      </div>

      <span
        dir="ltr"
        className="tm-rise num absolute bottom-10 text-[12px] tracking-wide opacity-65"
        style={{ animationDelay: "300ms" }}
      >
        v{APP_VERSION}
      </span>
    </div>
  );
}
