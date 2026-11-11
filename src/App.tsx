import { Atmosphere } from "./components/Atmosphere";
import { VehicleYear, ReminderDetail, IssueDetail } from "./screens/VehicleDetails";
import { Notifications } from "./screens/Notifications";
import { VehicleRecordEditor } from "./components/VehicleRecordEditor";
import { useStats } from "./hooks/useStats";
import { usePublishSummary } from "./hooks/usePublishSummary";
import { RouteScroll } from "./components/RouteScroll";
import { lazy, Suspense, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { useData } from "./context/DataContext";
import { Toaster } from "./components/Toaster";
import { TabBar } from "./components/TabBar";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { Skeleton } from "./components/Card";
import OpenNotification from "./screens/OpenNotification";
import { Splash } from "./screens/Splash";
import { Onboarding } from "./screens/Onboarding";
import { SignIn } from "./screens/SignIn";
const VehicleWizard = lazy(() => import("./screens/VehicleWizard").then((m) => ({ default: m.VehicleWizard })));
import { Home } from "./screens/Home";
import { FillupForm } from "./screens/FillupForm";
import { History } from "./screens/History";
const Maintenance = lazy(() => import("./screens/Maintenance").then(m => ({ default: m.Maintenance })));
const Account = lazy(() => import("./screens/Account").then((m) => ({ default: m.Account })));
const VehicleManager = lazy(() => import("./screens/VehicleManager").then((m) => ({ default: m.VehicleManager })));
const VehicleEdit = lazy(() => import("./screens/VehicleEdit").then((m) => ({ default: m.VehicleEdit })));
const ImportData = lazy(() => import("./screens/ImportData").then((m) => ({ default: m.ImportData })));
const Unsynced = lazy(() => import("./screens/Unsynced").then((m) => ({ default: m.Unsynced })));
const Legal = lazy(() => import("./screens/Legal").then((m) => ({ default: m.Legal })));
const Feedback = lazy(() => import("./screens/Feedback").then((m) => ({ default: m.Feedback })));

// Recharts is by far the heaviest dependency and is only needed on one tab,
// so it is split out of the initial bundle.
const Statistics = lazy(() =>
  import("./screens/Statistics").then((m) => ({ default: m.Statistics })),
);

// Admin is a rarely used, read-heavy screen — no reason to ship it to
// everyone's first paint.
const Admin = lazy(() => import("./screens/Admin").then((m) => ({ default: m.Admin })));

const ONBOARDING_KEY = "tm.onboarded";
const ALWAYS_REACHABLE = ["/vehicles/new", "/admin", "/legal", "/account", "/settings", "/feedback", "/notifications"];
const needsFirstVehicle = (pathname: string, vehicleCount: number) => vehicleCount === 0
  && !ALWAYS_REACHABLE.some(path => pathname === path || pathname.startsWith(`${path}/`));

/** Entry screens can replace a route; keep the one atmosphere on that screen. */
function AppAtmosphere() {
  const { pathname } = useLocation();
  const { user, loading, signingOut } = useAuth();
  const { ready, vehicles, accountDeletionPending } = useData();
  const route = pathname.startsWith("/legal") ? pathname : !user ? "/"
    : !loading && !signingOut && ready && !accountDeletionPending && needsFirstVehicle(pathname, vehicles.length)
      ? "/vehicles/new" : pathname;
  return <Atmosphere route={route} />;
}

export default function App() {
  return (
    <>
      <AppAtmosphere />
      {import.meta.env.VITE_LOCAL_CARE === "1" ? <div className="mx-auto max-w-[430px] bg-warning-soft px-3 py-1.5 text-center text-xs text-warning-ink">תצוגה מקומית · נתוני הדגמה</div> : null}
      <RouteScroll />
      <Suspense fallback={<Splash />}><Shell /></Suspense>
      {/* Mounted unconditionally: this is what registers the service worker,
          so the app is installable and offline-capable before sign-in too. */}
      <UpdatePrompt />
      <VehicleRecordEditor />
      <Toaster />
    </>
  );
}

function Shell() {
  const { user, loading, signingOut } = useAuth();
  const { ready, activeVehicles, vehicles, accountDeletionPending } = useData();
  const location = useLocation();
  const stats = useStats();
  usePublishSummary(stats);

  const [onboarded, setOnboarded] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDING_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (loading || signingOut) return <Splash />;

  // The legal pages must be reachable before signing in — that is exactly
  // when someone wants to read them.
  if (location.pathname.startsWith("/legal")) {
    return (
      <div className="app-shell mx-auto flex min-h-dvh w-full max-w-[430px] flex-col">
        <Routes>
          <Route path="/legal/:doc" element={<Legal />} />
          <Route path="*" element={<Navigate to="/legal/terms" replace />} />
        </Routes>
      </div>
    );
  }

  if (!user) {
    if (!onboarded) {
      return (
        <Onboarding
          onDone={() => {
            try {
              localStorage.setItem(ONBOARDING_KEY, "1");
            } catch {
              /* storage unavailable */
            }
            setOnboarded(true);
          }}
        />
      );
    }
    return <SignIn />;
  }

  if (!ready) return <Splash />;
  if (accountDeletionPending && location.pathname !== "/account") return <Navigate to="/account" replace />;

  // A signed-in user with no vehicle at all goes straight to the wizard —
  // except on routes that are meaningful without one (admin, legal, account),
  // which must stay reachable.
  if (needsFirstVehicle(location.pathname, vehicles.length)) return <VehicleWizard key={user.uid} firstRun />;

  // Only the four primary destinations keep tabs. Pushed screens have a back control.
  const showTabBar = ["/", "/history", "/stats", "/vehicle"].includes(location.pathname.replace(/\/+$/, "") || "/");

  return (
    <div className="app-shell mx-auto flex min-h-dvh w-full max-w-[430px] flex-col">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/vehicle" element={<Maintenance />} />
        <Route path="/vehicle/edit/:vehicleId" element={<VehicleEdit key={user.uid} />} />
        <Route path="/vehicle/years/:year" element={<VehicleYear />} />
        <Route path="/vehicle/reminders/:planId" element={<ReminderDetail />} />
        <Route path="/vehicle/issues/:issueId" element={<IssueDetail />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/open" element={<OpenNotification />} />
        <Route path="/history" element={<History />} />
        <Route
          path="/stats"
          element={
            <Suspense fallback={<StatsFallback />}>
              <Statistics />
            </Suspense>
          }
        />
        <Route path="/account" element={<Account />} />
        <Route path="/settings" element={<Navigate to="/account" replace />} />
        <Route path="/settings/profile" element={<Navigate to="/account" replace />} />
        <Route path="/settings/vehicles" element={<VehicleManager />} />
        <Route path="/settings/import" element={<ImportData />} />
        <Route path="/settings/unsynced" element={<Unsynced />} />
        <Route path="/legal/:doc" element={<Legal />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route
          path="/admin"
          element={
            <Suspense fallback={<StatsFallback />}>
              <Admin />
            </Suspense>
          }
        />
        <Route path="/vehicles/new" element={<VehicleWizard key={user.uid} />} />
        <Route path="/fillup/new" element={<FillupForm />} />
        <Route path="/fillup/:fillupId" element={<FillupForm />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {showTabBar ? <TabBar canAddFillup={activeVehicles.length > 0} /> : null}
    </div>
  );
}

function StatsFallback() {
  return (
    <main className="flex flex-1 flex-col gap-3 px-5 pb-[104px] pt-safe">
      <div className="pb-1 pt-4">
        <Skeleton className="h-7 w-36" />
      </div>
      <Skeleton className="h-[46px] rounded-pill" />
      <div className="flex gap-3">
        <Skeleton className="h-[84px] flex-1 rounded-card" />
        <Skeleton className="h-[84px] flex-1 rounded-card" />
      </div>
      <Skeleton className="h-[214px] rounded-card" />
      <Skeleton className="h-[214px] rounded-card" />
    </main>
  );
}
