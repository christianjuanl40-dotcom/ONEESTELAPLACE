"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useAuth } from "../auth/auth-context"
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
  }, [user])

  useEffect(() => {
    if (!user || !scope) return

    const userId = scope === "admin" ? "admin" : user.id

    console.log("[Firestore Listener START] Notifications", { userId })

    const q = query(
      collection(db, "notifications"),
      where("userId", "==", userId),
      limit(50),
    )

    const unsub = onSnapshot(q,
      (snapshot) => {
        const items: NotificationItem[] = []
        snapshot.forEach((docSnap) => {
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
        items.sort((a, b) => {
          const ta = a.createdAt?.toDate?.()?.getTime() ?? 0
          const tb = b.createdAt?.toDate?.()?.getTime() ?? 0
          return tb - ta
        })
        setNotifications(items)
      },
      (error) => {
        console.error("[Notifications snapshot error]", {
          code: error.code,
          message: error.message,
          error,
        })
      },
    )

    return () => {
      console.log("[Firestore Listener STOP] Notifications")
      unsub()
    }
  }, [user, scope])

  const unreadCount = useMemo(() => {
    const count = notifications.filter((n) => !n.isRead).length
    return count
  }, [notifications])

  const moduleUnreadCount = useMemo(() => {
    const count = notifications.filter((n) => !n.moduleRead).length
    return count
  }, [notifications])

  const markAsRead = useCallback((id: string) => {
    try {
      updateDoc(doc(db, "notifications", id), { isRead: true })
    } catch (error) {
      console.error("[Notifications] Failed to mark as read:", error)
    }
  }, [])

  const markAllAsRead = useCallback(() => {
    notifications
      .filter((n) => !n.isRead && n.id)
      .forEach((n) => {
        try {
          updateDoc(doc(db, "notifications", n.id!), { isRead: true })
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
        updateDoc(doc(db, "notifications", docSnap.id), { moduleRead: true })
      })
    } catch (error) {
      console.error("[Notifications] Failed to markByBookingId:", error)
    }
  }, [user])

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
