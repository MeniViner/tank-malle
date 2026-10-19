import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserPopupRedirectResolver,
  browserLocalPersistence,
  connectAuthEmulator,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { authDomainFor } from "./authFlow";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: authDomainFor(window.location.hostname, import.meta.env.VITE_FIREBASE_PROJECT_ID,
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// The isolated care preview must fail closed if its emulator configuration drifts.
if (import.meta.env.VITE_LOCAL_CARE === '1' && (config.projectId !== 'demo-tankmaleh' || import.meta.env.VITE_USE_EMULATORS !== '1' || !['localhost','127.0.0.1'].includes(window.location.hostname))) {
  throw new Error('Local care preview requires localhost and demo-tankmaleh emulators');
}

export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId);

export const app: FirebaseApp = initializeApp(config);

/** Explicit persistence order keeps Safari/iOS PWA sessions alive. */
export const auth: Auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});

/**
 * Offline-first cache. Every read is served locally and writes are queued
 * while offline, which is what makes "add a fill-up in a parking garage"
 * work. Multi-tab manager avoids the single-tab lock error.
 */
export const db: Firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

if (import.meta.env.VITE_USE_EMULATORS === "1") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
