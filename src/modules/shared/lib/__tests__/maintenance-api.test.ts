import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { TransactionStore } from "./helpers/transaction-store"

const boundary = vi.hoisted(() => ({ firestore: null as unknown, verifyIdToken: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => boundary.firestore,
  getAdminAuth: () => ({ verifyIdToken: boundary.verifyIdToken }),
}))

// Keep server-auth real: only Firebase token verification and persistence are fixtures.
import { POST as createMaintenance, DELETE as deleteMaintenance } from "@/app/api/maintenance/route"
import { POST as createBooking } from "@/app/api/bookings/route"
import { GET as getAvailability } from "@/app/api/availability/route"
import { calculateAvailabilityForDate } from "@/src/modules/shared/lib/availability"
import { getCatalogAvailabilitySpace } from "@/src/modules/shared/lib/resource-identity"

const date = "2099-03-01"
const nextDate = "2099-03-02"
const lastDate = "2099-03-03"
const catalog = {
  bookingCounter: 0,
  venues: [
    { id: "event-custom", name: "Office Garden Events", price: 10000, capacity: "100" },
    { id: "event-other", name: "Other Venue", price: 10000, capacity: "100" },
    { id: "event-archived", name: "Archived Venue", price: 10000, capacity: "100", isArchived: true },
  ],
  offices: [
    { id: "cedar-campus", name: "Cedar Annex", price: 5000, rooms: [
      { id: "shared-room", name: "Room 1" }, { id: "cedar-second", name: "Room 2" },
      { id: "archived-room", name: "Old Room", isArchived: true },
    ] },
    { id: "birch-campus", name: "Birch House", price: 5000, rooms: [
      { id: "shared-room", name: "Room 1" }, { id: "birch-second", name: "Room 2" },
    ] },
  ],
}
const venueInput = (extra = {}) => ({ type: "venue", scope: "venue", venueId: "event-custom", spaceId: "event-custom", date, ...extra })
const officeInput = (extra = {}) => ({ type: "office", scope: "room", officeId: "cedar-campus", spaceId: "shared-room", date, ...extra })
const eventBooking = (extra = {}) => ({
  bookingCategory: "venue", venueId: "event-custom", spaceId: "event-custom", venue: "Office Garden Events",
  userId: "client", date, startTime: "08:00", endTime: "14:00", status: "confirmed", ...extra,
})
const officeBooking = (extra = {}) => ({
  bookingCategory: "office", venueId: "cedar-campus", officeId: "cedar-campus", spaceId: "shared-room",
  userId: "client", venue: "Cedar Annex - Room 1", date, endDate: lastDate, status: "pending", ...extra,
})
const request = (body: unknown, token: string | null = "admin", method = "POST") => new NextRequest("http://localhost/api/maintenance", {
  method,
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
})
const create = (records: object[], token?: string | null) => createMaintenance(request({ records }, token))
const remove = (ids: string[], token?: string | null) => deleteMaintenance(request({ ids }, token, "DELETE"))

let store: TransactionStore
const maintenanceEntries = () => [...store.data.entries()].filter(([path]) => path.startsWith("maintenanceRecords/"))
const locks = () => [...store.data.entries()].filter(([, data]) => typeof data.revision === "number")
beforeEach(() => {
  store = new TransactionStore()
  boundary.firestore = store
  boundary.verifyIdToken.mockReset().mockImplementation(async (token: string) => {
    if (token === "invalid") throw Object.assign(new Error("Fixture invalid token"), { code: "auth/id-token-revoked" })
    return { uid: token, auth_time: 100 }
  })
  store.seed("cms/data", catalog)
  store.seed("users/admin", { role: "admin", status: "active", fullName: "Maintenance Admin" })
  store.seed("users/booking-staff", { role: "staff", status: "active", permissions: { bookings: true } })
  store.seed("users/cms-staff", { role: "staff", status: "active", permissions: { cms: true } })
  store.seed("users/denied-staff", { role: "staff", status: "active", permissions: { bookings: false } })
  store.seed("users/inactive-admin", { role: "admin", status: "inactive" })
  store.seed("users/client", { role: "client", status: "active" })
})

describe("maintenance authorization boundary (fixture tokens, real permission checks)", () => {
  it.each([[null, 401], ["invalid", 401], ["missing-profile", 403], ["client", 403], ["cms-staff", 403], ["denied-staff", 403], ["inactive-admin", 403]] as const)(
    "rejects %s for creation and deletion", async (token, status) => {
      store.seed("maintenanceRecords/KEEP", { status: "active" })
      const before = structuredClone(store.data)
      expect((await create([venueInput()], token)).status).toBe(status)
      expect((await remove(["KEEP"], token)).status).toBe(status)
      expect(store.data).toEqual(before)
    },
  )

  it("checks token revocation and permits staff only with bookings permission", async () => {
    const response = await create([venueInput()], "booking-staff")
    expect(response.status).toBe(201)
    expect(boundary.verifyIdToken).toHaveBeenCalledWith("booking-staff", true)
    const { records } = await response.json()
    expect(records[0].createdBy).toBe("booking-staff")
    expect((await remove([records[0].id], "booking-staff")).status).toBe(200)
  })
})

describe("whole-building maintenance availability GET", () => {
  const lookup = (token = "admin") => getAvailability(new NextRequest(`http://localhost/api/availability?${new URLSearchParams({
    category: "office", venueId: "cedar-campus", officeId: "cedar-campus", spaceId: "cedar-campus", from: date, to: "2099-03-04",
  })}`, { headers: { authorization: `Bearer ${token}` } }))

  it.each([["admin", 200], ["booking-staff", 200], ["client", 403], ["cms-staff", 403], ["denied-staff", 403]] as const)(
    "returns %s whole-building availability only with bookings access (%s)", async (token, status) => {
      const before = structuredClone(store.data)
      const response = await lookup(token)
      expect(response.status).toBe(status)
      if (status === 200) expect((await response.json()).space).toEqual({
        category: "office", venueId: "cedar-campus", officeId: "cedar-campus", spaceId: "cedar-campus",
      })
      expect(store.data).toEqual(before)
    },
  )

  it("aggregates every room's bookings, maintenance and rentals without leaking records or writing", async () => {
    store.seed("bookings/LOCAL-ROOM", officeBooking({ spaceId: "cedar-second", status: "confirmed", endDate: date }))
    store.seed("maintenanceRecords/LOCAL-MAINTENANCE", { ...officeInput({ date: nextDate }), status: "active" })
    store.seed("officeRentals/LOCAL-RENTAL", { officeId: "cedar-campus", spaceId: "shared-room", startDate: lastDate, endDate: lastDate, leaseStatus: "Active" })
    store.seed("bookings/LOCAL-OTHER", officeBooking({ venueId: "birch-campus", officeId: "birch-campus", status: "confirmed", endDate: "2099-03-04" }))
    const before = structuredClone(store.data)
    const response = await lookup()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect([date, nextDate, lastDate, "2099-03-04"].map(day => body.dates[day].status)).toEqual(["full", "maintenance", "full", "full"])
    expect(Object.values(body.dates).every(day => (day as { occupiedIntervals: unknown[] }).occupiedIntervals.length === 0)).toBe(true)
    expect(JSON.stringify(body)).not.toContain("LOCAL-")
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(store.data).toEqual(before)
  })

  it("fails closed for ambiguous room references, but ignores terminal records", async () => {
    store.seed("bookings/LOCAL-AMBIGUOUS", { bookingCategory: "office", roomName: "Room 1", date, status: "confirmed" })
    expect((await lookup()).status).toBe(409)
    store.seed("bookings/LOCAL-AMBIGUOUS", { bookingCategory: "office", roomName: "Room 1", date, status: "cancelled" })
    const response = await lookup()
    expect(response.status).toBe(200)
    expect((await response.json()).dates[date].status).toBe("available")
  })
})

describe("maintenance schema and authoritative writes", () => {
  it.each([
    { scope: "room" }, { officeId: "cedar-campus" }, { spaceId: "event-other" },
    { venueId: "missing" }, { venueId: "event-archived", spaceId: "event-archived" },
    { date: "2099-02-30" }, { date: "2000-01-01" }, { date: "2099-3-1" },
    { startDate: nextDate }, { endDate: "2099-02-28" }, { endDate: "2099-09-01" },
    { status: "active" }, { createdBy: "forged" }, { reason: "x".repeat(2001) },
  ])("rejects invalid venue input %j without writing", async (extra) => {
    const before = structuredClone(store.data)
    expect((await create([venueInput(extra)])).status).toBe(400)
    expect(store.data).toEqual(before)
  })

  it.each([
    { scope: "venue" }, { officeId: undefined }, { officeId: "missing" },
    { venueId: "birch-campus" }, { spaceId: "birch-second" }, { spaceId: "archived-room" },
    { scope: "building" }, { spaceId: "cedar-campus" },
  ])("rejects invalid office scope/IDs %j", async (extra) => {
    expect((await create([officeInput(extra)])).status).toBe(400)
    expect(maintenanceEntries()).toHaveLength(0)
  })

  it("rejects malformed JSON, empty/oversized batches, and missing persisted catalogs", async () => {
    expect((await createMaintenance(new NextRequest("http://localhost/api/maintenance", {
      method: "POST", headers: { authorization: "Bearer admin" }, body: "{",
    }))).status).toBe(400)
    expect((await create([])).status).toBe(400)
    expect((await create(Array.from({ length: 181 }, () => venueInput()))).status).toBe(400)
    expect((await create([venueInput({ reason: "x".repeat(128 * 1024) })])).status).toBe(413)
    store.data.delete("cms/data")
    expect((await create([venueInput()])).status).toBe(503)
  })

  it("atomically creates every selected date with fresh UUIDs, canonical scope, label snapshots, audit fields and per-day locks", async () => {
    const response = await create([venueInput({ reason: "  Annual inspection  " }), venueInput({ date: nextDate })])
    expect(response.status).toBe(201)
    const { records } = await response.json()
    expect(records).toHaveLength(2)
    expect(new Set(records.map((record: { id: string }) => record.id)).size).toBe(2)
    records.forEach((record: { id: string }) => expect(record.id).toMatch(/^maint_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/))
    expect(records[0]).toMatchObject({
      type: "venue", scope: "venue", venueId: "event-custom", spaceId: "event-custom", officeId: "",
      spaceName: "Office Garden Events", venueName: "Office Garden Events", date, startDate: date, endDate: date,
      status: "active", reason: "Annual inspection", createdBy: "admin", updatedBy: "admin", createdByName: "Maintenance Admin",
    })
    expect(records[0].createdAt).toBe(records[0].updatedAt)
    expect(maintenanceEntries()).toHaveLength(2)
    expect(locks().map(([, lock]) => lock.date).sort()).toEqual([date, nextDate])
  })

  it("locks every day of a venue range, not only its first date", async () => {
    expect((await create([venueInput({ startDate: date, endDate: lastDate })])).status).toBe(201)
    expect(maintenanceEntries()).toHaveLength(1)
    expect(locks().map(([, lock]) => lock.date).sort()).toEqual([date, nextDate, lastDate])
  })

  it("does not return success or partially persist when the transaction fails", async () => {
    const before = structuredClone(store.data)
    vi.spyOn(store, "runTransaction").mockRejectedValueOnce(new Error("Fixture commit failed"))
    expect((await create([venueInput(), venueInput({ date: nextDate })])).status).toBe(500)
    expect(store.data).toEqual(before)
  })
})

describe("full-day conflicts and resource identity", () => {
  it.each(["pending", "verifying", "confirmed", "reservation_secured", "cancellation_requested", "modification_under_review", "contract_signing_required"])(
    "rejects every overlapping blocking %s booking without cancelling it or saving other selected dates", async (status) => {
      store.seed("bookings/EXISTING", eventBooking({ status, date: nextDate }))
      const before = structuredClone(store.data)
      expect((await create([venueInput(), venueInput({ date: nextDate })])).status).toBe(409)
      expect(store.data).toEqual(before)
    },
  )

  it("rejects Few days and legacy startDate/name-only bookings without createdAt", async () => {
    const booking = eventBooking()
    const space = getCatalogAvailabilitySpace(catalog, "venue", "event-custom")!
    expect(calculateAvailabilityForDate(space, date, [booking]).status).toBe("few")
    store.seed("bookings/LEGACY", { venue: "Office Garden Events", bookingCategory: "venue", startDate: date, status: "pending" })
    expect((await create([venueInput()])).status).toBe(409)
  })

  it.each(["cancelled", "completed", "declined", "expired"])("does not block terminal %s bookings", async (status) => {
    store.seed("bookings/TERMINAL", eventBooking({ status }))
    expect((await create([venueInput()])).status).toBe(201)
  })

  it("rejects duplicate/overlapping batches and retains legacy maintenance beyond 500 rows", async () => {
    expect((await create([venueInput(), venueInput()])).status).toBe(409)
    expect(maintenanceEntries()).toHaveLength(0)
    for (let index = 0; index < 501; index++) {
      store.seed(`maintenanceRecords/OLD-${index}`, { type: "venue", spaceId: "event-other", date, status: "active", createdAt: "2000-01-01" })
    }
    store.seed("maintenanceRecords/LEGACY", { type: "venue", spaceName: "Office Garden Events", startDate: date, endDate: lastDate, status: "Active" })
    expect((await create([venueInput({ date: nextDate })])).status).toBe(409)
    expect(maintenanceEntries()).toHaveLength(502)
  })

  it("uses office/building IDs to distinguish repeated room IDs and names", async () => {
    store.seed("bookings/OTHER-BUILDING", officeBooking({ officeId: "birch-campus", venueId: "birch-campus", venue: "Birch House - Room 1" }))
    expect((await create([officeInput()])).status).toBe(201)
    expect(maintenanceEntries()[0][1]).toMatchObject({ type: "office", scope: "room", officeId: "cedar-campus", spaceId: "shared-room", officeName: "Cedar Annex", roomName: "Room 1" })
  })

  it.each([
    { collection: "bookings", record: { bookingCategory: "office", spaceId: "shared-room", date, endDate: lastDate, status: "pending" },
      terminal: { status: "cancelled", bookingStatus: "Confirmed", isSlotSecured: true, paymentStatus: "paid" } },
    { collection: "maintenanceRecords", record: { type: "office", scope: "room", spaceId: "shared-room", date, endDate: lastDate, status: "active" },
      terminal: { status: "inactive" } },
    { collection: "officeRentals", record: { officeSpaceId: "shared-room", date, endDate: lastDate, leaseStatus: "Active Lease" },
      terminal: { leaseStatus: "Completed" } },
  ])("rejects ambiguous $collection mappings for candidate rooms/buildings, but ignores terminal mappings", async ({ collection, record, terminal }) => {
    const path = `${collection}/AMBIGUOUS`
    store.seed(path, record)
    const before = structuredClone(store.data)
    for (const officeId of ["cedar-campus", "birch-campus"]) {
      for (const scope of ["room", "building"]) {
        const response = await create([officeInput({ officeId, scope, spaceId: scope === "building" ? officeId : "shared-room" })])
        expect(response.status).toBe(409)
        expect((await response.json()).error).toMatch(/ambiguous/i)
      }
    }
    expect(store.data).toEqual(before)
    expect((await create([officeInput({ spaceId: "cedar-second" })])).status).toBe(201)

    store.seed(path, { ...record, ...terminal })
    expect((await create([officeInput(), officeInput({ officeId: "birch-campus" })])).status).toBe(201)
  })

  it("blocks whole-building maintenance on any reserved room while allowing a different room", async () => {
    store.seed("bookings/ROOM-1", officeBooking({ date: "2099-02-01", endDate: lastDate }))
    expect((await create([officeInput({ spaceId: "cedar-second" })])).status).toBe(201)
    expect((await create([officeInput({ scope: "building", spaceId: "cedar-campus" })])).status).toBe(409)
  })

  it("checks room and building maintenance overlap in both directions", async () => {
    const building = officeInput({ scope: "building", spaceId: "cedar-campus" })
    expect((await create([building, officeInput()])).status).toBe(409)
    expect((await create([officeInput(), building])).status).toBe(409)
    expect(maintenanceEntries()).toHaveLength(0)
    expect((await create([building])).status).toBe(201)
    expect((await create([officeInput({ spaceId: "cedar-second" })])).status).toBe(409)
    expect(locks()).toHaveLength(1)
  })

  it.each([
    { officeId: "cedar-campus", spaceId: "shared-room", startDate: "2099-02-01", endDate: lastDate },
    { officeSpaceId: "cedar-campus" },
    { officeSpaceName: "Cedar Annex - Room 1" },
  ])("blocks overlapping and undated nonterminal office rentals %j", async (extra) => {
    store.seed("officeRentals/LEASE", { leaseStatus: "Active Lease", ...extra })
    expect((await create([officeInput()])).status).toBe(409)
    expect((await create([officeInput({ scope: "building", spaceId: "cedar-campus" })])).status).toBe(409)
  })

  it("ignores terminal/unrelated rentals but retains an active lease after its planned end", async () => {
    store.seed("officeRentals/TERMINAL", { officeSpaceId: "cedar-campus", leaseStatus: "Completed" })
    store.seed("officeRentals/EARLIER", { officeSpaceId: "cedar-campus", date: "2099-01-01", endDate: "2099-01-31", leaseStatus: "Active Lease" })
    store.seed("officeRentals/OTHER", { officeSpaceId: "birch-campus", leaseStatus: "Active Lease" })
    expect((await create([officeInput()])).status).toBe(409)
    store.seed("officeRentals/EARLIER", { officeSpaceId: "cedar-campus", date: "2099-01-01", endDate: "2099-01-31", leaseStatus: "Completed" })
    expect((await create([officeInput()])).status).toBe(201)
  })
})

describe("concurrent availability commits", () => {
  it("serializes duplicate maintenance submissions", async () => {
    const responses = await Promise.all([create([venueInput()]), create([venueInput()])])
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    expect(maintenanceEntries()).toHaveLength(1)
    expect(store.retries).toBeGreaterThan(0)
  })

  it("uses the booking API's venue/date lock for a non-first day of a range", async () => {
    const responses = await Promise.all([
      create([venueInput({ endDate: lastDate })]),
      createBooking(request({ ...eventBooking({ date: lastDate }), eventName: "New Event", eventType: "Celebration", guestCount: 10 }, "client")),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    expect(store.retries).toBeGreaterThan(0)
  })

  it("uses the all-dates building lock when a room rental starts before maintenance", async () => {
    const responses = await Promise.all([
      create([officeInput({ scope: "building", spaceId: "cedar-campus", date: nextDate })]),
      createBooking(request({ ...officeBooking(), eventName: "New Rental", eventType: "Office Rental", guestCount: 1, officeRentalTerm: "6_months" }, "client")),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    expect(store.retries).toBeGreaterThan(0)
  })

  it("serializes building versus room maintenance, but permits independent rooms", async () => {
    const conflicting = await Promise.all([
      create([officeInput({ scope: "building", spaceId: "cedar-campus" })]), create([officeInput()]),
    ])
    expect(conflicting.map((response) => response.status).sort()).toEqual([201, 409])
    const ids = maintenanceEntries().map(([path]) => path.split("/").at(-1)!)
    expect((await remove(ids)).status).toBe(200)
    const independent = await Promise.all([create([officeInput()]), create([officeInput({ spaceId: "cedar-second" })])])
    expect(independent.map((response) => response.status)).toEqual([201, 201])
    expect(store.retries).toBeGreaterThan(0)
  })
})

describe("explicit maintenance deletion", () => {
  it.each(["venue", "office"] as const)("refreshes %s availability after rename, range end, and acknowledged removal", async (type) => {
    const input = type === "venue" ? venueInput({ endDate: lastDate }) : officeInput({ endDate: lastDate })
    const created = await create([input])
    expect(created.status).toBe(201)
    const { records } = await created.json()
    const saved = structuredClone(store.data.get(`maintenanceRecords/${records[0].id}`))
    const renamed = structuredClone(catalog)
    renamed.venues[0].name = "Renamed Venue"
    renamed.offices[0].name = "Renamed Building"
    renamed.offices[0].rooms[0].name = "Renamed Room"
    store.seed("cms/data", renamed)
    const params = new URLSearchParams({ category: type, venueId: type === "venue" ? "event-custom" : "cedar-campus",
      ...(type === "office" ? { officeId: "cedar-campus", spaceId: "shared-room" } : {}), from: date, to: "2099-03-04" })
    const lookup = () => getAvailability(new NextRequest(`http://localhost/api/availability?${params}`, { headers: { authorization: "Bearer client" } }))
    const response = await lookup()
    expect(response.status).toBe(200)
    const result = await response.json()
    expect([date, nextDate, lastDate].map((day) => result.dates[day].status)).toEqual(["maintenance", "maintenance", "maintenance"])
    expect(result.dates["2099-03-04"].status).toBe("available")
    expect(store.data.get(`maintenanceRecords/${records[0].id}`)).toEqual(saved)
    expect((await remove([records[0].id])).status).toBe(200)
    const refreshed = await lookup()
    expect(refreshed.status).toBe(200)
    expect(Object.values((await refreshed.json()).dates).map((day) => (day as { status: string }).status))
      .toEqual(["available", "available", "available", "available"])
  })

  it("does not let a stale deletion remove maintenance recreated for the same resource and dates", async () => {
    const firstResponse = await create([venueInput()])
    expect(firstResponse.status).toBe(201)
    const original = (await firstResponse.json()).records[0]
    expect((await remove([original.id])).status).toBe(200)

    const recreatedResponse = await create([venueInput()])
    expect(recreatedResponse.status).toBe(201)
    const replacement = (await recreatedResponse.json()).records[0]
    expect(replacement.id).not.toBe(original.id)
    const beforeStaleDeletion = structuredClone(store.data)
    expect((await remove([original.id])).status).toBe(404)
    expect(store.data).toEqual(beforeStaleDeletion)
    expect(store.data.has(`maintenanceRecords/${replacement.id}`)).toBe(true)
    expect(maintenanceEntries()).toHaveLength(1)
  })

  it("deletes only the acknowledged IDs, including legacy resources absent from the catalog", async () => {
    store.seed("maintenanceRecords/LEGACY", { spaceName: "Removed resource", status: "Active" })
    store.seed("maintenanceRecords/KEEP", { spaceId: "event-other", date, status: "active" })
    const response = await remove(["LEGACY"])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ids: ["LEGACY"] })
    expect(store.data.has("maintenanceRecords/LEGACY")).toBe(false)
    expect(store.data.has("maintenanceRecords/KEEP")).toBe(true)
  })

  it("rejects wildcard requests, duplicate IDs and missing IDs without partial deletion", async () => {
    store.seed("maintenanceRecords/KEEP", { status: "active" })
    expect((await deleteMaintenance(request({ all: true }, "admin", "DELETE"))).status).toBe(400)
    expect((await remove([])).status).toBe(400)
    expect((await remove(["KEEP", "KEEP"])).status).toBe(400)
    expect((await remove(["KEEP", "MISSING"])).status).toBe(404)
    expect((await remove(["nested/id"])).status).toBe(400)
    expect(store.data.has("maintenanceRecords/KEEP")).toBe(true)
  })
})
