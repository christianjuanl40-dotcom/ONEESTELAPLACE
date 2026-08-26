"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useAuth } from "../auth/auth-context"
import { perfListener } from "../lib/perf-trace"
import { db } from "@/lib/firebase"
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  limit,
  getDocs,
  orderBy,
} from "firebase/firestore"
import type { NotificationItem, NotificationType } from "../lib/notifications"

interface NotificationContextValue {
  notifications: NotificationItem[]
  unreadCount: number
  moduleUnreadCount: number
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  markByBookingId: (bookingId: string, types?: NotificationType[]) => Promise<void>
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<NotificationItem[]>([])

  const scope = useMemo(() => {
    if (!user) return null
    return user.role === "admin" || user.role === "staff" ? "admin" : "client"
  }, [user?.role])

  const userId = useMemo(() => {
    if (!user || !scope) return null
    return scope === "admin" ? "admin" : user.id
  }, [user?.id, scope])

  useEffect(() => {
    if (!userId) return

    let activeUnsub: (() => void) | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null
    let destroyed = false

    console.log("[Notification Listener START]", { userId })
    perfListener("Notifications", "START")

    let firstSnapshot = true

    function mapSnapshot(snapshot: any): NotificationItem[] {
      const items: NotificationItem[] = []
      snapshot.forEach((docSnap: any) => {
        const data = docSnap.data()
        items.push({
          id: docSnap.id,
          type: data.type,
          title: data.title,
          message: data.message,
          bookingId: data.bookingId,
          userId: data.userId,
          relatedUserId: data.relatedUserId,
          relatedUserName: data.relatedUserName,
          isRead: data.isRead ?? false,
          moduleRead: data.moduleRead ?? data.isRead ?? false,
          createdAt: data.createdAt,
          link: data.link,
        })
      })
      return items
    }

    function sortDesc(items: NotificationItem[]): NotificationItem[] {
      return items.sort((a, b) => {
        const ta = a.createdAt?.toDate?.()?.getTime?.() ?? 0
        const tb = b.createdAt?.toDate?.()?.getTime?.() ?? 0
        return tb - ta
      })
    }

    function startOptimized(): () => void {
      const q = query(
        collection(db, "notifications"),
        where("userId", "==", userId),
        orderBy("createdAt", "desc"),
        limit(100),
      )
      return onSnapshot(q,
        (snapshot) => {
          const items = sortDesc(mapSnapshot(snapshot))
          if (firstSnapshot) {
            firstSnapshot = false
            perfListener("Notifications", "FIRST_SNAPSHOT", items.length)
          } else {
            perfListener("Notifications", "SNAPSHOT", items.length)
          }
          setNotifications(items)
        },
        (error) => {
          perfListener("Notifications", "ERROR")
          if (error.code === "failed-precondition") {
            if (destroyed) return
            activeUnsub?.()
            startFallback()
            scheduleRetry()
          } else {
            console.error("[Notifications snapshot error]", { code: error.code, message: error.message })
          }
        },
      )
    }

    function startFallback(): void {
      const q = query(
        collection(db, "notifications"),
        where("userId", "==", userId),
        limit(100),
      )
      activeUnsub = onSnapshot(q,
        (snapshot) => {
          const items = sortDesc(mapSnapshot(snapshot))
          if (firstSnapshot) {
            firstSnapshot = false
            perfListener("Notifications", "FIRST_SNAPSHOT", items.length)
          } else {
            perfListener("Notifications", "SNAPSHOT", items.length)
          }
          setNotifications(items)
        },
        (error) => {
          perfListener("Notifications", "ERROR")
          console.error("[Notifications fallback snapshot error]", { code: error.code, message: error.message })
        },
      )
    }

    function scheduleRetry(): void {
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = setTimeout(() => {
        if (destroyed) return
        activeUnsub?.()
        activeUnsub = startOptimized()
      }, 60_000)
    }

    activeUnsub = startOptimized()

    return () => {
      destroyed = true
      activeUnsub?.()
      if (retryTimer) clearTimeout(retryTimer)
      if (fallbackTimer) clearTimeout(fallbackTimer)
      perfListener("Notifications", "STOP")
      console.log("[Notification Listener STOP]", { userId })
    }
  }, [userId])

  const unreadCount = useMemo(() => {
    const count = notifications.filter((n) => !n.isRead).length
    console.log("[Notifications] Unread bell count:", count)
    return count
  }, [notifications])

  const moduleUnreadCount = useMemo(() => {
    const count = notifications.filter((n) => !n.moduleRead).length
    console.log("[Notifications] Module unread count:", count)
    return count
  }, [notifications])

  const markAsRead = useCallback((id: string) => {
    try {
      // Sync BOTH read flags: the bell badge counts isRead while the admin
      // sidebar badges count moduleRead. Writing only one leaves the other
      // badge stuck, so they are always updated together.
      updateDoc(doc(db, "notifications", id), { isRead: true, moduleRead: true })
    } catch (error) {
      console.error("[Notifications] Failed to mark as read:", error)
    }
  }, [])

  const markAllAsRead = useCallback(() => {
    notifications
      .filter((n) => !n.isRead && n.id)
      .forEach((n) => {
        try {
          updateDoc(doc(db, "notifications", n.id!), { isRead: true, moduleRead: true })
        } catch (error) {
          console.error("[Notifications] Failed to mark as read:", error)
        }
      })
  }, [notifications])

  const markByBookingId = useCallback(async (bookingId: string, types?: NotificationType[]) => {
    if (!user) return
    try {
      const recipientId = user.role === "admin" || user.role === "staff" ? "admin" : user.id
      const constraints: any[] = [
        where("userId", "==", recipientId),
        where("bookingId", "==", bookingId),
        where("moduleRead", "==", false),
      ]
      if (types && types.length > 0) {
        constraints.push(where("type", "in", types))
      }
      const q = query(collection(db, "notifications"), ...constraints)
      const snapshot = await getDocs(q)
      snapshot.forEach((docSnap) => {
        // Sync BOTH read flags (see markAsRead): viewing the booking must
        // clear the sidebar badge AND the bell badge for those notifications.
        updateDoc(doc(db, "notifications", docSnap.id), { moduleRead: true, isRead: true })
      })
    } catch (error) {
      console.error("[Notifications] Failed to markByBookingId:", error)
    }
  }, [userId])

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        moduleUnreadCount,
        markAsRead,
        markAllAsRead,
        markByBookingId,
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationProvider")
  }
  return context
}
