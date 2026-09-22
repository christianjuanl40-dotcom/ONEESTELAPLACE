import { getAuthHeaders } from "./auth-token"
import type { AvailabilityCategory, AvailabilityDay, AvailabilitySlot } from "./availability"

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
  availableSlots?: AvailabilitySlot[]
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
    name: request.name,
    roomName: request.roomName,
    excludeBookingId: request.excludeBookingId,
  })) {
    if (value) params.set(key, value)
  }

  const response = await fetch(`/api/availability?${params.toString()}`, {
    headers: await getAuthHeaders(),
    signal,
  })
  const body = await response.json().catch(() => null) as { error?: unknown } | AvailabilityResponse | null
  if (!response.ok) {
    throw new Error(body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : "Unable to load space availability.")
  }
  return body as AvailabilityResponse
}
