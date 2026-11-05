import { describe, expect, it } from "vitest"
import {
  getBookingScheduleClassification,
  getBookingScheduleRange,
  formatBookingDate,
  formatBookingDateTime,
  getCurrentBooking,
  getBookingLifecycleLabel,
  getBookingLifecycleStatus,
  getNextBooking,
  hasActiveModificationRequest,
  isActiveBooking,
  isBookingHistory,
  normalizeBookingLifecycleStatus,
} from "../booking-helpers"

describe("booking lifecycle status", () => {
  it("normalizes legacy payment and workflow values to lifecycle states", () => {
    expect(normalizeBookingLifecycleStatus("verifying")).toBe("pending")
    expect(normalizeBookingLifecycleStatus("fully_paid")).toBe("confirmed")
    expect(normalizeBookingLifecycleStatus("reservation-secured")).toBe("confirmed")
    expect(normalizeBookingLifecycleStatus("rental_expired")).toBe("completed")
    expect(normalizeBookingLifecycleStatus("declined")).toBe("cancelled")
  })

  it("uses the prior lifecycle while a request is under review", () => {
    expect(
      getBookingLifecycleStatus({
        status: "modification_under_review",
        modificationPreviousStatus: "confirmed",
      }),
    ).toBe("confirmed")
    expect(getBookingLifecycleLabel({ status: "verifying" })).toBe("Pending")
  })
})

describe("booking schedule presentation", () => {
  const now = new Date("2026-05-15T04:00:00.000Z") // 12:00 in Manila

  it("keeps a future confirmed reservation upcoming instead of current", () => {
    const booking = { id: "UPCOMING", status: "confirmed", date: "2026-05-20", createdAt: "2026-05-01" }

    expect(getBookingScheduleClassification(booking, now)).toBe("upcoming")
    expect(isActiveBooking(booking, now)).toBe(false)
    expect(getCurrentBooking([booking], now)).toBeNull()
    expect(getNextBooking([booking], now)?.id).toBe("UPCOMING")
  })

  it("classifies an office rental as active only inside its inclusive date range", () => {
    const booking = {
      id: "OFFICE",
      status: "active_rental",
      date: "2026-05-01",
      endDate: "2026-05-31",
    }

    expect(getBookingScheduleClassification(booking, now)).toBe("active")
    expect(getBookingScheduleClassification(booking, new Date("2026-05-01T00:00:00.000Z"))).toBe("active")
    expect(getBookingScheduleClassification(booking, new Date("2026-06-01T04:00:00.000Z"))).toBe("completed")
  })

  it("honors same-day start and end time boundaries", () => {
    const booking = {
      status: "confirmed",
      date: "2026-05-15",
      startTime: "12:00",
      endTime: "14:00",
    }

    expect(getBookingScheduleClassification(booking, new Date("2026-05-15T03:59:59.000Z"))).toBe("upcoming")
    expect(getBookingScheduleClassification(booking, new Date("2026-05-15T04:00:00.000Z"))).toBe("active")
    expect(getBookingScheduleClassification(booking, new Date("2026-05-15T06:00:00.000Z"))).toBe("active")
    expect(getBookingScheduleClassification(booking, new Date("2026-05-15T06:00:01.000Z"))).toBe("completed")
  })

  it("normalizes completed, cancelled, and rejected presentation states without changing lifecycle values", () => {
    expect(getBookingScheduleClassification({ status: "completed", date: "2026-06-01" }, now)).toBe("completed")
    expect(getBookingScheduleClassification({ status: "cancelled", date: "2026-06-01" }, now)).toBe("cancelled")
    expect(getBookingScheduleClassification({ status: "declined", date: "2026-06-01" }, now)).toBe("rejected")
    expect(isBookingHistory({ status: "declined", date: "2026-06-01" }, now)).toBe(true)
  })

  it("keeps missing or invalid legacy schedule fields out of current booking lists", () => {
    expect(getBookingScheduleClassification({ status: "confirmed", createdAt: "2026-05-01" }, now)).toBe("legacy")
    expect(getBookingScheduleClassification({ status: "active_rental", date: "not-a-date" }, now)).toBe("legacy")
    expect(isActiveBooking({ status: "confirmed" }, now)).toBe(false)
    expect(isBookingHistory({ status: "confirmed" }, now)).toBe(true)
  })

  it("uses Manila calendar boundaries for date-only bookings", () => {
    const booking = { status: "confirmed", date: "2026-05-15" }

    expect(getBookingScheduleClassification(booking, new Date("2026-05-15T15:59:59.000Z"))).toBe("active")
    expect(getBookingScheduleClassification(booking, new Date("2026-05-16T00:00:00.000Z"))).toBe("completed")
    expect(getBookingScheduleRange(booking)?.startTimestamp).toBe(Date.UTC(2026, 4, 15))
    expect(formatBookingDate("2026-05-15")).toBe("May 15, 2026")
    expect(formatBookingDateTime("2026-05-15T04:00:00.000Z")).toBe("May 15, 2026, 12:00 PM")
  })
})

describe("modification request state", () => {
  it("recognizes each active modification representation", () => {
    expect(hasActiveModificationRequest({ status: "modification_under_review" })).toBe(true)
    expect(hasActiveModificationRequest({ bookingStatus: "Modification Under Review" })).toBe(true)
    expect(hasActiveModificationRequest({ modificationStatus: "Under Review" })).toBe(true)
    expect(hasActiveModificationRequest({ modificationRequested: true })).toBe(true)
    expect(hasActiveModificationRequest({ modificationUnderReview: true })).toBe(true)
    expect(hasActiveModificationRequest({ modifyRequestStatus: "Pending" })).toBe(true)
  })

  it("does not block a booking after an explicit modification decision", () => {
    expect(
      hasActiveModificationRequest({
        status: "confirmed",
        bookingStatus: "Confirmed",
        modificationStatus: "Approved",
        modificationRequested: true,
        modificationUnderReview: true,
        modifyRequestStatus: "Pending",
      }),
    ).toBe(false)
    expect(
      hasActiveModificationRequest({
        status: "confirmed",
        modificationStatus: "Declined",
        modificationUnderReview: true,
        modifyRequestStatus: "Pending",
      }),
    ).toBe(false)
  })

  it("uses the canonical booking status to repair stale request aliases", () => {
    expect(
      hasActiveModificationRequest({
        status: "confirmed",
        bookingStatus: "Confirmed",
        modificationStatus: "Under Review",
        modificationRequested: true,
        modificationUnderReview: true,
        modifyRequestStatus: "Pending",
      }),
    ).toBe(false)
  })
})
