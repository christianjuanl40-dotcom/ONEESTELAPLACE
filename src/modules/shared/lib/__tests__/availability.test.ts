import { describe, expect, it } from "vitest"
import {
  calculateAvailabilityForDate,
  getEventSlots,
  isAvailabilityRangeOpen,
  isAvailabilitySlotOpen,
  type AvailabilityRecord,
  type AvailabilitySpace,
} from "../availability"

const eventDate = "2026-10-31"
const milestone: AvailabilitySpace = {
  category: "venue",
  venueId: "v1",
  spaceId: "v1",
  name: "The Milestone Event",
}
const moment: AvailabilitySpace = {
  category: "venue",
  venueId: "v2",
  spaceId: "v2",
  name: "The Moment Event",
}

function eventBooking(overrides: AvailabilityRecord = {}): AvailabilityRecord {
  return {
    id: "booking-1",
    venueId: "v1",
    venue: "The Milestone Event",
    bookingCategory: "venue",
    status: "confirmed",
    date: eventDate,
    startTime: "8:00 AM",
    endTime: "2:00 PM",
    totalPrice: 15000,
    amountPaid: 0,
    ...overrides,
  }
}

function officeSpace(officeId: string, roomId: string, roomName: string): AvailabilitySpace {
  return {
    category: "office",
    venueId: officeId,
    officeId,
    spaceId: roomId,
    name: officeId === "office-a" ? "Office A" : "Office B",
    roomName,
  }
}

describe("shared space availability", () => {
  it("returns AVAILABLE when there are no bookings", () => {
    const result = calculateAvailabilityForDate(milestone, eventDate, [])

    expect(result.status).toBe("available")
    expect(result.availableSlots).toEqual(getEventSlots(undefined))
  })

  it("uses configured event hours, duration, and interval", () => {
    const schedule = {
      openingTime: "9:00 AM",
      closingTime: "9:00 PM",
      bookingDurationHours: 4,
      slotIntervalHours: 2,
    }
    const slots = getEventSlots(schedule)

    expect(slots[0].label).toBe("9:00 AM - 1:00 PM")
    expect(slots.at(-1)?.label).toBe("5:00 PM - 9:00 PM")
    expect(slots).toHaveLength(5)
  })

  it("returns FEW when an existing booking leaves a complete six-hour slot", () => {
    const result = calculateAvailabilityForDate(milestone, eventDate, [eventBooking()])

    expect(result.status).toBe("few")
    expect(result.availableSlots.map((slot) => slot.label)).toContain("2:00 PM - 8:00 PM")
  })

  it("returns FULL when one booking leaves less than one complete six-hour slot", () => {
    const result = calculateAvailabilityForDate(milestone, eventDate, [eventBooking({
      startTime: "8:00 AM",
      endTime: "5:00 PM",
    })])

    expect(result.status).toBe("full")
    expect(result.availableSlots).toHaveLength(0)
  })

  it("returns FULL when multiple bookings consume every configured slot", () => {
    const bookings = [
      eventBooking({ id: "morning", startTime: "8:00 AM", endTime: "2:00 PM" }),
      eventBooking({ id: "afternoon", startTime: "2:00 PM", endTime: "8:00 PM" }),
      eventBooking({ id: "evening", startTime: "4:00 PM", endTime: "10:00 PM" }),
    ]

    expect(calculateAvailabilityForDate(milestone, eventDate, bookings).status).toBe("full")
  })

  it("returns FULL for fragmented free time even when the total free time exceeds six hours", () => {
    const bookings = [
      eventBooking({ id: "first", startTime: "8:00 AM", endTime: "10:00 AM" }),
      eventBooking({ id: "middle", startTime: "2:00 PM", endTime: "4:00 PM" }),
      eventBooking({ id: "last", startTime: "8:00 PM", endTime: "10:00 PM" }),
    ]

    expect(calculateAvailabilityForDate(milestone, eventDate, bookings).status).toBe("full")
  })

  it("isolates Venue A bookings from Venue B and recalculates after switching spaces", () => {
    const bookings = [eventBooking()]

    expect(calculateAvailabilityForDate(milestone, eventDate, bookings).status).toBe("few")
    expect(calculateAvailabilityForDate(moment, eventDate, bookings).status).toBe("available")
  })

  it("releases availability after an approved cancellation", () => {
    const result = calculateAvailabilityForDate(milestone, eventDate, [eventBooking({
      status: "cancelled",
      bookingStatus: "Cancelled",
    })])

    expect(result.status).toBe("available")
  })

  it("keeps a confirmed booking blocked while a new payment is pending", () => {
    const result = calculateAvailabilityForDate(milestone, eventDate, [eventBooking({
      status: "confirmed",
      paymentStatus: "for_review",
      hasActivePaymentSubmission: true,
    })])

    expect(result.status).toBe("few")
    expect(result.availableSlots.length).toBeGreaterThan(0)
  })

  it("blocks a fully paid booking", () => {
    const result = calculateAvailabilityForDate(milestone, eventDate, [eventBooking({
      startTime: "8:00 AM",
      endTime: "2:00 PM",
      paymentStatus: "paid",
      amountPaid: 15000,
      totalPrice: 15000,
    })])

    expect(result.status).toBe("few")
  })

  it("does not block for cancelled or expired bookings", () => {
    const bookings = [
      eventBooking({ id: "cancelled", status: "cancelled" }),
      eventBooking({ id: "expired", status: "rental_expired" }),
    ]

    expect(calculateAvailabilityForDate(milestone, eventDate, bookings).status).toBe("available")
  })

  it("keeps office room availability independent by office and room", () => {
    const officeABooking = eventBooking({
      id: "office-booking",
      isOfficeRental: true,
      bookingCategory: "office",
      bookingType: "office",
      venueId: "office-a",
      officeId: "office-a",
      spaceId: "office-a-room-1",
      venue: "Office A - Room 1",
      date: "2026-10-01",
      endDate: "2026-12-31",
      startTime: "",
      endTime: "",
    })

    expect(calculateAvailabilityForDate(officeSpace("office-a", "office-a-room-1", "Room 1"), eventDate, [officeABooking]).status).toBe("full")
    expect(calculateAvailabilityForDate(officeSpace("office-a", "office-a-room-2", "Room 2"), eventDate, [officeABooking]).status).toBe("available")
    expect(calculateAvailabilityForDate(officeSpace("office-b", "office-b-room-1", "Room 1"), eventDate, [officeABooking]).status).toBe("available")
  })

  it("treats a room-less office booking as reserving the identified office", () => {
    const officeWideBooking = eventBooking({
      isOfficeRental: true,
      bookingCategory: "office",
      venueId: "office-a",
      officeId: "office-a",
      spaceId: "",
      venue: "Office A",
      date: "2026-10-01",
      endDate: "2026-12-31",
      startTime: "",
      endTime: "",
    })

    expect(calculateAvailabilityForDate(officeSpace("office-a", "office-a-room-2", "Room 2"), eventDate, [officeWideBooking]).status).toBe("full")
    expect(calculateAvailabilityForDate(officeSpace("office-b", "office-b-room-2", "Room 2"), eventDate, [officeWideBooking]).status).toBe("available")
  })

  it("blocks an office when its date range overlaps and leaves another office available", () => {
    const booking = eventBooking({
      isOfficeRental: true,
      bookingCategory: "office",
      venueId: "office-a",
      officeId: "office-a",
      spaceId: "office-a-room-1",
      venue: "Office A - Room 1",
      date: "2026-10-01",
      endDate: "2026-11-15",
      startTime: "",
      endTime: "",
    })

    expect(calculateAvailabilityForDate(officeSpace("office-a", "office-a-room-1", "Room 1"), eventDate, [booking]).status).toBe("full")
    expect(calculateAvailabilityForDate(officeSpace("office-b", "office-b-room-1", "Room 1"), eventDate, [booking]).status).toBe("available")
  })

  it("checks every date in an office rental range", () => {
    const laterBooking = eventBooking({
      id: "later-office-booking",
      isOfficeRental: true,
      bookingCategory: "office",
      venueId: "office-a",
      officeId: "office-a",
      spaceId: "office-a-room-1",
      venue: "Office A - Room 1",
      date: "2026-12-01",
      endDate: "2027-06-01",
      startTime: "",
      endTime: "",
    })

    expect(isAvailabilityRangeOpen(
      officeSpace("office-a", "office-a-room-1", "Room 1"),
      "2026-10-01",
      "2027-01-01",
      [laterBooking],
    )).toBe(false)
    expect(isAvailabilityRangeOpen(
      officeSpace("office-a", "office-a-room-2", "Room 2"),
      "2026-10-01",
      "2027-01-01",
      [laterBooking],
    )).toBe(true)
  })

  it("treats an active persisted office rental as blocking", () => {
    const room = officeSpace("office-a", "office-a-room-1", "Room 1")
    expect(calculateAvailabilityForDate(
      room,
      eventDate,
      [],
      [],
      [{ officeSpaceId: room.spaceId, leaseStatus: "Active Lease" }],
    ).status).toBe("full")
    expect(calculateAvailabilityForDate(
      room,
      eventDate,
      [],
      [],
      [{ officeSpaceId: room.spaceId, leaseStatus: "Cancelled" }],
    ).status).toBe("available")
    expect(calculateAvailabilityForDate(
      room,
      eventDate,
      [],
      [],
      [{ officeSpaceName: "Office A - Room 1", leaseStatus: "Active Lease" }],
    ).status).toBe("full")
  })

  it("uses the same available slot for the client and server conflict check", () => {
    const existing = eventBooking()
    const result = calculateAvailabilityForDate(milestone, eventDate, [existing])
    const slot = result.availableSlots[0]

    expect(slot).toBeDefined()
    expect(isAvailabilitySlotOpen(
      milestone,
      eventDate,
      slot.startMinutes,
      slot.endMinutes,
      [existing],
    )).toBe(true)
    expect(isAvailabilitySlotOpen(
      milestone,
      eventDate,
      slot.startMinutes,
      slot.endMinutes,
      [existing, eventBooking({ id: "new-conflict", startTime: slot.startTimeLabel, endTime: slot.endTimeLabel })],
    )).toBe(false)
  })
})
