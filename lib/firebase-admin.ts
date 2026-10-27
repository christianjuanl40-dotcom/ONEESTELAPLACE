import "server-only"

import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import type { Auth } from "firebase-admin/auth"
import type { ServiceAccount } from "firebase-admin"
import { getFirestore } from "firebase-admin/firestore"
import type { Firestore } from "firebase-admin/firestore"

function getAdminApp() {
  const existingApp = getApps()[0]
  if (existingApp) return existingApp

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase Admin credentials. Required env vars: " +
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY.",
    )
  }

  const serviceAccount: ServiceAccount = {
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, "\n"),
  }

  return initializeApp({
    credential: cert(serviceAccount),
  })
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp())
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp())
}
