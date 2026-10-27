import { getAuthHeaders, getAuthScope } from "./auth-token"
import { perfMark } from "./perf-trace"
import type { AvailabilityCategory, AvailabilityDay, AvailabilitySlot, OfficeAvailabilityTerm, OfficeRoomStatus } from "./availability"

export type AvailabilityRequest = {
  category: AvailabilityCategory
  venueId: string
  officeId?: string
  spaceId?: string
  name?: string
  roomName?: string
  from: string
  to: string
  excludeBookingId?: string
  rentalTerm?: OfficeAvailabilityTerm
  officeSearch?: { from: string; to: string }
  revision?: string
}

export type AvailabilityResponse = {
  space: {
    category: AvailabilityCategory
    venueId: string
    officeId?: string
    spaceId?: string
  }
  schedule?: {
    openingMinutes: number
    closingMinutes: number
    bookingDurationMinutes: number
    slotIntervalMinutes: number
  }
  dates: Record<string, AvailabilityDay>
  officeSearch?: { from: string; to: string; earliestAvailableStartDate: string | null }
  availableSlots?: AvailabilitySlot[]
}

const pendingReads = new Map<string, { controller: AbortController; consumers: number; promise: Promise<unknown> }>()

/** In-flight GET sharing only: no completed private cache survives invalidation. */
async function readAvailability(url: string, signal?: AbortSignal, revision = ""): Promise<unknown> {
  const tokenStarted = performance.now()
  const uid = await getAuthScope(signal)
  if (signal?.aborted) throw new DOMException("Read cancelled", "AbortError")
  for (const [key, entry] of pendingReads) {
    if (!key.startsWith(`${uid}:`)) { entry.controller.abort(); pendingReads.delete(key) }
  }
  const key = `${uid}:${JSON.stringify([url, revision])}`
  let entry = pendingReads.get(key)
  if (!entry || entry.controller.signal.aborted) {
    const controller = new AbortController()
    let timedOut = false
    const deadline = setTimeout(() => { timedOut = true; controller.abort() }, 12000)
    const task = { controller, consumers: 0, promise: null as unknown as Promise<unknown> }
    task.promise = (async () => {
      const headers = await getAuthHeaders(false, false, controller.signal)
      perfMark(`[availability] token ready ${Math.round(performance.now() - tokenStarted)}ms`)
      const networkStarted = performance.now()
      let response: Response | undefined
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await fetch(url, { headers, signal: controller.signal, cache: "no-store" })
          if (attempt === 0 && [502, 503, 504].includes(response.status)) continue
          break
        } catch (error) {
          if (controller.signal.aborted || attempt === 1) throw error
        }
      }
      perfMark(`[availability] response ${Math.round(performance.now() - networkStarted)}ms; ${response?.headers.get("Server-Timing") || "no server timing"}`)
      if (await getAuthScope(controller.signal) !== uid) throw new DOMException("Session changed", "AbortError")
      const body = await response!.json().catch(() => null)
      if (!response!.ok) throw new Error(typeof body?.error === "string" ? body.error : "Unable to load availability. Please retry.")
      return body
    })().catch(error => {
      if (timedOut) throw new Error("Availability timed out. Check your connection and retry.")
      throw error
    }).finally(() => { clearTimeout(deadline); if (pendingReads.get(key) === task) pendingReads.delete(key) })
    pendingReads.set(key, task)
    entry = task
  }
  const shared = entry
  shared.consumers++
  return new Promise((resolve, reject) => {
    let finished = false
    const release = () => {
      if (finished) return false
      finished = true
      signal?.removeEventListener("abort", abort)
      if (--shared.consumers === 0 && pendingReads.get(key) === shared) shared.controller.abort()
      return true
    }
    const abort = () => { if (release()) reject(new DOMException("Read cancelled", "AbortError")) }
    signal?.addEventListener("abort", abort, { once: true })
    shared.promise.then(value => { if (release()) resolve(value) }, error => { if (release()) reject(error) })
    if (signal?.aborted) abort()
  })
}

export async function fetchAvailability(
  request: AvailabilityRequest,
  signal?: AbortSignal,
): Promise<AvailabilityResponse> {
  const params = new URLSearchParams({
    category: request.category,
    venueId: request.venueId,
    from: request.from,
    to: request.to,
  })
  for (const [key, value] of Object.entries({
    officeId: request.officeId,
    spaceId: request.spaceId,
    excludeBookingId: request.excludeBookingId,
    rentalTerm: request.rentalTerm,
    searchFrom: request.officeSearch?.from,
    searchTo: request.officeSearch?.to,
  })) {
    if (value) params.set(key, value)
  }

  const result = await readAvailability(`/api/availability?${params.toString()}`, signal, request.revision) as AvailabilityResponse | null
  if (!result?.space || result.space.category !== request.category || result.space.venueId !== request.venueId
    || (request.spaceId && result.space.spaceId !== request.spaceId)
    || (request.category === "office" && result.space.officeId !== (request.officeId || request.venueId))
    || !result.dates || typeof result.dates !== "object" || Array.isArray(result.dates)
    || Object.values(result.dates).some(day => !day || !["available", "few", "full", "maintenance"].includes(day.status)
      || !Array.isArray(day.availableSlots) || !Array.isArray(day.occupiedIntervals))
    || (request.officeSearch && (!result.officeSearch
    || result.officeSearch.from !== request.officeSearch.from || result.officeSearch.to !== request.officeSearch.to
    || !(result.officeSearch.earliestAvailableStartDate === null
      || /^\d{4}-\d{2}-\d{2}$/.test(result.officeSearch.earliestAvailableStartDate))))) {
    throw new Error("The availability response could not be confirmed. Please retry.")
  }
  for (let day = new Date(`${request.from}T00:00:00Z`); day <= new Date(`${request.to}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    if (!result.dates[day.toISOString().slice(0, 10)]) throw new Error("The availability response is incomplete. Please retry.")
  }
  return result
}

export async function fetchOfficeRoomAvailability(officeId: string, today: string, signal?: AbortSignal, revision = ""): Promise<Record<string, OfficeRoomStatus>> {
  const params = new URLSearchParams({ category: "office", venueId: officeId, officeId, scope: "rooms", from: today, to: today })
  const result = await readAvailability(`/api/availability?${params}`, signal, revision) as { officeId?: unknown; officeRooms?: Record<string, OfficeRoomStatus> } | null
  if (result?.officeId !== officeId || !result.officeRooms || typeof result.officeRooms !== "object" || Array.isArray(result.officeRooms)
    || Object.values(result.officeRooms).some((status) => !["available", "reserved", "occupied", "maintenance", "unavailable"].includes(String(status)))) {
    throw new Error("Room availability could not be confirmed. Please retry.")
  }
  return result.officeRooms
}
