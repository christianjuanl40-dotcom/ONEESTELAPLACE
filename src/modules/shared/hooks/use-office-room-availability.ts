"use client"

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "../auth/auth-context"
import { fetchOfficeRoomAvailability } from "../lib/availability-client"
import type { OfficeRoomStatus } from "../lib/availability"

/** Cross-customer occupancy comes from the sanitized server projection, never
 * from the client's owner-scoped booking/lease subscriptions. */
export function useOfficeRoomAvailability(active: boolean, officeId: string, refreshKey: string) {
  const { user, isLoading: authLoading, initializationError } = useAuth()
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  const canLoad = active && !authLoading && Boolean(user && officeId)
  const key = JSON.stringify([canLoad, user?.id, officeId, refreshKey, attempt])
  const [result, setResult] = useState<{ key: string; rooms: Record<string, OfficeRoomStatus>; loading: boolean; error: string | null }>({
    key: "", rooms: {}, loading: false, error: null,
  })
  useEffect(() => {
    if (!canLoad) return
    const controller = new AbortController()
    let inFlight = false
    const refresh = async () => {
      if (inFlight || controller.signal.aborted) return
      inFlight = true
      setResult({ key, rooms: {}, loading: true, error: null })
      try {
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
        const rooms = await fetchOfficeRoomAvailability(officeId, today, controller.signal, `${refreshKey}:${attempt}`)
        if (!controller.signal.aborted) setResult({ key, rooms, loading: false, error: null })
      } catch (cause) {
        if (!controller.signal.aborted) setResult({ key, rooms: {}, loading: false,
          error: cause instanceof Error ? cause.message : "Unable to load room availability." })
      } finally { inFlight = false }
    }
    void refresh()
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener("focus", refresh)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener("focus", refresh)
    }
  }, [canLoad, officeId, key, refreshKey, attempt])
  const current = canLoad && result.key === key
  return { rooms: current ? result.rooms : {}, loading: Boolean(active && (authLoading || (canLoad && (!current || result.loading)))),
    error: active && !authLoading && !user ? initializationError || "Sign in to check room availability." : current ? result.error : null, retry }
}
