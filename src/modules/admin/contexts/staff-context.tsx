"use client"
import React, { createContext, useContext, useEffect, useState } from "react"
import {
  collection,
  query,
  where,
  onSnapshot,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import type { StaffPermissions } from "@/src/modules/shared/types/permissions"
import { DEFAULT_STAFF_PERMISSIONS } from "@/src/modules/shared/types/permissions"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { getAuthHeaders } from "@/src/modules/shared/lib/auth-token"

export type StaffAccount = {
  id: string
  uid: string
  firstName: string
  lastName: string
  fullName: string
  email: string
  phone?: string
  position: string
  role: "staff"
  status: "active" | "inactive"
  permissions: StaffPermissions
  createdAt: string
  lastActive?: string
  profilePicture?: string
}

type StaffContextValue = {
  staff: StaffAccount[]
  loading: boolean
  addStaff: (data: {
    firstName: string
    lastName: string
    email: string
    password: string
    position: string
    phone?: string
    permissions: StaffPermissions
  }) => Promise<string | null>
  updateStaff: (uid: string, data: Partial<StaffAccount>) => Promise<void>
  deactivateStaff: (uid: string) => Promise<void>
  activateStaff: (uid: string) => Promise<void>
  deleteStaff: (uid: string) => Promise<void>
  toggleStaffPermission: (uid: string, permission: keyof StaffPermissions) => Promise<void>
}

const StaffContext = createContext<StaffContextValue | null>(null)

async function getApiError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null)
  return new Error(
    body && typeof body.error === "string" ? body.error : `${fallback} (${response.status})`,
  )
}

export const StaffProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth()
  const [staff, setStaff] = useState<StaffAccount[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const role = user?.role?.toLowerCase() ?? ""
    if (role !== "admin") {
      setLoading(false)
      return
    }

    const q = query(collection(db, "users"), where("role", "==", "staff"))
    console.log("[Firestore Listener START] Staff")
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const loaded: StaffAccount[] = []
        snapshot.forEach((docSnap) => {
          const d = docSnap.data()
          const permissions: StaffPermissions = {
            ...DEFAULT_STAFF_PERMISSIONS,
            ...(d.permissions || {}),
          }
          loaded.push({
            id: docSnap.id,
            uid: docSnap.id,
            firstName: d.firstName || "",
            lastName: d.lastName || "",
            fullName: d.fullName || "",
            email: d.email || "",
            phone: d.phone || "",
            position: d.position || "",
            role: "staff",
            status: d.status === "inactive" ? "inactive" : "active",
            permissions,
            createdAt: d.createdAt || "",
            lastActive: d.lastActive || "",
            profilePicture: d.profilePicture || "",
          })
        })
        setStaff(loaded)
        setLoading(false)
      },
      (error) => {
        console.error("[Staff snapshot error]", { code: error.code, message: error.message, error })
        setLoading(false)
      },
    )
    return () => {
      console.log("[Firestore Listener STOP] Staff")
      unsub()
    }
  }, [user?.role])

  const addStaff: StaffContextValue["addStaff"] = async (data) => {
    try {
      const fullName = `${data.firstName} ${data.lastName}`.trim()
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: await getAuthHeaders(true),
        body: JSON.stringify({
          email: data.email,
          password: data.password,
          firstName: data.firstName,
          lastName: data.lastName,
          fullName,
          phone: data.phone || "",
          position: data.position,
          permissions: data.permissions,
        }),
      })
      if (!res.ok) throw await getApiError(res, "Failed to create staff")
      const json = await res.json()

      return json.uid as string
    } catch (error) {
      console.error("[StaffContext] addStaff error:", error)
      throw error
    }
  }

  const updateStaff: StaffContextValue["updateStaff"] = async (uid, data) => {
    try {
      const updateData: Record<string, unknown> = { uid }
      if (data.firstName !== undefined) updateData.firstName = data.firstName
      if (data.lastName !== undefined) updateData.lastName = data.lastName
      if (data.fullName !== undefined) updateData.fullName = data.fullName
      if (data.email !== undefined) updateData.email = data.email
      if (data.phone !== undefined) updateData.phone = data.phone
      if (data.position !== undefined) updateData.position = data.position
      if (data.permissions !== undefined) updateData.permissions = data.permissions
      const res = await fetch("/api/staff", {
        method: "PATCH",
        headers: await getAuthHeaders(true),
        body: JSON.stringify(updateData),
      })
      if (!res.ok) throw await getApiError(res, "Failed to update staff")
    } catch (error) {
      console.error("[StaffContext] updateStaff error:", error)
      throw error
    }
  }

  const deactivateStaff: StaffContextValue["deactivateStaff"] = async (uid) => {
    try {
      const res = await fetch("/api/staff", {
        method: "PATCH",
        headers: await getAuthHeaders(true),
        body: JSON.stringify({ uid, disabled: true }),
      })
      if (!res.ok) throw await getApiError(res, "Failed to deactivate staff")
    } catch (error) {
      console.error("[StaffContext] deactivateStaff error:", error)
      throw error
    }
  }

  const activateStaff: StaffContextValue["activateStaff"] = async (uid) => {
    try {
      const res = await fetch("/api/staff", {
        method: "PATCH",
        headers: await getAuthHeaders(true),
        body: JSON.stringify({ uid, disabled: false }),
      })
      if (!res.ok) throw await getApiError(res, "Failed to activate staff")
    } catch (error) {
      console.error("[StaffContext] activateStaff error:", error)
      throw error
    }
  }

  const deleteStaff: StaffContextValue["deleteStaff"] = async (uid) => {
    try {
      const res = await fetch(`/api/staff?uid=${encodeURIComponent(uid)}`, {
        method: "DELETE",
        headers: await getAuthHeaders(),
      })
      if (!res.ok) {
        throw await getApiError(res, "Failed to delete staff")
      }
    } catch (error) {
      console.error("[StaffContext] deleteStaff error:", error)
      throw error
    }
  }

  const toggleStaffPermission: StaffContextValue["toggleStaffPermission"] = async (uid, permission) => {
    try {
      const member = staff.find((s) => s.uid === uid)
      if (!member) return
      const current = member.permissions[permission]
      const res = await fetch("/api/staff", {
        method: "PATCH",
        headers: await getAuthHeaders(true),
        body: JSON.stringify({
          uid,
          permissions: { ...member.permissions, [permission]: !current },
        }),
      })
      if (!res.ok) throw await getApiError(res, "Failed to update staff permissions")
    } catch (error) {
      console.error("[StaffContext] toggleStaffPermission error:", error)
      throw error
    }
  }

  const value: StaffContextValue = {
    staff,
    loading,
    addStaff,
    updateStaff,
    deactivateStaff,
    activateStaff,
    deleteStaff,
    toggleStaffPermission,
  }

  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>
}

export const useStaff = (): StaffContextValue => {
  const context = useContext(StaffContext)
  if (!context) throw new Error("useStaff must be used within a StaffProvider")
  return context
}
