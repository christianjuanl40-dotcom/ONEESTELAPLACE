import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin"
import {
  ApiAuthError,
  getSafeErrorCode,
  isApiAuthError,
  requireAuthenticatedUser,
} from "@/lib/server-auth"
import { normalizeProfileContactUpdate } from "@/src/modules/shared/lib/profile-utils"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>

const MAX_REQUEST_BYTES = 16 * 1024
const RECENT_AUTH_SECONDS = 10 * 60

function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null
}

function isRecentAuthentication(authTime: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  return Number.isFinite(authTime) && authTime > 0 && now - authTime <= RECENT_AUTH_SECONDS
}

function getAuthUpdateError(error: unknown): ApiAuthError {
  switch (getSafeErrorCode(error)) {
    case "auth/email-already-exists":
      return new ApiAuthError(409, "That email address is already in use.")
    case "auth/invalid-email":
      return new ApiAuthError(400, "Please provide a valid email address.")
    default:
      return new ApiAuthError(500, "Unable to update the account email.")
  }
}

function errorResponse(error: unknown) {
  if (isApiAuthError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  console.error(
    "[PATCH /api/profile]",
    error instanceof Error ? error.message : "Unknown error",
  )
  return NextResponse.json({ error: "Unable to update your profile. Please try again." }, { status: 500 })
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request)
    const bodyText = await request.text()
    if (new TextEncoder().encode(bodyText).byteLength > MAX_REQUEST_BYTES) {
      throw new ApiAuthError(413, "The profile update request is too large.")
    }

    let body: unknown
    try {
      body = JSON.parse(bodyText)
    } catch {
      throw new ApiAuthError(400, "Invalid JSON in profile update request.")
    }
    if (!isRecord(body)) throw new ApiAuthError(400, "Invalid profile update request.")

    const unsupportedKeys = Object.keys(body).filter((key) => key !== "email" && key !== "phone")
    if (unsupportedKeys.length > 0) {
      throw new ApiAuthError(400, "Only email and phone may be updated here.")
    }

    let contactUpdate
    try {
      contactUpdate = normalizeProfileContactUpdate(body)
    } catch (error) {
      throw new ApiAuthError(400, error instanceof Error ? error.message : "Invalid profile details.")
    }

    const adminAuth = getAdminAuth()
    const firestore = getAdminFirestore()
    const [authRecord, profileSnapshot] = await Promise.all([
      adminAuth.getUser(user.uid),
      firestore.collection("users").doc(user.uid).get(),
    ])
    if (!profileSnapshot.exists) throw new ApiAuthError(404, "Your profile could not be found.")

    const profileData = profileSnapshot.data() as DataRecord
    const currentAuthEmail = String(authRecord.email || "").trim().toLowerCase()
    const currentProfileEmail = typeof profileData.email === "string"
      ? profileData.email.trim().toLowerCase()
      : ""
    const previousEmail = currentAuthEmail || currentProfileEmail
    const previousPhone = typeof profileData.phone === "string" ? profileData.phone : ""
    const emailChanged = contactUpdate.email !== currentAuthEmail

    if (emailChanged && !isRecentAuthentication(user.authTime)) {
      throw new ApiAuthError(401, "For security, sign in again before changing your email address.")
    }

    let authEmailChanged = false
    try {
      if (emailChanged) {
        await adminAuth.updateUser(user.uid, { email: contactUpdate.email })
        authEmailChanged = true
      }
    } catch (error) {
      throw getAuthUpdateError(error)
    }

    try {
      await firestore.collection("users").doc(user.uid).update({
        email: contactUpdate.email,
        phone: contactUpdate.phone,
      })
    } catch (error) {
      let rollbackFailed = false

      if (authEmailChanged) {
        try {
          if (previousEmail) {
            await adminAuth.updateUser(user.uid, { email: previousEmail })
          } else {
            rollbackFailed = true
          }
        } catch (rollbackError) {
          rollbackFailed = true
          console.error(
            "[PATCH /api/profile] Firebase Auth rollback failed:",
            getSafeErrorCode(rollbackError),
          )
        }
      }

      try {
        await firestore.collection("users").doc(user.uid).update({
          email: currentProfileEmail || previousEmail,
          phone: previousPhone,
        })
      } catch (rollbackError) {
        rollbackFailed = true
        console.error(
          "[PATCH /api/profile] Firestore rollback failed:",
          rollbackError instanceof Error ? rollbackError.message : "Unknown error",
        )
      }

      console.error(
        "[PATCH /api/profile] Profile update failed:",
        error instanceof Error ? error.message : "Unknown error",
      )
      if (rollbackFailed) {
        throw new ApiAuthError(
          500,
          "Your email and profile records could not be synchronized. Please contact support before trying again.",
        )
      }
      throw new ApiAuthError(500, "Your profile was not updated. Please try again.")
    }

    return NextResponse.json({
      success: true,
      profile: {
        email: contactUpdate.email,
        phone: contactUpdate.phone,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
