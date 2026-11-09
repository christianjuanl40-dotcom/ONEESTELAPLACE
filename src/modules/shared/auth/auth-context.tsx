"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  reload,
  sendEmailVerification,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from "firebase/auth"
import { doc, getDocFromServer, updateDoc } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"
import { perfMark } from "@/src/modules/shared/lib/perf-trace"
import type { StaffPermissions } from "@/src/modules/shared/types/permissions"
import { DEFAULT_STAFF_PERMISSIONS } from "@/src/modules/shared/types/permissions"
import {
  uploadToCloudinary,
  deleteFromCloudinary,
  extractPublicId,
  isOwnedProfilePublicId,
} from "@/src/modules/shared/lib/cloudinary"
import { formatDisplayName, getStructuredName } from "@/src/modules/shared/lib/name-utils"
import { getAuthHeaders } from "@/src/modules/shared/lib/auth-token"
import { normalizeProfileContactUpdate } from "@/src/modules/shared/lib/profile-utils"
import { updateAuthenticatedPassword } from "@/src/modules/shared/lib/password-update"
import { safeRead } from "@/src/modules/shared/lib/safe-read"
import { createSessionInitializer, type SessionState } from "@/src/modules/shared/lib/session-initialization"

const VERIFICATION_LINK_FALLBACK_ENABLED = process.env.NEXT_PUBLIC_EMAIL_VERIFICATION_LINK_FALLBACK_ENABLED === "true"

export interface AppUser {
  id: string
  fullName: string
  name: string
  firstName?: string
  middleName?: string
  lastName?: string
  email: string
  emailVerified: boolean
  /** New email/password signups remain verification-gated until Auth is verified. */
  emailVerificationRequired?: boolean
  role: "admin" | "client" | "staff"
  profilePicture: string
  createdAt: string
  status: "active" | "inactive"
  phone?: string
  position?: string
  permissions?: StaffPermissions
}

export type AppRole = AppUser["role"]

export interface SignupInput {
  firstName: string
  middleName?: string
  lastName: string
  email: string
  phone?: string
  password: string
  role?: AppRole
  profilePicture?: string
}

type PendingRegistrationPassword = {
  registrationId: string
  value: string
}

export interface ProfileContactUpdateInput {
  email: string
  phone: string
  currentPassword?: string
}

export interface AuthContextValue {
  user: AppUser | null
  isLoading: boolean
  authLoading: boolean
  profileLoading: boolean
  initializationError: string | null
  isSigningIn: boolean
  pendingRegistration: { registrationId: string; email: string } | null
  login: (email: string, password?: string) => Promise<{ success: boolean; message?: string; role?: string; requiresVerification?: boolean }>
  signup: (input: SignupInput) => Promise<{ success: boolean; message?: string; requiresVerification?: boolean; registrationId?: string }>
  restorePendingRegistration: (registrationId: string) => Promise<{ success: boolean; message?: string; email?: string; status?: string }>
  verifyPendingRegistrationCode: (code: string) => Promise<{ success: boolean; message?: string; email?: string }>
  resendPendingRegistrationCode: () => Promise<{ success: boolean; message?: string; retryAfterSeconds?: number }>
  finalizePendingRegistration: () => Promise<{ success: boolean; message?: string }>
  clearPendingRegistration: () => void
  requestEmailVerificationCode: () => Promise<{ success: boolean; message?: string; retryAfterSeconds?: number }>
  verifyEmailCode: (code: string) => Promise<{ success: boolean; message?: string; alreadyVerified?: boolean }>
  sendVerificationEmail: () => Promise<{ success: boolean; message?: string }>
  verificationLinkFallbackEnabled: boolean
  logout: () => Promise<boolean>
  updateProfilePicture: (dataUrl: string) => Promise<void>
  removeProfilePicture: () => Promise<void>
  updateProfileDetails: (input: ProfileContactUpdateInput) => Promise<{ email: string; phone: string }>
  updatePassword: (currentPassword: string, newPassword: string) => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function getFirebaseErrorMessage(error: any): string {
  const code = error?.code || ""
  switch (code) {
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Invalid email or password."
    case "auth/email-already-in-use":
      return "An account with this email already exists."
    case "auth/weak-password":
      return "Password should be at least 6 characters."
    case "auth/invalid-email":
      return "Invalid email address."
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later."
    case "auth/network-request-failed":
      return "Network error. Please check your connection."
    case "auth/expired-action-code":
    case "auth/invalid-action-code":
      return "That verification link is expired or invalid. Request a new verification email and try again."
    case "auth/user-disabled":
      return "This account is disabled. Please contact an administrator."
    case "unavailable":
    case "deadline-exceeded":
    case "read/timeout":
      return "Your account profile could not be loaded. Check your connection and retry."
    case "app/account-inactive":
      return "This account is inactive. Please contact an administrator."
    case "app/invalid-role":
      return "Your account has an invalid or missing role. Please contact support."
    default:
      return error?.message || "An unexpected error occurred."
  }
}

function getProfileUpdateErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : ""

  switch (code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "The current password is incorrect."
    case "auth/requires-recent-login":
    case "auth/user-token-expired":
      return "For security, sign in again before changing your email address."
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later."
    default:
      return error instanceof Error ? error.message : "Unable to update your profile. Please try again."
  }
}

function getPasswordUpdateErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : ""

  switch (code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "The current password is incorrect."
    case "auth/requires-recent-login":
    case "auth/user-token-expired":
      return "For security, sign in again before changing your password."
    case "auth/weak-password":
      return "The new password should be at least 6 characters."
    case "auth/password-reuse":
    case "auth/password-fields-required":
    case "auth/password-provider-required":
      return error instanceof Error ? error.message : "Unable to update your password."
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later."
    case "auth/network-request-failed":
      return "Network error. Please check your connection."
    default:
      return error instanceof Error ? error.message : "Unable to update your password. Please try again."
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState<AppUser>>({ user: null, phase: "auth", error: null })
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [pendingRegistration, setPendingRegistration] = useState<{ registrationId: string; email: string } | null>(null)
  // Deliberately not state, persistence, or a cookie: this is the only place
  // the original signup password survives the OTP route transition. The
  // provider is mounted above the app routes, so client-side navigation keeps
  // it available without putting plaintext credentials in storage or APIs.
  const pendingRegistrationPassword = useRef<PendingRegistrationPassword | null>(null)
  const signingIn = useRef(false)
  const pendingFinalization = useRef(false)
  const user = session.user?.id === auth.currentUser?.uid ? session.user : null
  const isLoading = session.phase === "auth" || session.phase === "profile" || isSigningIn
    || (session.phase === "ready" && Boolean(auth.currentUser) && !user)
  const setUser = useCallback((update: AppUser | null | ((current: AppUser | null) => AppUser | null)) => {
    setSession(current => ({ ...current, user: typeof update === "function" ? update(current.user) : update }))
  }, [])
  const initializer = useMemo(() => createSessionInitializer<FirebaseUser, AppUser>({
    currentUid: () => auth.currentUser?.uid,
    publish: setSession,
    errorMessage: error => {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown"
      console.error("[AUTH] Initialization failed", { code })
      if (code === "app/profile-missing") return "Your account profile is missing. Retry, or contact support if it is still unavailable."
      if (code === "app/account-inactive") return "This account is inactive. Contact an administrator or sign out."
      if (code === "app/invalid-role" || code === "permission-denied") return "Your account profile could not be authorized. Retry or contact support."
      return "Your account profile could not be loaded. Check your connection and retry."
    },
    read: async (identity, signal) => {
      const started = performance.now()
      const snapshot = await safeRead(() => getDocFromServer(doc(db, "users", identity.uid)), { signal })
      perfMark(`[AUTH] profile server read ${Math.round(performance.now() - started)}ms`)
      if (!snapshot.exists()) throw Object.assign(new Error("Missing account profile"), { code: "app/profile-missing" })
      const data = snapshot.data()
      const role = String(data.role || "").trim().toLowerCase()
      if (role !== "admin" && role !== "client" && role !== "staff") throw Object.assign(new Error("Invalid role"), { code: "app/invalid-role" })
      if (String(data.status || "active").trim().toLowerCase() !== "active") throw Object.assign(new Error("Inactive account"), { code: "app/account-inactive" })
      const nameParts = getStructuredName(data)
      const fullName = formatDisplayName({ ...nameParts, fullName: data.fullName, name: data.name })
      const permissions = role === "staff" ? { ...DEFAULT_STAFF_PERMISSIONS } : undefined
      if (permissions && data.permissions && typeof data.permissions === "object") {
        for (const key of Object.keys(permissions) as Array<keyof StaffPermissions>) {
          if (typeof data.permissions[key] === "boolean") permissions[key] = data.permissions[key]
        }
      }
      return { id: identity.uid, fullName, name: fullName, ...nameParts, email: identity.email || data.email || "", emailVerified: identity.emailVerified,
        emailVerificationRequired: data.emailVerificationRequired === true,
        role, profilePicture: data.profilePicture || "", createdAt: data.createdAt || "", status: "active",
        phone: data.phone || "", position: data.position || "", permissions }
    },
  }), [])

  useEffect(() => {
    perfMark("[AUTH] onAuthStateChanged registered")
    const controller = new AbortController()
    void safeRead(() => auth.authStateReady(), { signal: controller.signal, attempts: 1 }).catch(error => {
      if (!controller.signal.aborted) initializer.fail(error)
    })
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser && auth.currentUser) return
      perfMark(firebaseUser ? "[AUTH] onAuthStateChanged fired (signed in)" : "[AUTH] onAuthStateChanged fired (signed out)")
       if (firebaseUser) {
         // A newly created Auth identity has no profile until the protected
         // registration finalizer commits it. Do not turn that short handoff
         // into a dashboard/session initialization attempt.
         if (pendingFinalization.current) return
         void initializer.load(firebaseUser).catch(() => {})
       }
      else initializer.clear()
    }, error => initializer.fail(error))
    return () => { controller.abort(); unsubscribe(); initializer.dispose() }
  }, [initializer])

  const login = useCallback(async (email: string, password?: string) => {
    if (signingIn.current) return { success: false, message: "Sign-in is already in progress." }
    signingIn.current = true
    setIsSigningIn(true)
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password!)
      const profile = await initializer.load(credential.user)
      return {
        success: true,
        role: profile.role,
        requiresVerification: profile.role === "client"
          && profile.emailVerificationRequired === true
          && credential.user.emailVerified !== true,
      }
    } catch (error: any) {
      return { success: false, message: getFirebaseErrorMessage(error) }
    } finally { signingIn.current = false; setIsSigningIn(false) }
  }, [initializer])

  const requestEmailVerificationCode = useCallback(async () => {
    const currentUser = auth.currentUser
    if (!currentUser) return { success: false, message: "Please sign in again before requesting a verification code." }
    if (currentUser.emailVerified) return { success: true, message: "This email address is already verified." }

    try {
      const response = await fetch("/api/auth/email-otp", {
        method: "POST",
        headers: await getAuthHeaders(true),
        body: JSON.stringify({ action: "issue" }),
      })
      const payload = await response.json().catch(() => null) as {
        error?: unknown
        status?: unknown
        retryAfterSeconds?: unknown
      } | null
      const retryAfterSeconds = typeof payload?.retryAfterSeconds === "number" && Number.isFinite(payload.retryAfterSeconds)
        ? Math.max(0, Math.ceil(payload.retryAfterSeconds))
        : undefined
      if (!response.ok) {
        return {
          success: false,
          message: typeof payload?.error === "string" ? payload.error : "We could not send a verification code. Please try again later.",
          retryAfterSeconds,
        }
      }
      return {
        success: true,
        message: payload?.status === "already_verified"
          ? "This email address is already verified."
          : "Your 6-digit verification code was sent. Check your inbox and spam folder.",
        retryAfterSeconds,
      }
    } catch {
      return { success: false, message: "We could not send a verification code. Check your connection and try again." }
    }
  }, [])

  const verifyEmailCode = useCallback(async (code: string) => {
    const currentUser = auth.currentUser
    if (!currentUser) return { success: false, message: "Please sign in again before verifying your email." }
    const normalizedCode = code.trim()
    if (!/^\d{6}$/.test(normalizedCode)) return { success: false, message: "Enter the 6-digit verification code." }

    try {
      const response = await fetch("/api/auth/email-otp", {
        method: "POST",
        headers: await getAuthHeaders(true),
        body: JSON.stringify({ action: "verify", code: normalizedCode }),
      })
      const payload = await response.json().catch(() => null) as {
        error?: unknown
        alreadyVerified?: unknown
      } | null
      if (!response.ok) {
        return {
          success: false,
          message: typeof payload?.error === "string" ? payload.error : "We could not verify that code. Please try again.",
        }
      }

      try {
        await reload(currentUser)
        await currentUser.getIdToken(true)
        await initializer.load(currentUser, true)
      } catch {
        return {
          success: false,
          message: "Your email was verified, but the local session could not be refreshed. Please refresh the page and try again.",
        }
      }
      return {
        success: true,
        alreadyVerified: payload?.alreadyVerified === true,
        message: "Your email has been verified successfully.",
      }
    } catch {
      return { success: false, message: "We could not verify that code. Check your connection and try again." }
    }
  }, [initializer])

  const signup = useCallback(async (input: SignupInput) => {
    pendingRegistrationPassword.current = null
    try {
      // Password is deliberately not included in this request. It remains only
      // in the provider's temporary in-memory handoff until OTP succeeds.
      const response = await fetch("/api/auth/register/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: input.firstName,
          middleName: input.middleName || "",
          lastName: input.lastName,
          email: input.email,
          phone: input.phone || "",
        }),
      })
      const payload = await response.json().catch(() => null) as {
        error?: unknown
        registrationId?: unknown
        email?: unknown
        retryAfterSeconds?: unknown
      } | null
      if (!response.ok) {
        return {
          success: false,
          message: typeof payload?.error === "string" ? payload.error : "We could not start signup. Please try again later.",
        }
      }
      const registrationId = typeof payload?.registrationId === "string" ? payload.registrationId : ""
      const email = typeof payload?.email === "string" ? payload.email : input.email.trim().toLowerCase()
      if (!registrationId || !email) return { success: false, message: "Signup could not be started. Please try again later." }
      pendingRegistrationPassword.current = { registrationId, value: input.password }
      setPendingRegistration({ registrationId, email })
      return {
        success: true,
        message: "Your verification code was sent. Your account will be finalized after the code is accepted.",
        requiresVerification: true,
        registrationId,
      }
    } catch {
      return { success: false, message: "We could not start signup. Check your connection and try again." }
    }
  }, [])

  const restorePendingRegistration = useCallback(async (registrationId: string) => {
    const normalizedId = registrationId.trim()
    if (!normalizedId) return { success: false, message: "This signup session is missing. Start signup again." }
    if (pendingRegistrationPassword.current?.registrationId !== normalizedId) {
      pendingRegistrationPassword.current = null
    }
    try {
      const response = await fetch("/api/auth/register/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", registrationId: normalizedId }),
      })
      const payload = await response.json().catch(() => null) as {
        error?: unknown
        email?: unknown
        status?: unknown
      } | null
      if (!response.ok) {
        return { success: false, message: typeof payload?.error === "string" ? payload.error : "This signup session has expired. Start signup again." }
      }
      const email = typeof payload?.email === "string" ? payload.email : ""
      if (!email) return { success: false, message: "This signup session is invalid. Start signup again." }
      setPendingRegistration({ registrationId: normalizedId, email })
      return { success: true, email, status: typeof payload?.status === "string" ? payload.status : undefined }
    } catch {
      return { success: false, message: "We could not load the signup session. Check your connection and try again." }
    }
  }, [])

  const verifyPendingRegistrationCode = useCallback(async (code: string) => {
    const pending = pendingRegistration
    if (!pending) return { success: false, message: "This signup session is missing. Start signup again." }
    try {
      const response = await fetch("/api/auth/register/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", registrationId: pending.registrationId, code: code.trim() }),
      })
      const payload = await response.json().catch(() => null) as { error?: unknown; email?: unknown } | null
      if (!response.ok) {
        return { success: false, message: typeof payload?.error === "string" ? payload.error : "We could not verify that code. Please try again." }
      }
      const email = typeof payload?.email === "string" ? payload.email : pending.email
      setPendingRegistration({ ...pending, email })
      return { success: true, email, message: "Email verified. Finalizing your account automatically." }
    } catch {
      return { success: false, message: "We could not verify that code. Check your connection and try again." }
    }
  }, [pendingRegistration])

  const resendPendingRegistrationCode = useCallback(async () => {
    const pending = pendingRegistration
    if (!pending) return { success: false, message: "This signup session is missing. Start signup again." }
    try {
      const response = await fetch("/api/auth/register/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend", registrationId: pending.registrationId }),
      })
      const payload = await response.json().catch(() => null) as {
        error?: unknown
        retryAfterSeconds?: unknown
        email?: unknown
      } | null
      const retryAfterSeconds = typeof payload?.retryAfterSeconds === "number" && Number.isFinite(payload.retryAfterSeconds)
        ? Math.max(0, Math.ceil(payload.retryAfterSeconds))
        : undefined
      if (!response.ok) {
        return { success: false, message: typeof payload?.error === "string" ? payload.error : "We could not send a new verification code. Please try again.", retryAfterSeconds }
      }
      if (typeof payload?.email === "string" && payload.email) setPendingRegistration({ ...pending, email: payload.email })
      return { success: true, message: "A new verification code was sent. Check your inbox and spam folder.", retryAfterSeconds }
    } catch {
      return { success: false, message: "We could not send a new verification code. Check your connection and try again." }
    }
  }, [pendingRegistration])

  const finalizePendingRegistration = useCallback(async () => {
    const pending = pendingRegistration
    if (!pending) return { success: false, message: "This signup session is missing. Start signup again." }
    const passwordHandoff = pendingRegistrationPassword.current
    if (passwordHandoff?.registrationId !== pending.registrationId || passwordHandoff.value.length < 6) {
      return {
        success: false,
        message: "For your security, this browser no longer has the signup password. Cancel signup and start again.",
      }
    }
    const normalizedEmail = pending.email.trim().toLowerCase()
    let currentUser = auth.currentUser
    if (currentUser && (currentUser.email || "").trim().toLowerCase() !== normalizedEmail) {
      return { success: false, message: "A different Firebase account is already signed in. Sign out and try again." }
    }

    pendingFinalization.current = true
    let createdAuthIdentity = false
    try {
      if (!currentUser) {
        const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, passwordHandoff.value)
        currentUser = credential.user
        createdAuthIdentity = true
      }
      const response = await fetch("/api/auth/register/finalize", {
        method: "POST",
        headers: await getAuthHeaders(true),
        body: JSON.stringify({ registrationId: pending.registrationId }),
      })
      const payload = await response.json().catch(() => null) as { error?: unknown } | null
      if (!response.ok) {
        // Keep the newly-created Auth identity out of normal profile loading
        // while this still-retryable handoff remains on the verification page.
        pendingFinalization.current = createdAuthIdentity
        return { success: false, message: typeof payload?.error === "string" ? payload.error : "Your account could not be finalized. Keep this page open and try again." }
      }

      pendingRegistrationPassword.current = null
      setPendingRegistration(null)
      initializer.clear()
      try {
        await signOut(auth)
      } catch {
        return { success: false, message: "Your account was created, but sign out could not be completed. Please sign out before logging in." }
      }
      pendingFinalization.current = false
      return { success: true, message: "Account created successfully. Please log in manually to continue." }
    } catch (error: any) {
      pendingFinalization.current = createdAuthIdentity
      return { success: false, message: getFirebaseErrorMessage(error) }
    }
  }, [initializer, pendingRegistration])

  const clearPendingRegistration = useCallback(() => {
    pendingFinalization.current = false
    pendingRegistrationPassword.current = null
    setPendingRegistration(null)
  }, [])

  const sendVerificationEmailForCurrentUser = useCallback(async () => {
    const currentUser = auth.currentUser
    if (!currentUser) return { success: false, message: "Please sign in again before requesting verification." }
    if (currentUser.emailVerified) return { success: true, message: "This email address is already verified." }
    if (!VERIFICATION_LINK_FALLBACK_ENABLED) {
      return { success: false, message: "The verification-link fallback is disabled. Use the six-digit verification code." }
    }
    try {
      await sendEmailVerification(currentUser)
      return { success: true, message: "Verification email sent. Check your inbox and spam folder." }
    } catch (error: any) {
      return { success: false, message: getFirebaseErrorMessage(error) }
    }
  }, [])

  const logout = useCallback(async () => {
    initializer.clear()
    pendingRegistrationPassword.current = null
    setPendingRegistration(null)
    try {
      await signOut(auth)
      return true
    }
    catch {
      setSession({ user: null, phase: "error", error: "Sign-out could not be completed. Check your connection and try signing out again." })
      return false
    }
  }, [initializer])

  const updateProfilePicture = useCallback(async (dataUrl: string) => {
    const identity = auth.currentUser
    if (!identity) return
    try {
      let url = ""
      if (dataUrl) {
        const res = await fetch(dataUrl)
        const blob = await res.blob()
        const file = new File([blob], "profile.jpg", { type: blob.type })
        const result = await uploadToCloudinary(file, { folder: "profiles" })
        url = result.secureUrl
      } else {
        const currentUrl = user?.profilePicture
        if (currentUrl) {
          const publicId = extractPublicId(currentUrl)
          // A legacy/profile URL is not proof of ownership. Clear the profile
          // reference safely, but only request deletion for the trusted UID
          // namespace enforced by the server route.
          if (publicId && isOwnedProfilePublicId(publicId, identity.uid)) {
            deleteFromCloudinary(publicId).catch(() => {})
          }
        }
      }
      if (auth.currentUser?.uid !== identity.uid) throw new Error("The signed-in account changed. Please retry.")
      const userDocRef = doc(db, "users", identity.uid)
      await updateDoc(userDocRef, { profilePicture: url })
      setUser((prev) => (prev?.id === identity.uid ? { ...prev, profilePicture: url } : prev))
    } catch (err) {
      console.error("[Auth] Failed to update profile picture:", err)
      throw err
    }
  }, [user])

  const removeProfilePicture = useCallback(async () => {
    const identity = auth.currentUser
    if (!identity) return
    try {
      const currentUrl = user?.profilePicture
      if (currentUrl) {
        const publicId = extractPublicId(currentUrl)
        // Unverified legacy images are deliberately left in Cloudinary; their
        // profile reference can still be removed without granting deletion.
        if (publicId && isOwnedProfilePublicId(publicId, identity.uid)) {
          await deleteFromCloudinary(publicId)
        }
      }
      if (auth.currentUser?.uid !== identity.uid) throw new Error("The signed-in account changed. Please retry.")
      const userDocRef = doc(db, "users", identity.uid)
      await updateDoc(userDocRef, { profilePicture: "" })
      setUser((prev) => (prev?.id === identity.uid ? { ...prev, profilePicture: "" } : prev))
    } catch (err) {
      console.error("[Auth] Failed to remove profile picture:", err)
      throw err
    }
  }, [user])

  const updateProfileDetails = useCallback(async (input: ProfileContactUpdateInput) => {
    const currentUser = auth.currentUser
    if (!currentUser) throw new Error("Authentication is required.")

    let contactUpdate
    try {
      contactUpdate = normalizeProfileContactUpdate(input)
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Invalid profile details.")
    }

    const currentAuthEmail = (currentUser.email || "").trim().toLowerCase()
    const emailChanged = contactUpdate.email !== currentAuthEmail

    if (emailChanged) {
      if (!input.currentPassword?.trim()) {
        throw new Error("Enter your current password to change your email address.")
      }
      if (!currentAuthEmail) {
        throw new Error("This account does not have a password sign-in method for email changes.")
      }
      if (!currentUser.providerData.some((provider) => provider.providerId === "password")) {
        throw new Error("Email changes require a recent password sign-in for this account.")
      }

      try {
        const credential = EmailAuthProvider.credential(currentAuthEmail, input.currentPassword)
        await reauthenticateWithCredential(currentUser, credential)
      } catch (error) {
        throw new Error(getProfileUpdateErrorMessage(error))
      }
    }

    let response: Response
    try {
      response = await fetch("/api/profile", {
        method: "PATCH",
        headers: await getAuthHeaders(true, emailChanged),
        body: JSON.stringify(contactUpdate),
      })
    } catch (error) {
      throw new Error(getProfileUpdateErrorMessage(error))
    }

    const responseBody = await response.json().catch(() => null) as {
      error?: unknown
      profile?: unknown
    } | null
    if (!response.ok) {
      throw new Error(
        responseBody && typeof responseBody.error === "string"
          ? responseBody.error
          : "Unable to update your profile. Please try again.",
      )
    }

    let persistedProfile
    try {
      persistedProfile = normalizeProfileContactUpdate(
        responseBody?.profile && typeof responseBody.profile === "object"
          ? responseBody.profile as Record<string, unknown>
          : {},
      )
    } catch {
      throw new Error("The profile server returned an invalid update response.")
    }

    try {
      await reload(currentUser)
    } catch (error) {
      console.warn("[Auth] Profile updated, but the local Auth session could not be reloaded:", error)
    }

    setUser((prev) => (
      prev?.id === currentUser.uid
        ? { ...prev, email: persistedProfile.email, phone: persistedProfile.phone }
        : prev
    ))
    return persistedProfile
  }, [])

  const updatePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const currentUser = auth.currentUser
    if (!currentUser) throw new Error("Authentication is required.")
    try {
      await updateAuthenticatedPassword(currentUser, currentPassword, newPassword)
    } catch (error) {
      throw new Error(getPasswordUpdateErrorMessage(error))
    }
  }, [])

  const refreshUser = useCallback(async () => {
    try { await safeRead(() => auth.authStateReady(), { attempts: 1 }) }
    catch (error) { initializer.fail(error); return }
    const identity = auth.currentUser
    if (!identity) { initializer.clear(); return }
    try {
      await reload(identity)
    } catch (error) {
      console.warn("[AUTH] Unable to refresh Firebase verification state", {
        code: error && typeof error === "object" && "code" in error ? String(error.code) : "unknown",
      })
    }
    await initializer.load(identity, true).catch(() => {})
  }, [initializer])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      authLoading: session.phase === "auth",
      profileLoading: session.phase === "profile",
      initializationError: session.error,
      isSigningIn,
      pendingRegistration,
      login,
      signup,
      restorePendingRegistration,
      verifyPendingRegistrationCode,
      resendPendingRegistrationCode,
      finalizePendingRegistration,
      clearPendingRegistration,
      requestEmailVerificationCode,
      verifyEmailCode,
      sendVerificationEmail: sendVerificationEmailForCurrentUser,
      verificationLinkFallbackEnabled: VERIFICATION_LINK_FALLBACK_ENABLED,
      logout,
      updateProfilePicture,
      removeProfilePicture,
      updateProfileDetails,
      updatePassword,
      refreshUser,
    }),
    [user, isLoading, session.phase, session.error, isSigningIn, pendingRegistration, login, signup, restorePendingRegistration, verifyPendingRegistrationCode, resendPendingRegistrationCode, finalizePendingRegistration, clearPendingRegistration, requestEmailVerificationCode, verifyEmailCode, sendVerificationEmailForCurrentUser, logout, updateProfilePicture, removeProfilePicture, updateProfileDetails, updatePassword, refreshUser]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used within an AuthProvider")
  return context
}

/**
 * Used by globally mounted providers that can also be exercised in isolation
 * (for example, CMS tests). Feature pages should continue to use useAuth so a
 * missing authentication provider is surfaced immediately.
 */
export const useOptionalAuth = () => useContext(AuthContext)
