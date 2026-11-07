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
import { getAdminNotificationTypes } from "../lib/notification-access"
import { toValidDate } from "../lib/time-format"

interface NotificationContextValue {
  notifications: NotificationItem[]
  unreadCount: number
  moduleUnreadCount: number
  isLoading: boolean
  error: string | null
  retryNotifications: () => void
  markAsRead: (id: string) => Promise<void>
  markAllAsRead: () => Promise<void>
  markByBookingId: (bookingId: string, types?: NotificationType[]) => Promise<void>
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [storedNotifications, setNotifications] = useState<NotificationItem[]>([])
  const [loadedScope, setLoadedScope] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryAttempt, setRetryAttempt] = useState(0)
  const userRole = user?.role
  const currentUserId = user?.id

  const adminNotificationTypes = useMemo(
    () => getAdminNotificationTypes(userRole, {
      dashboard: user?.permissions?.dashboard,
      bookings: user?.permissions?.bookings,
      payments: user?.permissions?.payments,
    }),
    [
      userRole,
      user?.permissions?.dashboard,
      user?.permissions?.bookings,
      user?.permissions?.payments,
    ],
  )

  const userId = useMemo(() => {
    if (!currentUserId || !userRole) return null
    if (userRole === "client") return currentUserId
    if (userRole === "admin") return "admin"
    return adminNotificationTypes && adminNotificationTypes.length > 0 ? "admin" : null
  }, [currentUserId, userRole, adminNotificationTypes])
  const scope = JSON.stringify([currentUserId, userRole, adminNotificationTypes])
  const notifications = currentUserId && loadedScope === scope ? storedNotifications : []

  useEffect(() => {
    setNotifications([])
    setLoadedScope(scope)
    setError(null)
    if (!userId) {
      setNotifications([])
      setIsLoading(false)
      return
    }

    const typeFilter = userRole === "staff" ? adminNotificationTypes : null

    let activeUnsub: (() => void) | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let destroyed = false
    setIsLoading(true)

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
          // createdAt is the canonical field. The additional read-only
          // fallbacks keep older exported/serialized records honest without
          // fabricating a current timestamp or changing Firestore writes.
          createdAt: data.createdAt ?? data.eventAt ?? data.timestamp ?? data.notificationAt,
          link: data.link,
        })
      })
      return items
    }

    function sortDesc(items: NotificationItem[]): NotificationItem[] {
      return items.sort((a, b) => {
        const ta = toValidDate(a.createdAt)?.getTime() ?? null
        const tb = toValidDate(b.createdAt)?.getTime() ?? null
        if (ta === null || tb === null) {
          if (ta === null && tb === null) return 0
          return ta === null ? 1 : -1
        }
        return tb - ta
      })
    }

    function getBaseConstraints(): any[] {
      return [
        where("userId", "==", userId),
        ...(typeFilter && typeFilter.length > 0 ? [where("type", "in", typeFilter)] : []),
      ]
    }

    function startOptimized(): () => void {
      const q = query(
        collection(db, "notifications"),
        ...getBaseConstraints(),
        orderBy("createdAt", "desc"),
        limit(100),
      )
      return onSnapshot(q,
        (snapshot) => {
          if (destroyed) return
          const items = sortDesc(mapSnapshot(snapshot))
           if (firstSnapshot) {
            firstSnapshot = false
            perfListener("Notifications", "FIRST_SNAPSHOT", items.length)
          } else {
            perfListener("Notifications", "SNAPSHOT", items.length)
           }
           setError(null)
           setIsLoading(false)
           setNotifications(items)
        },
        (error) => {
          if (destroyed) return
          perfListener("Notifications", "ERROR")
            if (error.code === "failed-precondition") {
            if (destroyed) return
            activeUnsub?.()
            startFallback()
            scheduleRetry()
            } else {
              console.error("[Notifications snapshot error]", { code: error.code, message: error.message })
              setError(error.code === "permission-denied"
                ? "Notifications are not authorized for this account."
                : "Notifications could not be loaded. Check your connection and retry.")
              setIsLoading(false)
            }
        },
      )
    }

    function startFallback(): void {
      const q = query(
        collection(db, "notifications"),
        ...getBaseConstraints(),
        limit(100),
      )
      activeUnsub = onSnapshot(q,
        (snapshot) => {
          if (destroyed) return
          const items = sortDesc(mapSnapshot(snapshot))
           if (firstSnapshot) {
            firstSnapshot = false
            perfListener("Notifications", "FIRST_SNAPSHOT", items.length)
          } else {
            perfListener("Notifications", "SNAPSHOT", items.length)
           }
           setError(null)
           setIsLoading(false)
           setNotifications(items)
        },
        (error) => {
          if (destroyed) return
         perfListener("Notifications", "ERROR")
         console.error("[Notifications fallback snapshot error]", { code: error.code, message: error.message })
          setError(error.code === "permission-denied"
            ? "Notifications are not authorized for this account."
            : "Notifications could not be loaded. Check your connection and retry.")
          setIsLoading(false)
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
      perfListener("Notifications", "STOP")
      console.log("[Notification Listener STOP]", { userId })
    }
  }, [currentUserId, userId, adminNotificationTypes, userRole, scope, retryAttempt])

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

  const retryNotifications = useCallback(() => {
    setError(null)
    setRetryAttempt((attempt) => attempt + 1)
  }, [])

  const markAsRead = useCallback(async (id: string) => {
    if (!id) return
    const previous = storedNotifications.find((notification) => notification.id === id)
    setNotifications((current) => current.map((notification) => (
      notification.id === id
        ? { ...notification, isRead: true, moduleRead: true }
        : notification
    )))
    try {
      // Sync BOTH read flags: the bell badge counts isRead while the admin
      // sidebar badges count moduleRead. Writing only one leaves the other
      // badge stuck, so they are always updated together.
      await updateDoc(doc(db, "notifications", id), { isRead: true, moduleRead: true })
    } catch (error) {
      console.error("[Notifications] Failed to mark as read:", error)
      if (previous) {
        setNotifications((current) => current.map((notification) => notification.id === id ? previous : notification))
      }
      setError("Notification read state could not be saved. Retry and try again.")
    }
  }, [storedNotifications])

  const markAllAsRead = useCallback(async () => {
    const unread = storedNotifications.filter((notification) => !notification.isRead && notification.id)
    if (unread.length === 0) return
    const previous = new Map(storedNotifications.map((notification) => [notification.id, notification]))
    setNotifications((current) => current.map((notification) => (
      unread.some((item) => item.id === notification.id)
        ? { ...notification, isRead: true, moduleRead: true }
        : notification
    )))
    try {
      await Promise.all(unread.map((notification) => updateDoc(
        doc(db, "notifications", notification.id!),
        { isRead: true, moduleRead: true },
      )))
    } catch (error) {
      console.error("[Notifications] Failed to mark all as read:", error)
      setNotifications((current) => current.map((notification) => previous.get(notification.id) || notification))
      setError("Notification read state could not be saved. Retry and try again.")
    }
  }, [storedNotifications])

  const markByBookingId = useCallback(async (bookingId: string, types?: NotificationType[]) => {
    if (!currentUserId || !userId) return
    try {
      const recipientId = userId === "admin" ? "admin" : currentUserId
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
      await Promise.all(snapshot.docs.map((docSnap) => {
        // Sync BOTH read flags (see markAsRead): viewing the booking must
        // clear the sidebar badge AND the bell badge for those notifications.
        return updateDoc(doc(db, "notifications", docSnap.id), { moduleRead: true, isRead: true })
      }))
      const updatedIds = new Set(snapshot.docs.map((docSnap) => docSnap.id))
      setNotifications((current) => current.map((notification) => (
        updatedIds.has(notification.id || "")
          ? { ...notification, moduleRead: true, isRead: true }
          : notification
      )))
    } catch (error) {
      console.error("[Notifications] Failed to markByBookingId:", error)
      setError("Notification read state could not be saved. Retry and try again.")
    }
  }, [currentUserId, userId])

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        moduleUnreadCount,
        isLoading,
        error,
        retryNotifications,
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
