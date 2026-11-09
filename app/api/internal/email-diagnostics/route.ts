import "server-only"

import { timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getEmailConfig, getEmailRuntimeDiagnostics } from "@/lib/email-config"
import { getFirebaseAdminProjectId } from "@/lib/firebase-admin"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
// The diagnostic route is read-only, but keep its platform budget aligned with
// the transactional routes so a cold server configuration read is not
// mistaken for a dispatch failure.
export const maxDuration = 60

const EMAIL_DISPATCH_IMPLEMENTATION = "after-scoped-outbox-v1"

function getDispatchDiagnostics() {
  const commit = String(process.env.VERCEL_GIT_COMMIT_SHA || "").trim()
  return {
    implementation: EMAIL_DISPATCH_IMPLEMENTATION,
    immediateAfter: true,
    scopedJobIds: true,
    scheduledFallback: true,
    deploymentCommitSha: /^[a-f0-9]{7,64}$/i.test(commit) ? commit : null,
  }
}

function matchesSecret(request: NextRequest): boolean {
  const expected = String(process.env.CRON_SECRET || "")
  if (!expected) return false
  const header = request.headers.get("authorization") || request.headers.get("x-cron-secret") || ""
  const supplied = header.replace(/^Bearer\s+/i, "").trim()
  const left = Buffer.from(expected)
  const right = Buffer.from(supplied)
  return left.length === right.length && timingSafeEqual(left, right)
}

function getFirebaseDiagnostics() {
  try {
    const projectId = getFirebaseAdminProjectId()
    const configuredClientProject = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim()
    return {
      adminConfigured: Boolean(projectId),
      projectMatchesProduction: projectId === "oneestela-ae9b5" && (!configuredClientProject || configuredClientProject === projectId),
      errorCode: null,
    }
  } catch {
    return {
      adminConfigured: false,
      projectMatchesProduction: false,
      errorCode: "firebase_admin_unavailable",
    }
  }
}

export async function GET(request: NextRequest) {
  if (!matchesSecret(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } })
  }
  const config = getEmailConfig()
  const diagnostics = getEmailRuntimeDiagnostics(config)
  const firebase = getFirebaseDiagnostics()
  return NextResponse.json({
    status: diagnostics.otpReady ? "ready" : "not_ready",
    email: diagnostics,
    firebase,
    dispatch: getDispatchDiagnostics(),
  }, { status: diagnostics.otpReady && firebase.projectMatchesProduction ? 200 : 503, headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: NextRequest) {
  return GET(request)
}
