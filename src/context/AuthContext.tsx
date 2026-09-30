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
import {
  clearIndexedDbPersistence,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  terminate,
} from "firebase/firestore";
import { auth, db, googleProvider } from "../lib/firebase";
import { hasAnyUnacknowledged } from "../lib/outbox";

interface AuthContextValue {
  user: User | null;
  /** True until the first auth state resolution completes. */
  loading: boolean;
  signingIn: boolean;
  /**
   * True from the moment sign-out starts until the page reloads. The shell
   * shows the splash for that window: rendering the sign-in screen while the
   * cache is still being cleared invited a second navigation to race the
   * pending `location.replace`, which is how the account-switch flow got
   * "navigation aborted" errors.
   */
  signingOut: boolean;
  error: string | null;
  /** Mirrors the signed `admin` custom claim on the ID token. */
  isAdmin: boolean;
  /**
   * The sign-in BEFORE the current session, in epoch ms.
   *
   * Firebase's own `metadata.lastSignInTime` is the CURRENT sign-in once the
   * user is signed in, so showing it as "last login" always says "now". The
   * real previous value is kept on the user document and rotated exactly once
   * per authentication event.
   *
   * `null` means there is no previous login — this is the first one.
   * `undefined` means it has not been read yet.
   */
  previousLoginAt: number | null | undefined;
  /** False until the token claims have been read at least once. */
  claimsLoaded: boolean;
  signIn: () => Promise<void>;
  /**
   * Sign out. `keepLocalQueue` skips clearing Firestore's persistent cache,
   * so writes the server has not acknowledged stay queued for the next
   * sign-in of the same account instead of being wiped with the session.
   */
  signOutUser: (options?: { keepLocalQueue?: boolean }) => Promise<void>;
  refreshClaims: () => Promise<void>;
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
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [claimsLoaded, setClaimsLoaded] = useState(false);
  const [previousLoginAt, setPreviousLoginAt] = useState<number | null | undefined>(
    undefined,
  );

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

        if (!nextUser) {
          setIsAdmin(false);
          setClaimsLoaded(true);
          setPreviousLoginAt(undefined);
          return;
        }
        // The claim lives in the signed token, so the rules and the UI agree
        // on it by construction.
        nextUser
          .getIdTokenResult()
          .then((result) => {
            setIsAdmin(result.claims.admin === true);
            return rotateLoginStamps(nextUser.uid, result.claims.auth_time);
          })
          .then((previous) => setPreviousLoginAt(previous))
          .catch(() => {
            setIsAdmin(false);
            setPreviousLoginAt(null);
          })
          .finally(() => setClaimsLoaded(true));
      },
      () => {
        setLoading(false);
        setClaimsLoaded(true);
      },
    );
  }, []);

  /** Force a token refresh — used right after a claim is granted. */
  const refreshClaims = useCallback(async () => {
    if (!auth.currentUser) return;
    const result = await auth.currentUser.getIdTokenResult(true);
    setIsAdmin(result.claims.admin === true);
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

  /**
   * Sign out and leave nothing of this session behind.
   *
   * Signing out of Auth alone left the previous account's Firestore cache and
   * in-memory state in place, so signing in as somebody else rendered the
   * outgoing account's vehicles until the listeners caught up — which is what
   * made "switch account" look broken. Clearing the persistent cache and
   * reloading gives the next sign-in a genuinely clean process.
   */
  const signOutUser = useCallback(async (options: { keepLocalQueue?: boolean } = {}) => {
    setSigningOut(true);
    await signOut(auth);

    // Every query is scoped to users/{uid}/…, so keeping the persistent cache
    // exposes nothing to the next account. Clearing it is only a cleanliness
    // measure — and one that used to wipe a queued, unacknowledged write
    // together with the session. The cache is shared by every account that
    // has signed in on this device, so it is kept whenever ANY of them still
    // has an unacknowledged write, not only the one signing out.
    const keepQueue = options.keepLocalQueue || hasAnyUnacknowledged(localStorage);
    if (!keepQueue) {
      try {
        // The cache can only be cleared while no client is using it.
        await terminate(db);
        await clearIndexedDbPersistence(db);
      } catch {
        /* best effort — a second tab may still hold the lease */
      }
    }

    window.location.replace("/");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      signingIn,
      signingOut,
      error,
      isAdmin,
      previousLoginAt,
      claimsLoaded,
      signIn,
      signOutUser,
      refreshClaims,
    }),
    [
      user,
      loading,
      signingIn,
      signingOut,
      error,
      isAdmin,
      previousLoginAt,
      claimsLoaded,
      signIn,
      signOutUser,
      refreshClaims,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}


/**
 * Rotate the login stamps and return the PREVIOUS login.
 *
 * The ID token's `auth_time` identifies the authentication EVENT, not the
 * token: a page refresh or a background token refresh reuses the same
 * auth_time, so guarding on it is what stops a reload from overwriting the
 * previous-login value with the current one.
 *
 * Run in a transaction so two tabs waking at once cannot both rotate.
 * Timestamps are stored in UTC epoch milliseconds and formatted in the
 * device's timezone at render time.
 */
async function rotateLoginStamps(
  uid: string,
  authTimeClaim: unknown,
): Promise<number | null> {
  // `auth_time` is seconds since the epoch, per the OIDC spec.
  const authTime =
    typeof authTimeClaim === "number"
      ? authTimeClaim * 1000
      : typeof authTimeClaim === "string" && Number.isFinite(Number(authTimeClaim))
        ? Number(authTimeClaim) * 1000
        : null;

  const ref = doc(db, "users", uid);

  if (authTime === null) {
    // Without an auth_time we cannot tell a new sign-in from a refresh, so we
    // read the stored value and change nothing.
    const snapshot = await getDoc(ref).catch(() => null);
    return numberOrNull(snapshot?.data()?.previousLoginAt);
  }

  try {
    return await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.exists() ? snapshot.data() : {};

      const lastProcessed = numberOrNull(data.lastProcessedAuthTime);
      const currentLogin = numberOrNull(data.currentLoginAt);
      const storedPrevious = numberOrNull(data.previousLoginAt);

      // Same authentication event — a refresh or a token renewal. Nothing moves.
      if (lastProcessed === authTime) return storedPrevious;

      transaction.set(
        ref,
        {
          previousLoginAt: currentLogin,
          currentLoginAt: authTime,
          lastProcessedAuthTime: authTime,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      // The first ever sign-in has no predecessor.
      return currentLogin;
    });
  } catch {
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
