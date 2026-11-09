import {
  DEFAULT_STAFF_PERMISSIONS,
  type StaffPermissions,
} from "@/src/modules/shared/types/permissions"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin"
import { formatDisplayName, getStructuredName } from "@/src/modules/shared/lib/name-utils"
import { getEmailVerificationActivationStart, isEmailVerificationEnforcementEnabled } from "@/lib/email-config"

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
  authTime: number
  role: "admin" | "staff"
  permissions: Partial<StaffPermissions>
  email?: string
  fullName?: string
  firstName?: string
  middleName?: string
  lastName?: string
  phone?: string
  emailVerified: boolean
}

export type AuthorizedUser = {
  uid: string
  authTime: number
  role: "admin" | "staff" | "client"
  permissions: Partial<StaffPermissions>
  email?: string
  fullName?: string
  firstName?: string
  middleName?: string
  lastName?: string
  phone?: string
  emailVerified: boolean
  emailVerificationRequired: boolean
}

type AuthorizationOptions = {
  permission?: keyof StaffPermissions
  adminOnly?: boolean
  requireVerifiedClient?: boolean
  /** OTP issue/verify is the only authenticated flow allowed before verification. */
  allowUnverifiedClient?: boolean
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

type FirebaseAuthUserLike = {
  emailVerified?: boolean
  metadata?: { creationTime?: string }
  providerData?: Array<{ providerId?: string }>
}

/**
 * Verification enforcement is intentionally opt-in at mutation boundaries.
 * The activation timestamp prevents the flag from unexpectedly locking out
 * legacy clients, while provider identity keeps Google and other trusted
 * Firebase providers outside the email/password rollout gate.
 */
export async function enforceVerifiedClientPolicy(input: {
  uid: string
  role: AuthorizedUser["role"]
  emailVerified: boolean
  emailVerificationRequired?: boolean
  signInProvider?: string
  authUser?: FirebaseAuthUserLike
}): Promise<void> {
  if (input.role !== "client" || input.emailVerified) return

  const provider = String(input.signInProvider || "").trim().toLowerCase()
  const providerIsPassword = provider
    ? provider === "password"
    : Boolean(input.authUser?.providerData?.some((entry) => entry.providerId === "password"))
  if (!providerIsPassword) return

  // New email/password signups carry this Firestore-rule-required marker in
  // their profile. It is intentionally independent from the optional rollout flag:
  // a newly created account must not use the temporary signup session to enter
  // the portal while legacy accounts remain governed by the rollout boundary.
  if (input.emailVerificationRequired === true) {
    throw new ApiAuthError(403, "Please verify your email address before continuing with this protected action.")
  }

  if (!isEmailVerificationEnforcementEnabled()) return

  const activationStart = getEmailVerificationActivationStart()
  if (!activationStart) {
    // Safe fail-open behavior is required for a flag that has not been given a
    // trusted rollout boundary. The owner can see the missing configuration in
    // deployment checks without locking existing accounts out.
    return
  }

  const creationTime = input.authUser?.metadata?.creationTime
  const createdAt = creationTime ? new Date(creationTime) : null
  if (!createdAt || Number.isNaN(createdAt.getTime()) || createdAt < activationStart) return
  throw new ApiAuthError(403, "Please verify your email address before continuing with this protected action.")
}

export async function requireAuthenticatedUser(
  request: Request,
  options: Pick<AuthorizationOptions, "requireVerifiedClient" | "allowUnverifiedClient"> = {},
): Promise<AuthorizedUser> {
  const token = getBearerToken(request)

  let uid: string
  let authTime = 0
  let tokenEmail = ""
  let emailVerified = false
  let signInProvider = ""
  try {
    const decoded = await getAdminAuth().verifyIdToken(token, true)
    uid = decoded.uid
    authTime = typeof decoded.auth_time === "number" ? decoded.auth_time : 0
    tokenEmail = typeof decoded.email === "string" ? decoded.email : ""
    emailVerified = decoded.email_verified === true
    signInProvider = isRecord(decoded.firebase) && typeof decoded.firebase.sign_in_provider === "string"
      ? decoded.firebase.sign_in_provider
      : ""
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

  let authUser: FirebaseAuthUserLike | undefined
  const emailVerificationRequired = profile.emailVerificationRequired === true
  const verificationActivationStart = options.requireVerifiedClient && roleValue === "client"
    ? getEmailVerificationActivationStart()
    : null
  if (emailVerificationRequired || verificationActivationStart) {
    try {
      authUser = await getAdminAuth().getUser(uid)
      emailVerified = authUser.emailVerified === true
    } catch (error) {
      console.error("[API auth] Firebase verification policy lookup failed:", getErrorCode(error))
      throw new ApiAuthError(503, "Verification status could not be checked. Please try again.")
    }
  }

  const permissions: Partial<StaffPermissions> = {}
  if (isRecord(profile.permissions)) {
    for (const key of Object.keys(DEFAULT_STAFF_PERMISSIONS) as Array<keyof StaffPermissions>) {
      if (typeof profile.permissions[key] === "boolean") {
        permissions[key] = profile.permissions[key] as StaffPermissions[typeof key]
      }
    }
  }

  if (!options.allowUnverifiedClient) {
    await enforceVerifiedClientPolicy({
      uid,
      role: roleValue as AuthorizedUser["role"],
      emailVerified,
      emailVerificationRequired,
      signInProvider,
      authUser,
    })
  }

  return {
    uid,
    authTime,
    role: roleValue as AuthorizedUser["role"],
    permissions,
    email: tokenEmail || (typeof profile.email === "string" ? profile.email : undefined),
    fullName: formatDisplayName(profile),
    ...getStructuredName(profile),
    phone: typeof profile.phone === "string" ? profile.phone : undefined,
    emailVerified,
    emailVerificationRequired,
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
