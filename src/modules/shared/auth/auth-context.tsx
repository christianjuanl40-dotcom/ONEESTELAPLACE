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
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from "firebase/auth"
import { doc, getDocFromServer, setDoc, updateDoc } from "firebase/firestore"
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

export interface AppUser {
  id: string
  fullName: string
  name: string
  firstName?: string
  middleName?: string
  lastName?: string
  email: string
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
  login: (email: string, password?: string) => Promise<{ success: boolean; message?: string; role?: string }>
  signup: (input: SignupInput) => Promise<{ success: boolean; message?: string }>
  logout: () => Promise<void>
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
  const signingIn = useRef(false)
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
      return { id: identity.uid, fullName, name: fullName, ...nameParts, email: identity.email || data.email || "",
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
      if (firebaseUser) void initializer.load(firebaseUser).catch(() => {})
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
      return { success: true, role: profile.role }
    } catch (error: any) {
      return { success: false, message: getFirebaseErrorMessage(error) }
    } finally { signingIn.current = false; setIsSigningIn(false) }
  }, [initializer])

  const signup = useCallback(async (input: SignupInput) => {
    let uid: string | null = null

    try {
      const credential = await createUserWithEmailAndPassword(auth, input.email, input.password)
      uid = credential.user.uid

      const firstName = input.firstName.trim()
      const middleName = input.middleName?.trim() || ""
      const lastName = input.lastName.trim()
      const fullName = formatDisplayName({ firstName, middleName, lastName })
      const role = "client"
      const createdAt = new Date().toISOString()
      const userDocRef = doc(db, "users", uid)

      const userData = {
        uid,
        email: input.email.toLowerCase().trim(),
        fullName,
        firstName,
        middleName,
        lastName,
        phone: input.phone || "",
        role,
        profilePicture: "",
        status: "active",
        createdAt,
      }

      await setDoc(userDocRef, userData)

      await initializer.load(credential.user, true)

      return { success: true, message: "Registration successful." }
    } catch (error: any) {
      const errorCode = error?.code || "unknown"
      const errorMessage = error?.message || String(error)

      if (errorCode === "permission-denied") {
        return {
          success: false,
          message: `Firestore permission denied. Deploy security rules: run 'firebase deploy --only firestore:rules' or check Firebase Console > Firestore > Rules. (code: ${errorCode})`,
        }
      }

      return { success: false, message: `Signup failed (${errorCode}): ${errorMessage}` }
    }
  }, [initializer])

  const logout = useCallback(async () => {
    initializer.clear()
    try { await signOut(auth) }
    catch {
      setSession({ user: null, phase: "error", error: "Sign-out could not be completed. Check your connection and try signing out again." })
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
    if (!auth.currentUser) { initializer.clear(); return }
    await initializer.load(auth.currentUser, true).catch(() => {})
  }, [initializer])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      authLoading: session.phase === "auth",
      profileLoading: session.phase === "profile",
      initializationError: session.error,
      isSigningIn,
      login,
      signup,
      logout,
      updateProfilePicture,
      removeProfilePicture,
      updateProfileDetails,
      updatePassword,
      refreshUser,
    }),
    [user, isLoading, session.phase, session.error, isSigningIn, login, signup, logout, updateProfilePicture, removeProfilePicture, updateProfileDetails, updatePassword, refreshUser]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used within an AuthProvider")
  return context
}
