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
  const user = async (request: Request) => ({ uid: "CLIENT", role: request.headers.get("x-role") || "client",
    fullName: "Fixture Client", email: "client@example.test", permissions: { bookings: true, payments: true } })
  return { ApiAuthError, isApiAuthError: (error: unknown) => error instanceof ApiAuthError, requireAuthenticatedUser: user,
    requireBackofficeUser: async (request: Request) => {
      const authenticated = await user(request)
      if (authenticated.role !== "admin") throw new ApiAuthError(403, "Admin fixture required.")
      return authenticated
    } }
})

import { POST as create } from "@/app/api/bookings/route"
import { GET as availability } from "@/app/api/availability/route"
import { POST as maintain } from "@/app/api/maintenance/route"
import { POST as modify } from "@/app/api/bookings/modification/route"
import { POST as submit } from "@/app/api/payments/submit/route"
import { POST as onsite } from "@/app/api/payments/onsite/route"
import { POST as lifecycle } from "@/app/api/bookings/lifecycle/route"
import { POST as review } from "@/app/api/payments/review/route"
import { canAutomaticallyExpireBooking } from "../booking-lifecycle"

type Data = Record<string, unknown>
const now = "2026-10-25T04:00:00.000Z"
const abandonedAt = "2026-10-23T04:00:00.000Z"
const date = "2099-03-01"
const endDate = "2099-09-01"
const catalog = { bookingCounter: 0,
  venues: [{ id: "hall-fixed", name: "Office / Ceremony Lab", price: 10000, capacity: "100" }],
  offices: [
    { id: "east-fixed", name: "Saffron / Atrium", price: 10000, rooms: [{ id: "shared-room", name: "Quiet Corner" }, { id: "other-room", name: "Window Seat" }] },
    { id: "west-fixed", name: "Juniper & Slate", price: 10000, rooms: [{ id: "shared-room", name: "Quiet Corner" }] },
  ] }
const post = (body: object, role = "client") => new NextRequest("http://localhost/api/fixture", {
  method: "POST", headers: { "content-type": "application/json", "x-role": role }, body: JSON.stringify(body),
})
const input = (extra: Data = {}) => ({ venueId: "east-fixed", officeId: "east-fixed", spaceId: "shared-room",
  bookingCategory: "office", isOfficeRental: true, eventName: "Collective", eventType: "Custom / Business", date, officeRentalTerm: "6_months", ...extra })
const hold = (extra: Data = {}) => ({ ...input(), userId: "CLIENT", uid: "CLIENT", bookingCode: "LEGACY-CODE", venue: "Old Display Snapshot",
  endDate, time: "", startTime: "", endTime: "", guestCount: 1, rentalTerm: "6_months", contractTerm: "6_months", specialRequests: "Original note",
  status: "pending", bookingStatus: "Pending", paymentStatus: "unpaid", paymentType: "slot_reservation", totalPrice: 10000,
  selectedDownpaymentAmount: 10000, amountPaid: 0, downpaymentPaid: 0, isSlotSecured: false, verifiedByAdmin: false,
  contractSigned: false, cancellationRequested: false, modificationRequested: false, hasActivePaymentSubmission: false,
  createdAt: abandonedAt, adminLogs: [] as Data[], ...extra })
const eventInput = () => ({ venueId: "hall-fixed", date, eventName: "Office Rental Showcase", eventType: "Custom / Event",
  guestCount: 10, startTime: "08:00", endTime: "14:00" })
const eventHold = (extra: Data = {}) => hold({ ...eventInput(), officeId: "", spaceId: "hall-fixed", bookingCategory: "venue", isOfficeRental: false,
  endDate: "", officeRentalTerm: "", rentalTerm: "", contractTerm: "", time: "08:00 - 14:00", paymentType: "downpayment", selectedDownpaymentAmount: 5000, ...extra })
const maintenanceInput = (extra: Data = {}) => ({ type: "office", scope: "room", officeId: "east-fixed", spaceId: "shared-room", date, ...extra })
const query = (extra: Record<string, string> = {}) => new NextRequest(`http://localhost/api/availability?${new URLSearchParams({
  category: "office", venueId: "east-fixed", officeId: "east-fixed", spaceId: "shared-room", from: date, to: date, rentalTerm: "6_months", ...extra,
})}`)

let store: TransactionStore
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(now))
  store = new TransactionStore()
  boundary.firestore = store
  store.seed("cms/data", catalog)
})
afterEach(() => vi.useRealTimers())

function expectExpired(id = "HOLD") {
  const booking = store.data.get(`bookings/${id}`)!
  expect(booking).toMatchObject({ status: "cancelled", bookingStatus: "Cancelled", paymentStatus: "cancelled",
    cancellationSource: "system", cancellationType: "automatic_expiry", cancellationStatus: "Automatic Expiry",
    cancellationActorId: "system", cancellationActorName: "System", adminCancelDecision: "automatic_expiry",
    cancellationReason: "Payment window expired", cancelledAt: now, updatedAt: now, lastActivityAt: now,
    createdAt: abandonedAt, specialRequests: "Original note" })
  expect((booking.adminLogs as Data[]).filter((log) => log.action === "AUTO_EXPIRE_BOOKING")).toEqual([
    { action: "AUTO_EXPIRE_BOOKING", message: "Booking was automatically cancelled after the 24-hour payment window expired.", createdAt: now },
  ])
}

describe("server-driven abandoned hold expiry", () => {
  it("uses the canonical exact 24-hour boundary and does not expire invalid or fresh timestamps", async () => {
    const boundaryTime = "2026-10-24T04:00:00.000Z"
    expect(canAutomaticallyExpireBooking(hold({ createdAt: boundaryTime }), [], Date.parse(now) - 1)).toBe(false)
    expect(canAutomaticallyExpireBooking(hold({ createdAt: boundaryTime }), [], Date.parse(now))).toBe(true)
    for (const createdAt of [now, undefined, "not-a-date"]) {
      store.seed("bookings/HOLD", hold({ createdAt }))
      const response = await availability(query())
      expect(response.status).toBe(200)
      expect((await response.json()).dates[date].status).toBe("full")
    }
  })

  it.each(["office", "venue"])("projects an abandoned %s hold as available through read-only GET", async (category) => {
    store.seed("bookings/HOLD", category === "office" ? hold() : eventHold())
    const before = structuredClone(store.data)
    const versions = new Map(store.versions)
    const response = await availability(query(category === "office" ? {} : { category, venueId: "hall-fixed", officeId: "", spaceId: "", rentalTerm: "" }))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.dates[date].status).toBe("available")
    expect(result.dates[date].occupiedIntervals).toEqual([])
    expect(result.dates[date].availableSlots).toHaveLength(category === "office" ? 0 : 9)
    expect(store.data).toEqual(before)
    expect(store.versions).toEqual(versions)
    expect(store.notification).toBe(0)
  })

  it.each(["office", "venue"])("atomically expires an abandoned %s hold when creating its replacement", async (category) => {
    const logs = Array.from({ length: 55 }, (_, index) => ({ action: `OLD_${index}`, createdAt: abandonedAt }))
    store.seed("bookings/HOLD", category === "office" ? hold({ adminLogs: logs }) : eventHold({ adminLogs: logs }))
    const response = await create(post(category === "office" ? input() : eventInput()))
    expect(response.status).toBe(201)
    expectExpired()
    const expired = store.data.get("bookings/HOLD")!
    expect(expired.adminLogs).toHaveLength(50)
    expect((expired.adminLogs as Data[])[0].action).toBe("OLD_6")
    const result = await response.json()
    expect(store.data.get(`bookings/${result.id}`)).toMatchObject({ status: "pending", createdAt: now })
    expect((await create(post(category === "office" ? input() : eventInput()))).status).toBe(409)
    expectExpired()
  })

  it("finishes every hold's ledger reads before committing any automatic expiry", async () => {
    for (const id of ["FIRST", "SECOND"]) {
      store.seed(`bookings/${id}`, hold({ bookingCode: `CODE-${id}` }))
      store.seed(`payments/REJECTED-${id}`, { bookingCode: `CODE-${id}`, status: "Rejected", verificationStatus: "Rejected", amount: 10000 })
    }
    expect((await create(post(input()))).status).toBe(201)
    expectExpired("FIRST")
    expectExpired("SECOND")
  })

  it("commits automatic expiry and maintenance together after all reads", async () => {
    store.seed("bookings/HOLD", hold())
    const response = await maintain(post({ records: [maintenanceInput()] }, "admin"))
    expect(response.status).toBe(201)
    expectExpired()
    const result = await response.json()
    expect(store.data.get(`maintenanceRecords/${result.records[0].id}`)).toMatchObject({ status: "active", date, spaceId: "shared-room" })
  })

  it.each(["approve", "admin_update"])("defers expiry until a successful modification %s commit", async (action) => {
    store.seed("bookings/HOLD", hold())
    store.seed("bookings/MOVING", hold({ date: "2098-03-01", endDate: "2098-09-01", status: "reservation_secured", isSlotSecured: true }))
    const changes = { date }
    if (action === "approve") {
      expect((await modify(post({ action: "request", bookingId: "MOVING", changes, reason: "Move" }))).status).toBe(200)
      expect(store.data.get("bookings/HOLD")).toEqual(hold())
    }
    expect((await modify(post({ action, bookingId: "MOVING", changes, reason: "Move" }, "admin"))).status).toBe(200)
    expectExpired()
    expect(store.data.get("bookings/MOVING")).toMatchObject({ date, endDate, status: "reservation_secured" })
  })

  it.each(["create", "maintenance", "approve"])("does not commit projected expiry when %s later rejects a conflict", async (writer) => {
    store.seed("bookings/HOLD", hold())
    if (writer === "approve") {
      store.seed("bookings/MOVING", hold({ date: "2098-03-01", endDate: "2098-09-01", status: "reservation_secured", isSlotSecured: true }))
      expect((await modify(post({ action: "request", bookingId: "MOVING", changes: { date }, reason: "Move" }))).status).toBe(200)
    }
    if (writer === "maintenance") {
      store.seed("bookings/SECURED", hold({ spaceId: "other-room", status: "reservation_secured", isSlotSecured: true }))
    } else {
      store.seed("maintenanceRecords/BLOCK", { ...maintenanceInput(), status: "active" })
    }
    const before = structuredClone(store.data)
    const versions = new Map(store.versions)
    const response = writer === "create" ? await create(post(input()))
      : writer === "maintenance" ? await maintain(post({ records: [maintenanceInput(), maintenanceInput({ spaceId: "other-room" })] }, "admin"))
        : await modify(post({ action: "approve", bookingId: "MOVING" }, "admin"))
    expect(response.status).toBe(409)
    expect(store.data).toEqual(before)
    expect(store.versions).toEqual(versions)
  })

  it.each(["create", "maintenance", "approve"])("scopes %s expiry to the resource, including all-date office exclusivity for allocations", async (writer) => {
    store.seed("bookings/HOLD", hold())
    const unrelated = {
      EVENT: eventHold(),
      ROOM: hold({ spaceId: "other-room" }),
      PARENT: hold({ venueId: "west-fixed", officeId: "west-fixed" }),
      EARLIER: hold({ date: "2097-03-01", endDate: "2097-09-01" }),
    }
    for (const [id, booking] of Object.entries(unrelated)) store.seed(`bookings/${id}`, booking)
    if (writer === "approve") {
      store.seed("bookings/MOVING", hold({ date: "2098-03-01", endDate: "2098-09-01", status: "reservation_secured", isSlotSecured: true }))
      expect((await modify(post({ action: "request", bookingId: "MOVING", changes: { date }, reason: "Move" }))).status).toBe(200)
    }
    const response = writer === "create" ? await create(post(input()))
      : writer === "maintenance" ? await maintain(post({ records: [maintenanceInput()] }, "admin"))
        : await modify(post({ action: "approve", bookingId: "MOVING" }, "admin"))
    expect(response.status).toBe(writer === "approve" ? 200 : 201)
    expectExpired()
    for (const [id, booking] of Object.entries(unrelated)) {
      if (id === "EARLIER") expect(store.data.get(`bookings/${id}`)).toMatchObject({ status: "cancelled", cancellationType: "automatic_expiry" })
      else expect(store.data.get(`bookings/${id}`)).toEqual(booking)
    }
  })
})

describe("payment and secured-hold expiry protection", () => {
  it.each([
    { isSlotSecured: true }, { verifiedByAdmin: true }, { contractSigned: true }, { cancellationRequested: true },
    { modificationRequested: true }, { hasActivePaymentSubmission: true }, { paymentStatus: "for_review" },
    { amountPaid: 1000 }, { downpaymentPaid: 1000 },
  ])("retains a pending hold protected by canonical metadata: %j", async (fields) => {
    const booking = hold(fields)
    expect(canAutomaticallyExpireBooking(booking, [])).toBe(false)
    store.seed("bookings/HOLD", booking)
    const before = structuredClone(store.data)
    const response = await availability(query())
    expect(response.status).toBe(200)
    expect((await response.json()).dates[date].status).toBe("full")
    expect((await create(post(input()))).status).toBe(409)
    expect(store.data).toEqual(before)
  })

  describe.each([
    { bookingId: "HOLD" }, { bookingCode: "HOLD" }, { bookingId: "LEGACY-CODE" }, { bookingCode: "LEGACY-CODE" },
  ])("ledger join %j", (join) => {
    it.each(["For Verification", "Verified", "Incomplete"])("keeps an old pending hold with %s ledger activity despite stale unpaid aggregates", async (status) => {
      store.seed("bookings/HOLD", hold())
      store.seed("payments/PAYMENT", { ...join, status, amount: 1000, amountReceived: status === "Incomplete" ? 250 : 0, term: "Slot Reservation" })
      const before = structuredClone(store.data)
      const response = await availability(query())
      expect(response.status).toBe(200)
      expect((await response.json()).dates[date].status).toBe("full")
      expect((await create(post(input()))).status).toBe(409)
      expect(store.data).toEqual(before)
    })
  })

  it("does not release a pending hold that has a finalized zero-value verification record", async () => {
    store.seed("bookings/HOLD", hold())
    store.seed("payments/VERIFIED", { bookingCode: "LEGACY-CODE", status: "Verified", amount: 0 })
    expect((await create(post(input()))).status).toBe(409)
    expect(store.data.get("bookings/HOLD")).toEqual(hold())
  })

  it("does not treat another booking's payment or a receipt projection as the hold's ledger", async () => {
    store.seed("bookings/HOLD", hold({ receipt: { paymentStatus: "Verified", amountPaid: 10000 } }))
    store.seed("payments/UNRELATED", { bookingId: "SOMEONE-ELSE", bookingCode: "OTHER-CODE", customerId: "CLIENT", status: "Verified", amount: 10000 })
    expect((await create(post(input()))).status).toBe(201)
    expectExpired()
  })

  it("allows review of an existing protected payment after 24 hours without releasing its reservation", async () => {
    store.seed("bookings/HOLD", hold())
    store.seed("payments/PENDING", { bookingCode: "LEGACY-CODE", status: "For Verification", amount: 10000, term: "Slot Reservation" })
    const response = await review(post({ bookingId: "HOLD", paymentRecordId: "PENDING", action: "verify", verifiedAmount: 10000 }, "admin"))
    expect(response.status).toBe(200)
    expect(store.data.get("bookings/HOLD")).toMatchObject({ status: "reservation_secured", isSlotSecured: true })
    expect((await create(post(input()))).status).toBe(409)
    expect((store.data.get("bookings/HOLD")?.adminLogs as Data[]).some((log) => log.action === "AUTO_EXPIRE_BOOKING")).toBe(false)
  })
})

describe("released hold mutation guards", () => {
  it.each(["submit", "onsite", "request", "admin_update"])("rejects %s on an expired abandoned hold even before expiry is persisted", async (action) => {
    store.seed("bookings/HOLD", hold())
    const before = structuredClone(store.data)
    const response = action === "submit" ? await submit(post({ bookingId: "HOLD", method: "cash", type: "slot_reservation", amount: 10000 }))
      : action === "onsite" ? await onsite(post({ bookingId: "HOLD", paymentType: "full_payment", amountReceived: 10000 }, "admin"))
        : await modify(post({ action, bookingId: "HOLD", changes: { eventName: "Attempted resurrection" }, reason: "Edit" }, action === "request" ? "client" : "admin"))
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/expired|released/i)
    expect(store.data).toEqual(before)
  })

  describe.each(["cancelled", "expired", "rental_expired"])("terminal lifecycle %s", (status) => {
    it.each(["status", "contract_signed", "verify", "incomplete"])("cannot reactivate a released reservation via %s", async (action) => {
      store.seed("bookings/HOLD", hold({ status, isSlotSecured: true, verifiedByAdmin: true, amountPaid: 10000 }))
      store.seed("payments/HISTORICAL", { bookingId: "HOLD", status: "Verified", amount: 10000, term: "Slot Reservation" })
      store.seed("payments/PENDING", { bookingId: "HOLD", status: "For Verification", amount: 10000, term: "Slot Reservation" })
      const before = structuredClone(store.data)
      const response = action === "status" || action === "contract_signed"
        ? await lifecycle(post({ action, bookingId: "HOLD", status: "reservation_secured" }, "admin"))
        : await review(post({ action, bookingId: "HOLD", paymentRecordId: "PENDING", verifiedAmount: action === "incomplete" ? 5000 : 10000,
          adminNote: "Must not reactivate" }, "admin"))
      expect(response.status).toBe(409)
      expect((await response.json()).error).toMatch(/released/i)
      expect(store.data).toEqual(before)
    })
  })

  it("keeps an already-verified payment retry idempotent after the reservation has been released", async () => {
    store.seed("bookings/HOLD", hold({ status: "cancelled" }))
    store.seed("payments/VERIFIED", { bookingId: "HOLD", status: "Verified", amount: 10000, term: "Slot Reservation", adminNote: "Original review" })
    const before = structuredClone(store.data)
    const response = await review(post({ action: "verify", bookingId: "HOLD", paymentRecordId: "VERIFIED", adminNote: "Later note" }, "admin"))
    expect(response.status).toBe(200)
    expect((await response.json()).alreadyVerified).toBe(true)
    expect(store.data).toEqual(before)
  })
})

describe("pending payment versus replacement creation", () => {
  it.each(["payment", "replacement"])("retries the losing transaction when %s commits first across the expiry boundary", async (winner) => {
    const createdAt = "2026-10-24T04:00:00.000Z"
    store.seed("bookings/HOLD", hold({ createdAt }))
    const paymentReady = Promise.withResolvers<void>()
    const replacementReady = Promise.withResolvers<void>()
    const allowPayment = Promise.withResolvers<void>()
    const allowReplacement = Promise.withResolvers<void>()
    const runTransaction = store.runTransaction.bind(store)
    let pausePayment = true
    let pauseReplacement = true
    // Pause after real route validation, with fixture writes still buffered. Both
    // transactions must see the unpaid booking before either writer commits.
    store.runTransaction = async (callback) => runTransaction(async (transaction) => {
      const result = await callback(transaction)
      if (result && typeof result === "object" && "payment" in result) {
        if (pausePayment) {
          pausePayment = false
          paymentReady.resolve()
          await allowPayment.promise
        }
      } else if (pauseReplacement) {
        pauseReplacement = false
        replacementReady.resolve()
        await allowReplacement.promise
      }
      return result
    })
    vi.setSystemTime(new Date(Date.parse(now) - 1))
    const paying = submit(post({ bookingId: "HOLD", method: "cash", type: "slot_reservation", amount: 10000 }))
    await paymentReady.promise
    vi.setSystemTime(new Date(now))
    const replacing = create(post(input()))
    await replacementReady.promise
    let paymentResponse: Response
    let replacementResponse: Response
    if (winner === "payment") {
      allowPayment.resolve()
      paymentResponse = await paying
      allowReplacement.resolve()
      replacementResponse = await replacing
    } else {
      allowReplacement.resolve()
      replacementResponse = await replacing
      allowPayment.resolve()
      paymentResponse = await paying
    }
    expect([paymentResponse.status, replacementResponse.status]).toEqual(winner === "payment" ? [201, 409] : [409, 201])
    expect(store.retries).toBeGreaterThan(0)
    const payments = [...store.data.keys()].filter((key) => key.startsWith("payments/"))
    const receipts = [...store.data.keys()].filter((key) => key.startsWith("receipts/"))
    expect(payments).toHaveLength(winner === "payment" ? 1 : 0)
    expect(receipts).toHaveLength(winner === "payment" ? 1 : 0)
    expect(store.data.get("cms/data")?.bookingCounter).toBe(winner === "payment" ? 0 : 1)
    if (winner === "payment") {
      expect(store.data.get("bookings/HOLD")).toMatchObject({ status: "pending", hasActivePaymentSubmission: true })
      expect(store.data.get("bookings/HOLD")?.cancellationType).toBeUndefined()
    } else {
      expect(store.data.get("bookings/HOLD")).toMatchObject({ status: "cancelled", cancellationType: "automatic_expiry", createdAt, cancelledAt: now })
    }
  })
})
