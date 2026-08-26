import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Firestore persistent local cache (IndexedDB): returning visits render the
// cached snapshot immediately while background listeners synchronize with
// Firestore. Firestore remains the single source of truth.
let db: ReturnType<typeof getFirestore>;
if (typeof window !== "undefined" && typeof indexedDB !== "undefined") {
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentSingleTabManager({ forceOwnership: false }),
      }),
    });
  } catch {
    // initializeFirestore throws if Firestore was already started without the
    // cache (e.g. another module imported first). Fall back to the default
    // instance so the app keeps working.
    db = getFirestore(app);
  }
} else {
  db = getFirestore(app);
}
const auth = getAuth(app);

export { app, db, auth };
