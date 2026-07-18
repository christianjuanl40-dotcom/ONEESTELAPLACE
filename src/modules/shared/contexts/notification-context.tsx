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
} from "firebase/firestore"
import type { NotificationItem } from "../lib/notifications"

interface NotificationContextValue {
  notifications: NotificationItem[]
  unreadCount: number
  markAsRead: (id: string) => void
  markAllAsRead: () => void
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
    console.log("[Notifications] Provider subscribing, userId:", userId)

    const q = query(
      collection(db, "notifications"),
      where("userId", "==", userId),
      limit(50),
    )

    const unsub = onSnapshot(q,
      (snapshot) => {
        console.log("[Notifications] Provider snapshot size:", snapshot.size)
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
        console.error("[Notifications] onSnapshot error:", error)
      },
    )

    return () => unsub()
  }, [user, scope])

  const unreadCount = useMemo(() => {
    const count = notifications.filter((n) => !n.isRead).length
    console.log("[Notifications] unread count:", count)
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

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        markAsRead,
        markAllAsRead,
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
