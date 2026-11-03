import { useNavigate } from "react-router-dom";
import { ScreenHeader } from "../components/AppHeader";
import { GroupRow } from "../components/DesignPrimitives";
import { ChevronEnd, ShieldIcon } from "../components/icons";
import { AccountActions } from "../components/account/AccountActions";
import { AccountData } from "../components/account/AccountData";
import { AccountFuel } from "../components/account/AccountFuel";
import { AccountIdentity } from "../components/account/AccountIdentity";
import { AccountMore } from "../components/account/AccountMore";
import { AccountPreferences } from "../components/account/AccountPreferences";
import { useAccountSummary } from "../components/account/useAccountSummary";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import "../account-design.css";

/** A new identity gets a new UI lifetime, including sheets and pending requests. */
export function Account() {
  const { user } = useAuth();
  return <AccountBody key={user?.uid ?? "signed-out"} />;
}

function AccountBody() {
  const navigate = useNavigate();
  const { isAdmin, claimsLoaded } = useAuth();
  const { accountDeletionPending } = useData();
  const summary = useAccountSummary();
  return <main className="account-page pt-safe" data-testid="account-page">
    <ScreenHeader title="חשבון" backLabel="חזרה" backIcon={<ChevronEnd size={22} />} onBack={() => navigate("/")} />
    <div className="account-body">
      <AccountIdentity summary={summary} />
      {accountDeletionPending ? <p role="alert" className="account-recovery">
        מחיקת החשבון ממתינה להשלמה. נתונים שכבר נמחקו לא ישוחזרו. רעננו ונסו שוב דרך ״מחיקת החשבון״ למטה.
      </p> : <>
        <AccountFuel />
        <AccountPreferences />
        <AccountData onImported={summary.refresh} />
        {claimsLoaded && isAdmin ? <section className="account-section" aria-labelledby="account-admin-heading">
          <h2 id="account-admin-heading" className="account-section-title">ניהול</h2>
          <div className="tm-group"><GroupRow testId="account-admin" icon={<ShieldIcon />} title="לוח בקרה" onClick={() => navigate("/admin")} /></div>
        </section> : null}
      </>}
      <AccountMore><AccountActions /></AccountMore>
    </div>
  </main>;
}
