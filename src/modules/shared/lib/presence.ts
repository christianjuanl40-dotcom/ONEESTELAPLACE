"use client"

import { useCallback, useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuth } from "@/src/modules/shared/auth/auth-context"

export const ACTIVE_THRESHOLD_MS = 2 * 60 * 1000

const PRESENCE_THROTTLE_MS = 60 * 1000

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "focus"] as const

export function usePresenceTracking() {
  const { user } = useAuth()
  const lastWriteRef = useRef(0)
  const pathname = usePathname()

  const writePresence = useCallback(() => {
    if (!user || user.role !== "client") return
    const now = Date.now()
    if (now - lastWriteRef.current < PRESENCE_THROTTLE_MS) return
    lastWriteRef.current = now
    updateDoc(doc(db, "users", user.id), {
      lastActiveAt: serverTimestamp(),
    }).catch(() => {})
  }, [user])

  useEffect(() => {
    writePresence()
  }, [writePresence])

  useEffect(() => {
    const handleActivity = () => writePresence()
    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true })
    })
    const handleVisibility = () => {
      if (document.visibilityState === "visible") writePresence()
    }
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      ACTIVITY_EVENTS.forEach((event) => {
        window.removeEventListener(event, handleActivity)
      })
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [writePresence])

  useEffect(() => {
    if (pathname) writePresence()
  }, [pathname, writePresence])
}

export function PresenceTracker() {
  usePresenceTracking()
  return null
}

export function formatLastActive(timestampMs: number, now: Date = new Date()): string {
  const diffMs = Math.max(0, now.getTime() - timestampMs)
  const diffMins = Math.floor(diffMs / (1000 * 60))
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  const date = new Date(timestampMs)
  if (diffDays === 1) return "yesterday"
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: "long" })
  return date.toLocaleDateString([], { month: "long", day: "2-digit", year: "numeric" })
}

export function getPresenceStatus(
  lastActiveAtMs: number | null | undefined,
  now: Date = new Date()
): { isActive: boolean; label: string | null } {
  if (!lastActiveAtMs) return { isActive: false, label: null }
  if (now.getTime() - lastActiveAtMs <= ACTIVE_THRESHOLD_MS) {
    return { isActive: true, label: "Active now" }
  }
  const label = formatLastActive(lastActiveAtMs, now)
  if (label === "yesterday" || label.endsWith(" ago")) {
    return { isActive: false, label: `Active ${label}` }
  }
  return { isActive: false, label }
}
