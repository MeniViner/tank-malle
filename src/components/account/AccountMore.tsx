import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useInstallPrompt } from "../../hooks/useInstallPrompt";
import { APP_SHARE_URL, browserShareDeps, buildSharePayload, shareApp } from "../../lib/share";
import { APP_VERSION, BUILD_COMMIT, BUILD_DIRTY } from "../../lib/version";
import { GroupRow } from "../DesignPrimitives";
import { NumRun } from "../Fmt";
import { Sheet } from "../Sheet";
import { UpdateCheckButton } from "../UpdateCheckButton";
import { CheckIcon, CopyIcon, DocumentIcon, MessageIcon, PhoneIcon, ShareIcon } from "../icons";

/** Product sharing never includes the current route, vehicle or account data. */
export function AccountMore({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { state: installState, install } = useInstallPrompt();
  const [manualOpen, setManualOpen] = useState(false);
  const [manualNote, setManualNote] = useState("");
  const [sharing, setSharing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const shareBusy = useRef(false);
  const installBusy = useRef(false);
  const linkInput = useRef<HTMLInputElement>(null);
  const scope = useRef<{ active: boolean } | null>(null);

  // Each account lifetime has its own token, including A → B → A. Late native
  // prompt/clipboard results cannot announce success in a different account.
  useLayoutEffect(() => {
    const token = { active: true };
    scope.current = token;
    return () => { token.active = false; };
  }, [user?.uid]);

  async function share() {
    if (shareBusy.current) return;
    const token = scope.current;
    shareBusy.current = true;
    setSharing(true);
    try {
      const outcome = await shareApp(browserShareDeps());
      if (!token?.active || scope.current !== token) return;
      if (outcome === "copied") showToast({ tone: "success", title: "הקישור הועתק" });
      else if (outcome === "manual") { setManualNote(""); setManualOpen(true); }
      // A completed or dismissed native sheet needs no additional message.
    } catch {
      if (token?.active && scope.current === token) { setManualNote(""); setManualOpen(true); }
    } finally {
      shareBusy.current = false;
      if (token?.active && scope.current === token) setSharing(false);
    }
  }

  async function copyLink() {
    const token = scope.current;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(APP_SHARE_URL);
      if (token?.active && scope.current === token) {
        setManualNote("");
        showToast({ tone: "success", title: "הקישור הועתק" });
      }
    } catch {
      if (!token?.active || scope.current !== token) return;
      linkInput.current?.focus();
      linkInput.current?.select();
      setManualNote("הקישור מסומן. אפשר להעתיק אותו ידנית.");
    }
  }

  async function installApp() {
    if (installState !== "available" || installBusy.current) return;
    const token = scope.current;
    installBusy.current = true;
    setInstalling(true);
    try {
      const accepted = await install();
      if (accepted && token?.active && scope.current === token) {
        showToast({ tone: "success", title: "האפליקציה הותקנה" });
      }
    } catch {
      if (token?.active && scope.current === token) {
        showToast({ tone: "error", title: "לא ניתן לפתוח את ההתקנה כרגע" });
      }
    } finally {
      installBusy.current = false;
      if (token?.active && scope.current === token) setInstalling(false);
    }
  }

  const manualInstall = /iPad|iPhone|iPod/.test(navigator.userAgent)
    ? "בספארי: שיתוף ← הוספה למסך הבית"
    : "בתפריט הדפדפן: התקנת אפליקציה";

  return <section className="account-section" aria-labelledby="account-more-title">
    <h2 id="account-more-title" className="account-section-title">עוד</h2>
    <div className="tm-group">
      <GroupRow icon={<MessageIcon />} title="שליחת משוב" onClick={() => navigate("/feedback")} />
      <GroupRow icon={<ShareIcon />} title="שיתוף האפליקציה" testId="account-share"
        onClick={() => void share()} disabled={sharing} chevron={false} />
      <GroupRow icon={<PhoneIcon />} testId="account-install"
        title={installState === "installed" ? "האפליקציה מותקנת" : "התקנת האפליקציה"}
        subtitle={installState === "manual" ? manualInstall : undefined}
        value={installing ? "ממתינים…" : undefined}
        onClick={installState === "available" ? () => void installApp() : undefined}
        disabled={installing}>
        {installState === "installed" ? <CheckIcon size={20} aria-hidden="true" /> : null}
      </GroupRow>
      <GroupRow icon={<DocumentIcon />} title="תנאי שימוש" onClick={() => navigate("/legal/terms")} />
      <GroupRow icon={<DocumentIcon />} title="מדיניות פרטיות" onClick={() => navigate("/legal/privacy")} />
      {children}
    </div>
    <p className="text-center text-[12px] text-ink-2">
      טנק מלא · גרסה <NumRun>{APP_VERSION}</NumRun> · בילד <NumRun>{BUILD_COMMIT.slice(0, 10)}</NumRun>
      {BUILD_DIRTY ? " · שינויים מקומיים" : ""}
    </p>
    <div className="[&_button]:min-h-11"><UpdateCheckButton /></div>

    <Sheet open={manualOpen} onClose={() => setManualOpen(false)} title="שיתוף האפליקציה">
      <div className="flex flex-col gap-4">
        <p className="text-[15px] text-ink">{buildSharePayload().text}</p>
        <div className="flex items-center gap-2 rounded-[14px] border border-line bg-surface p-2">
          <input ref={linkInput} readOnly dir="ltr" value={APP_SHARE_URL} aria-label="קישור לשיתוף"
            onFocus={event => event.currentTarget.select()}
            className="min-h-11 min-w-0 flex-1 bg-transparent px-2 text-left text-[14px] text-ink" />
          <button type="button" aria-label="העתקת הקישור" onClick={() => void copyLink()}
            className="tm-icon-button flex-none"><CopyIcon size={20} /></button>
        </div>
        {manualNote ? <p role="status" className="text-[13px] text-ink-2">{manualNote}</p> : null}
        <p className="text-[13px] text-ink-2">הקישור לעמוד הראשי ואינו כולל נתונים מהחשבון שלך.</p>
      </div>
    </Sheet>
  </section>;
}
