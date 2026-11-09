import "server-only"

import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import type { Auth } from "firebase-admin/auth"
import type { ServiceAccount } from "firebase-admin"
import { getFirestore } from "firebase-admin/firestore"
import type { Firestore } from "firebase-admin/firestore"

const PRODUCTION_PROJECT_ID = "oneestela-ae9b5"
const STAGING_PROJECT_ID = "one-estela-place-staging"

function envValue(name: string): string {
  return String(process.env[name] || "").trim()
}

function isStagingRuntime(): boolean {
  return envValue("ONEESTELA_ENV").toLowerCase() === "staging"
}

type AdminSettings = {
  projectId: string
  clientEmail: string
  privateKey: string
}

function getAdminSettings(): AdminSettings {
  const clientProjectId = envValue("NEXT_PUBLIC_FIREBASE_PROJECT_ID")
  const configuredAdminProjectId = envValue("FIREBASE_ADMIN_PROJECT_ID")
  const projectId = configuredAdminProjectId || clientProjectId
  const clientEmail = envValue("FIREBASE_ADMIN_CLIENT_EMAIL")
  const privateKey = envValue("FIREBASE_ADMIN_PRIVATE_KEY")

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase Admin credentials. Required env vars: FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY; staging also requires FIREBASE_ADMIN_PROJECT_ID.",
    )
  }

  if (clientProjectId && projectId !== clientProjectId) {
    throw new Error("Firebase Admin and client project identities do not match.")
  }

  if (isStagingRuntime()) {
    if (clientProjectId !== STAGING_PROJECT_ID || configuredAdminProjectId !== STAGING_PROJECT_ID || projectId === PRODUCTION_PROJECT_ID) {
      throw new Error("Staging Firebase project identity is invalid.")
    }

    const stagingServiceAccountSuffix = `@${STAGING_PROJECT_ID}.iam.gserviceaccount.com`
    if (!clientEmail.toLowerCase().endsWith(stagingServiceAccountSuffix)) {
      throw new Error("Staging Firebase Admin credentials must belong to the staging project.")
    }
  }

  return { projectId, clientEmail, privateKey }
}

function getAdminApp() {
  const existingApp = getApps()[0]
  if (existingApp) {
    if (isStagingRuntime()) {
      const settings = getAdminSettings()
      if (existingApp.options.projectId !== settings.projectId || existingApp.options.projectId === PRODUCTION_PROJECT_ID) {
        throw new Error("Existing Firebase Admin app is not the configured staging project.")
      }
    }
    return existingApp
  }

  const { projectId, clientEmail, privateKey } = getAdminSettings()
  const serviceAccount: ServiceAccount = {
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, "\n"),
  }

  return initializeApp({
    credential: cert(serviceAccount),
  })
}

/** Safe diagnostic identity; never exposes credential material. */
export function getFirebaseAdminProjectId(): string {
  const app = getAdminApp()
  const options = app.options as {
    projectId?: unknown
    credential?: { projectId?: unknown }
  }
  return String(options.projectId || options.credential?.projectId || "").trim()
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp())
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp())
}
