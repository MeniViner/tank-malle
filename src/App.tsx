import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { useData } from "./context/DataContext";
import { Toaster } from "./components/Toaster";
import { TabBar } from "./components/TabBar";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { Skeleton } from "./components/Card";
import { Splash } from "./screens/Splash";
import { Onboarding } from "./screens/Onboarding";
import { SignIn } from "./screens/SignIn";
import { VehicleWizard } from "./screens/VehicleWizard";
import { Home } from "./screens/Home";
import { FillupForm } from "./screens/FillupForm";
import { History } from "./screens/History";
import { Settings } from "./screens/Settings";
import { Profile } from "./screens/Profile";
import { VehicleManager } from "./screens/VehicleManager";
import { ImportData } from "./screens/ImportData";
import { Legal } from "./screens/Legal";
import { Feedback } from "./screens/Feedback";

// Recharts is by far the heaviest dependency and is only needed on one tab,
// so it is split out of the initial bundle.
const Statistics = lazy(() =>
  import("./screens/Statistics").then((m) => ({ default: m.Statistics })),
);

// Admin is a rarely used, read-heavy screen — no reason to ship it to
// everyone's first paint.
const Admin = lazy(() => import("./screens/Admin").then((m) => ({ default: m.Admin })));

const ONBOARDING_KEY = "tm.onboarded";

export default function App() {
  return (
    <>
      <Shell />
      {/* Mounted unconditionally: this is what registers the service worker,
          so the app is installable and offline-capable before sign-in too. */}
      <UpdatePrompt />
      <Toaster />
    </>
  );
}

function Shell() {
  const { user, loading } = useAuth();
  const { ready, activeVehicles, vehicles } = useData();
  const location = useLocation();

  const [onboarded, setOnboarded] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDING_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Hold the splash for a beat so the app never flashes between states on a
  // fast connection.
  const [splashDone, setSplashDone] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSplashDone(true), 900);
    return () => clearTimeout(timer);
  }, []);

  if (loading || !splashDone) return <Splash />;

  // The legal pages must be reachable before signing in — that is exactly
  // when someone wants to read them.
  if (location.pathname.startsWith("/legal")) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-bg">
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

  // A signed-in user with no vehicle at all goes straight to the wizard —
  // except on routes that are meaningful without one (admin, legal, profile),
  // which must stay reachable.
  const ALWAYS_REACHABLE = ["/vehicles/new", "/admin", "/legal", "/settings/profile"];
  const needsFirstVehicle =
    vehicles.length === 0 &&
    !ALWAYS_REACHABLE.some((path) => location.pathname.startsWith(path));

  if (needsFirstVehicle) return <VehicleWizard firstRun />;

  // Full-screen flows (the fill-up form, the vehicle wizard) replace the tab
  // bar rather than sitting under it.
  const showTabBar =
    !location.pathname.startsWith("/fillup/") &&
    !location.pathname.startsWith("/vehicles/new") &&
    !location.pathname.startsWith("/legal");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-bg">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/history" element={<History />} />
        <Route
          path="/stats"
          element={
            <Suspense fallback={<StatsFallback />}>
              <Statistics />
            </Suspense>
          }
        />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/profile" element={<Profile />} />
        <Route path="/settings/vehicles" element={<VehicleManager />} />
        <Route path="/settings/import" element={<ImportData />} />
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
        <Route path="/vehicles/new" element={<VehicleWizard />} />
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
