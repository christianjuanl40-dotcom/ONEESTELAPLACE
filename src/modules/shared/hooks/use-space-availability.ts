"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "../auth/auth-context"
import { perfMark } from "../lib/perf-trace"
import { fetchAvailability, type AvailabilityRequest, type AvailabilityResponse } from "../lib/availability-client"
import type { AvailabilityDay, AvailabilitySpace } from "../lib/availability"

/** Refresh visible schedules on focus and periodically; commits still recheck server-side. */
export function useSpaceAvailability(
  active: boolean,
  space: AvailabilitySpace | null,
  month: Date,
  excludeBookingId = "",
  rentalTerm?: AvailabilityRequest["rentalTerm"],
  refreshKey = "",
  officeSearch?: AvailabilityRequest["officeSearch"],
) {
  const { user, isLoading: authLoading, initializationError } = useAuth()
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  const [result, setResult] = useState<{
    key: string
    days: Record<string, AvailabilityDay>
    loading: boolean
    error: string | null
    officeSearch?: AvailabilityResponse["officeSearch"]
    receivedAt?: number
  }>({ key: "", days: {}, loading: false, error: null })
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const canLoad = active && !authLoading && Boolean(user && space && (space.category !== "office" || space.spaceId))
  const searchFrom = officeSearch?.from
  const searchTo = officeSearch?.to
  const category = space?.category
  const venueId = space?.venueId
  const officeId = space?.officeId
  const spaceId = space?.spaceId
  const request = useMemo<AvailabilityRequest | null>(() => {
    if (!category || !venueId) return null
    const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    return { category, venueId, officeId, spaceId, from: format(new Date(year, monthIndex, 1)),
      to: format(new Date(year, monthIndex + 1, 0)), excludeBookingId, rentalTerm,
      officeSearch: searchFrom && searchTo ? { from: searchFrom, to: searchTo } : undefined, revision: `${refreshKey}:${attempt}` }
  }, [category, venueId, officeId, spaceId, year, monthIndex, excludeBookingId, rentalTerm, searchFrom, searchTo, refreshKey, attempt])
  const requestKey = JSON.stringify([canLoad, user?.id, request, refreshKey, attempt])

  useEffect(() => {
    if (!canLoad || !request) {
      setResult({ key: requestKey, days: {}, loading: false, error: null })
      return
    }
    const controller = new AbortController()
    let inFlight = false
    const refresh = async () => {
      if (inFlight || controller.signal.aborted) return
      inFlight = true
      setResult({ key: requestKey, days: {}, loading: true, error: null })
      try {
        const response = await fetchAvailability(request, controller.signal)
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, days: response.dates || {}, loading: false, error: null, officeSearch: response.officeSearch, receivedAt: performance.now() })
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, days: {}, loading: false,
            error: cause instanceof Error ? cause.message : "Unable to load availability." })
        }
      } finally {
        inFlight = false
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener("focus", refresh)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener("focus", refresh)
    }
  }, [canLoad, request, requestKey])

  const isCurrent = canLoad && result.key === requestKey
  useEffect(() => {
    if (isCurrent && !result.loading && result.receivedAt !== undefined) perfMark(`[availability] calendar render commit ${Math.round(performance.now() - result.receivedAt)}ms`)
  }, [isCurrent, result])
  return { days: isCurrent ? result.days : {},
    loading: Boolean(active && (authLoading || (canLoad && (!isCurrent || result.loading)))),
    error: active && !authLoading && !user ? initializationError || "Sign in to check availability." : isCurrent ? result.error : null,
    officeSearch: isCurrent ? result.officeSearch : undefined, retry }
}
