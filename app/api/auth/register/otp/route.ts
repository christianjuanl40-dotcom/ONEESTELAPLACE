import "server-only"

import { NextRequest, NextResponse } from "next/server"
import {
  getPendingRegistrationStatus,
  issuePendingRegistration,
  PendingRegistrationError,
  PENDING_REGISTRATION_AUTH_COOKIE,
  PENDING_REGISTRATION_COOKIE,
  resendPendingRegistration,
  verifyPendingRegistration,
} from "@/lib/pending-registration"
import { ApiAuthError, isApiAuthError } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_BODY_BYTES = 8 * 1024

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const direct = request.headers.get("x-real-ip")?.trim()
  const value = forwarded || direct || ""
  return value.length <= 200 ? value : ""
}

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") || 0)
  if (contentLength > MAX_BODY_BYTES) throw new ApiAuthError(413, "The signup request is too large.")
  const bodyText = await request.text()
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
    throw new ApiAuthError(413, "The signup request is too large.")
  }
  if (!bodyText.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object")
    return parsed as Record<string, unknown>
  } catch {
    throw new ApiAuthError(400, "Invalid signup request.")
  }
}

function getCookieValue(request: NextRequest, name: string): string {
  return request.cookies.get(name)?.value?.trim() || ""
}

function getRegistrationId(request: NextRequest, body: Record<string, unknown>): string {
  const cookieId = getCookieValue(request, PENDING_REGISTRATION_COOKIE)
  const bodyId = typeof body.registrationId === "string" ? body.registrationId.trim() : ""
  if (cookieId && bodyId && cookieId !== bodyId) {
    throw new ApiAuthError(403, "This signup session is invalid.")
  }
  const registrationId = cookieId || bodyId
  if (!registrationId) throw new ApiAuthError(400, "Start signup before requesting a verification code.")
  return registrationId
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.max(0, Math.floor(maxAge)),
  }
}

function errorResponse(error: unknown) {
  if (error instanceof PendingRegistrationError) {
    console.warn("[pending registration] request rejected", { code: error.code, status: error.status })
    return NextResponse.json(
      {
        error: error.message,
        ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    )
  }
  if (isApiAuthError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
  }
  console.error("[POST /api/auth/register/otp] request failed")
  return NextResponse.json(
    { error: "Signup could not be started. Please try again later." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  )
}

export async function POST(request: NextRequest) {
  try {
    const body = await readBody(request)
    const action = String(body.action || "issue").trim().toLowerCase()
    if (action === "issue") {
      const result = await issuePendingRegistration({
        firstName: typeof body.firstName === "string" ? body.firstName : "",
        middleName: typeof body.middleName === "string" ? body.middleName : "",
        lastName: typeof body.lastName === "string" ? body.lastName : "",
        email: typeof body.email === "string" ? body.email : "",
        phone: typeof body.phone === "string" ? body.phone : "",
      }, getClientIp(request))
      const response = NextResponse.json(
        { success: true, status: result.status, registrationId: result.registrationId, email: result.email, retryAfterSeconds: result.retryAfterSeconds, expiresInSeconds: result.expiresInSeconds },
        { headers: { "Cache-Control": "no-store" } },
      )
      response.cookies.set(PENDING_REGISTRATION_COOKIE, result.registrationId, cookieOptions(result.expiresInSeconds))
      response.cookies.set(PENDING_REGISTRATION_AUTH_COOKIE, "", cookieOptions(0))
      return response
    }

    const registrationId = getRegistrationId(request, body)
    if (action === "resend") {
      const result = await resendPendingRegistration(registrationId, getClientIp(request))
      const response = NextResponse.json(
        { success: true, status: result.status, email: result.email, retryAfterSeconds: result.retryAfterSeconds, expiresInSeconds: result.expiresInSeconds },
        { headers: { "Cache-Control": "no-store" } },
      )
      response.cookies.set(PENDING_REGISTRATION_COOKIE, result.registrationId, cookieOptions(result.expiresInSeconds))
      return response
    }

    if (action === "verify") {
      const result = await verifyPendingRegistration(registrationId, body.code)
      const response = NextResponse.json(
        { success: true, status: result.status, email: result.email, authorizationExpiresInSeconds: result.authorizationExpiresInSeconds },
        { headers: { "Cache-Control": "no-store" } },
      )
      response.cookies.set(PENDING_REGISTRATION_COOKIE, registrationId, cookieOptions(result.authorizationExpiresInSeconds || 60 * 10))
      if (result.authorizationToken) {
        response.cookies.set(PENDING_REGISTRATION_AUTH_COOKIE, result.authorizationToken, cookieOptions(result.authorizationExpiresInSeconds))
      }
      return response
    }

    if (action === "status") {
      const result = await getPendingRegistrationStatus(registrationId)
      const response = NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
      response.cookies.set(PENDING_REGISTRATION_COOKIE, registrationId, cookieOptions(Math.max(result.expiresInSeconds, 60 * 10)))
      return response
    }

    throw new ApiAuthError(400, "Invalid signup verification action.")
  } catch (error) {
    return errorResponse(error)
  }
}
