"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Users } from "lucide-react"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { UserAvatar } from "@/src/modules/shared/components/user-avatar"
import { formatDisplayName } from "@/src/modules/shared/lib/name-utils"
import { formatBookingDateTime } from "@/src/modules/shared/lib/booking-helpers"
import { Table, TableBody, TableCell, TableHead, TableHeader } from "@/src/modules/shared/components/ui/table"
import { db } from "@/lib/firebase"
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
} from "firebase/firestore"

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

const USERS_PAGE_SIZE = 100

function getUserStatusClass(status?: string) {
  const normalized = String(status || "").trim().toLowerCase()
  return normalized === "active"
    ? "border-emerald-100 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-slate-50 text-slate-600"
}

function formatUserDate(value?: string) {
  return value ? formatBookingDateTime(value, "short") || "—" : "—"
}

export default function UsersPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [lastVisible, setLastVisible] = useState<any>(null)
  const [hasMore, setHasMore] = useState(false)
  const [indexFallback, setIndexFallback] = useState(false)

  useEffect(() => {
    if (user && user.role === "staff" && !user.permissions?.users) {
      router.replace("/dashboard")
    }
  }, [user, router])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mapUser = (docSnap: any): UserRecord => {
    const data = docSnap.data()
    return {
      uid: docSnap.id,
      fullName: formatDisplayName(data),
      email: data.email || "",
      phone: data.phone || "",
      role: data.role || "",
      status: data.status || "",
      createdAt: data.createdAt || "",
      profilePicture: data.profilePicture || "",
    }
  }

  useEffect(() => {
    let cancelled = false

    async function fetchUsers() {
      try {
        const clientsRef = collection(db, "users")
        const q = query(
          clientsRef,
          where("role", "==", "client"),
          orderBy("createdAt", "desc"),
          limit(USERS_PAGE_SIZE),
        )
        const snapshot = await getDocs(q)
        if (cancelled) return
        const loaded = snapshot.docs.map(mapUser)
        setUsers(loaded)
        setLastVisible(snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null)
        setHasMore(snapshot.docs.length === USERS_PAGE_SIZE)
      } catch (err: any) {
        if (err?.code === "failed-precondition") {
          // Composite index (role ASC, createdAt DESC) not created yet:
          // fall back to a single scoped query (clients only) so the page
          // still works without loading the entire users collection.
          if (cancelled) return
          setIndexFallback(true)
          try {
            const fallbackSnap = await getDocs(
              query(collection(db, "users"), where("role", "==", "client")),
            )
            if (cancelled) return
            setUsers(fallbackSnap.docs.map(mapUser))
            setHasMore(false)
            setLastVisible(null)
          } catch (err2) {
            if (!cancelled) {
              setError(err2 instanceof Error ? err2.message : "Failed to load users")
            }
          }
        } else {
          console.error("[UsersPage] Firestore getDocs error:", err)
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to load users")
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchUsers()

    return () => { cancelled = true }
  }, [])

  const loadMore = useCallback(async () => {
    if (!lastVisible || indexFallback || loadingMore) return
    setLoadingMore(true)
    try {
      const snapshot = await getDocs(
        query(
          collection(db, "users"),
          where("role", "==", "client"),
          orderBy("createdAt", "desc"),
          limit(USERS_PAGE_SIZE),
          startAfter(lastVisible),
        ),
      )
      const more = snapshot.docs.map(mapUser)
      setUsers((prev) => [...prev, ...more])
      setLastVisible(snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null)
      setHasMore(snapshot.docs.length === USERS_PAGE_SIZE)
    } catch (err) {
      console.error("[UsersPage] load more error:", err)
      setError(err instanceof Error ? err.message : "Failed to load more users")
    } finally {
      setLoadingMore(false)
    }
  }, [lastVisible, indexFallback, loadingMore])

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <header className="mb-5">
          <h1 className="oe-page-title">Users Information</h1>
        </header>
        {loading ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center gap-3" role="status" aria-live="polite">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-orange-600" aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-500">Loading client accounts…</span>
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
          <div className="mt-5">
            <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block">
              <Table className="min-w-[860px] table-fixed xl:min-w-0">
                <caption className="sr-only">Client user accounts</caption>
                <colgroup>
                  <col style={{ width: "26%" }} />
                  <col style={{ width: "27%" }} />
                  <col style={{ width: "19%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "15%" }} />
                </colgroup>
                <TableHeader className="bg-slate-50/80">
                  <tr>
                    <TableHead className="oe-table-head">Client</TableHead>
                    <TableHead className="oe-table-head">Email</TableHead>
                    <TableHead className="oe-table-head">Phone</TableHead>
                    <TableHead className="oe-table-head">Status</TableHead>
                    <TableHead className="oe-table-head">Joined</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <tr key={u.uid} className="border-b border-slate-100 transition-colors hover:bg-slate-50/70">
                      <TableCell className="min-w-0 align-top whitespace-normal">
                        <div className="flex min-w-0 items-center gap-3">
                          <UserAvatar
                            name={u.fullName}
                            picture={u.profilePicture}
                            className="h-10 w-10 shrink-0"
                            ringClassName=""
                            fallbackClassName="bg-orange-50 text-orange-600"
                            textClassName="font-black uppercase text-sm"
                          />
                          <p className="oe-table-primary line-clamp-2">{u.fullName || "—"}</p>
                        </div>
                      </TableCell>
                      <TableCell className="min-w-0 align-top whitespace-normal">
                        <p className="oe-table-primary break-words">{u.email || "—"}</p>
                      </TableCell>
                      <TableCell className="min-w-0 align-top whitespace-normal">
                        <p className="oe-table-primary break-words">{u.phone || "—"}</p>
                      </TableCell>
                      <TableCell className="align-top whitespace-nowrap">
                        <span className={`oe-status-badge border ${getUserStatusClass(u.status)}`}>
                          {u.status || "Unknown"}
                        </span>
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <p className="oe-table-secondary">{formatUserDate(u.createdAt)}</p>
                      </TableCell>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-2 md:hidden">
              {users.map((u) => (
                <article key={u.uid} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <UserAvatar
                        name={u.fullName}
                        picture={u.profilePicture}
                        className="h-10 w-10 shrink-0"
                        ringClassName=""
                        fallbackClassName="bg-orange-50 text-orange-600"
                        textClassName="font-black uppercase text-sm"
                      />
                      <div className="min-w-0">
                        <p className="oe-table-primary line-clamp-2">{u.fullName || "—"}</p>
                        <p className="oe-table-secondary mt-0.5">Client account</p>
                      </div>
                    </div>
                    <span className={`oe-status-badge shrink-0 border ${getUserStatusClass(u.status)}`}>
                      {u.status || "Unknown"}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-3">
                    <div className="min-w-0">
                      <dt className="oe-table-label">Email</dt>
                      <dd className="oe-table-secondary mt-0.5 break-words">{u.email || "—"}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="oe-table-label">Phone</dt>
                      <dd className="oe-table-secondary mt-0.5 break-words">{u.phone || "—"}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="oe-table-label">Joined</dt>
                      <dd className="oe-table-secondary mt-0.5">{formatUserDate(u.createdAt)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
            {hasMore && !indexFallback && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-xs font-black text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {loadingMore ? "Loading..." : "Load More"}
                </button>
              </div>
            )}
            {indexFallback && hasMore === false && (
              <p className="pt-1 text-center text-[10px] font-semibold text-slate-400">
                Showing all client accounts.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
