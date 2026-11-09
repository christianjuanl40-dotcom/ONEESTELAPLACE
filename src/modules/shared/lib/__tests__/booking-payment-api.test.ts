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
  const user = async (request: Request) => {
    const role = request.headers.get("x-role") || "client"
    const permissions: Record<string, boolean> = role === "staff" ? { bookings: true } : {}
    return { uid: "CLIENT", role, fullName: "Fixture", email: "fixture@example.test", permissions }
  }
  const backoffice = async (request: Request, options: { permission?: string; adminOnly?: boolean } = {}) => {
    const current = await user(request)
    if (current.role !== "admin" && current.role !== "staff") throw new ApiAuthError(403, "This account is not authorized.")
    if (options.adminOnly && current.role !== "admin") throw new ApiAuthError(403, "Administrator access is required.")
    if (options.permission && current.role !== "admin" && current.permissions[options.permission] !== true) {
      throw new ApiAuthError(403, "You do not have permission to perform this action.")
    }
    return current
  }
  return { ApiAuthError, isApiAuthError: (error: unknown) => error instanceof ApiAuthError,
    requireAuthenticatedUser: user, requireBackofficeUser: backoffice }
})

import { POST as create } from "@/app/api/bookings/route"
import { POST as modify } from "@/app/api/bookings/modification/route"
import { PATCH as cancel } from "@/app/api/bookings/cancellation/route"
import { POST as review } from "@/app/api/payments/review/route"
import { POST as onsite } from "@/app/api/payments/onsite/route"
import { POST as submit } from "@/app/api/payments/submit/route"
import { POST as lifecycle } from "@/app/api/bookings/lifecycle/route"
import { POST as refund } from "@/app/api/bookings/refund/route"
import { GET as availability } from "@/app/api/availability/route"

const date = "2099-03-01"
const post = (body: object, role = "client") => new NextRequest("http://localhost/api/fixture", {
  method: "POST", headers: { "content-type": "application/json", "x-role": role }, body: JSON.stringify(body),
})
const input = (startTime: string, endTime: string, extra = {}) => ({
  venueId: "V1", date, eventName: "Fixture", eventType: "Celebration", guestCount: 10, startTime, endTime, ...extra,
})
const existing = (extra = {}) => ({
  ...input("08:00", "14:00"), userId: "CLIENT", venue: "Venue One", spaceId: "V1", officeId: "",
  time: "08:00 - 14:00", endDate: "", status: "confirmed", bookingStatus: "Confirmed", bookingCategory: "venue",
  totalPrice: 10000, paymentType: "downpayment", selectedDownpaymentAmount: 5000, specialRequests: "", ...extra,
})

let store: TransactionStore
beforeEach(() => {
  store = new TransactionStore()
  boundary.firestore = store
  store.seed("cms/data", { bookingCounter: 0, venues: [
    { id: "V1", name: "Venue One", price: 10000, capacity: "100" },
    { id: "V2", name: "Venue Two", price: 10000, capacity: "100" },
  ] })
})
afterEach(() => vi.unstubAllEnvs())

describe("server event scheduling commits", () => {
  it.each([
    [{ catalogStatus: "under_renovation" }, "canonical catalog status"],
    [{ isHidden: true }, "legacy hidden catalog status"],
  ])("rejects a stale new booking for a %s", async (statusFields, _label) => {
    const cms = structuredClone(store.data.get("cms/data")) as any
    Object.assign(cms.venues[0], statusFields)
    store.seed("cms/data", cms)
    const response = await create(post(input("08:00", "14:00")))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/no longer available/i)
  })

  it("returns buffered calendar/dropdown slots through the actual availability endpoint", async () => {
    store.seed("bookings/MORNING", existing())
    const response = await availability(new NextRequest(`http://localhost/api/availability?category=venue&venueId=V1&from=${date}&to=${date}`))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.dates[date].availableSlots.map((slot: { startTimeLabel: string }) => slot.startTimeLabel)).toEqual(["3:00 PM", "4:00 PM"])
    const own = await availability(new NextRequest(`http://localhost/api/availability?category=venue&venueId=V1&from=${date}&to=${date}&excludeBookingId=MORNING`))
    expect((await own.json()).dates[date].availableSlots).toHaveLength(9)
  })

  it.each([["14:00", "20:00", 409], ["15:00", "21:00", 201], ["16:00", "22:00", 201]])(
    "checks stale creation %s–%s against persisted bookings", async (start, end, status) => {
      store.seed("bookings/EXISTING", existing())
      expect((await create(post(input(start, end)))).status).toBe(status)
    })

  it("checks reverse order, separate venues, and exact duration", async () => {
    store.seed("bookings/LATER", existing({ startTime: "15:00", endTime: "21:00" }))
    expect((await create(post(input("08:00", "14:00")))).status).toBe(201)
    expect((await create(post(input("08:00", "14:00", { venueId: "V2" })))).status).toBe(201)
    expect((await create(post(input("08:00", "15:00", { venueId: "V2" })))).status).toBe(400)
  })

  it("rejects a stale approval when another booking took the requested interval", async () => {
    store.seed("bookings/MOVING", existing({ date: "2099-02-01" }))
    expect((await modify(post({ action: "request", bookingId: "MOVING", changes: { date }, reason: "New date" }))).status).toBe(200)
    store.seed("bookings/NEW", existing())
    expect((await modify(post({ action: "approve", bookingId: "MOVING" }, "admin"))).status).toBe(409)
    expect(store.data.get("bookings/MOVING")?.date).toBe("2099-02-01")
  })

  it("excludes its own booking and validates time-range-only admin updates", async () => {
    store.seed("bookings/MOVING", existing())
    expect((await modify(post({ action: "admin_update", bookingId: "MOVING", changes: { eventName: "Updated" }, reason: "Edit" }, "admin"))).status).toBe(200)
    expect(store.data.get("bookings/MOVING")).toMatchObject({ modifiedBy: "CLIENT", modifiedByName: "Fixture" })
    const movingLogs = store.data.get("bookings/MOVING")?.adminLogs as Array<Record<string, unknown>> | undefined
    expect(movingLogs?.at(-1)).toMatchObject({
      action: "ADMIN_UPDATE_BOOKING",
      actorId: "CLIENT",
      previousValues: { eventName: "Fixture" },
      updatedValues: { eventName: "Updated" },
    })
    expect([...store.data.keys()].filter((key) => key.startsWith("notifications/")).map((key) => store.data.get(key)?.type)).toEqual(["booking_updated"])
    expect((await modify(post({ action: "admin_update", bookingId: "MOVING", changes: { eventName: "Updated" }, reason: "Repeat" }, "admin"))).status).toBe(200)
    expect([...store.data.keys()].filter((key) => key.startsWith("notifications/")).map((key) => store.data.get(key)?.type)).toEqual(["booking_updated"])
    store.seed("bookings/LATER", existing({ startTime: "15:00", endTime: "21:00" }))
    expect((await modify(post({ action: "admin_update", bookingId: "MOVING", changes: { time: "9:00 AM - 3:00 PM" }, reason: "Edit" }, "admin"))).status).toBe(400)
    expect((await modify(post({ action: "admin_update", bookingId: "MOVING", changes: { startTime: "08:00", endTime: "14:00" }, reason: "Edit" }, "admin"))).status).toBe(200)
    expect(store.data.get("bookings/MOVING")?.endTime).toBe("14:00")
  })

  it("preserves the original schedule and appends later revisions", async () => {
    store.seed("bookings/MOVING", existing())
    const first = await modify(post({
      action: "admin_update",
      bookingId: "MOVING",
      changes: { date: "2099-04-01", startTime: "09:00", endTime: "15:00" },
      reason: "Move the event.",
    }, "admin"))
    expect(first.status).toBe(200)
    const afterFirst = store.data.get("bookings/MOVING") as any
    expect(afterFirst.originalSchedule).toMatchObject({
      date: "2099-03-01",
      startTime: "8:00 AM",
      endTime: "2:00 PM",
    })
    expect(afterFirst.scheduleHistory).toHaveLength(1)
    expect(afterFirst.scheduleHistory[0]).toMatchObject({
      revision: 1,
      previousSchedule: afterFirst.originalSchedule,
      currentSchedule: { date: "2099-04-01", startTime: "9:00 AM", endTime: "3:00 PM" },
    })

    const second = await modify(post({
      action: "admin_update",
      bookingId: "MOVING",
      changes: { date: "2099-05-01", startTime: "10:00", endTime: "16:00" },
      reason: "Move it again.",
    }, "admin"))
    expect(second.status).toBe(200)
    const afterSecond = store.data.get("bookings/MOVING") as any
    expect(afterSecond.originalSchedule).toMatchObject({ date: "2099-03-01", startTime: "8:00 AM", endTime: "2:00 PM" })
    expect(afterSecond.scheduleHistory).toHaveLength(2)
    expect(afterSecond.scheduleHistory[1]).toMatchObject({
      revision: 2,
      previousSchedule: { date: "2099-04-01", startTime: "9:00 AM", endTime: "3:00 PM" },
      currentSchedule: { date: "2099-05-01", startTime: "10:00 AM", endTime: "4:00 PM" },
    })
  })

  it("does not create schedule history for no-op or failed changes", async () => {
    store.seed("bookings/MOVING", existing())
    const noOp = await modify(post({
      action: "admin_update", bookingId: "MOVING",
      changes: { date, startTime: "08:00", endTime: "14:00" }, reason: "No change.",
    }, "admin"))
    expect(noOp.status).toBe(200)
    expect(store.data.get("bookings/MOVING")).not.toHaveProperty("scheduleHistory")
    expect(store.data.get("bookings/MOVING")).not.toHaveProperty("originalSchedule")

    store.seed("bookings/CONFLICT", existing({ date: "2099-04-01", startTime: "09:00", endTime: "15:00" }))
    const failed = await modify(post({
      action: "admin_update", bookingId: "MOVING",
      changes: { date: "2099-04-01", startTime: "10:00", endTime: "16:00" }, reason: "Conflicting change.",
    }, "admin"))
    expect(failed.status).toBe(409)
    expect(store.data.get("bookings/MOVING")).not.toHaveProperty("scheduleHistory")
    expect(store.data.get("bookings/MOVING")).not.toHaveProperty("originalSchedule")
    expect(store.data.get("bookings/MOVING")).toMatchObject({ date, startTime: "08:00", endTime: "14:00" })
  })

  it("allows a buffered modification on approval and preserves maintenance blocks", async () => {
    store.seed("bookings/MOVING", existing({ date: "2099-02-01" }))
    store.seed("bookings/MORNING", existing())
    expect((await modify(post({ action: "request", bookingId: "MOVING", changes: { date, startTime: "15:00", endTime: "21:00" }, reason: "Move" }))).status).toBe(200)
    expect((await modify(post({ action: "approve", bookingId: "MOVING" }, "admin"))).status).toBe(200)
    expect(store.data.get("bookings/MOVING")?.startTime).toBe("15:00")
    expect(store.data.get("bookings/MOVING")?.originalSchedule).toMatchObject({ date: "2099-02-01", startTime: "8:00 AM", endTime: "2:00 PM" })
    expect((store.data.get("bookings/MOVING")?.scheduleHistory as any[])).toHaveLength(1)
    store.seed("maintenanceRecords/BLOCK", { spaceId: "V2", date, status: "active" })
    expect((await create(post(input("08:00", "14:00", { venueId: "V2" })))).status).toBe(409)
  })

  it("serializes concurrent conflicting creations", async () => {
    const responses = await Promise.all([create(post(input("08:00", "14:00"))), create(post(input("09:00", "15:00")))])
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    expect(store.retries).toBeGreaterThan(0)
    expect([...store.data.keys()].filter((key) => key.startsWith("bookings/"))).toHaveLength(1)
    expect([...store.data.values()].filter((data) => data.revision === 1)).toHaveLength(1)
  })

  it("serializes concurrent creation and modification into the same interval", async () => {
    store.seed("bookings/MOVING", existing({ date: "2099-02-01" }))
    const responses = await Promise.all([
      create(post(input("08:00", "14:00"))),
      modify(post({ action: "admin_update", bookingId: "MOVING", changes: { date }, reason: "Move" }, "admin")),
    ])
    expect(responses.filter((response) => response.status === 409)).toHaveLength(1)
    expect(store.retries).toBeGreaterThan(0)
  })

  it("keeps direct admin modification owner and payment fields server-authoritative", async () => {
    store.seed("bookings/MOVING", existing({ amountPaid: 2500, paymentStatus: "partial", userId: "CLIENT" }))
    const response = await modify(post({
      action: "admin_update",
      bookingId: "MOVING",
      changes: { eventName: "Operations Workshop", guestCount: 50 },
      reason: "Client requested an updated event description.",
    }, "admin"))
    expect(response.status).toBe(400)
    expect(store.data.get("bookings/MOVING")).toMatchObject({
      userId: "CLIENT",
      eventName: "Fixture",
      guestCount: 10,
      amountPaid: 2500,
      paymentStatus: "partial",
    })
  })

  it("enforces the catalog capacity on event creation and modification requests", async () => {
    const constrained = structuredClone(store.data.get("cms/data")) as any
    constrained.venues[0].capacity = "50"
    store.seed("cms/data", constrained)

    expect((await create(post(input("08:00", "14:00", { guestCount: 50 })))).status).toBe(201)
    const invalid = await create(post(input("15:00", "21:00", { guestCount: 51 })))
    expect(invalid.status).toBe(400)
    expect((await invalid.json()).error).toMatch(/50 guests/i)

    store.seed("bookings/MOVING", existing({ guestCount: 10 }))
    const modification = await modify(post({
      action: "request", bookingId: "MOVING", changes: { guestCount: 51 }, reason: "Too many guests",
    }))
    expect(modification.status).toBe(400)
    expect((await modification.json()).error).toMatch(/50 guests/i)
    expect(store.data.get("bookings/MOVING")).toMatchObject({ guestCount: 10, status: "confirmed" })

    const adminUpdate = await modify(post({
      action: "admin_update", bookingId: "MOVING", changes: { guestCount: 51 }, reason: "Too many guests",
    }, "admin"))
    expect(adminUpdate.status).toBe(400)
    expect((await adminUpdate.json()).error).toMatch(/not allowed/i)
    expect(store.data.get("bookings/MOVING")).toMatchObject({ guestCount: 10, status: "confirmed" })
  })

  it.each([
    [0, /guestCount/i], [-1, /guestCount/i], [10.5, /guestCount/i], [undefined, /guestCount/i],
  ])("rejects invalid event guest count %s", async (guestCount, expected) => {
    const body = input("08:00", "14:00") as Record<string, unknown>
    if (guestCount === undefined) delete body.guestCount
    else body.guestCount = guestCount
    const response = await create(post(body))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(expected)
  })

  it("revalidates modification capacity when approval reads a changed catalog", async () => {
    store.seed("bookings/MOVING", existing({ guestCount: 10 }))
    const request = await modify(post({
      action: "request", bookingId: "MOVING", changes: { guestCount: 80 }, reason: "Increase guests",
    }))
    expect(request.status).toBe(200)

    const constrained = structuredClone(store.data.get("cms/data")) as any
    constrained.venues[0].capacity = "50"
    store.seed("cms/data", constrained)
    const approval = await modify(post({ action: "approve", bookingId: "MOVING" }, "admin"))
    expect(approval.status).toBe(400)
    expect((await approval.json()).error).toMatch(/50 guests/i)
    expect(store.data.get("bookings/MOVING")).toMatchObject({
      guestCount: 10, status: "modification_under_review", modificationRequested: true,
    })
  })

  it("resolves legacy name references to the canonical venue and rejects their buffered conflicts", async () => {
    store.seed("bookings/LEGACY", existing({ venueId: "Venue One", spaceId: "Venue One", date: "2099-02-01" }))
    store.seed("bookings/MORNING", existing())
    expect((await modify(post({ action: "admin_update", bookingId: "LEGACY",
      changes: { date, startTime: "14:00", endTime: "20:00" }, reason: "Move" }, "admin"))).status).toBe(409)
    expect((await modify(post({ action: "admin_update", bookingId: "LEGACY",
      changes: { date, startTime: "15:00", endTime: "21:00" }, reason: "Move" }, "admin"))).status).toBe(200)
    const locks = [...store.data.entries()].filter(([key]) => key.startsWith("eventAvailabilityLocks/"))
    expect(locks.map(([, data]) => data.venueId)).toEqual(["V1"])
  })
})

describe("finalized payment snapshot persistence", () => {
  it.each<[Record<string, unknown>, string]>([
    [{ bookingCategory: "venue", bookingType: "Office Space Rental", isOfficeRental: true, officeId: "O1" }, "Event Venue Booking"],
    [{ bookingCategory: "office", bookingType: "event", isOfficeRental: false }, "Office Space Rental"],
    [{ bookingType: "Office Space Rental" }, "Office Space Rental"],
    [{ rentalType: "Office Rental" }, "Office Space Rental"],
    [{ officeId: "O1" }, "Office Space Rental"],
    [{ isOfficeRental: true, venue: "Harbor Hub" }, "Office Space Rental"],
    [{ venue: "Office Ballroom", eventType: "Office Space Rental" }, "Event Venue Booking"],
    [{ bookingType: "event", isOfficeRental: true }, "Event Venue Booking"],
  ])("uses structured category precedence for the reviewed receipt: %j", async (identity, rentalType) => {
    const { bookingCategory: _category, ...base } = existing()
    store.seed("bookings/BOOKING", { ...base, ...identity })
    store.seed("payments/PAY-1", { bookingId: "BOOKING", status: "For Verification", amount: 5000, term: "Down Payment" })
    const body = { bookingId: "BOOKING", paymentRecordId: "PAY-1", action: "verify", verifiedAmount: 5000 }
    const response = await review(post(body, "admin"))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.booking.receipt.rentalType).toBe(rentalType)
    expect(store.data.get(`receipts/${result.payment.receiptNumber}`)).toMatchObject({
      rentalType, reviewSnapshot: result.payment.reviewSnapshot,
    })
    expect(result.payment.reviewSnapshot.summary.remainingBookingBalance).toBe(5000)
    const finalized = structuredClone(store.data)
    expect((await review(post(body, "admin"))).status).toBe(200)
    expect(store.data).toEqual(finalized)
  })

  it("requires the selected stable payment ID and never reviews an implicit latest submission", async () => {
    store.seed("bookings/BOOKING", existing())
    store.seed("payments/PAY-1", { bookingId: "BOOKING", paymentNumber: 1, status: "For Verification", amount: 2500 })
    expect((await review(post({ bookingId: "BOOKING", action: "verify" }, "admin"))).status).toBe(400)
    expect((await review(post({ bookingId: "BOOKING", paymentRecordId: "1", action: "verify" }, "admin"))).status).toBe(404)
    expect(store.data.get("payments/PAY-1")?.status).toBe("For Verification")
  })

  it("atomically persists each own snapshot/receipt and leaves earlier ones intact after later reviews and retries", async () => {
    store.seed("bookings/BOOKING", existing())
    const receiptCopies: unknown[] = []
    for (let n = 1; n <= 3; n++) {
      store.seed(`payments/PAY-${n}`, { bookingId: "BOOKING", status: "For Verification", amount: 2500,
        term: "Down Payment", paymentMethod: "bank", proofUrl: `proof-${n}.png`, submittedAt: `2026-10-0${n}T10:00:00Z` })
      const response = await review(post({ bookingId: "BOOKING", paymentRecordId: `PAY-${n}`,
        action: n === 2 ? "reject" : "verify", adminNote: n === 2 ? "Wrong proof" : "", verifiedAmount: 2500 }, "admin"))
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.payment.reviewSnapshot.summary.remainingBalance).toBe(n === 3 ? 5000 : 7500)
      const receipt = store.data.get(`receipts/${data.payment.receiptNumber}`)
      expect(receipt?.reviewSnapshot).toEqual(data.payment.reviewSnapshot)
      receiptCopies.push(structuredClone(receipt))
    }
    const beforeRetry = structuredClone(store.data)
    expect((await review(post({ bookingId: "BOOKING", paymentRecordId: "PAY-1", action: "verify", adminNote: "Later note" }, "admin"))).status).toBe(200)
    expect(store.data).toEqual(beforeRetry)
    const receipts = [...store.data.entries()].filter(([key]) => key.startsWith("receipts/")).map(([, data]) => data)
    expect(receipts).toEqual(receiptCopies)
  })

  it("persists stable display labels and original submitted amounts before review", async () => {
    store.seed("bookings/BOOKING", existing())
    store.seed("payments/OLD", { bookingId: "BOOKING", paymentNumber: 25, status: "Rejected", amount: 1000 })
    const response = await submit(post({ bookingId: "BOOKING", method: "cash", type: "downpayment", amount: 2500 }))
    expect(response.status).toBe(201)
    const data = await response.json()
    expect(data.payment.paymentNumber).toBe(26)
    expect(data.receipt.paymentNumber).toBe(26)
    expect(data.payment.requestedAmount).toBe(2500)
    expect(data.payment.reviewSnapshot).toBeUndefined()
  })

  it("captures onsite reviews too, retaining the first snapshot after a full settlement", async () => {
    store.seed("bookings/BOOKING", existing())
    const firstResponse = await onsite(post({ bookingId: "BOOKING", paymentType: "downpayment", amountReceived: 2500 }, "admin"))
    expect(firstResponse.status).toBe(201)
    const first = await firstResponse.json()
    const secondResponse = await onsite(post({ bookingId: "BOOKING", paymentType: "full_payment", amountReceived: 7500 }, "admin"))
    expect(secondResponse.status).toBe(201)
    const second = await secondResponse.json()
    expect(second.payment.reviewSnapshot.summary.remainingBookingBalance).toBe(0)
    expect(second.payment.reviewSnapshot.summary.requiredDpAmount).toBe(5000)
    expect(store.data.get(`payments/${first.payment.id}`)?.reviewSnapshot).toEqual(first.payment.reviewSnapshot)
    expect(first.payment.reviewSnapshot.summary.remainingBookingBalance).toBe(7500)
  })

  it("makes a keyed onsite retry return the original payment instead of charging twice", async () => {
    store.seed("bookings/BOOKING", existing())
    const body = { bookingId: "BOOKING", paymentType: "downpayment", amountReceived: 2500,
      adminNote: "Received at office", idempotencyKey: "onsite-fixture-retry-1" }
    const responses = await Promise.all([onsite(post(body, "admin")), onsite(post(body, "admin"))])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201])
    const results = await Promise.all(responses.map((response) => response.json()))
    expect(new Set(results.map((result) => result.payment.id)).size).toBe(1)
    expect(results.filter((result) => result.alreadyProcessed)).toHaveLength(1)
    expect([...store.data.keys()].filter((path) => path.startsWith("payments/")).length).toBe(1)
    expect([...store.data.keys()].filter((path) => path.startsWith("receipts/")).length).toBe(1)
    expect([...store.data.keys()].filter((path) => path.startsWith("paymentIdempotency/")).length).toBe(1)
  })

  it("rejects a cent-level onsite overpayment without writing a ledger record", async () => {
    store.seed("bookings/BOOKING", existing())
    store.seed("payments/ALMOST-PAID", {
      bookingId: "BOOKING", status: "Verified", verificationStatus: "Verified", amount: 9999.99,
      term: "Full Payment",
    })
    const before = structuredClone(store.data)
    const response = await onsite(post({ bookingId: "BOOKING", paymentType: "remaining_balance", amountReceived: 0.02,
      idempotencyKey: "onsite-cent-overpay" }, "admin"))

    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/exceeds/i)
    expect(store.data).toEqual(before)
  })

  it("issues the verified payment's own receipt instead of falling back to a newer pending receipt", async () => {
    store.seed("bookings/BOOKING", existing())
    const firstResponse = await onsite(post({ bookingId: "BOOKING", paymentType: "downpayment", amountReceived: 5000 }, "admin"))
    const first = await firstResponse.json()
    const pendingReceipt = { bookingId: "BOOKING", paymentId: "PENDING", receiptNumber: "ER-PENDING", paymentStatus: "For Verification" }
    const current = store.data.get("bookings/BOOKING")!
    store.seed("bookings/BOOKING", { ...current, receipt: pendingReceipt, paymentReceipts: [...current.paymentReceipts as object[], pendingReceipt] })
    store.seed("payments/PENDING", { bookingId: "BOOKING", status: "For Verification", amount: 5000, submittedAt: "2099-01-01" })
    const response = await lifecycle(post({ action: "issue_receipt", bookingId: "BOOKING" }))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.receipt.paymentId).toBe(first.payment.id)
    expect(result.receipt.reviewSnapshot).toEqual(first.payment.reviewSnapshot)
  })

  it("does not invent a historical balance when issuing a missing legacy receipt later", async () => {
    store.seed("bookings/BOOKING", existing())
    store.seed("payments/LEGACY", { bookingId: "BOOKING", status: "Verified", amount: 5000, submittedAt: "2025-01-01" })
    const response = await lifecycle(post({ action: "issue_receipt", bookingId: "BOOKING" }))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.receipt.paymentId).toBe("LEGACY")
    expect(result.receipt.reviewSnapshot).toBeUndefined()
    expect(result.receipt.remainingBalance).toBeUndefined()
  })

  it("makes lifecycle completion and reminders idempotent", async () => {
    store.seed("bookings/BOOKING", { ...existing(), status: "confirmed", bookingStatus: "Confirmed", amountPaid: 10000 })
    store.seed("payments/PAID", { bookingId: "BOOKING", status: "Verified", verificationStatus: "Verified", amount: 10000 })

    const firstCompletion = await lifecycle(post({ action: "complete", bookingId: "BOOKING" }, "admin"))
    const secondCompletion = await lifecycle(post({ action: "complete", bookingId: "BOOKING" }, "admin"))
    expect(firstCompletion.status).toBe(200)
    expect(secondCompletion.status).toBe(200)
    expect((await secondCompletion.json()).changed).toBe(false)
    expect((store.data.get("bookings/BOOKING")?.adminLogs as Array<{ action: string }>).filter((log) => log.action === "MARK_BOOKING_COMPLETED")).toHaveLength(1)

    store.seed("bookings/REMINDER", { ...existing(), status: "confirmed", bookingStatus: "Confirmed", amountPaid: 5000 })
    store.seed("payments/REMINDER-PAY", { bookingId: "REMINDER", status: "Verified", verificationStatus: "Verified", amount: 5000 })
    const firstReminder = await lifecycle(post({ action: "balance_reminder", bookingId: "REMINDER" }, "admin"))
    const secondReminder = await lifecycle(post({ action: "balance_reminder", bookingId: "REMINDER" }, "admin"))
    expect(firstReminder.status).toBe(200)
    expect((await secondReminder.json()).changed).toBe(false)
    expect([...store.data.keys()].filter((path) => path.startsWith("notifications/")).length).toBe(1)
  })

  it("rejects only an unsecured unpaid pending booking and notifies the client", async () => {
    vi.stubEnv("EMAIL_SENDING_ENABLED", "true")
    store.seed("bookings/REJECT", existing({
      status: "pending",
      bookingStatus: "Pending",
      isSlotSecured: false,
      amountPaid: 0,
      paymentStatus: "unpaid",
    }))

    const response = await lifecycle(post({
      action: "status",
      bookingId: "REJECT",
      status: "declined",
      reason: "The requested date is unavailable after final review.",
    }, "admin"))
    expect(response.status).toBe(200)
    expect(store.data.get("bookings/REJECT")).toMatchObject({
      status: "declined",
      bookingStatus: "Rejected",
      isSlotSecured: false,
      rejectionReason: "The requested date is unavailable after final review.",
      rejectedBy: "CLIENT",
    })
    expect([...store.data.values()].find((value) => value.type === "booking_rejected")).toMatchObject({
      type: "booking_rejected",
      userId: "CLIENT",
      bookingId: "REJECT",
    })
    expect(store.data.get("emailOutbox/booking_rejected_REJECT")).toMatchObject({
      eventType: "booking_rejected",
      eventId: "booking_rejected_REJECT",
      recipientUid: "CLIENT",
      status: "pending",
    })

    store.seed("bookings/PAID-PENDING", existing({ status: "pending", bookingStatus: "Pending", isSlotSecured: false }))
    store.seed("payments/PAID-PENDING-PROOF", {
      bookingId: "PAID-PENDING",
      status: "For Verification",
      verificationStatus: "For Verification",
      amount: 1000,
    })
    const blocked = await lifecycle(post({ action: "status", bookingId: "PAID-PENDING", status: "declined", reason: "Not accepted" }, "admin"))
    expect(blocked.status).toBe(409)
    expect(store.data.get("bookings/PAID-PENDING")?.status).toBe("pending")
  })

  it("creates an internal refund-request notification without changing the payment ledger", async () => {
    store.seed("bookings/REFUND", existing({
      refundStatus: "eligible",
      refundAmount: 0,
      amountPaid: 5000,
    }))
    store.seed("payments/REFUND-PAYMENT", {
      bookingId: "REFUND",
      status: "Verified",
      verificationStatus: "Verified",
      amount: 5000,
      submittedAt: "2099-01-01",
    })

    const response = await refund(post({ action: "request", bookingId: "REFUND" }))
    expect(response.status).toBe(201)
    expect(store.data.get("bookings/REFUND")?.refundStatus).toBe("requested")
    const notification = [...store.data.entries()]
      .find(([path]) => path.startsWith("notifications/"))?.[1]
    expect(notification).toMatchObject({
      type: "refund_requested",
      userId: "admin",
      relatedUserId: "CLIENT",
      bookingId: "REFUND",
      isRead: false,
      moduleRead: false,
    })
    expect(notification?.link).toBe("/dashboard/bookings?highlight=REFUND")
  })

  it("keeps refund completion notifications client-scoped", async () => {
    store.seed("bookings/REFUND", existing({
      refundStatus: "requested",
      refundAmount: 5000,
      amountPaid: 5000,
    }))
    store.seed("payments/REFUND-PAYMENT", {
      bookingId: "REFUND",
      status: "Verified",
      verificationStatus: "Verified",
      amount: 5000,
      submittedAt: "2099-01-01",
    })

    const response = await refund(post({ action: "complete", bookingId: "REFUND" }, "admin"))
    expect(response.status).toBe(201)
    const notification = [...store.data.entries()]
      .find(([path]) => path.startsWith("notifications/"))?.[1]
    expect(notification).toMatchObject({
      type: "refund_completed",
      userId: "CLIENT",
      bookingId: "REFUND",
      isRead: false,
      moduleRead: false,
    })
    expect(notification?.link).toBe("/portal/bookings?highlight=REFUND")
  })
})

describe("direct administrative cancellation", () => {
  const directCancel = (bookingId = "CANCEL-ME", role = "admin", reason = "Operations cancelled the reservation") => cancel(
    new NextRequest("http://localhost/api/bookings/cancellation", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-role": role },
      body: JSON.stringify({ action: "admin_cancel", bookingId, reason }),
    }),
  )

  it("cancels an eligible paid booking without processing a refund", async () => {
    store.seed("bookings/CANCEL-ME", existing({
      date: "2099-03-01",
      status: "confirmed",
      bookingStatus: "Confirmed",
      amountPaid: 2500,
      paymentStatus: "paid",
      isSlotSecured: true,
      refundStatus: "Not Applicable",
    }))
    store.seed("payments/PAY-CANCEL", { bookingId: "CANCEL-ME", status: "Verified", amount: 2500 })

    const response = await directCancel()
    expect(response.status).toBe(200)
    expect(store.data.get("bookings/CANCEL-ME")).toMatchObject({
      status: "cancelled",
      bookingStatus: "Cancelled",
      cancellationSource: "admin",
      cancellationType: "admin_action",
      cancellationReason: "Operations cancelled the reservation",
      cancellationActorId: "CLIENT",
      cancellationActorName: "Fixture",
      refundStatus: "eligible",
    })
    expect(store.data.get("payments/PAY-CANCEL")).toMatchObject({ status: "Verified", amount: 2500 })
    const cancellationLogs = store.data.get("bookings/CANCEL-ME")?.adminLogs as Array<Record<string, unknown>> | undefined
    expect(cancellationLogs?.at(-1)).toMatchObject({
      action: "ADMIN_CANCEL_BOOKING",
      actorId: "CLIENT",
      actorName: "Fixture",
      previousValues: { status: "confirmed" },
      updatedValues: { status: "cancelled" },
    })
    const notificationKeys = [...store.data.keys()].filter((key) => key.startsWith("notifications/"))
    expect(notificationKeys).toHaveLength(1)
    expect(store.data.get(notificationKeys[0])).toMatchObject({ type: "booking_cancelled", userId: "CLIENT", bookingId: "CANCEL-ME" })

    const duplicate = await directCancel()
    expect(duplicate.status).toBe(200)
    expect([...store.data.keys()].filter((key) => key.startsWith("notifications/"))).toHaveLength(1)
    expect(store.data.get("bookings/CANCEL-ME")?.refundStatus).not.toBe("refunded")
  })

  it.each([
    ["staff", "Administrator access is required"],
    ["client", "This account is not authorized"],
  ])("denies direct cancellation to %s", async (role, message) => {
    store.seed("bookings/CANCEL-ME", existing({ date: "2099-03-01", amountPaid: 2500, paymentStatus: "paid", isSlotSecured: true }))
    const response = await directCancel("CANCEL-ME", role)
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain(message)
    expect(store.data.get("bookings/CANCEL-ME")?.status).toBe("confirmed")
  })

  it.each([
    [{ amountPaid: 0, paymentStatus: "unpaid", isSlotSecured: false }, /after the booking payment is secured/i],
    [{ amountPaid: 2500, paymentStatus: "for_review", isSlotSecured: true }, /after the booking payment is secured/i],
    [{ amountPaid: 2500, paymentStatus: "paid", isSlotSecured: true, status: "completed" }, /not eligible/i],
    [{ amountPaid: 2500, paymentStatus: "paid", isSlotSecured: true, status: "cancellation_requested", cancellationRequested: true }, /cancellation request under review/i],
    [{ amountPaid: 2500, paymentStatus: "paid", isSlotSecured: true, modificationStatus: "Under Review" }, /active modification/i],
  ])("rejects unsafe direct cancellation state %j", async (fields, expected) => {
    store.seed("bookings/CANCEL-ME", existing({ date: "2099-03-01", ...fields }))
    const response = await directCancel()
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(expected)
    const state = fields as Record<string, unknown>
    expect(store.data.get("bookings/CANCEL-ME")?.status).toBe(state.status || "confirmed")
  })
})
