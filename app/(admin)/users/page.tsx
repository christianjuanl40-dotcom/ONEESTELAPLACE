"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Users } from "lucide-react"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { UserAvatar } from "@/src/modules/shared/components/user-avatar"
import { db } from "@/lib/firebase"
import { collection, getDocs } from "firebase/firestore"

interface UserRecord {
  uid: string
  fullName: string
  email: string
  phone: string
  role: string
  status: string
  createdAt: string
  profilePicture?: string
}

export default function UsersPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<UserRecord[]>([])

  useEffect(() => {
    if (user && user.role === "staff" && !user.permissions?.users) {
      router.replace("/dashboard")
    }
  }, [user, router])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchUsers() {
      try {
        const snapshot = await getDocs(collection(db, "users"))
        console.log("[UsersPage] snapshot size:", snapshot.size)
        console.log("[UsersPage] document IDs:", snapshot.docs.map((d) => d.id))

        const loaded: UserRecord[] = []
        snapshot.forEach((docSnap) => {
          const data = docSnap.data()
          loaded.push({
            uid: docSnap.id,
            fullName: data.fullName || "",
            email: data.email || "",
            phone: data.phone || "",
            role: data.role || "",
            status: data.status || "",
            createdAt: data.createdAt || "",
            profilePicture: data.profilePicture || "",
          })
        })
        console.log("[UsersPage] users loaded:", loaded.length)
        console.log("[UsersPage] final array:", JSON.stringify(loaded.map((u) => ({ uid: u.uid, email: u.email }))))

        const clientUsers = loaded.filter((u) => u.role === "client")

        if (!cancelled) {
          setUsers(clientUsers)
          setLoading(false)
        }
      } catch (err) {
        console.error("[UsersPage] Firestore getDocs error:", err)
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load users")
          setLoading(false)
        }
      }
    }

    fetchUsers()

    return () => { cancelled = true }
  }, [])

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <section className="border-b border-slate-200 pb-5 mb-6">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-orange-600">
            Admin Users Information
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
            User Information
          </h1>
          <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">
            Read-only view of registered customer accounts and contact details.
          </p>
        </section>

        {loading ? (
          <div className="flex min-h-[230px] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-orange-600" />
          </div>
        ) : error ? (
          <div className="flex min-h-[230px] flex-col items-center justify-center rounded-2xl border border-dashed border-red-300 bg-red-50 px-6 py-10 text-center mt-5">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white text-red-400 shadow-sm">
              <Users className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-black text-red-700">Failed to load users</h3>
            <p className="mt-1 max-w-sm text-xs leading-5 text-red-500">{error}</p>
          </div>
        ) : users.length === 0 ? (
          <div className="flex min-h-[230px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center mt-5">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm">
              <Users className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-black text-slate-700">No users found</h3>
            <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
              The users collection exists but contains no documents.
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {users.map((u) => (
              <div key={u.uid} className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <UserAvatar
                  name={u.fullName}
                  picture={u.profilePicture}
                  className="h-11 w-11 shrink-0"
                  ringClassName=""
                  fallbackClassName="bg-orange-50 text-orange-600"
                  textClassName="font-black uppercase text-sm"
                />
                <div className="min-w-0 flex-1 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3 sm:gap-x-4">
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Name</p>
                    <p className="text-xs font-black text-slate-800 truncate">{u.fullName || "—"}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Email</p>
                    <p className="text-xs font-bold text-slate-800 truncate">{u.email || "—"}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Phone</p>
                    <p className="text-xs font-bold text-slate-800 truncate">{u.phone || "—"}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
