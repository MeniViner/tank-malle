import { AppMark } from "../components/icons";

/** Boot screen (design 01): accent field, mark, wordmark, version. */
export function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-accent px-8 text-accent-contrast">
      <span className="flex size-[86px] items-center justify-center rounded-[26px] bg-[rgb(255_255_255/0.16)]">
        <AppMark size={54} />
      </span>

      <div className="flex flex-col items-center gap-1.5">
        <h1 className="text-[30px] font-bold">טנק מלא</h1>
        <p className="text-[15px] opacity-85">יומן התדלוקים החכם שלך</p>
      </div>

      <span dir="ltr" className="num absolute bottom-10 text-[12.5px] opacity-70">
        גרסה 1.0.0
      </span>
    </div>
  );
}
