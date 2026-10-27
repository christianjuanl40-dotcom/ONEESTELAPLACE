import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { TransactionStore } from "./helpers/transaction-store"

const boundary = vi.hoisted(() => ({ firestore: null as unknown }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/firebase-admin", () => ({ getAdminFirestore: () => boundary.firestore }))
vi.mock("@/lib/server-auth", () => {
  class ApiAuthError extends Error {
    constructor(readonly status: number, message: string) { super(message) }
  }
  const user = async (request: Request) => ({ uid: request.headers.get("x-uid") || "CLIENT",
    role: request.headers.get("x-role") || "client", fullName: "Fixture Client", email: "client@example.test",
    permissions: { bookings: request.headers.get("x-bookings-permission") === "true" } })
  return { ApiAuthError, isApiAuthError: (error: unknown) => error instanceof ApiAuthError, requireAuthenticatedUser: user,
    requireBackofficeUser: async (request: Request) => {
      const authenticated = await user(request)
      if (authenticated.role !== "admin" && !(authenticated.role === "staff" && authenticated.permissions.bookings)) {
        throw new ApiAuthError(403, "Booking permission required.")
      }
      return authenticated
    } }
})

import { POST as create } from "@/app/api/bookings/route"
import { POST as modify } from "@/app/api/bookings/modification/route"
import { GET as availability } from "@/app/api/availability/route"
import { POST as lifecycle } from "@/app/api/bookings/lifecycle/route"

type Data = Record<string, unknown>
const date = "2099-03-01"
const endDate = "2101-03-01"
const oldDate = "2098-03-01"
const now = "2026-10-25T04:00:00.000Z"
const catalog = {
  bookingCounter: 0,
  venues: [{ id: "hall-fixed", name: "Office Annex / Ceremony Lab", legacyNames: ["Old Conservatory"], price: 10000, capacity: "100" }],
  offices: [
    { id: "east-fixed", name: "Saffron / Atrium", legacyNames: ["Old East Wing"], price: 12000, rooms: [
      { id: "shared-room", name: "Quiet Corner", legacyNames: ["Suite 17"] },
      { id: "other-room", name: "Window Seat", legacyNames: ["Suite 2"] },
    ] },
    { id: "west-fixed", name: "Juniper & Slate", legacyNames: ["Old West Wing"], price: 15000, rooms: [
      { id: "shared-room", name: "Quiet Corner", legacyNames: ["Suite 17"] },
    ] },
  ],
}
const post = (body: object, role = "client") => new NextRequest("http://localhost/api/fixture", {
  method: "POST", headers: { "content-type": "application/json", "x-role": role }, body: JSON.stringify(body),
})
const officeInput = (extra: Data = {}) => ({ venueId: "east-fixed", officeId: "east-fixed", spaceId: "shared-room",
  bookingCategory: "office", isOfficeRental: true, eventName: "Research Collective", eventType: "Anything / Custom Business",
  date, officeRentalTerm: "2_years", ...extra })
const officeBooking = (extra: Data = {}) => ({ ...officeInput(), userId: "CLIENT", venue: "Deleted Building - Deleted Room",
  bookingType: "office", roomName: "Obsolete Room Snapshot", endDate, time: "", startTime: "", endTime: "", guestCount: 1,
  status: "reservation_secured", bookingStatus: "Slot Secured", isSlotSecured: true, totalPrice: 12000,
  paymentStatus: "slot_verified", amountPaid: 12000, rentalTerm: "2_years", contractTerm: "2_years", specialRequests: "", createdAt: now, ...extra })
const eventInput = (extra: Data = {}) => ({ venueId: "hall-fixed", date, eventName: "Office Space Rental", eventType: "Office / Room Expo",
  guestCount: 10, startTime: "08:00", endTime: "14:00", ...extra })
const eventBooking = (extra: Data = {}) => ({ ...eventInput(), userId: "CLIENT", venue: "Saffron / Atrium - Quiet Corner",
  spaceId: "hall-fixed", officeId: "", bookingCategory: "venue", bookingType: "venue", isOfficeRental: false,
  endDate: "", time: "08:00 - 14:00", status: "confirmed", bookingStatus: "Confirmed", specialRequests: "", totalPrice: 10000, ...extra })
const maintenance = (extra: Data = {}) => ({ type: "office", scope: "room", officeId: "east-fixed", venueId: "east-fixed",
  spaceId: "shared-room", spaceName: "Deleted Room Snapshot", status: "active", ...extra })
const query = (extra: Record<string, string> = {}, headers: Record<string, string> = {}) => new NextRequest(
  `http://localhost/api/availability?${new URLSearchParams({ category: "office", venueId: "east-fixed", officeId: "east-fixed",
    spaceId: "shared-room", from: date, to: date, ...extra })}`, { headers },
)

let store: TransactionStore
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(now))
  store = new TransactionStore()
  boundary.firestore = store
  store.seed("cms/data", catalog)
})
afterEach(() => vi.useRealTimers())

describe("availability read projections and diagnostics", () => {
  it("projects scheduling fields without filtering out legacy blockers or exposing private payloads", async () => {
    store.seed("bookings/LEGACY", officeBooking({ venueId: "Old East Wing", officeId: "Old East Wing", spaceId: "", roomId: "Suite 17",
      proofUrl: "data:image/png;base64," + "A".repeat(300000), paymentReceipts: [{ privateProof: "large" }], userInfo: { name: "Private Client" } }))
    const selections: string[][] = []
    const collection = store.collection.bind(store)
    vi.spyOn(store, "collection").mockImplementation(path => {
      const ref = collection(path), select = ref.select.bind(ref)
      ref.select = (...fields) => { selections.push(fields); return select(...fields) }
      return ref
    })
    const response = await availability(query())
    expect(response.status).toBe(200)
    expect((await response.json()).dates[date].status).toBe("full")
    expect(response.headers.get("server-timing")).toMatch(/auth;dur=.*catalog;dur=.*calculate;dur=.*total;dur=/)
    expect(response.headers.get("x-request-id")).toBeTruthy()
    expect(selections.length).toBeGreaterThan(0)
    expect(selections[0]).toContain("roomId")
    expect(selections.flat()).not.toContain("proofUrl")
    expect(selections.flat()).not.toContain("paymentReceipts")
    expect(selections.flat()).not.toContain("userInfo")
  })

  it("does not look up a payment ledger for a hold already protected by canonical secured metadata", async () => {
    store.seed("bookings/SECURED", officeBooking({ status: "pending", createdAt: "2026-10-01T00:00:00Z", isSlotSecured: true }))
    const collection = vi.spyOn(store, "collection")
    expect((await availability(query())).status).toBe(200)
    expect(collection.mock.calls.some(([name]) => name === "payments")).toBe(false)
  })

  it("keeps transaction reads complete so an expiry commit preserves earlier audit logs", async () => {
    const previousLog = { action: "ORIGINAL", message: "Keep this audit entry", createdAt: "2026-10-01T00:00:00Z" }
    store.seed("bookings/ABANDONED", officeBooking({ status: "pending", bookingStatus: "Pending", isSlotSecured: false,
      paymentStatus: "unpaid", amountPaid: 0, createdAt: "2026-10-01T00:00:00Z", adminLogs: [previousLog] }))
    const selections: string[][] = [], collection = store.collection.bind(store)
    vi.spyOn(store, "collection").mockImplementation(path => {
      const ref = collection(path), select = ref.select.bind(ref)
      ref.select = (...fields) => { selections.push(fields); return select(...fields) }; return ref
    })
    const response = await create(post(officeInput()))
    expect(response.status).toBe(201)
    expect(selections).toEqual([])
    expect(store.data.get("bookings/ABANDONED")?.adminLogs).toEqual([previousLog, expect.objectContaining({ action: "AUTO_EXPIRE_BOOKING" })])
  })
})

describe("exclusive ongoing office occupancy and room-card projection", () => {
  const rooms = () => query({ scope: "rooms", spaceId: "" })
  const lease = (extra: Data = {}) => ({ officeId: "east-fixed", officeSpaceId: "shared-room", leaseStatus: "Active Lease",
    startDate: "2025-01-01", endDate: "2026-01-01", userId: "OTHER-CUSTOMER", clientName: "Private Tenant", ...extra })

  it("keeps an office visible but blocks room bookings while it is Under Renovation", async () => {
    const renovating = structuredClone(catalog) as any
    renovating.offices[0].catalogStatus = "under_renovation"
    store.seed("cms/data", renovating)

    expect((await availability(rooms())).status).toBe(409)
    expect((await create(post(officeInput()))).status).toBe(400)
  })

  it.each(["Active Lease", "Active", "Occupied"])("blocks Room 1 for all customers with a dated %s lease; Rooms 2–8 stay independently bookable", async (leaseStatus) => {
    const expanded = structuredClone(catalog)
    expanded.offices[0].rooms.push(...Array.from({ length: 6 }, (_, i) => ({ id: `room-${i + 3}`, name: `Room ${i + 3}`, legacyNames: [] })))
    store.seed("cms/data", expanded)
    store.seed("officeRentals/PRIVATE-LEASE", lease({ leaseStatus }))
    const summary = await availability(rooms())
    expect(summary.status).toBe(200)
    expect(summary.headers.get("cache-control")).toBe("private, no-store")
    const body = await summary.json()
    expect(body).toEqual({ officeId: "east-fixed", officeRooms: Object.fromEntries(expanded.offices[0].rooms.map((room, index) => [room.id, index === 0 ? "occupied" : "available"])) })
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE-LEASE|Private Tenant|OTHER-CUSTOMER|startDate|endDate/)
    for (const uid of ["CLIENT-A", "CLIENT-B"]) {
      const request = post(officeInput({ date: "2105-01-01" }))
      request.headers.set("x-uid", uid)
      expect((await create(request)).status).toBe(409)
    }
    for (const room of expanded.offices[0].rooms.slice(1)) expect((await create(post(officeInput({ spaceId: room.id })))).status).toBe(201)
  })

  it("does not release the room as a secured booking transitions to an active lease, or while cancellation is pending", async () => {
    store.seed("bookings/RESERVATION", officeBooking({ userId: "OTHER-CUSTOMER" }))
    expect((await (await availability(rooms())).json()).officeRooms["shared-room"]).toBe("reserved")
    store.seed("bookings/RESERVATION", officeBooking({ status: "completed" }))
    store.seed("officeRentals/LEASE", lease())
    expect((await (await availability(rooms())).json()).officeRooms["shared-room"]).toBe("occupied")
    expect((await create(post(officeInput()))).status).toBe(409)
    store.seed("officeRentals/LEASE", lease({ cancellationRequested: true, cancellationStatus: "Pending" }))
    expect((await create(post(officeInput()))).status).toBe(409)
    store.seed("officeRentals/LEASE", lease({ leaseStatus: "Completed" }))
    store.seed("bookings/PENDING-CANCEL", officeBooking({ status: "cancellation_requested", cancellationRequested: true }))
    expect((await create(post(officeInput()))).status).toBe(409)
    store.seed("bookings/PENDING-CANCEL", officeBooking({ status: "cancelled" }))
    store.seed("maintenanceRecords/CURRENT", maintenance({ date: "2026-10-25" }))
    expect((await (await availability(rooms())).json()).officeRooms["shared-room"]).toBe("maintenance")
    store.seed("maintenanceRecords/CURRENT", maintenance({ date, endDate }))
    expect((await create(post(officeInput()))).status).toBe(409)
    store.data.delete("maintenanceRecords/CURRENT")
    expect((await create(post(officeInput()))).status).toBe(201)
  })

  it("revalidates a stale browser submission after another customer's reservation", async () => {
    expect((await (await availability(rooms())).json()).officeRooms["shared-room"]).toBe("available")
    const stale = post(officeInput({ date: "2105-01-01" }))
    expect((await create(post(officeInput()))).status).toBe(201)
    expect((await create(stale)).status).toBe(409)
    expect((await (await availability(rooms())).json()).officeRooms["shared-room"]).toBe("reserved")
  })

  it("retains the same room through the actual contract-signing transition into an active rental", async () => {
    store.seed("bookings/SIGNING", officeBooking({ date: "2025-01-01", endDate: "2026-01-01", contractSigned: false }))
    expect((await create(post(officeInput()))).status).toBe(409)
    expect((await lifecycle(post({ action: "contract_signed", bookingId: "SIGNING", signedBy: "Fixture Admin" }, "admin"))).status).toBe(200)
    expect(store.data.get("bookings/SIGNING")).toMatchObject({ status: "active_rental", contractSigned: true })
    expect((await (await availability(rooms())).json()).officeRooms["shared-room"]).toBe("occupied")
    expect((await create(post(officeInput({ date: "2105-01-01" })))).status).toBe(409)
  })

  it.each(["Active", "Occupied"])("recognizes a legacy %s booking without relying on display names or stale bookingStatus", async (status) => {
    store.seed("bookings/LEGACY", officeBooking({ status, bookingStatus: "Completed", date: "2020-01-01", endDate: "2021-01-01", amountPaid: 0, isSlotSecured: false }))
    expect((await (await availability(rooms())).json()).officeRooms["shared-room"]).toBe("occupied")
    expect((await create(post(officeInput()))).status).toBe(409)
  })

  it("releases a ledger-expired hold outside the requested term, atomically auditing replacement allocation", async () => {
    store.seed("bookings/EXPIRED", officeBooking({ status: "pending", isSlotSecured: false, verifiedByAdmin: false,
      amountPaid: 0, paymentStatus: "unpaid", createdAt: "2026-10-23T00:00:00Z" }))
    expect((await (await availability(rooms())).json()).officeRooms["shared-room"]).toBe("available")
    expect(store.data.get("bookings/EXPIRED")?.status).toBe("pending")
    expect((await create(post(officeInput({ date: "2105-01-01" })))).status).toBe(201)
    expect(store.data.get("bookings/EXPIRED")).toMatchObject({ status: "cancelled", cancellationType: "automatic_expiry" })
  })

  it("isolates ambiguous leases to candidate rooms, and preserves normal building lookup permissions", async () => {
    store.seed("officeRentals/AMBIGUOUS", { officeSpaceId: "shared-room", leaseStatus: "Active Lease", startDate: "2020-01-01", endDate: "2021-01-01" })
    expect((await (await availability(rooms())).json()).officeRooms).toEqual({ "shared-room": "unavailable", "other-room": "available" })
    expect((await availability(query({ spaceId: "east-fixed" }))).status).toBe(403)
    expect((await create(post(officeInput()))).status).toBe(409)
    expect((await create(post(officeInput({ spaceId: "other-room" })))).status).toBe(201)
  })
})

describe("bounded earliest office start-date discovery", () => {
  const search = (extra: Record<string, string> = {}) => query({
    from: "2026-11-01", to: "2026-11-30", rentalTerm: "6_months",
    searchFrom: "2026-11-01", searchTo: "2029-10-31", ...extra,
  })
  const occupied = (extra: Data = {}) => officeBooking({ date: "2026-10-01", endDate: "2027-05-26", ...extra })

  it("offers no future date while an ongoing reservation remains, without leaking records", async () => {
    store.seed("bookings/PRIVATE", occupied({ userInfo: { name: "Private Customer" } }))
    const response = await availability(search())
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const result = await response.json()
    expect(result.officeSearch).toEqual({ from: "2026-11-01", to: "2029-10-31", earliestAvailableStartDate: null })
    expect(result.dates["2026-11-25"].status).toBe("full")
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|Private Customer|userInfo/)
    const calendar = await availability(search({ from: "2027-05-01", to: "2027-05-31" }))
    const days = (await calendar.json()).dates
    expect(days["2027-05-26"].status).toBe("full")
    expect(days["2027-05-27"].status).toBe("full")
    expect((await create(post(officeInput({ date: "2027-05-26", officeRentalTerm: "6_months" })))).status).toBe(409)
    expect((await create(post(officeInput({ date: "2027-05-27", officeRentalTerm: "6_months" })))).status).toBe(409)
    store.seed("bookings/PRIVATE", occupied({ status: "completed" }))
    const saved = await create(post(officeInput({ date: "2027-05-27", officeRentalTerm: "6_months" })))
    expect(saved.status).toBe(201)
    expect((await saved.json()).booking).toMatchObject({ endDate: "2027-11-27", startTime: "", endTime: "", time: "" })
  })

  it.each(["6_months", "1_year", "2_years"])("checks later reservations and building/room maintenance through the complete %s term", async (rentalTerm) => {
    store.seed("bookings/COMPLETED", occupied({ status: "completed" }))
    store.seed("maintenanceRecords/BUILDING", maintenance({ scope: "building", spaceId: "east-fixed", date: "2028-03-01" }))
    store.seed("maintenanceRecords/ROOM", maintenance({ date: "2028-04-01", endDate: "2028-04-03" }))
    const response = await availability(search({ rentalTerm }))
    expect(response.status).toBe(200)
    expect((await response.json()).officeSearch.earliestAvailableStartDate).toBe(rentalTerm === "6_months" || rentalTerm === "1_year" ? "2026-11-25" : "2028-04-04")
    const rejected = await create(post(officeInput({ date: "2028-02-27", officeRentalTerm: rentalTerm })))
    expect(rejected.status).toBe(409)
  })

  it("recalculates by duration and stable parent/room IDs, and uses the Manila minimum", async () => {
    store.seed("maintenanceRecords/FUTURE", maintenance({ date: "2027-06-01", endDate: "2027-06-15" }))
    expect((await (await availability(search())).json()).officeSearch.earliestAvailableStartDate).toBe("2026-11-25")
    expect((await (await availability(search({ rentalTerm: "1_year" }))).json()).officeSearch.earliestAvailableStartDate).toBe("2027-06-16")
    for (const selection of [{ spaceId: "other-room" }, { officeId: "west-fixed", venueId: "west-fixed" }] as Record<string, string>[]) {
      const response = await availability(search({ ...selection, rentalTerm: "2_years" }))
      expect(response.status).toBe(200)
      expect((await response.json()).officeSearch.earliestAvailableStartDate).toBe("2026-11-25")
    }
  })

  it("respects unexpired pencil holds, projects abandoned expiry, and retains ledger-protected holds", async () => {
    const pencil = occupied({ status: "pending", isSlotSecured: false, verifiedByAdmin: false, amountPaid: 0,
      paymentStatus: "unpaid", createdAt: now })
    store.seed("bookings/PENCIL", pencil)
    expect((await (await availability(search())).json()).officeSearch.earliestAvailableStartDate).toBeNull()
    store.seed("bookings/PENCIL", { ...pencil, createdAt: "2026-10-23T00:00:00Z" })
    expect((await (await availability(search())).json()).officeSearch.earliestAvailableStartDate).toBe("2026-11-25")
    expect(store.data.get("bookings/PENCIL")?.status).toBe("pending")
    store.seed("payments/PROTECTED", { bookingId: "PENCIL", status: "For Verification", amount: 12000 })
    expect((await (await availability(search())).json()).officeSearch.earliestAvailableStartDate).toBeNull()
    store.seed("bookings/PENCIL", { ...pencil, status: "cancelled" })
    expect((await (await availability(search())).json()).officeSearch.earliestAvailableStartDate).toBe("2026-11-25")
  })

  it("returns a bounded empty result for an undated lease, permits a later search, and refreshes after release", async () => {
    store.seed("officeRentals/LEGACY", { officeId: "east-fixed", officeSpaceId: "shared-room", leaseStatus: "Active Lease" })
    expect((await (await availability(search())).json()).officeSearch.earliestAvailableStartDate).toBeNull()
    expect((await (await availability(search({ searchFrom: "2029-11-01", searchTo: "2032-10-31" }))).json()).officeSearch.earliestAvailableStartDate).toBeNull()
    store.seed("officeRentals/LEGACY", { officeId: "east-fixed", officeSpaceId: "shared-room", leaseStatus: "Expired" })
    expect((await (await availability(search())).json()).officeSearch.earliestAvailableStartDate).toBe("2026-11-25")
  })

  it.each<Record<string, string>>([
    { searchTo: "2035-01-01" }, { searchFrom: "2026-02-30" }, { searchTo: "" },
    { rentalTerm: "" }, { rentalTerm: "6_hours" }, { searchFrom: "2030-01-01" },
  ])("rejects invalid or unbounded searches: %j", async (params) => {
    expect((await availability(search(params))).status).toBe(400)
  })

  it("reports a read failure as an error without returning available dates", async () => {
    const spy = vi.spyOn(store, "collection").mockImplementation(() => { throw new Error("Local read failure") })
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const response = await availability(search())
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: "Unable to load space availability. Check your connection and retry.", requestId: response.headers.get("x-request-id") })
    } finally { spy.mockRestore(); log.mockRestore() }
  })
})

describe("office resource isolation through real routes", () => {
  it("allows an office despite the client's own event, another room, and the same room ID in another parent", async () => {
    store.seed("bookings/OWN-EVENT", eventBooking())
    store.seed("bookings/OTHER-ROOM", officeBooking({ spaceId: "other-room" }))
    store.seed("bookings/OTHER-PARENT", officeBooking({ venueId: "west-fixed", officeId: "west-fixed" }))
    const response = await availability(query({ rentalTerm: "2_years" }))
    expect(response.status).toBe(200)
    expect((await response.json()).dates[date].status).toBe("available")
    const created = await create(post(officeInput()))
    expect(created.status).toBe(201)
    const result = await created.json()
    expect(result.booking).toMatchObject({ venueId: "east-fixed", officeId: "east-fixed", spaceId: "shared-room",
      venue: "Saffron / Atrium - Quiet Corner", bookingCategory: "office", isOfficeRental: true, date, endDate,
      eventType: "Anything / Custom Business", officeRentalTerm: "2_years", status: "pending", totalPrice: 12000 })
    const { id: bookingId, ...persisted } = result.booking
    expect(bookingId).toBe(result.id)
    expect(store.data.get(`bookings/${result.id}`)).toEqual(persisted)
  })

  it("does not join same-named sibling rooms when their stable IDs differ", async () => {
    const sameNames = structuredClone(catalog)
    sameNames.offices[0].rooms[1].name = "Quiet Corner"
    store.seed("cms/data", sameNames)
    store.seed("bookings/SIBLING", officeBooking({ spaceId: "other-room", venue: "Saffron / Atrium - Quiet Corner", roomName: "Quiet Corner" }))
    const response = await availability(query({ rentalTerm: "2_years" }))
    expect(response.status).toBe(200)
    expect((await response.json()).dates[date].status).toBe("available")
    expect((await create(post(officeInput()))).status).toBe(201)
  })

  it.each(["Office Rental", "Unlisted / Independent Makers' Night", "Room 17 Appreciation Society"])(
    "allows custom venue event labels without changing resource category: %s", async (eventType) => {
      const response = await create(post(eventInput({ eventType })))
      expect(response.status).toBe(201)
      expect((await response.json()).booking).toMatchObject({ eventType, eventName: "Office Space Rental", venueId: "hall-fixed",
        spaceId: "hall-fixed", officeId: "", bookingCategory: "venue", isOfficeRental: false, startTime: "08:00", endTime: "14:00" })
    })

  it.each<Record<string, string>>([
    { spaceId: "Suite 17" }, { spaceId: "Room 1" }, { spaceId: "1" }, { spaceId: "east-fixed-room-1" },
    { spaceId: "shared-roo" }, { spaceId: "" }, { officeId: "west-fixed" },
    { venueId: "Old East Wing", officeId: "Old East Wing" },
  ])("rejects noncanonical office/room selections instead of guessing: %j", async (selection) => {
    const response = await create(post(officeInput(selection)))
    expect(response.status).toBe(400)
    expect((await availability(query(selection))).status).toBe(400)
    expect(store.data.get("cms/data")?.bookingCounter).toBe(0)
    expect([...store.data.keys()].filter((key) => key.startsWith("bookings/"))).toEqual([])
  })

  it("rejects duplicate room IDs within one parent rather than selecting its first room", async () => {
    const duplicate = structuredClone(catalog)
    duplicate.offices[0].rooms.push({ id: "shared-room", name: "Different Physical Room", legacyNames: [] })
    store.seed("cms/data", duplicate)
    expect((await availability(query())).status).toBe(400)
    expect((await create(post(officeInput()))).status).toBe(400)
    expect(store.data.get("cms/data")?.bookingCounter).toBe(0)
  })

  it("honors an exact historical alias without attaching it to the same-named room in another parent", async () => {
    store.seed("bookings/LEGACY", { bookingCategory: "office", venue: "Old East Wing - Suite 17", date, endDate, status: "pending" })
    const own = await availability(query())
    expect(own.status).toBe(200)
    expect((await own.json()).dates[date].status).toBe("full")
    const separate = await availability(query({ venueId: "west-fixed", officeId: "west-fixed" }))
    expect(separate.status).toBe(200)
    expect((await separate.json()).dates[date].status).toBe("available")
    expect((await create(post(officeInput()))).status).toBe(409)
    expect((await create(post(officeInput({ venueId: "west-fixed", officeId: "west-fixed" })))).status).toBe(201)
  })

  it("rejects an ambiguous active legacy room reference for either candidate, not for unrelated rooms", async () => {
    store.seed("bookings/AMBIGUOUS", { bookingCategory: "office", spaceId: "shared-room", date, endDate, status: "pending" })
    for (const venueId of ["east-fixed", "west-fixed"]) {
      const response = await availability(query({ venueId, officeId: venueId }))
      expect(response.status).toBe(409)
      expect((await response.json()).error).toMatch(/ambiguous/i)
      expect((await create(post(officeInput({ venueId, officeId: venueId })))).status).toBe(409)
    }
    expect((await create(post(officeInput({ spaceId: "other-room" })))).status).toBe(201)
  })
})

describe("complete office rental-term conflicts", () => {
  it("keeps a reservation exclusive before/after its planned dates despite stale aliases", async () => {
    store.seed("bookings/ALIASED", officeBooking({ date, startDate: oldDate }))
    const current = await availability(query())
    expect(current.status).toBe(200)
    expect((await current.json()).dates[date].status).toBe("full")
    const previous = await availability(query({ from: oldDate, to: oldDate }))
    expect(previous.status).toBe(200)
    expect((await previous.json()).dates[oldDate].status).toBe("full")
    expect((await create(post(officeInput({ date: oldDate, officeRentalTerm: "6_months" })))).status).toBe(409)
  })

  it.each(["officeRentalTerm", "rentalTerm", "contractTerm"])("retains a legacy office's whole stored %s when endDate is absent", async (field) => {
    store.seed("bookings/NO-END", officeBooking({ date: "2099-08-31", startDate: oldDate, endDate: undefined,
      officeRentalTerm: undefined, rentalTerm: undefined, contractTerm: undefined, [field]: "6_months" }))
    const last = await availability(query({ from: "2100-02-28", to: "2100-02-28" }))
    expect(last.status).toBe(200)
    expect((await last.json()).dates["2100-02-28"].status).toBe("full")
    expect((await create(post(officeInput({ date: "2100-02-28", officeRentalTerm: "6_months" })))).status).toBe(409)
    const after = await availability(query({ from: "2100-03-01", to: "2100-03-01" }))
    expect(after.status).toBe(200)
    expect((await after.json()).dates["2100-03-01"].status).toBe("full")
    expect((await create(post(officeInput({ date: "2100-03-01", officeRentalTerm: "6_months" })))).status).toBe(409)
  })

  it.each([
    ["booking date/endDate", "bookings/FUTURE", officeBooking({ date: "2101-02-28", endDate: "2101-04-01" }), "full"],
    ["date-only booking", "bookings/FUTURE", officeBooking({ date: "2101-02-28", endDate: "" }), "full"],
    ["legacy booking startDate", "bookings/FUTURE", officeBooking({ date: undefined, startDate: "2101-02-28" }), "full"],
    ["date-only maintenance", "maintenanceRecords/FUTURE", maintenance({ date: "2101-02-28" }), "maintenance"],
    ["legacy maintenance startDate", "maintenanceRecords/FUTURE", maintenance({ startDate: "2101-02-28", endDate: "2101-04-01" }), "maintenance"],
    ["legacy rental startDate", "officeRentals/FUTURE", { officeId: "east-fixed", officeSpaceId: "shared-room", startDate: "2101-02-28",
      endDate: "2101-04-01", leaseStatus: "Active Lease" }, "full"],
  ] as const)("checks %s near the end of two years, not just the visible start day", async (_name, path, record, status) => {
    store.seed(path, record)
    const startOnly = await availability(query())
    expect(startOnly.status).toBe(200)
    expect((await startOnly.json()).dates[date].status).toBe(status === "full" ? "full" : "available")
    const entireTerm = await availability(query({ rentalTerm: "2_years" }))
    expect(entireTerm.status).toBe(200)
    expect((await entireTerm.json()).dates[date].status).toBe(status)
    const response = await create(post(officeInput()))
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(status === "maintenance" ? /maintenance/i : /reserved/i)
    expect(store.data.get("cms/data")?.bookingCounter).toBe(0)
  })

  it.each([
    ["bookings", endDate, 409], ["bookings", "2101-03-02", 409],
    ["maintenanceRecords", endDate, 409], ["maintenanceRecords", "2101-03-02", 201],
  ] as const)("uses the inclusive persisted term end for %s on %s", async (collection, future, status) => {
    store.seed(`${collection}/BOUNDARY`, collection === "bookings"
      ? officeBooking({ date: future, endDate: future }) : maintenance({ date: future }))
    const response = await availability(query({ rentalTerm: "2_years" }))
    expect(response.status).toBe(200)
    expect((await response.json()).dates[date].status).toBe(status === 201 ? "available" : collection === "bookings" ? "full" : "maintenance")
    expect((await create(post(officeInput()))).status).toBe(status)
  })

  it("evaluates a full term independently for every proposed start in the visible range", async () => {
    store.seed("maintenanceRecords/LAST-DAY", maintenance({ date: "2101-03-03" }))
    const response = await availability(query({ to: "2099-03-03", rentalTerm: "2_years" }))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(Object.keys(result.dates)).toEqual([date, "2099-03-02", "2099-03-03"])
    expect(Object.values(result.dates).map((day) => (day as { status: string }).status)).toEqual(["available", "available", "maintenance"])
  })

  it.each(["6_months", "1_year", "2_years"])("derives the complete %s term rather than trusting a submitted endDate", async (rentalTerm) => {
    store.seed("maintenanceRecords/FUTURE", maintenance({ date: "2100-02-28", endDate: "2100-02-28" }))
    const visible = await availability(query({ rentalTerm }))
    expect(visible.status).toBe(200)
    expect((await visible.json()).dates[date].status).toBe(rentalTerm === "6_months" ? "available" : "maintenance")
    const response = await create(post(officeInput({ officeRentalTerm: "", rentalTerm, endDate: date })))
    expect(response.status).toBe(rentalTerm === "6_months" ? 201 : 409)
    if (rentalTerm === "6_months") expect((await response.json()).booking.endDate).toBe("2099-09-01")
  })

  it("limits future building maintenance to its own parent while blocking every room in that building", async () => {
    store.seed("maintenanceRecords/BUILDING", maintenance({ scope: "building", spaceId: "east-fixed", startDate: "2100-11-01" }))
    expect((await create(post(officeInput()))).status).toBe(409)
    expect((await create(post(officeInput({ spaceId: "other-room" })))).status).toBe(409)
    expect((await create(post(officeInput({ venueId: "west-fixed", officeId: "west-fixed" })))).status).toBe(201)
  })

  it.each(["cancelled", "canceled", "expired", "rental_expired", "completed", "declined"])(
    "releases a %s booking despite stale secured/payment/display flags", async (status) => {
      store.seed("bookings/TERMINAL", officeBooking({ status, bookingStatus: "Confirmed", cancellationRequested: true, hasActivePaymentSubmission: true }))
      const response = await availability(query({ rentalTerm: "2_years" }))
      expect(response.status).toBe(200)
      expect((await response.json()).dates[date].status).toBe("available")
      expect((await create(post(officeInput()))).status).toBe(201)
    })

  it.each(["Cancelled", "Expired", "Completed", "Declined", "Terminated", "rental_expired"])("releases a terminal legacy office rental: %s", async (leaseStatus) => {
    store.seed("officeRentals/TERMINAL", { officeId: "east-fixed", officeSpaceId: "shared-room", leaseStatus })
    const response = await availability(query({ rentalTerm: "2_years" }))
    expect(response.status).toBe(200)
    expect((await response.json()).dates[date].status).toBe("available")
    expect((await create(post(officeInput()))).status).toBe(201)
  })

  it.each([
    ["cancelled booking", "bookings/TERMINAL", { bookingCategory: "office", spaceId: "shared-room", date, endDate, status: "cancelled" }],
    ["expired booking", "bookings/TERMINAL", { bookingCategory: "office", spaceId: "shared-room", date, endDate, status: "expired" }],
    ["cancelled legacy rental", "officeRentals/TERMINAL", { officeSpaceId: "shared-room", date, endDate, leaseStatus: "Cancelled" }],
    ["expired legacy rental", "officeRentals/TERMINAL", { officeSpaceId: "shared-room", date, endDate, leaseStatus: "Expired" }],
  ] as const)("releases an ambiguous %s instead of retaining a terminal hold", async (_name, path, record) => {
    store.seed(path, record)
    const response = await availability(query({ rentalTerm: "2_years" }))
    expect(response.status).toBe(200)
    expect((await response.json()).dates[date].status).toBe("available")
    expect((await create(post(officeInput()))).status).toBe(201)
  })

  it.each([
    { status: "pending", bookingStatus: "Pending", isSlotSecured: false, paymentStatus: "unpaid", amountPaid: 0, hasActivePaymentSubmission: false },
    { status: "verifying", isSlotSecured: false, paymentStatus: "for_review", amountPaid: 0, hasActivePaymentSubmission: true },
    { status: "modification_under_review", modificationPreviousStatus: "reservation_secured" },
    { status: "cancellation_requested", previousStatus: "reservation_secured" },
  ])("keeps a legitimate active hold with lifecycle $status", async (fields) => {
    store.seed("bookings/HOLD", officeBooking(fields))
    const response = await availability(query({ rentalTerm: "2_years" }))
    expect(response.status).toBe(200)
    expect((await response.json()).dates[date].status).toBe("full")
    expect((await create(post(officeInput()))).status).toBe(409)
  })

  it.each(["Pending Review", "Active Lease"])("keeps an undated legacy %s rental as a hold on its exact room", async (leaseStatus) => {
    store.seed("officeRentals/HOLD", { officeId: "east-fixed", officeSpaceId: "shared-room", leaseStatus })
    expect((await create(post(officeInput()))).status).toBe(409)
    expect((await create(post(officeInput({ spaceId: "other-room" })))).status).toBe(201)
  })
})

describe("office schedule commits and modifications", () => {
  it.each([date, "2100-03-01", "2105-01-01"])("serializes same-room concurrent creations including nonoverlapping dates starting %s", async (secondDate) => {
    const otherCustomer = post(officeInput({ date: secondDate }))
    otherCustomer.headers.set("x-uid", "OTHER-CUSTOMER")
    const responses = await Promise.all([create(post(officeInput())), create(otherCustomer)])
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    expect(store.retries).toBeGreaterThan(0)
    expect([...store.data.keys()].filter((key) => key.startsWith("bookings/"))).toHaveLength(1)
    expect(store.data.get("cms/data")?.bookingCounter).toBe(1)
  })

  it("rejects a sequential duplicate while its new unpaid pending hold remains legitimate", async () => {
    expect((await create(post(officeInput()))).status).toBe(201)
    expect((await create(post(officeInput()))).status).toBe(409)
    expect(store.data.get("cms/data")?.bookingCounter).toBe(1)
  })

  it("permits concurrent same-name and same-room-ID creations in separate parents", async () => {
    const responses = await Promise.all([create(post(officeInput())), create(post(officeInput({ venueId: "west-fixed", officeId: "west-fixed" })))])
    expect(responses.map((response) => response.status)).toEqual([201, 201])
    expect(store.data.get("cms/data")?.bookingCounter).toBe(2)
  })

  it.each(["admin_update", "approve"])("serializes office %s versus overlapping creation with different start dates", async (action) => {
    store.seed("bookings/MOVING", officeBooking({ date: oldDate, endDate: "2098-09-01", officeRentalTerm: "6_months", rentalTerm: "6_months", contractTerm: "6_months" }))
    const changes = { date, officeRentalTerm: "2_years" }
    if (action === "approve") {
      expect((await modify(post({ action: "request", bookingId: "MOVING", changes, reason: "Move lease" }))).status).toBe(200)
    }
    const responses = await Promise.all([
      modify(post({ action, bookingId: "MOVING", changes, reason: "Move lease" }, "admin")),
      create(post(officeInput({ date: "2100-03-01" }))),
    ])
    const statuses = responses.map((response) => response.status).sort()
    expect(statuses).toContain(409)
    expect(statuses.filter((status) => status === 200 || status === 201)).toHaveLength(1)
    expect(responses.map((response) => response.status)).toEqual([200, 409])
    const occupying = [...store.data.entries()].filter(([key, record]) => key.startsWith("bookings/")
      && String(record.date) <= "2100-03-01" && String(record.endDate) >= "2100-03-01")
    expect(occupying).toHaveLength(1)
  })

  it.each([
    ["request", "date"], ["request", "startDate"],
    ["admin_update", "date"], ["admin_update", "startDate"],
    ["approve", "date"], ["approve", "startDate"],
  ])("rejects office %s when future %s maintenance intersects the changed two-year term", async (action, field) => {
    store.seed("bookings/MOVING", officeBooking({ date: oldDate, endDate: "2098-09-01" }))
    const changes = { date, officeRentalTerm: "2_years" }
    if (action === "approve") {
      expect((await modify(post({ action: "request", bookingId: "MOVING", changes, reason: "Move lease" }))).status).toBe(200)
    }
    store.seed("maintenanceRecords/NEW", maintenance({ [field]: "2101-02-28" }))
    const before = structuredClone(store.data)
    const response = await modify(post({ action, bookingId: "MOVING", changes, reason: "Move lease" }, action === "request" ? "client" : "admin"))
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/maintenance/i)
    expect(store.data).toEqual(before)
  })

  it("rechecks a stale office approval against a newly activated legacy lease", async () => {
    store.seed("bookings/MOVING", officeBooking({ date: oldDate, endDate: "2098-09-01" }))
    expect((await modify(post({ action: "request", bookingId: "MOVING", changes: { date }, reason: "Move" }))).status).toBe(200)
    store.seed("officeRentals/NEW-LEASE", { officeId: "east-fixed", officeSpaceId: "shared-room", leaseStatus: "Active Lease", startDate: "2105-01-01", endDate: "2106-01-01" })
    const before = structuredClone(store.data)
    expect((await modify(post({ action: "approve", bookingId: "MOVING" }, "admin"))).status).toBe(409)
    expect(store.data).toEqual(before)
  })

  it.each(["admin_update", "approve"])("persists the recomputed full office term on %s while excluding its own booking", async (action) => {
    store.seed("bookings/MOVING", officeBooking({ officeRentalTerm: "6_months", rentalTerm: "6_months", contractTerm: "6_months", endDate: "2099-09-01" }))
    const changes = { date: "2099-08-31", officeRentalTerm: "6_months" }
    if (action === "approve") {
      expect((await modify(post({ action: "request", bookingId: "MOVING", changes, reason: "New start" }))).status).toBe(200)
    }
    const response = await modify(post({ action, bookingId: "MOVING", changes, reason: "New start" }, "admin"))
    expect(response.status).toBe(200)
    expect(store.data.get("bookings/MOVING")).toMatchObject({ date: "2099-08-31", endDate: "2100-02-28",
      venueId: "east-fixed", officeId: "east-fixed", spaceId: "shared-room", bookingCategory: "office", isOfficeRental: true })
  })

  describe.each(["office", "venue"])("%s legacy date-alias rescheduling", (category) => {
    it.each(["admin_update", "approve"])("synchronizes existing startDate/endDate aliases on %s", async (action) => {
      const office = category === "office"
      store.seed("bookings/MOVING", office ? officeBooking({ date: oldDate, startDate: oldDate, endDate: "2098-09-01",
        officeRentalTerm: "6_months", rentalTerm: "6_months", contractTerm: "6_months" })
        : eventBooking({ date: oldDate, startDate: oldDate, endDate: oldDate }))
      const changes = { date: "2099-08-31" }
      if (action === "approve") {
        expect((await modify(post({ action: "request", bookingId: "MOVING", changes, reason: "Reschedule" }))).status).toBe(200)
        expect(store.data.get("bookings/MOVING")).toMatchObject({ date: oldDate, startDate: oldDate, endDate: office ? "2098-09-01" : oldDate })
      }
      expect((await modify(post({ action, bookingId: "MOVING", changes, reason: "Reschedule" }, "admin"))).status).toBe(200)
      expect(store.data.get("bookings/MOVING")).toMatchObject({ date: "2099-08-31", startDate: "2099-08-31", endDate: office ? "2100-02-28" : "2099-08-31" })
      const released = await availability(query({ category, venueId: office ? "east-fixed" : "hall-fixed",
        officeId: office ? "east-fixed" : "", spaceId: office ? "shared-room" : "", from: oldDate, to: oldDate }))
      expect(released.status).toBe(200)
      expect((await released.json()).dates[oldDate].status).toBe(office ? "full" : "available")
    })
  })

  it.each(["admin_update", "approve"])("keeps venue identity and schedule when %s changes only office-like event labels", async (action) => {
    const original = eventBooking({ eventName: "A Celebration", eventType: "Custom Celebration" })
    store.seed("bookings/EVENT", original)
    const changes = { eventName: "Office Rental - Room 1", eventType: "Unlisted / Office Space Rental" }
    if (action === "approve") {
      expect((await modify(post({ action: "request", bookingId: "EVENT", changes, reason: "Title only" }))).status).toBe(200)
    }
    const response = await modify(post({ action, bookingId: "EVENT", changes, reason: "Title only" }, "admin"))
    expect(response.status).toBe(200)
    expect(store.data.get("bookings/EVENT")).toMatchObject({ ...changes, venueId: "hall-fixed", spaceId: "hall-fixed", officeId: "",
      venue: original.venue, bookingCategory: "venue", bookingType: "venue", isOfficeRental: false, date, endDate: "",
      startTime: "08:00", endTime: "14:00", time: "08:00 - 14:00" })
    const responseAfter = await availability(query({ category: "venue", venueId: "hall-fixed", officeId: "", spaceId: "" }))
    expect(responseAfter.status).toBe(200)
    expect((await responseAfter.json()).dates[date].availableSlots.map((slot: { startMinutes: number }) => slot.startMinutes)).toEqual([900, 960])
  })

  it.each([
    ["ambiguous", { spaceId: "shared-room", venue: "", roomName: "" }],
    ["unresolved", { spaceId: "missing-room", venue: "Old East Wing - Suite 1" }],
  ] as const)("rejects modifications of an %s historical resource instead of guessing", async (status, reference) => {
    store.seed("bookings/LEGACY", { userId: "CLIENT", bookingCategory: "office", eventName: "Legacy", date, endDate,
      status: "reservation_secured", officeRentalTerm: "2_years", ...reference })
    const before = structuredClone(store.data)
    const response = await modify(post({ action: "admin_update", bookingId: "LEGACY", changes: { eventName: "New title" }, reason: "Title" }, "admin"))
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(new RegExp(status))
    expect(store.data).toEqual(before)
  })
})

describe.each([
  ["office parent", "isBookable", false], ["office parent", "isHidden", true], ["office parent", "isArchived", true],
  ["office room", "isBookable", false], ["office room", "isHidden", true], ["office room", "isArchived", true],
  ["venue", "isBookable", false], ["venue", "isHidden", true], ["venue", "isArchived", true],
] as const)("schedule modifications with %s %s=%s", (target, flag, value) => {
  it.each(["request", "admin_update", "approve"])("rejects %s against the current parent/room bookability", async (action) => {
    const office = target !== "venue"
    store.seed("bookings/MOVING", office ? officeBooking() : eventBooking())
    const changes = office && flag === "isHidden" ? { officeRentalTerm: "1_year" }
      : office ? { date: "2099-08-31" } : { startTime: "15:00", endTime: "21:00" }
    if (action === "approve") {
      expect((await modify(post({ action: "request", bookingId: "MOVING", changes, reason: "New schedule" }))).status).toBe(200)
    }
    const disabled = structuredClone(catalog)
    Object.assign(target === "office room" ? disabled.offices[0].rooms[0] : office ? disabled.offices[0] : disabled.venues[0], { [flag]: value })
    store.seed("cms/data", disabled)
    const before = structuredClone(store.data)
    const response = await modify(post({ action, bookingId: "MOVING", changes, reason: "New schedule" }, action === "request" ? "client" : "admin"))
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/bookable/i)
    expect(store.data).toEqual(before)
  })
})

describe.each([
  ["office parent", "isHidden", true], ["office room", "isBookable", false], ["venue", "isArchived", true],
] as const)("title-only modifications with disabled %s", (target, flag, value) => {
  it.each(["admin_update", "approve"])("allows %s without rewriting its historical schedule or date aliases", async (action) => {
    const office = target !== "venue"
    const original = office ? officeBooking({ startDate: oldDate, endDate: "2099-04-15" }) : eventBooking({ startDate: oldDate, endDate: date })
    store.seed("bookings/TITLE", original)
    const disabled = structuredClone(catalog)
    Object.assign(target === "office room" ? disabled.offices[0].rooms[0] : office ? disabled.offices[0] : disabled.venues[0], { [flag]: value })
    store.seed("cms/data", disabled)
    const changes = { eventName: "Office / Room Showcase" }
    if (action === "approve") {
      expect((await modify(post({ action: "request", bookingId: "TITLE", changes, reason: "Title only" }))).status).toBe(200)
    }
    expect((await modify(post({ action, bookingId: "TITLE", changes, reason: "Title only" }, "admin"))).status).toBe(200)
    expect(store.data.get("bookings/TITLE")).toMatchObject({ ...changes, date: original.date, startDate: oldDate, endDate: original.endDate,
      venueId: original.venueId, spaceId: original.spaceId, officeId: original.officeId, startTime: original.startTime,
      endTime: original.endTime, time: original.time })
  })
})

describe("sanitized availability and authorized exclusions", () => {
  it("returns exactly schedule primitives and sanitized occupied intervals, never customer or booking data", async () => {
    const secrets = ["PRIVATE-BOOKING-ID", "PRIVATE-USER-ID", "Private Customer Name", "private@example.test", "PRIVATE-PHONE",
      "PRIVATE-EVENT-TITLE", "PRIVATE-NOTES", "PRIVATE-PROOF", "PRIVATE-REFERENCE", "PRIVATE-BOOKING-CODE"]
    store.seed(`bookings/${secrets[0]}`, eventBooking({ userId: secrets[1], uid: secrets[1],
      userInfo: { name: secrets[2], email: secrets[3], phone: secrets[4] }, eventName: secrets[5], specialRequests: secrets[6],
      adminLogs: [{ message: secrets[6] }], proofUrl: secrets[7], referenceNumber: secrets[8], bookingCode: secrets[9] }))
    const response = await availability(query({ category: "venue", venueId: "hall-fixed", officeId: "", spaceId: "" }))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const result = await response.json()
    expect(Object.keys(result).sort()).toEqual(["dates", "schedule", "space"])
    expect(result.space).toEqual({ category: "venue", venueId: "hall-fixed", spaceId: "hall-fixed" })
    expect(result.schedule).toEqual({ openingMinutes: 480, closingMinutes: 1320, bookingDurationMinutes: 360, slotIntervalMinutes: 60 })
    expect(Object.keys(result.dates)).toEqual([date])
    expect(Object.keys(result.dates[date]).sort()).toEqual(["availableSlots", "occupiedIntervals", "status"])
    expect(result.dates[date].status).toBe("few")
    expect(result.dates[date].occupiedIntervals).toEqual([{ startMinutes: 480, endMinutes: 840, startTimeLabel: "8:00 AM", endTimeLabel: "2:00 PM" }])
    expect(result.dates[date].availableSlots).toEqual([
      { startMinutes: 900, endMinutes: 1260, startTimeLabel: "3:00 PM", endTimeLabel: "9:00 PM", label: "3:00 PM - 9:00 PM" },
      { startMinutes: 960, endMinutes: 1320, startTimeLabel: "4:00 PM", endTimeLabel: "10:00 PM", label: "4:00 PM - 10:00 PM" },
    ])
    for (const secret of secrets) expect(JSON.stringify(result)).not.toContain(secret)
  })

  it("returns only exact office identity and day keys, with no catalog or rental documents", async () => {
    store.seed("bookings/PRIVATE", officeBooking({ userId: "OTHER", userInfo: { email: "private@example.test" } }))
    const response = await availability(query({ rentalTerm: "2_years" }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ space: { category: "office", venueId: "east-fixed", officeId: "east-fixed", spaceId: "shared-room" },
      dates: { [date]: { status: "full", availableSlots: [], occupiedIntervals: [] } } })
  })

  it("lets an owning client exclude only their own booking, not somebody else's or a missing booking", async () => {
    store.seed("bookings/OWN", officeBooking())
    store.seed("bookings/FOREIGN", officeBooking({ userId: "OTHER", spaceId: "other-room" }))
    const own = await availability(query({ excludeBookingId: "OWN", rentalTerm: "2_years" }))
    expect(own.status).toBe(200)
    expect((await own.json()).dates[date].status).toBe("available")
    expect((await availability(query({ excludeBookingId: "FOREIGN" }))).status).toBe(403)
    expect((await availability(query({ excludeBookingId: "MISSING" }))).status).toBe(403)
    const notExcluded = await availability(query())
    expect((await notExcluded.json()).dates[date].status).toBe("full")
  })

  it("does not hide another overlapping hold when an owned booking is excluded", async () => {
    store.seed("bookings/OWN", officeBooking())
    store.seed("bookings/OTHER-HOLD", officeBooking({ userId: "OTHER", date: "2101-02-28" }))
    const response = await availability(query({ excludeBookingId: "OWN", rentalTerm: "2_years" }))
    expect(response.status).toBe(200)
    expect((await response.json()).dates[date].status).toBe("full")
  })

  it.each([
    ["admin", "false", 200], ["staff", "true", 200], ["staff", "false", 403],
  ] as const)("checks booking permissions for a foreign exclusion by %s with permission=%s", async (role, permission, status) => {
    store.seed("bookings/FOREIGN", officeBooking({ userId: "OTHER" }))
    const response = await availability(query({ excludeBookingId: "FOREIGN" }, { "x-role": role, "x-bookings-permission": permission }))
    expect(response.status).toBe(status)
    if (status === 200) expect((await response.json()).dates[date].status).toBe("available")
  })
})
