import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { EmailOtpError, issueEmailOtp, verifyEmailOtp } from "@/lib/email-otp"
import { ApiAuthError, isApiAuthError, requireAuthenticatedUser } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_BODY_BYTES = 4 * 1024

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const direct = request.headers.get("x-real-ip")?.trim()
  const value = forwarded || direct || ""
  return value.length <= 200 ? value : ""
}

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") || 0)
  if (contentLength > MAX_BODY_BYTES) throw new ApiAuthError(413, "The verification request is too large.")
  const bodyText = await request.text()
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
    throw new ApiAuthError(413, "The verification request is too large.")
  }
  if (!bodyText.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object")
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new ApiAuthError(400, "Invalid verification request.")
  }
}

function errorResponse(error: unknown) {
  if (error instanceof EmailOtpError) {
    return NextResponse.json(
      {
        error: error.message,
        ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      },
      {
        status: error.status,
        headers: { "Cache-Control": "no-store" },
      },
    )
  }
  if (isApiAuthError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
  }
  console.error("[POST /api/auth/email-otp] request failed")
  return NextResponse.json(
    { error: "Email verification could not be completed. Please try again later." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  )
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request, { allowUnverifiedClient: true })
    if (user.role !== "client") throw new ApiAuthError(403, "Only Client accounts can use email verification.")

    const body = await readBody(request)
    const action = String(body.action || "issue").trim().toLowerCase()
    if (action === "issue" || action === "resend") {
      const result = await issueEmailOtp(user.uid, getClientIp(request))
      return NextResponse.json(
        { success: true, status: result.status, ...(result.status === "sent" ? { retryAfterSeconds: result.retryAfterSeconds } : {}) },
        { headers: { "Cache-Control": "no-store" } },
      )
    }

    if (action === "verify") {
      const code = typeof body.code === "string" ? body.code : ""
      const result = await verifyEmailOtp(user.uid, code)
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
    }

    throw new ApiAuthError(400, "Invalid email verification action.")
  } catch (error) {
    return errorResponse(error)
  }
}
