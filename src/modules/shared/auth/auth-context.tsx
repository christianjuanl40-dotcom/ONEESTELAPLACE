"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
} from "firebase/auth"
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore"
import { auth, db } from "@/lib/firebase"
import { perfMark } from "@/src/modules/shared/lib/perf-trace"
import type { StaffPermissions } from "@/src/modules/shared/types/permissions"
import { DEFAULT_STAFF_PERMISSIONS } from "@/src/modules/shared/types/permissions"
import { uploadToCloudinary, deleteFromCloudinary, extractPublicId } from "@/src/modules/shared/lib/cloudinary"
import { formatDisplayName, getStructuredName } from "@/src/modules/shared/lib/name-utils"
import { getAuthHeaders } from "@/src/modules/shared/lib/auth-token"
import { normalizeProfileContactUpdate } from "@/src/modules/shared/lib/profile-utils"

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
  login: (email: string, password?: string) => Promise<{ success: boolean; message?: string; role?: string }>
  signup: (input: SignupInput) => Promise<{ success: boolean; message?: string }>
  logout: () => void
  updateProfilePicture: (dataUrl: string) => Promise<void>
  removeProfilePicture: () => Promise<void>
  updateProfileDetails: (input: ProfileContactUpdateInput) => Promise<{ email: string; phone: string }>
  refreshUser: () => void
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    perfMark("[AUTH] onAuthStateChanged registered")
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      perfMark(firebaseUser ? "[AUTH] onAuthStateChanged fired (signed in)" : "[AUTH] onAuthStateChanged fired (signed out)")
      if (firebaseUser) {
        try {
          const userDocRef = doc(db, "users", firebaseUser.uid)
          const userDocSnap = await getDoc(userDocRef)
          perfMark("[AUTH] Firestore users/{uid} read complete")
          console.log(
            `[DEBUG][AUTH] profile read — uid: ${firebaseUser.uid}, email: ${firebaseUser.email ?? "null"}, docExists: ${userDocSnap.exists()}`,
          )
          if (userDocSnap.exists()) {
            const data = userDocSnap.data()
            const rawRole: string = String(data.role || "").toLowerCase().trim()
            console.log(
              `[DEBUG][AUTH] role: ${JSON.stringify(rawRole)}, permissions: ${JSON.stringify(data.permissions ?? "none")}`,
            )

            if (rawRole !== "admin" && rawRole !== "client" && rawRole !== "staff") {
              console.error("[Auth:onAuthStateChanged] INVALID ROLE:", rawRole, "- not setting user")
              setUser(null)
            } else {
              const validRole = rawRole as AppUser["role"]
              const nameParts = getStructuredName(data)
              const fullName = formatDisplayName({ ...nameParts, fullName: data.fullName, name: data.name })
              const permissions: StaffPermissions | undefined =
                validRole === "staff"
                  ? { ...DEFAULT_STAFF_PERMISSIONS, ...(data.permissions || {}) }
                  : undefined
              setUser((prev) => {
                if (
                  prev &&
                  prev.id === firebaseUser.uid &&
                  prev.role === validRole &&
                  prev.fullName === fullName &&
                  prev.firstName === nameParts.firstName &&
                  prev.middleName === nameParts.middleName &&
                  prev.lastName === nameParts.lastName &&
                  prev.email === (firebaseUser.email || data.email || "") &&
                  prev.profilePicture === (data.profilePicture || "") &&
                  prev.status === (data.status || "active") &&
                  prev.phone === (data.phone || "") &&
                  prev.position === (data.position || "")
                ) {
                  return prev
                }
                return {
                  id: firebaseUser.uid,
                  fullName,
                  name: fullName,
                  firstName: nameParts.firstName,
                  middleName: nameParts.middleName,
                  lastName: nameParts.lastName,
                  email: firebaseUser.email || data.email || "",
                  role: validRole,
                  profilePicture: data.profilePicture || "",
                  createdAt: data.createdAt || new Date().toISOString(),
                  status: data.status || "active",
                  phone: data.phone || "",
                  position: data.position || "",
                  permissions,
                }
              })
            }
          }
        } catch (err: any) {
          console.error("[Auth:onAuthStateChanged] Firestore read error:", err?.code || err?.message || err)
        }
      } else {
        setUser(null)
      }
      setIsLoading(false)
      perfMark("[AUTH] AuthProvider ready (isLoading=false)")
    })

    return unsubscribe
  }, [])

  const login = useCallback(async (email: string, password?: string) => {
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password!)

      const userDocRef = doc(db, "users", credential.user.uid)
      const userDocSnap = await getDoc(userDocRef)

      if (!userDocSnap.exists()) {

        const recoveredEmail = (credential.user.email || email).toLowerCase().trim()
        const now = new Date().toISOString()
        const recoveredData = {
          uid: credential.user.uid,
          email: recoveredEmail,
          fullName: credential.user.displayName || recoveredEmail.split("@")[0] || "User",
          role: "client",
          status: "active",
          createdAt: now,
        }

        await setDoc(userDocRef, recoveredData)

        const verifySnap = await getDoc(userDocRef)
        if (!verifySnap.exists()) {
          console.error("[Auth] Login — FATAL: setDoc succeeded but getDoc returns exists()=false")
          return {
            success: false,
            message:
              "Profile recovery failed — document was written but could not be read back. Check Firestore security rules.",
          }
        }

        setUser({
          id: credential.user.uid,
          fullName: recoveredData.fullName,
          name: recoveredData.fullName,
          firstName: "",
          middleName: "",
          lastName: "",
          email: recoveredData.email,
          role: "client",
          profilePicture: "",
          createdAt: now,
          status: "active",
          phone: "",
        })

        return { success: true, role: "client" }
      }

      const data = userDocSnap.data()
      const rawRole: string = String(data.role || "").toLowerCase().trim()

      if (rawRole !== "admin" && rawRole !== "client" && rawRole !== "staff") {
        console.error("[Auth] Login FAILED — invalid or missing role:", JSON.stringify(data.role), "at", userDocRef.path)
        return {
          success: false,
          message: "Your account has an invalid or missing role. Please contact support.",
        }
      }

      const role = rawRole as AppUser["role"]
      const nameParts = getStructuredName(data)
      const fullName = formatDisplayName({ ...nameParts, fullName: data.fullName, name: data.name })
      const permissions: StaffPermissions | undefined =
        role === "staff"
          ? { ...DEFAULT_STAFF_PERMISSIONS, ...(data.permissions || {}) }
          : undefined

      setUser({
        id: credential.user.uid,
        fullName,
        name: fullName,
        firstName: nameParts.firstName,
        middleName: nameParts.middleName,
        lastName: nameParts.lastName,
        email: credential.user.email || data.email || email,
        role,
        profilePicture: data.profilePicture || "",
        createdAt: data.createdAt || new Date().toISOString(),
        status: data.status || "active",
        phone: data.phone || "",
        position: data.position || "",
        permissions,
      })

      return { success: true, role }
    } catch (error: any) {
      return { success: false, message: getFirebaseErrorMessage(error) }
    }
  }, [])

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

      const verifySnap = await getDoc(userDocRef)
      if (!verifySnap.exists()) {
        console.error("[Auth:Signup] FATAL: setDoc succeeded but getDoc returns exists()=false")
        return {
          success: false,
          message:
            "Account created but profile write could not be verified. Please try logging in — the system will attempt to recover your profile.",
        }
      }

      setUser({
        id: uid,
        fullName,
        name: fullName,
        firstName,
        middleName,
        lastName,
        email: input.email.toLowerCase().trim(),
        role: role as AppUser["role"],
        profilePicture: "",
        createdAt,
        status: "active",
        phone: input.phone || "",
      })

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
  }, [])

  const logout = useCallback(async () => {
    await signOut(auth)
    window.location.replace("/")
  }, [])

  const updateProfilePicture = useCallback(async (dataUrl: string) => {
    if (!auth.currentUser) return
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
          if (publicId) {
            deleteFromCloudinary(publicId).catch(() => {})
          }
        }
      }
      const userDocRef = doc(db, "users", auth.currentUser.uid)
      await updateDoc(userDocRef, { profilePicture: url })
      setUser((prev) => (prev ? { ...prev, profilePicture: url } : prev))
    } catch (err) {
      console.error("[Auth] Failed to update profile picture:", err)
      throw err
    }
  }, [user])

  const removeProfilePicture = useCallback(async () => {
    if (!auth.currentUser) return
    try {
      const currentUrl = user?.profilePicture
      if (currentUrl) {
        const publicId = extractPublicId(currentUrl)
        if (publicId) {
          await deleteFromCloudinary(publicId)
        }
      }
      const userDocRef = doc(db, "users", auth.currentUser.uid)
      await updateDoc(userDocRef, { profilePicture: "" })
      setUser((prev) => (prev ? { ...prev, profilePicture: "" } : prev))
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
      prev
        ? { ...prev, email: persistedProfile.email, phone: persistedProfile.phone }
        : prev
    ))
    return persistedProfile
  }, [])

  const refreshUser = useCallback(async () => {
    if (!auth.currentUser) {
      setUser(null)
      return
    }
    try {
      const userDocRef = doc(db, "users", auth.currentUser.uid)
      const userDocSnap = await getDoc(userDocRef)
      if (userDocSnap.exists()) {
        const data = userDocSnap.data()
        const rawRole: string = String(data.role || "").toLowerCase().trim()
        if (rawRole !== "admin" && rawRole !== "client" && rawRole !== "staff") {
          console.error("[Auth:refreshUser] Invalid role:", rawRole)
          setUser(null)
          return
        }
        const refreshedRole = rawRole as AppUser["role"]
        const nameParts = getStructuredName(data)
        const fullName = formatDisplayName({ ...nameParts, fullName: data.fullName, name: data.name })
        const refreshedPermissions: StaffPermissions | undefined =
          refreshedRole === "staff"
            ? { ...DEFAULT_STAFF_PERMISSIONS, ...(data.permissions || {}) }
            : undefined
        setUser({
          id: auth.currentUser.uid,
          fullName,
          name: fullName,
          firstName: nameParts.firstName,
          middleName: nameParts.middleName,
          lastName: nameParts.lastName,
          email: auth.currentUser.email || data.email || "",
          role: refreshedRole,
          profilePicture: data.profilePicture || "",
          createdAt: data.createdAt || new Date().toISOString(),
          status: data.status || "active",
          phone: data.phone || "",
          position: data.position || "",
          permissions: refreshedPermissions,
        })
      }
    } catch {
      // ignore
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      authLoading: isLoading,
      login,
      signup,
      logout,
      updateProfilePicture,
      removeProfilePicture,
      updateProfileDetails,
      refreshUser,
    }),
    [user, isLoading, login, signup, logout, updateProfilePicture, removeProfilePicture, updateProfileDetails, refreshUser]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used within an AuthProvider")
  return context
}
