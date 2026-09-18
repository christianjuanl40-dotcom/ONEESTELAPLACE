import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing"

const rulesSuite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip

rulesSuite("Firestore security rules", () => {
  let testEnv: RulesTestEnvironment

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-one-estela-place",
      firestore: {
        rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
      },
    })
  })

  afterEach(async () => {
    await testEnv.clearFirestore()
  })

  afterAll(async () => {
    await testEnv.cleanup()
  })

  async function seedProfilesAndRecords() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore()
      await Promise.all([
        firestore.collection("users").doc("reports-staff").set({
          role: "staff",
          status: "active",
          permissions: { reports: true },
        }),
        firestore.collection("users").doc("booking-staff").set({
          role: "staff",
          status: "active",
          permissions: { bookings: true },
        }),
        firestore.collection("users").doc("payment-staff").set({
          role: "staff",
          status: "active",
          permissions: { payments: true },
        }),
        firestore.collection("users").doc("client").set({
          role: "client",
          status: "active",
        }),
        firestore.collection("users").doc("another-client").set({
          role: "client",
          status: "active",
        }),
        firestore.collection("bookings").doc("BK001").set({ userId: "client" }),
        firestore.collection("bookings").doc("BK002").set({ userId: "another-client" }),
        firestore.collection("bookings").doc("BK003").set({
          userId: "client",
          status: "confirmed",
          bookingStatus: "Confirmed",
          paymentStatus: "paid",
          cancellationRequested: false,
          cancellationStatus: "None",
          refundStatus: "Not Applicable",
          refundEligible: false,
        }),
        firestore.collection("payments").doc("PAY001").set({ customerId: "client" }),
        firestore.collection("notifications").doc("booking-notification").set({
          type: "booking_submitted",
          userId: "admin",
        }),
        firestore.collection("notifications").doc("payment-notification").set({
          type: "payment_submitted",
          userId: "admin",
        }),
      ])
    })
  }

  it("allows reports staff to read report booking and payment data", async () => {
    await seedProfilesAndRecords()
    const firestore = testEnv.authenticatedContext("reports-staff").firestore()

    await assertSucceeds(firestore.collection("bookings").get())
    await assertSucceeds(firestore.collection("payments").get())
  })

  it("does not let booking staff read payment records", async () => {
    await seedProfilesAndRecords()
    const firestore = testEnv.authenticatedContext("booking-staff").firestore()

    await assertSucceeds(firestore.collection("bookings").get())
    await assertFails(firestore.collection("payments").get())
  })

  it("does not let clients verify a payment record", async () => {
    await seedProfilesAndRecords()
    const firestore = testEnv.authenticatedContext("client").firestore()

    await assertFails(
      firestore.collection("payments").doc("PAY001").update({
        status: "Verified",
        verificationStatus: "Verified",
      }),
    )
  })

  it("limits client profile updates to the authenticated user's contact fields", async () => {
    await seedProfilesAndRecords()
    const firestore = testEnv.authenticatedContext("client").firestore()

    await assertSucceeds(
      firestore.collection("users").doc("client").update({
        email: "updated@example.com",
        phone: "+63 900 000 0000",
      }),
    )
    await assertFails(
      firestore.collection("users").doc("another-client").update({
        email: "attacker@example.com",
      }),
    )
    await assertFails(
      firestore.collection("users").doc("client").update({
        role: "admin",
      }),
    )
  })

  it("limits admin notifications to the staff member's permission area", async () => {
    await seedProfilesAndRecords()

    const bookingStaff = testEnv.authenticatedContext("booking-staff").firestore()
    const paymentStaff = testEnv.authenticatedContext("payment-staff").firestore()

    await assertSucceeds(bookingStaff.collection("notifications").doc("booking-notification").get())
    await assertFails(bookingStaff.collection("notifications").doc("payment-notification").get())
    await assertSucceeds(paymentStaff.collection("notifications").doc("payment-notification").get())
    await assertFails(paymentStaff.collection("notifications").doc("booking-notification").get())
  })

  it("denies the obsolete shared unread counter collection", async () => {
    await seedProfilesAndRecords()
    const firestore = testEnv.authenticatedContext("client").firestore()
    const unreadCounter = firestore.collection("unreadCounts").doc("client")

    await assertFails(unreadCounter.get())
    await assertFails(unreadCounter.set({ count: 1 }))
  })

  it("keeps client booking reads scoped to the authenticated owner", async () => {
    await seedProfilesAndRecords()
    const firestore = testEnv.authenticatedContext("client").firestore()

    await assertSucceeds(firestore.collection("bookings").doc("BK001").get())
    await assertFails(firestore.collection("bookings").doc("BK002").get())
  })

  it("does not let clients forge cancellation decisions or refund eligibility", async () => {
    await seedProfilesAndRecords()
    const firestore = testEnv.authenticatedContext("client").firestore()
    const booking = firestore.collection("bookings").doc("BK003")

    await assertFails(booking.update({
      status: "cancellation_requested",
      bookingStatus: "Cancellation Under Review",
      cancellationRequested: true,
      cancellationStatus: "Pending",
      cancellationReason: "Client supplied reason",
    }))
    await assertFails(booking.update({
      status: "cancelled",
      bookingStatus: "Cancelled",
      cancellationRequested: false,
      cancellationStatus: "Approved",
    }))
    await assertFails(booking.update({
      cancellationStatus: "Declined",
      cancellationDeclineReason: "Client supplied decision",
    }))
    await assertFails(booking.update({
      refundEligible: true,
      refundStatus: "eligible",
    }))
  })
})
