import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin"
import {
  ApiAuthError,
  getSafeErrorCode,
  isApiAuthError,
  requireBackofficeUser,
} from "@/lib/server-auth"
import {
  DEFAULT_STAFF_PERMISSIONS,
  type StaffPermissions,
} from "@/src/modules/shared/types/permissions"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_REQUEST_BYTES = 64 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readText(body: Record<string, unknown>, key: string, maxLength: number): string | null {
  const value = body[key]
  if (value === undefined || value === null) return ""
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length <= maxLength ? normalized : null
}

function normalizePermissions(value: unknown): StaffPermissions {
  const permissions = { ...DEFAULT_STAFF_PERMISSIONS }
  if (!isRecord(value)) return permissions

  for (const key of Object.keys(DEFAULT_STAFF_PERMISSIONS) as Array<keyof StaffPermissions>) {
    if (typeof value[key] === "boolean") permissions[key] = value[key]
  }
  return permissions
}

function isValidUid(uid: string): boolean {
  return UID_PATTERN.test(uid)
}

async function readJsonBody(request: NextRequest): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") || 0)
  if (contentLength > MAX_REQUEST_BYTES) {
    throw new ApiAuthError(413, "The staff request is too large.")
  }

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw new ApiAuthError(413, "The staff request is too large.")
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new ApiAuthError(400, "Invalid JSON in request body.")
  }
}

async function requireStaffTarget(uid: string) {
  if (!isValidUid(uid)) throw new ApiAuthError(400, "Invalid staff ID.")

  const snapshot = await getAdminFirestore().collection("users").doc(uid).get()
  const role = typeof snapshot.data()?.role === "string" ? snapshot.data()?.role.toLowerCase() : ""
  if (!snapshot.exists || role !== "staff") {
    throw new ApiAuthError(404, "Staff account not found.")
  }
  return snapshot
}

function errorResponse(error: unknown, operation: string) {
  if (isApiAuthError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  console.error(`[${operation}]`, error instanceof Error ? error.message : "Unknown error")
  return NextResponse.json({ error: "The staff operation failed. Please try again." }, { status: 500 })
}

export async function GET(request: NextRequest) {
  try {
    await requireBackofficeUser(request, { adminOnly: true })
    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    return errorResponse(error, "GET /api/staff")
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireBackofficeUser(request, { adminOnly: true })

    const body = await readJsonBody(request)
    if (!isRecord(body)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
    }

    const emailValue = readText(body, "email", 254)
    const firstName = readText(body, "firstName", 80)
    const lastName = readText(body, "lastName", 80)
    const phone = readText(body, "phone", 40)
    const position = readText(body, "position", 100)
    const password = typeof body.password === "string" ? body.password : ""

    if (
      emailValue === null ||
      firstName === null ||
      lastName === null ||
      phone === null ||
      position === null ||
      !emailValue ||
      !firstName ||
      !lastName ||
      !position
    ) {
      return NextResponse.json({ error: "Please provide valid staff details." }, { status: 400 })
    }

    const email = emailValue.toLowerCase()
    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 })
    }
    if (password.length < 6 || password.length > 128) {
      return NextResponse.json(
        { error: "The temporary password must be between 6 and 128 characters." },
        { status: 400 },
      )
    }

    const fullName = `${firstName} ${lastName}`.trim()
    const auth = getAdminAuth()
    let userRecord
    try {
      userRecord = await auth.createUser({
        email,
        password,
        displayName: fullName,
      })
    } catch (error: unknown) {
      const code = getSafeErrorCode(error)
      if (code === "auth/email-already-exists") {
        return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 })
      }
      console.error("[POST /api/staff] Firebase user creation failed:", code)
      return NextResponse.json({ error: "Unable to create the staff account." }, { status: 500 })
    }

    const profileData = {
      uid: userRecord.uid,
      email,
      fullName,
      firstName,
      lastName,
      phone: phone || "",
      position,
      role: "staff",
      status: "active",
      permissions: normalizePermissions(body.permissions),
      createdAt: new Date().toISOString(),
      profilePicture: "",
    }

    try {
      await getAdminFirestore().collection("users").doc(userRecord.uid).set(profileData)
    } catch (error: unknown) {
      console.error(
        "[POST /api/staff] Profile creation failed:",
        error instanceof Error ? error.message : "Unknown error",
      )
      try {
        await auth.deleteUser(userRecord.uid)
      } catch (cleanupError: unknown) {
        console.error("[POST /api/staff] Auth cleanup failed:", getSafeErrorCode(cleanupError))
      }
      return NextResponse.json({ error: "Unable to create the staff profile." }, { status: 500 })
    }

    return NextResponse.json({ uid: userRecord.uid }, { status: 201 })
  } catch (error: unknown) {
    return errorResponse(error, "POST /api/staff")
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireBackofficeUser(request, { adminOnly: true })

    const body = await readJsonBody(request)
    if (!isRecord(body) || typeof body.uid !== "string" || !isValidUid(body.uid)) {
      return NextResponse.json({ error: "A valid staff ID is required." }, { status: 400 })
    }
    if (body.uid === actor.uid) {
      return NextResponse.json({ error: "You cannot modify your own staff account here." }, { status: 400 })
    }

    await requireStaffTarget(body.uid)

    const authUpdates: { email?: string; disabled?: boolean } = {}
    const profileUpdates: Record<string, unknown> = {}

    if (body.disabled !== undefined) {
      if (typeof body.disabled !== "boolean") {
        return NextResponse.json({ error: "Invalid account status." }, { status: 400 })
      }
      authUpdates.disabled = body.disabled
      profileUpdates.status = body.disabled ? "inactive" : "active"
    }

    for (const key of ["firstName", "lastName", "fullName", "phone", "position"] as const) {
      if (body[key] === undefined) continue
      const maxLength = key === "phone" ? 40 : key === "position" ? 100 : 80
      const value = readText(body, key, maxLength)
      if (value === null) {
        return NextResponse.json({ error: `Invalid ${key}.` }, { status: 400 })
      }
      profileUpdates[key] = value
    }

    if (body.email !== undefined) {
      const email = readText(body, "email", 254)?.toLowerCase() || ""
      if (!EMAIL_PATTERN.test(email)) {
        return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 })
      }
      authUpdates.email = email
      profileUpdates.email = email
    }

    if (body.permissions !== undefined) {
      if (!isRecord(body.permissions)) {
        return NextResponse.json({ error: "Invalid staff permissions." }, { status: 400 })
      }
      profileUpdates.permissions = normalizePermissions(body.permissions)
    }

    if (!Object.keys(authUpdates).length && !Object.keys(profileUpdates).length) {
      return NextResponse.json({ error: "No staff changes were provided." }, { status: 400 })
    }

    if (Object.keys(authUpdates).length) {
      try {
        await getAdminAuth().updateUser(body.uid, authUpdates)
      } catch (error: unknown) {
        const code = getSafeErrorCode(error)
        if (code === "auth/email-already-exists") {
          return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 })
        }
        console.error("[PATCH /api/staff] Firebase update failed:", code)
        return NextResponse.json({ error: "Unable to update the staff account." }, { status: 500 })
      }
    }

    if (Object.keys(profileUpdates).length) {
      await getAdminFirestore().collection("users").doc(body.uid).update(profileUpdates)
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    return errorResponse(error, "PATCH /api/staff")
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireBackofficeUser(request, { adminOnly: true })
    const uid = new URL(request.url).searchParams.get("uid")?.trim() || ""
    if (!isValidUid(uid)) {
      return NextResponse.json({ error: "A valid staff ID is required." }, { status: 400 })
    }
    if (uid === actor.uid) {
      return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 })
    }

    await requireStaffTarget(uid)

    try {
      await getAdminAuth().deleteUser(uid)
    } catch (error: unknown) {
      if (getSafeErrorCode(error) !== "auth/user-not-found") {
        console.error("[DELETE /api/staff] Firebase deletion failed:", getSafeErrorCode(error))
        return NextResponse.json({ error: "Unable to delete the staff account." }, { status: 500 })
      }
    }

    await getAdminFirestore().collection("users").doc(uid).delete()
    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    return errorResponse(error, "DELETE /api/staff")
  }
}
