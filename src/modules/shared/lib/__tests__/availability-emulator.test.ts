import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { generateKeyPairSync } from "node:crypto"
import { initializeApp, getApps, deleteApp, cert, type App } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"
import { NextRequest } from "next/server"

vi.mock("server-only", () => ({}))
// Validate committed outbox records, never schedule SMTP from disposable tests.
vi.mock("@/lib/email-dispatch", () => ({ scheduleImmediateEmailDispatch: () => {} }))
vi.mock("@/lib/server-auth", () => {
  class ApiAuthError extends Error {
    constructor(readonly status: number, message: string) { super(message) }
  }
  const user = async (request: Request) => ({
    uid: request.headers.get("x-test-role") === "admin" ? "EMULATOR-ADMIN" : "EMULATOR-CLIENT",
    role: request.headers.get("x-test-role") === "admin" ? "admin" : "client",
    permissions: { bookings: true }, fullName: "Emulator Test", authTime: 100,
  })
  return {
    ApiAuthError,
    isApiAuthError: (error: unknown) => error instanceof ApiAuthError,
    requireAuthenticatedUser: user,
    requireBackofficeUser: async (request: Request) => {
      const authenticated = await user(request)
      if (authenticated.role !== "admin") throw new ApiAuthError(403, "Fixture administrator required.")
      return authenticated
    },
  }
})

import { getAdminFirestore } from "@/lib/firebase-admin"
import { POST as createBooking } from "@/app/api/bookings/route"
import { POST as modifyBooking } from "@/app/api/bookings/modification/route"
import { POST as createMaintenance } from "@/app/api/maintenance/route"
import { POST as submitPayment } from "@/app/api/payments/submit/route"
import { POST as lifecycle } from "@/app/api/bookings/lifecycle/route"
import { bookingCoversAvailabilityDate } from "@/src/modules/shared/lib/availability"
import { isAvailabilityBlockingBooking } from "@/src/modules/shared/lib/booking-helpers"

// Separate from the rules suite's project: parallel runs must never clear each other's data.
const PROJECT_ID = "demo-one-estela-availability"
const emulatorSuite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip
const date = "2099-03-01"
const nextDate = "2099-03-02"
const lastDate = "2099-03-03"
const catalog = {
  bookingCounter: 0,
  venues: [{ id: "EVENT", name: "Emulator Events", price: 10000, capacity: "100" }],
  offices: [{ id: "OFFICE", name: "Emulator Offices", price: 5000, rooms: [
    { id: "ROOM-1", name: "Room 1" }, { id: "ROOM-2", name: "Room 2" },
  ] }],
}

function localEmulatorOrigin(host: string): string {
  const match = host.match(/^(?:localhost|127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})$/)
  if (!match || Number(match[1]) > 65535) throw new Error("Availability integration tests refuse nonlocal or invalid Firestore emulator hosts.")
  return `http://${host}`
}

const post = (body: object, role = "client") => new NextRequest("http://localhost/api/emulator-test", {
  method: "POST", headers: { "content-type": "application/json", "x-test-role": role }, body: JSON.stringify(body),
})
const officeInput = (start = date) => ({
  venueId: "OFFICE", officeId: "OFFICE", spaceId: "ROOM-1", bookingCategory: "office", officeRentalTerm: "6_months",
  eventName: "Emulator Rental", eventType: "Office Rental", date: start, guestCount: 1,
})

describe("availability emulator connection safety", () => {
  it.each(["localhost:8080", "127.0.0.1:8189", "[::1]:8080"])("accepts loopback host %s", (host) => {
    expect(localEmulatorOrigin(host)).toBe(`http://${host}`)
  })
  it.each(["firestore.googleapis.com:443", "192.168.1.20:8080", "0.0.0.0:8080", "localhost:8080/remote", "http://localhost:8080", "user@localhost:8080", "localhost:0", "localhost:65536"])(
    "rejects unsafe host %s before any SDK or cleanup connection", (host) => {
      expect(() => localEmulatorOrigin(host)).toThrow("refuse nonlocal or invalid")
    },
  )
})

emulatorSuite("real Firestore availability transactions (fixture authentication only)", () => {
  let app: App | undefined
  let firestore: Firestore | undefined
  let origin: string | undefined

  async function clearDemoDatabase() {
    if (!origin) return
    const response = await fetch(`${origin}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
      method: "DELETE", signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`Demo emulator cleanup failed: HTTP ${response.status}`)
  }

  beforeAll(() => {
    origin = localEmulatorOrigin(process.env.FIRESTORE_EMULATOR_HOST!)
    if (getApps().length) throw new Error("Refusing to reuse an existing Firebase Admin app in emulator integration tests.")
    // Admin Firestore requires a certificate class. Generate an in-memory dummy
    // certificate only after the loopback guard, never discover ADC/.env credentials.
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    app = initializeApp({ projectId: PROJECT_ID, credential: cert({
      projectId: PROJECT_ID,
      clientEmail: `emulator@${PROJECT_ID}.iam.gserviceaccount.com`,
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    }) }, "availability-emulator-test")
    firestore = getFirestore(app)
    firestore.settings({ host: process.env.FIRESTORE_EMULATOR_HOST!, ssl: false, preferRest: false })
    expect(app.options.projectId).toBe(PROJECT_ID)
    expect(getAdminFirestore()).toBe(firestore)
  })

  beforeEach(async () => {
    await clearDemoDatabase()
    await firestore!.collection("cms").doc("data").set(catalog)
  }, 20000)

  afterEach(clearDemoDatabase, 20000)
  afterEach(() => vi.unstubAllEnvs())

  afterAll(async () => {
    try {
      await firestore?.terminate()
    } finally {
      if (app) await deleteApp(app)
    }
  }, 20000)

  it("atomically persists one reminder for concurrent requests and a separate later event without changing the payment ledger", async () => {
    vi.stubEnv("EMAIL_SENDING_ENABLED", "true")
    const bookingRef = firestore!.collection("bookings").doc("REMINDER-REAL")
    await bookingRef.set({ userId: "EMULATOR-CLIENT", bookingCode: "REF-REAL", venueId: "EVENT", spaceId: "EVENT",
      bookingCategory: "venue", status: "confirmed", bookingStatus: "Confirmed", date, totalPrice: 10000,
      paymentType: "downpayment", selectedDownpaymentAmount: 5000, createdAt: new Date().toISOString() })
    const payment = { bookingId: "REMINDER-REAL", customerId: "EMULATOR-CLIENT", paymentMethod: "bank", status: "Verified", amount: 5000 }
    await firestore!.collection("payments").doc("REMINDER-PAYMENT").set(payment)
    const send = (idempotencyKey: string) => lifecycle(post({ action: "balance_reminder", bookingId: bookingRef.id, idempotencyKey }, "admin"))
    const responses = await Promise.all([send("first"), send("first"), send("second")])
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
    const payloads = await Promise.all(responses.map((response) => response.json()))
    expect(payloads.filter((payload) => payload.changed)).toHaveLength(1)
    const created = payloads.find((payload) => payload.changed)!
    const winningKey = payloads[2].changed ? "second" : "first"
    const notificationRef = firestore!.collection("notifications").doc(created.reminder.notificationId)
    expect((await notificationRef.get()).data()).toMatchObject({ userId: "EMULATOR-CLIENT", bookingId: bookingRef.id, type: "balance_reminder", isRead: false })
    expect((await bookingRef.get()).data()).toMatchObject({ balanceReminderSent: true, balanceReminderNotificationId: notificationRef.id })
    expect((await firestore!.collection("notifications").get()).size).toBe(1)
    expect((await firestore!.collection("emailOutbox").get()).size).toBe(1)
    await notificationRef.update({ isRead: true, moduleRead: true })
    await bookingRef.update({ balanceReminderSentAt: "2000-01-01T00:00:00Z" })
    expect((await (await send(winningKey)).json()).reminder.status).toBe("already_sent")
    expect((await notificationRef.get()).data()?.isRead).toBe(true)
    const later = await (await send("intentional-later-event")).json()
    expect(later.reminder.status).toBe("created")
    expect(later.reminder.notificationId).not.toBe(notificationRef.id)
    expect((await firestore!.collection("notifications").get()).size).toBe(2)
    expect((await firestore!.collection("emailOutbox").get()).size).toBe(2)
    expect((await firestore!.collection("payments").doc("REMINDER-PAYMENT").get()).data()).toEqual(payment)
  }, 60000)

  it("permits only one of two office creations even with nonoverlapping start dates", async () => {
    const responses = await Promise.all([
      createBooking(post(officeInput(date))), createBooking(post(officeInput("2105-04-01"))),
    ])
    const outcomes = await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() })))
    expect(outcomes.map((result) => result.status).sort(), JSON.stringify(outcomes)).toEqual([201, 409])
    const bookings = await firestore!.collection("bookings").get()
    expect(bookings.size).toBe(1)
    expect(bookings.docs[0].data()).toMatchObject({ officeId: "OFFICE", spaceId: "ROOM-1", status: "pending" })
    const locks = await firestore!.collection("eventAvailabilityLocks").get()
    expect(locks.docs.map((document) => document.data())).toEqual([{ venueId: "office:OFFICE", date: "all-dates", revision: 1 }])
  }, 60000)

  it("permits only a room booking or overlapping whole-building maintenance range, never both", async () => {
    const responses = await Promise.all([
      createBooking(post(officeInput())),
      createMaintenance(post({ records: [{
        type: "office", scope: "building", officeId: "OFFICE", spaceId: "OFFICE",
        date: "2099-05-15", endDate: "2099-05-17",
      }] }, "admin")),
    ])
    const outcomes = await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() })))
    expect(outcomes.map((result) => result.status).sort(), JSON.stringify(outcomes)).toEqual([201, 409])
    const bookings = await firestore!.collection("bookings").get()
    const maintenance = await firestore!.collection("maintenanceRecords").get()
    expect(bookings.size + maintenance.size).toBe(1)
    if (maintenance.size) expect(maintenance.docs[0].data()).toMatchObject({
      scope: "building", officeId: "OFFICE", date: "2099-05-15", endDate: "2099-05-17", status: "active",
    })
    const locks = await firestore!.collection("eventAvailabilityLocks").get()
    expect(locks.docs.map((document) => document.data())).toEqual([{ venueId: "office:OFFICE", date: "all-dates", revision: 1 }])
  }, 60000)

  it("serializes an event creation against a nonfirst date in a maintenance range", async () => {
    const responses = await Promise.all([
      createBooking(post({ venueId: "EVENT", spaceId: "EVENT", bookingCategory: "venue", date: lastDate,
        eventName: "Emulator Event", eventType: "Celebration", guestCount: 10, startTime: "08:00", endTime: "14:00" })),
      createMaintenance(post({ records: [{ type: "venue", scope: "venue", venueId: "EVENT", spaceId: "EVENT", date, endDate: lastDate }] }, "admin")),
    ])
    const outcomes = await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() })))
    expect(outcomes.map((result) => result.status).sort(), JSON.stringify(outcomes)).toEqual([201, 409])
    const bookings = await firestore!.collection("bookings").get()
    const maintenance = await firestore!.collection("maintenanceRecords").get()
    expect(bookings.size + maintenance.size).toBe(1)
    const locks = await firestore!.collection("eventAvailabilityLocks").get()
    expect(locks.docs.map((document) => document.data().date).sort()).toEqual(maintenance.size ? [date, nextDate, lastDate] : [lastDate])
    expect(locks.docs.every((document) => document.data().revision === 1)).toBe(true)
  }, 60000)

  it("revalidates event capacity during a real Firestore modification approval", async () => {
    await firestore!.collection("cms").doc("data").set({
      ...catalog,
      venues: [{ ...catalog.venues[0], capacity: "50" }],
    })
    const initial = await createBooking(post({ venueId: "EVENT", spaceId: "EVENT", bookingCategory: "venue",
      date, eventName: "Capacity Event", eventType: "Celebration", guestCount: 10, startTime: "08:00", endTime: "14:00" }))
    expect(initial.status).toBe(201)
    const { id } = await initial.json()

    const request = await modifyBooking(post({ action: "request", bookingId: id,
      changes: { guestCount: 40 }, reason: "Increase guests" }))
    expect(request.status).toBe(200)

    await firestore!.collection("cms").doc("data").set({
      ...catalog,
      venues: [{ ...catalog.venues[0], capacity: "20" }],
    })
    const approval = await modifyBooking(post({ action: "approve", bookingId: id }, "admin"))
    expect(approval.status).toBe(400)
    expect((await approval.json()).error).toMatch(/20 guests/i)
    expect((await firestore!.collection("bookings").doc(id).get()).data()).toMatchObject({
      guestCount: 10, status: "modification_under_review", modificationRequested: true,
    })
  }, 60000)

  it("serializes a new office booking against approval of an overlapping office modification", async () => {
    const initialResponse = await createBooking(post(officeInput("2098-01-01")))
    expect(initialResponse.status).toBe(201)
    const { id } = await initialResponse.json()
    const requestResponse = await modifyBooking(post({ action: "request", bookingId: id, changes: { date }, reason: "Move the rental" }))
    expect(requestResponse.status, JSON.stringify(await requestResponse.json())).toBe(200)

    const responses = await Promise.all([
      createBooking(post(officeInput("2099-04-01"))), modifyBooking(post({ action: "approve", bookingId: id }, "admin")),
    ])
    const outcomes = await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() })))
    expect(outcomes.map((result) => result.status), JSON.stringify(outcomes)).toEqual([409, 200])
    const bookings = await firestore!.collection("bookings").get()
    const occupying = bookings.docs.filter((document) => isAvailabilityBlockingBooking(document.data())
      && bookingCoversAvailabilityDate(document.data(), "2099-05-01"))
    expect(occupying).toHaveLength(1)
    const original = (await firestore!.collection("bookings").doc(id).get()).data()!
    expect(bookings.size).toBe(1)
    expect(original).toMatchObject({ date, modificationStatus: "Approved", modificationRequested: false })
    const locks = await firestore!.collection("eventAvailabilityLocks").get()
    expect(locks.docs.map((document) => document.data())).toEqual([{ venueId: "office:OFFICE", date: "all-dates", revision: 2 }])
  }, 60000)

  it("atomically expires and audits an abandoned office hold while rejecting a concurrent stale payment", async () => {
    const initialResponse = await createBooking(post(officeInput()))
    expect(initialResponse.status).toBe(201)
    const { id: originalId } = await initialResponse.json()
    const originalRef = firestore!.collection("bookings").doc(originalId)
    await originalRef.update({ createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() })

    const responses = await Promise.all([
      createBooking(post({ ...officeInput(), eventName: "Replacement Rental" })),
      submitPayment(post({ bookingId: originalId, type: "slot_reservation", method: "cash", amount: 5000 })),
    ])
    const outcomes = await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() })))
    expect(outcomes.map((result) => result.status), JSON.stringify(outcomes)).toEqual([201, 409])
    expect(outcomes[1].body.error).toMatch(/expired|released|cannot accept/i)
    const replacementId = outcomes[0].body.id
    expect(replacementId).not.toBe(originalId)

    const [originalSnapshot, replacementSnapshot] = await firestore!.getAll(originalRef, firestore!.collection("bookings").doc(replacementId))
    const original = originalSnapshot.data()!
    expect(original).toMatchObject({
      status: "cancelled", bookingStatus: "Cancelled", paymentStatus: "cancelled", cancellationStatus: "Automatic Expiry",
      cancellationSource: "system", cancellationType: "automatic_expiry", cancellationActorId: "system",
      cancellationReason: "Payment window expired", amountPaid: 0, cancelledAt: expect.any(String),
    })
    expect(original.adminLogs.filter((entry: { action: string }) => entry.action === "AUTO_EXPIRE_BOOKING")).toHaveLength(1)
    expect(replacementSnapshot.data()).toMatchObject({ eventName: "Replacement Rental", status: "pending", officeId: "OFFICE", spaceId: "ROOM-1" })
    expect(originalSnapshot.updateTime!.isEqual(replacementSnapshot.updateTime!)).toBe(true)
    const bookings = await firestore!.collection("bookings").get()
    expect(bookings.size).toBe(2)
    expect(bookings.docs.filter((document) => isAvailabilityBlockingBooking(document.data()))).toHaveLength(1)
    expect((await firestore!.collection("payments").get()).size).toBe(0)
    expect((await firestore!.collection("receipts").get()).size).toBe(0)
    const locks = await firestore!.collection("eventAvailabilityLocks").get()
    expect(locks.docs.map((document) => document.data())).toEqual([{ venueId: "office:OFFICE", date: "all-dates", revision: 2 }])
  }, 60000)
})
