import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { TransactionStore } from "./helpers/transaction-store"

const boundary = vi.hoisted(() => ({ firestore: null as unknown }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/firebase-admin", () => ({ getAdminFirestore: () => boundary.firestore }))
vi.mock("@/lib/server-auth", () => {
  class ApiAuthError extends Error {
    constructor(readonly status: number, message: string) { super(message) }
  }
  const user = async (request: Request) => ({ uid: "CLIENT", role: request.headers.get("x-role") || "client", fullName: "Fixture", permissions: {} })
  return { ApiAuthError, isApiAuthError: (error: unknown) => error instanceof ApiAuthError,
    requireAuthenticatedUser: user, requireBackofficeUser: user }
})

import { POST as create } from "@/app/api/bookings/route"
import { POST as modify } from "@/app/api/bookings/modification/route"
import { POST as review } from "@/app/api/payments/review/route"
import { POST as onsite } from "@/app/api/payments/onsite/route"
import { POST as submit } from "@/app/api/payments/submit/route"
import { POST as lifecycle } from "@/app/api/bookings/lifecycle/route"
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
    store.seed("bookings/LATER", existing({ startTime: "15:00", endTime: "21:00" }))
    expect((await modify(post({ action: "admin_update", bookingId: "MOVING", changes: { time: "9:00 AM - 3:00 PM" }, reason: "Edit" }, "admin"))).status).toBe(409)
    expect((await modify(post({ action: "admin_update", bookingId: "MOVING", changes: { time: "8:00 AM - 2:00 PM" }, reason: "Edit" }, "admin"))).status).toBe(200)
    expect(store.data.get("bookings/MOVING")?.endTime).toBe("14:00")
  })

  it("allows a buffered modification on approval and preserves maintenance blocks", async () => {
    store.seed("bookings/MOVING", existing({ date: "2099-02-01" }))
    store.seed("bookings/MORNING", existing())
    expect((await modify(post({ action: "request", bookingId: "MOVING", changes: { date, startTime: "15:00", endTime: "21:00" }, reason: "Move" }))).status).toBe(200)
    expect((await modify(post({ action: "approve", bookingId: "MOVING" }, "admin"))).status).toBe(200)
    expect(store.data.get("bookings/MOVING")?.startTime).toBe("15:00")
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
})
