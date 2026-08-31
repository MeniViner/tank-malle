import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import { auth, googleProvider } from "../lib/firebase";

interface AuthContextValue {
  user: User | null;
  /** True until the first auth state resolution completes. */
  loading: boolean;
  signingIn: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** iOS standalone PWAs cannot keep a popup's opener, so they need redirect. */
function needsRedirect(): boolean {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true;
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return standalone || (iOS && /Safari/.test(navigator.userAgent) && standalone);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Pick up a completed redirect sign-in before settling the auth state.
    getRedirectResult(auth).catch(() => {
      /* no pending redirect */
    });

    return onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    setSigningIn(true);
    try {
      if (needsRedirect()) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      await signInWithPopup(auth, googleProvider);
    } catch (caught) {
      const code = (caught as { code?: string }).code ?? "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        setError(null);
      } else if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        // Popup unavailable in this context — fall back to the redirect flow.
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch {
          setError("ההתחברות נכשלה. נסו שוב.");
        }
      } else if (code === "auth/network-request-failed") {
        setError("אין חיבור לאינטרנט. בדקו את החיבור ונסו שוב.");
      } else if (code === "auth/unauthorized-domain") {
        setError("הדומיין אינו מורשה להתחברות. פנו למנהל המערכת.");
      } else {
        setError("ההתחברות נכשלה. נסו שוב.");
      }
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut(auth);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, signingIn, error, signIn, signOutUser }),
    [user, loading, signingIn, error, signIn, signOutUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
