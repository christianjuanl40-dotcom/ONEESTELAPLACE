import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth } from "@/lib/firebase-admin"
import {
  finalizePendingRegistration,
  PendingRegistrationError,
  PENDING_REGISTRATION_AUTH_COOKIE,
  PENDING_REGISTRATION_COOKIE,
} from "@/lib/pending-registration"
import { ApiAuthError, isApiAuthError } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_BODY_BYTES = 2 * 1024

function getBearerToken(request: NextRequest): string {
  const value = request.headers.get("authorization") || ""
  const match = value.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]?.trim()) throw new ApiAuthError(401, "Authentication is required to finish signup.")
  return match[1].trim()
}

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") || 0)
  if (contentLength > MAX_BODY_BYTES) throw new ApiAuthError(413, "The signup request is too large.")
  const bodyText = await request.text()
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) throw new ApiAuthError(413, "The signup request is too large.")
  if (!bodyText.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object")
    return parsed as Record<string, unknown>
  } catch {
    throw new ApiAuthError(400, "Invalid signup finalization request.")
  }
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  }
}

function clearRegistrationCookies(response: NextResponse) {
  response.cookies.set(PENDING_REGISTRATION_COOKIE, "", cookieOptions(0))
  response.cookies.set(PENDING_REGISTRATION_AUTH_COOKIE, "", cookieOptions(0))
}

function errorResponse(error: unknown) {
  if (error instanceof PendingRegistrationError) {
    console.warn("[pending registration finalize] request rejected", { code: error.code, status: error.status })
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    )
  }
  if (isApiAuthError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
  }
  console.error("[POST /api/auth/register/finalize] request failed")
  return NextResponse.json(
    { error: "Signup could not be finalized. Keep this page open and try again." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  )
}

export async function POST(request: NextRequest) {
  try {
    const body = await readBody(request)
    const registrationId = request.cookies.get(PENDING_REGISTRATION_COOKIE)?.value?.trim() || ""
    const authorizationToken = request.cookies.get(PENDING_REGISTRATION_AUTH_COOKIE)?.value?.trim() || ""
    const bodyRegistrationId = typeof body.registrationId === "string" ? body.registrationId.trim() : ""
    if (!registrationId || !authorizationToken || (bodyRegistrationId && bodyRegistrationId !== registrationId)) {
      throw new ApiAuthError(403, "Verify the email code before finishing signup.")
    }

    const token = getBearerToken(request)
    let decoded: { uid: string }
    try {
      decoded = await getAdminAuth().verifyIdToken(token, true)
    } catch {
      throw new ApiAuthError(401, "Authentication is required to finish signup.")
    }

    const result = await finalizePendingRegistration({
      registrationId,
      authorizationToken,
      uid: decoded.uid,
    })
    const response = NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
    clearRegistrationCookies(response)
    return response
  } catch (error) {
    return errorResponse(error)
  }
}
