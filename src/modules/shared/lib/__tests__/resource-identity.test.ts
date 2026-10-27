import { describe, expect, it } from "vitest"
import {
  ambiguousResourceAffectsSpace,
  getCatalogAvailabilitySpace,
  isOfficeResourceBooking,
  resolveResourceSpace,
  resourceSpacesOverlap,
} from "../resource-identity"
import {
  bookingMatchesAvailabilitySpace,
  calculateAvailabilityForDate,
  getAvailabilityDateBounds,
  getAvailabilityRangeStatus,
  maintenanceMatchesAvailabilitySpace,
  officeRentalMatchesAvailabilitySpace,
} from "../availability"

const catalog = {
  venues: [{ id: "hall-fixed", name: "Office Annex / Ceremony Lab", legacyNames: ["Old Conservatory"] }],
  offices: [
    { id: "east-fixed", name: "Saffron / Atrium", legacyNames: ["Old East Wing"], rooms: [
      { id: "shared-room", name: "Quiet Corner", legacyNames: ["Suite 17"] },
      { id: "other-room", name: "Window Seat", legacyNames: ["Suite 2"] },
    ] },
    { id: "west-fixed", name: "Juniper & Slate", legacyNames: ["Old West Wing"], rooms: [
      { id: "shared-room", name: "Quiet Corner", legacyNames: ["Suite 17"] },
    ] },
  ],
}
const east = getCatalogAvailabilitySpace(catalog, "office", "east-fixed", "shared-room")!
const other = getCatalogAvailabilitySpace(catalog, "office", "east-fixed", "other-room")!
const west = getCatalogAvailabilitySpace(catalog, "office", "west-fixed", "shared-room")!
const hall = getCatalogAvailabilitySpace(catalog, "venue", "hall-fixed")!
const office = { bookingCategory: "office", officeId: "east-fixed", venueId: "east-fixed", spaceId: "shared-room" }
const date = "2099-03-01"

describe("exact resource identity", () => {
  it.each(["booking", "maintenance", "rental"] as const)("keeps %s stable IDs authoritative after arbitrary catalog renames", (kind) => {
    const renamed = structuredClone(catalog)
    renamed.offices[0].name = "Copper + Cloud"
    renamed.offices[0].rooms[0].name = "The Unnumbered Alcove"
    renamed.venues[0].name = "Paper Moon"
    const record = { ...office, type: "office", roomName: "Deleted Room Label", venue: "Deleted Building - Deleted Room",
      spaceName: "Juniper & Slate - Quiet Corner", officeSpaceName: "Another obsolete snapshot", name: "Old display" }
    expect(resolveResourceSpace(renamed, record, kind)).toEqual({ status: "resolved", space: {
      category: "office", venueId: "east-fixed", officeId: "east-fixed", spaceId: "shared-room",
      name: "Copper + Cloud", roomName: "The Unnumbered Alcove", catalog: renamed,
    } })
    if (kind !== "rental") {
      expect(resolveResourceSpace(renamed, { bookingCategory: "venue", type: "venue", venueId: "hall-fixed", spaceId: "hall-fixed",
        venue: "Saffron / Atrium - Quiet Corner", eventName: "Office Space Rental" }, kind)).toEqual({
        status: "resolved", space: { category: "venue", venueId: "hall-fixed", spaceId: "hall-fixed", name: "Paper Moon", catalog: renamed },
      })
    }
  })

  it("requires a parent for duplicate room IDs and isolates identical room names", () => {
    expect(resolveResourceSpace(catalog, office)).toEqual({ status: "resolved", space: east })
    expect(resolveResourceSpace(catalog, { ...office, officeId: "west-fixed", venueId: "west-fixed" })).toEqual({ status: "resolved", space: west })
    expect(resolveResourceSpace(catalog, { bookingCategory: "office", spaceId: "shared-room" })).toEqual({ status: "ambiguous", candidates: [east, west] })
    expect(bookingMatchesAvailabilitySpace(office, east)).toBe(true)
    expect(bookingMatchesAvailabilitySpace(office, other)).toBe(false)
    expect(bookingMatchesAvailabilitySpace(office, west)).toBe(false)
    expect(resourceSpacesOverlap(east, west)).toBe(false)
    expect(resourceSpacesOverlap(east, other)).toBe(false)
    expect(resourceSpacesOverlap(east, hall)).toBe(false)
  })

  it("isolates same-named sibling rooms by ID and leaves their bare label ambiguous", () => {
    const sameNames = structuredClone(catalog)
    sameNames.offices[0].rooms[1].name = "Quiet Corner"
    const selected = getCatalogAvailabilitySpace(sameNames, "office", "east-fixed", "shared-room")!
    const sibling = getCatalogAvailabilitySpace(sameNames, "office", "east-fixed", "other-room")!
    expect(bookingMatchesAvailabilitySpace(office, selected)).toBe(true)
    expect(bookingMatchesAvailabilitySpace(office, sibling)).toBe(false)
    expect(resolveResourceSpace(sameNames, { bookingCategory: "office", officeId: "east-fixed", roomName: "Quiet Corner" })).toEqual({
      status: "ambiguous", candidates: [selected, sibling],
    })
  })

  it("requires exact catalog ID pairs, not aliases, missing rooms, or duplicate IDs within a parent", () => {
    expect(getCatalogAvailabilitySpace(catalog, "office", "east-fixed")).toBeNull()
    expect(getCatalogAvailabilitySpace(catalog, "office", "Old East Wing", "shared-room")).toBeNull()
    expect(getCatalogAvailabilitySpace(catalog, "office", "east-fixed", "Suite 17")).toBeNull()
    expect(getCatalogAvailabilitySpace(catalog, "venue", "Old Conservatory")).toBeNull()
    const duplicate = structuredClone(catalog)
    duplicate.offices[0].rooms.push({ id: "shared-room", name: "Not The Same Room", legacyNames: [] })
    expect(getCatalogAvailabilitySpace(duplicate, "office", "east-fixed", "shared-room")).toBeNull()
  })

  it.each([
    { bookingCategory: "venue" },
    { bookingType: "event_venue_rental" },
    { rentalType: "event" },
    { isOfficeRental: false },
    {},
  ])("does not classify office-like display labels or event titles as office identity: %j", (category) => {
    const record = { ...category, venueId: "hall-fixed", spaceId: "hall-fixed", venue: "Office Space Rental - Room 1",
      eventName: "Office Rental", eventType: "Office Space Rental", name: "Office A", roomName: "Room 1" }
    expect(isOfficeResourceBooking(record)).toBe(false)
    expect(resolveResourceSpace(catalog, record)).toEqual({ status: "resolved", space: hall })
  })

  it.each([
    { bookingCategory: "office" }, { bookingType: "office_rental" }, { rentalType: "office space rental" },
    { isOfficeRental: true }, { officeId: "east-fixed" },
  ])("recognizes explicit office metadata independently of arbitrary display labels: %j", (category) => {
    expect(isOfficeResourceBooking({ ...category, venue: "Paper Moon", eventName: "A Birthday", eventType: "Anything / Custom" })).toBe(true)
  })

  it.each([
    { bookingCategory: "office", venue: "Saffron / Atrium - Quiet Corner" },
    { bookingCategory: "office", venue: "  OLD   EAST WING - SUITE 17  " },
    { bookingCategory: "office", officeId: "Old East Wing", roomName: "Suite 17" },
    { bookingCategory: "office", venueId: "Old East Wing", roomId: "Suite 17" },
  ])("resolves only exact current or explicitly registered historical aliases: %j", (record) => {
    expect(resolveResourceSpace(catalog, record)).toEqual({ status: "resolved", space: east })
  })

  it.each(["booking", "maintenance", "rental"] as const)("scopes a %s roomId alias before considering exact child IDs in unrelated buildings", (kind) => {
    const collision = structuredClone(catalog)
    collision.offices[1].rooms.push({ id: "Suite 17", name: "Foreign Exact ID", legacyNames: [] })
    for (const parent of [{ officeId: "east-fixed" }, { venueId: "Old East Wing" }]) {
      const record = { bookingCategory: "office", type: "office", ...parent, roomId: "Suite 17" }
      expect(resolveResourceSpace(collision, record, kind)).toEqual({ status: "resolved", space: { ...east, catalog: collision } })
    }
    expect(resolveResourceSpace(collision, { bookingCategory: "office", officeId: "west-fixed", roomId: "Suite 17" }, kind)).toMatchObject({
      status: "resolved", space: { venueId: "west-fixed", spaceId: "Suite 17" },
    })
  })

  it.each([
    { officeId: "east-fixed", roomName: "Quiet" },
    { officeId: "east-fixed", roomName: "Room 1" },
    { officeId: "east-fixed", roomId: "1" },
    { officeId: "east-fixed", spaceId: "east-fixed-room-1" },
    { officeId: "east-fixed", spaceId: "shared-roo" },
    { officeId: "east-fixed", spaceId: "SHARED-ROOM" },
    { venue: "Saffron / Atrium - Quiet" },
    { venue: "Old East Wing - Suite 1" },
    { venue: "Office 1 - Room 1" },
    { venue: "Saffron" },
    { eventName: "Saffron / Atrium - Quiet Corner" },
  ])("leaves substrings, room numbers, ID prefixes, positions, and titles unresolved: %j", (reference) => {
    expect(resolveResourceSpace(catalog, { bookingCategory: "office", ...reference })).toEqual({ status: "unresolved", candidates: [] })
  })

  it("preserves ambiguous aliases even when a candidate is archived", () => {
    const ambiguous = structuredClone(catalog)
    ambiguous.offices.forEach((building) => building.legacyNames.push("Shared Former Building"))
    Object.assign(ambiguous.offices[1], { isArchived: true })
    const reference = { bookingCategory: "office", venue: "Shared Former Building - Suite 17" }
    const result = resolveResourceSpace(ambiguous, reference)
    expect(result.status).toBe("ambiguous")
    if (result.status === "resolved") throw new Error("An ambiguous alias must not select the first catalog entry")
    expect(result.candidates.map((space) => [space.venueId, space.spaceId])).toEqual([
      ["east-fixed", "shared-room"], ["west-fixed", "shared-room"],
    ])
    expect(ambiguousResourceAffectsSpace(ambiguous, reference, east, "booking")).toBe(true)
    expect(ambiguousResourceAffectsSpace(ambiguous, reference, west, "booking")).toBe(true)
    expect(ambiguousResourceAffectsSpace(ambiguous, reference, other, "booking")).toBe(false)
    expect(resolveResourceSpace(catalog, { bookingCategory: "office", roomName: "Quiet Corner" }).status).toBe("ambiguous")
  })

  it("does not use catalog order to break ties or infer a room", () => {
    const reversed = structuredClone(catalog)
    reversed.offices.reverse().forEach((building) => building.rooms.reverse())
    expect(resolveResourceSpace(reversed, office)).toEqual({ status: "resolved", space: { ...east, catalog: reversed } })
    expect(resolveResourceSpace(reversed, { bookingCategory: "office", roomName: "Quiet Corner" }).status).toBe("ambiguous")
    expect(resolveResourceSpace(reversed, { bookingCategory: "office", officeId: "east-fixed", roomName: "Room 1" }).status).toBe("unresolved")
  })
})

describe("identity-scoped shared availability", () => {
  it("uses stable parent/room pairs for bookings, legacy rentals, and maintenance", () => {
    const booking = { ...office, venue: "Stale Display", date, endDate: "2101-03-01", status: "confirmed" }
    const maintenance = { type: "office", scope: "room", officeId: "east-fixed", spaceId: "shared-room", date, status: "active", spaceName: "Stale Display" }
    const rental = { officeId: "east-fixed", officeSpaceId: "shared-room", officeSpaceName: "Stale Display", leaseStatus: "Active Lease" }
    expect(maintenanceMatchesAvailabilitySpace(maintenance, east)).toBe(true)
    expect(maintenanceMatchesAvailabilitySpace(maintenance, west)).toBe(false)
    expect(officeRentalMatchesAvailabilitySpace(rental, east)).toBe(true)
    expect(officeRentalMatchesAvailabilitySpace(rental, west)).toBe(false)
    expect(calculateAvailabilityForDate(east, date, [booking]).status).toBe("full")
    expect(calculateAvailabilityForDate(other, date, [booking], [maintenance], [rental]).status).toBe("available")
    expect(calculateAvailabilityForDate(west, date, [booking], [maintenance], [rental]).status).toBe("available")
    expect(calculateAvailabilityForDate(east, date, [], [maintenance]).status).toBe("maintenance")
    expect(calculateAvailabilityForDate(east, date, [], [], [rental]).status).toBe("full")
  })

  it("applies explicit building maintenance to its own rooms only", () => {
    const record = { type: "office", scope: "building", officeId: "east-fixed", spaceId: "east-fixed", date, status: "active" }
    expect(maintenanceMatchesAvailabilitySpace(record, east)).toBe(true)
    expect(maintenanceMatchesAvailabilitySpace(record, other)).toBe(true)
    expect(maintenanceMatchesAvailabilitySpace(record, west)).toBe(false)
    expect(maintenanceMatchesAvailabilitySpace(record, hall)).toBe(false)
  })

  it("keeps a venue's occupied schedule after a customer event title changes", () => {
    const booking = { bookingCategory: "venue", venueId: "hall-fixed", spaceId: "hall-fixed", venue: "Office A - Room 1",
      eventName: "Celebration", eventType: "A custom event label", date, status: "confirmed", startTime: "08:00", endTime: "14:00" }
    const before = calculateAvailabilityForDate(hall, date, [booking])
    const after = calculateAvailabilityForDate(hall, date, [{ ...booking, eventName: "Office Space Rental", eventType: "Office / Room Expo" }])
    expect(after).toEqual(before)
    expect(after.status).toBe("few")
    expect(after.availableSlots.map((slot) => slot.startMinutes)).toEqual([900, 960])
    expect(calculateAvailabilityForDate(east, date, [booking]).status).toBe("available")
  })

  it.each(["date", "startDate"])("checks inclusive two-year range boundaries for %s-only legacy records", (field) => {
    const lastDay = "2101-03-01"
    const booking = { ...office, status: "pending", [field]: lastDay }
    const maintenance = { type: "office", officeId: "east-fixed", spaceId: "shared-room", scope: "room", status: "active", [field]: lastDay }
    expect(getAvailabilityRangeStatus(east, date, lastDay, [booking])).toBe("full")
    expect(getAvailabilityRangeStatus(east, date, lastDay, [], [maintenance])).toBe("maintenance")
    expect(getAvailabilityRangeStatus(east, date, "2101-02-28", [booking], [maintenance])).toBe("full")
    expect(getAvailabilityRangeStatus(east, date, "2101-02-28", [], [maintenance])).toBe("available")
    expect(getAvailabilityRangeStatus(west, date, lastDay, [booking], [maintenance])).toBe("available")
  })
})

describe("canonical availability date bounds", () => {
  it("prefers canonical date to stale startDate on bookings, maintenance, and rentals", () => {
    for (const identity of [office, { type: "office", scope: "room" }, { officeId: "east-fixed", leaseStatus: "Active Lease" }]) {
      expect(getAvailabilityDateBounds({ ...identity, date, startDate: "2098-01-01", endDate: "2099-09-01" })).toEqual({
        start: date, end: "2099-09-01",
      })
    }
    expect(getAvailabilityDateBounds({ startDate: date })).toEqual({ start: date, end: date })
  })

  it.each(["officeRentalTerm", "rentalTerm", "contractTerm"])("derives a missing office endDate from recognized %s with month-end clamping", (field) => {
    for (const [start, term, end] of [
      ["2099-08-31", "6_months", "2100-02-28"],
      ["2096-02-29", "1_year", "2097-02-28"],
      ["2096-02-29", "2_years", "2098-02-28"],
    ]) {
      expect(getAvailabilityDateBounds({ ...office, date: start, startDate: "2090-01-01", endDate: "", [field]: term })).toEqual({ start, end })
      expect(getAvailabilityDateBounds({ ...office, startDate: start, [field]: term })).toEqual({ start, end })
    }
  })

  it("keeps persisted endDate authoritative and never invents an office term for events or unknown labels", () => {
    expect(getAvailabilityDateBounds({ ...office, date, officeRentalTerm: "2_years", endDate: "2099-04-15" })).toEqual({ start: date, end: "2099-04-15" })
    for (const record of [
      { ...office }, { ...office, officeRentalTerm: "not-a-stored-term" },
      { bookingCategory: "venue", eventName: "Office Rental", eventType: "Office Space Rental", rentalTerm: "2_years" },
    ]) {
      expect(getAvailabilityDateBounds({ ...record, date })).toEqual({ start: date, end: date })
    }
  })

  it("keeps ongoing reservations exclusive independently of derived or stale date bounds", () => {
    const booking = { ...office, status: "reservation_secured", date: "2099-08-31", startDate: "2098-01-01", officeRentalTerm: "6_months" }
    expect(calculateAvailabilityForDate(east, "2098-01-01", [booking]).status).toBe("full")
    expect(calculateAvailabilityForDate(east, "2100-02-28", [booking]).status).toBe("full")
    expect(calculateAvailabilityForDate(east, "2100-03-01", [booking]).status).toBe("full")
    expect(getAvailabilityRangeStatus(east, "2100-02-01", "2100-02-28", [booking])).toBe("full")
    expect(getAvailabilityRangeStatus(east, "2100-03-01", "2100-09-01", [booking])).toBe("full")
  })
})
