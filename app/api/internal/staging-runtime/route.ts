import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { getFirebaseAdminProjectId } from "@/lib/firebase-admin"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Local-only staging diagnostic. It returns project IDs and safety flags, never
 * credentials. It is intentionally unavailable outside a staging dev process.
 */
export async function GET(request: NextRequest) {
  const expectedToken = String(process.env.STAGING_RUNTIME_CHECK_TOKEN || "")
  const suppliedToken = request.headers.get("x-staging-runtime-check") || ""
  if (
    process.env.NODE_ENV === "production"
    || String(process.env.ONEESTELA_ENV || "").trim().toLowerCase() !== "staging"
    || !expectedToken
    || suppliedToken !== expectedToken
  ) {
    return NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } })
  }

  const adminProjectId = getFirebaseAdminProjectId()
  return NextResponse.json(
    {
      clientProjectId: String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || ""),
      adminProjectId,
      emailSendingEnabled: String(process.env.EMAIL_SENDING_ENABLED || "").toLowerCase() === "true",
      otpSendingEnabled: String(process.env.EMAIL_OTP_SENDING_ENABLED || "").toLowerCase() === "true",
      verificationEnforcementEnabled: String(process.env.EMAIL_VERIFICATION_ENFORCEMENT_ENABLED || "").toLowerCase() === "true",
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
