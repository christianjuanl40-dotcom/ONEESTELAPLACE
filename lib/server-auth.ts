import {
  DEFAULT_STAFF_PERMISSIONS,
  type StaffPermissions,
} from "@/src/modules/shared/types/permissions"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin"

export class ApiAuthError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 500 | 503

  constructor(status: 400 | 401 | 403 | 404 | 409 | 413 | 500 | 503, message: string) {
    super(message)
    this.name = "ApiAuthError"
    this.status = status
  }
}

export type AuthorizedBackofficeUser = {
  uid: string
  role: "admin" | "staff"
  permissions: Partial<StaffPermissions>
}

export type AuthorizedUser = {
  uid: string
  role: "admin" | "staff" | "client"
  permissions: Partial<StaffPermissions>
  email?: string
  fullName?: string
  phone?: string
}

type AuthorizationOptions = {
  permission?: keyof StaffPermissions
  adminOnly?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string") return error.code
  return "unknown"
}

function getBearerToken(request: Request): string {
  const header = request.headers.get("authorization") || ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) throw new ApiAuthError(401, "Authentication is required.")
  return match[1].trim()
}

export async function requireAuthenticatedUser(request: Request): Promise<AuthorizedUser> {
  const token = getBearerToken(request)

  let uid: string
  try {
    const decoded = await getAdminAuth().verifyIdToken(token, true)
    uid = decoded.uid
  } catch (error) {
    console.error("[API auth] ID token verification failed:", getErrorCode(error))
    throw new ApiAuthError(401, "Authentication is required.")
  }

  let profile: Record<string, unknown>
  try {
    const snapshot = await getAdminFirestore().collection("users").doc(uid).get()
    if (!snapshot.exists) throw new ApiAuthError(403, "This account is not authorized.")
    profile = snapshot.data() as Record<string, unknown>
  } catch (error) {
    if (error instanceof ApiAuthError) throw error
    console.error("[API auth] Profile lookup failed:", getErrorCode(error))
    throw new ApiAuthError(503, "Authorization service is temporarily unavailable.")
  }

  const roleValue = typeof profile.role === "string" ? profile.role.toLowerCase().trim() : ""
  const status = typeof profile.status === "string" ? profile.status.toLowerCase().trim() : "active"
  if (
    (roleValue !== "admin" && roleValue !== "staff" && roleValue !== "client") ||
    status === "inactive"
  ) {
    throw new ApiAuthError(403, "This account is not authorized.")
  }

  const permissions: Partial<StaffPermissions> = {}
  if (isRecord(profile.permissions)) {
    for (const key of Object.keys(DEFAULT_STAFF_PERMISSIONS) as Array<keyof StaffPermissions>) {
      if (typeof profile.permissions[key] === "boolean") {
        permissions[key] = profile.permissions[key] as StaffPermissions[typeof key]
      }
    }
  }

  return {
    uid,
    role: roleValue as AuthorizedUser["role"],
    permissions,
    email: typeof profile.email === "string" ? profile.email : undefined,
    fullName: typeof profile.fullName === "string" ? profile.fullName : undefined,
    phone: typeof profile.phone === "string" ? profile.phone : undefined,
  }
}

export async function requireBackofficeUser(
  request: Request,
  options: AuthorizationOptions = {},
): Promise<AuthorizedBackofficeUser> {
  const user = await requireAuthenticatedUser(request)
  if (user.role !== "admin" && user.role !== "staff") {
    throw new ApiAuthError(403, "This account is not authorized.")
  }

  if (options.adminOnly && user.role !== "admin") {
    throw new ApiAuthError(403, "Administrator access is required.")
  }

  if (
    options.permission &&
    user.role !== "admin" &&
    user.permissions[options.permission] !== true
  ) {
    throw new ApiAuthError(403, "You do not have permission to perform this action.")
  }

  return { ...user, role: user.role as "admin" | "staff" }
}

export function isApiAuthError(error: unknown): error is ApiAuthError {
  return error instanceof ApiAuthError
}

export function getSafeErrorCode(error: unknown): string {
  return getErrorCode(error)
}
