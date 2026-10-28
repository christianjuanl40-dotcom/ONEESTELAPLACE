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
const officeBooking = {
  userId: "client", venueId: "OFFICE", officeId: "OFFICE", spaceId: "ROOM-1", venue: "Office - Room 1",
  date: "2099-03-01", startDate: "2099-03-01", endDate: "2099-08-31",
  startTime: "", endTime: "", time: "", bookingCategory: "office", bookingType: "office", isOfficeRental: true,
  officeRentalTerm: "6_months", rentalTerm: "6_months", contractTerm: "6_months",
  status: "confirmed", bookingStatus: "Confirmed", isSlotSecured: true, amountPaid: 5000, totalPrice: 10000, paymentStatus: "partial",
}

rulesSuite("Firestore security rules", () => {
  let testEnv: RulesTestEnvironment

  beforeAll(async () => {
    const match = process.env.FIRESTORE_EMULATOR_HOST?.match(/^(?:localhost|127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})$/)
    if (!match || Number(match[1]) > 65535) throw new Error("Rules tests require a local Firestore emulator host and port.")
    testEnv = await initializeTestEnvironment({
      projectId: "demo-one-estela-place",
      firestore: {
        rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
      },
    })
  })

  afterEach(async () => {
    if (testEnv) await testEnv.clearFirestore()
  })

  afterAll(async () => {
    if (testEnv) await testEnv.cleanup()
  })

  async function seedProfilesAndRecords() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore()
      await Promise.all([
        firestore.collection("users").doc("admin").set({ role: "admin", status: "active" }),
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
        firestore.collection("users").doc("users-staff").set({
          role: "staff",
          status: "active",
          permissions: { users: true },
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
        firestore.collection("bookings").doc("OFFICE-BOOKING").set(officeBooking),
        firestore.collection("officeRentals").doc("OWN-LEASE").set({
          userId: "client", officeSpaceId: "ROOM-1", officeId: "OFFICE", leaseStatus: "Active Lease",
        }),
        firestore.collection("officeRentals").doc("OTHER-LEASE").set({
          userId: "another-client", officeSpaceId: "ROOM-2", officeId: "OFFICE", leaseStatus: "Active Lease",
        }),
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
        firestore.collection("receipts").doc("RECEIPT-CLIENT").set({
          bookingId: "BK001",
          paymentId: "PAY001",
          paymentStatus: "Verified",
          paymentAmount: 5000,
        }),
        firestore.collection("receipts").doc("RECEIPT-OTHER").set({
          bookingId: "BK002",
          paymentId: "PAY002",
          paymentStatus: "Verified",
          paymentAmount: 5000,
        }),
        firestore.collection("maintenanceRecords").doc("MAINT001").set({
          type: "venue", scope: "venue", venueId: "V1", spaceId: "V1", date: "2099-03-01", status: "active",
        }),
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

  describe.each(["admin", "booking-staff"])("server-authoritative reservations for %s", (uid) => {
    it("denies direct booking creation, including a valid office reservation", async () => {
      await seedProfilesAndRecords()
      const bookings = testEnv.authenticatedContext(uid).firestore().collection("bookings")
      await assertFails(bookings.doc("NEW-OFFICE").set(officeBooking))
      await assertFails(bookings.doc("NEW-EVENT").set({
        userId: "client", venueId: "VENUE", spaceId: "VENUE", bookingCategory: "venue",
        date: "2099-03-01", startTime: "08:00", endTime: "14:00", status: "pending",
      }))
    })

    it.each(Object.entries({
      venueId: "OTHER-OFFICE", officeId: "OTHER-OFFICE", spaceId: "ROOM-2", venue: "Another Office - Room 2",
      date: "2099-04-01", startDate: "2099-04-01", endDate: "2100-03-31",
      startTime: "08:00", endTime: "14:00", time: "08:00 - 14:00",
      bookingCategory: "venue", bookingType: "venue", isOfficeRental: false,
      officeRentalTerm: "1_year", rentalTerm: "1_year", contractTerm: "1_year",
      status: "cancelled", bookingStatus: "Cancelled", isSlotSecured: false,
      amountPaid: 10000, totalPrice: 20000, paymentStatus: "paid",
    }))("denies direct changes to %s", async (field, value) => {
      await seedProfilesAndRecords()
      const booking = testEnv.authenticatedContext(uid).firestore().collection("bookings").doc("OFFICE-BOOKING")
      await assertFails(booking.update({ [field]: value }))
      expect((await assertSucceeds(booking.get())).data()).toEqual(officeBooking)
    })

    it("also denies protected field changes through merges or replacement deletions", async () => {
      await seedProfilesAndRecords()
      const booking = testEnv.authenticatedContext(uid).firestore().collection("bookings").doc("OFFICE-BOOKING")
      await assertFails(booking.set({ date: "2099-04-01", specialRequests: "A harmless note" }, { merge: true }))
      const replacement = { ...officeBooking } as Record<string, unknown>
      delete replacement.spaceId
      await assertFails(booking.set(replacement))
      await assertFails(booking.delete())
    })

    it("allows metadata-only edits and retains backoffice booking/rental reads", async () => {
      await seedProfilesAndRecords()
      const firestore = testEnv.authenticatedContext(uid).firestore()
      const booking = firestore.collection("bookings").doc("OFFICE-BOOKING")
      await assertSucceeds(booking.update({
        eventName: "Updated customer label", specialRequests: "Staff note", updatedAt: "2099-01-01T12:00:00Z",
      }))
      expect((await booking.get()).data()).toMatchObject({ ...officeBooking, specialRequests: "Staff note" })
      await assertFails(booking.update({
        adminLogs: [{ action: "NOTE", message: "Forged audit edit", createdAt: "2099-01-01T12:00:00Z" }],
      }))
      await assertSucceeds(firestore.collection("bookings").get())
      await assertSucceeds(firestore.collection("officeRentals").get())
    })

    it("denies direct legacy office rental creation, updates, and deletion", async () => {
      await seedProfilesAndRecords()
      const rentals = testEnv.authenticatedContext(uid).firestore().collection("officeRentals")
      await assertFails(rentals.doc("NEW-LEASE").set({ userId: "client", officeSpaceId: "ROOM-1", leaseStatus: "Pending Review" }))
      await assertFails(rentals.doc("OWN-LEASE").update({ officeSpaceId: "ROOM-2", leaseStatus: "Cancelled" }))
      await assertFails(rentals.doc("OWN-LEASE").update({ chequeNotes: "Even a metadata-only lease update is frozen" }))
      await assertFails(rentals.doc("OWN-LEASE").delete())
    })
  })

  it("retains client metadata writes and owner-scoped booking and rental queries", async () => {
    await seedProfilesAndRecords()
    const firestore = testEnv.authenticatedContext("client").firestore()
    await assertSucceeds(firestore.collection("bookings").doc("OFFICE-BOOKING").update({ lastActivityAt: "2099-01-01T12:00:00Z" }))
    await assertFails(firestore.collection("bookings").doc("BK002").update({ lastActivityAt: "2099-01-01T12:00:00Z" }))
    await assertSucceeds(firestore.collection("bookings").where("userId", "==", "client").get())
    await assertFails(firestore.collection("bookings").get())
    await assertSucceeds(firestore.collection("officeRentals").doc("OWN-LEASE").get())
    await assertFails(firestore.collection("officeRentals").doc("OTHER-LEASE").get())
    await assertSucceeds(firestore.collection("officeRentals").where("userId", "==", "client").get())
    await assertFails(firestore.collection("officeRentals").get())
  })

  it.each(["admin", "booking-staff", "payment-staff", "reports-staff", "client"])(
    "keeps maintenance readable but server-write-only for %s", async (uid) => {
      await seedProfilesAndRecords()
      const firestore = testEnv.authenticatedContext(uid).firestore()
      const records = firestore.collection("maintenanceRecords")
      await assertSucceeds(records.get())
      await assertFails(records.doc("NEW").set({ type: "venue", spaceId: "V1", date: "2099-03-01", status: "active" }))
      await assertFails(records.doc("MAINT001").update({ status: "inactive" }))
      await assertFails(records.doc("MAINT001").delete())
    },
  )

  it("denies unauthenticated maintenance access", async () => {
    await seedProfilesAndRecords()
    const records = testEnv.unauthenticatedContext().firestore().collection("maintenanceRecords")
    await assertFails(records.get())
    await assertFails(records.doc("MAINT001").delete())
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
    await assertFails(
      firestore.collection("users").doc("client").update({
        permissions: { users: true },
      }),
    )
    await assertFails(
      firestore.collection("users").doc("client").update({
        status: "inactive",
      }),
    )
    await assertFails(
      firestore.collection("users").doc("client").update({
        uid: "another-user",
      }),
    )
  })

  it("restricts Users-management staff to client metadata and blocks authorization escalation", async () => {
    await seedProfilesAndRecords()
    const firestore = testEnv.authenticatedContext("users-staff").firestore()

    await assertSucceeds(
      firestore.collection("users").doc("client").update({
        email: "staff-updated@example.com",
        phone: "+63 900 111 2222",
      }),
    )
    await assertFails(
      firestore.collection("users").doc("users-staff").update({
        role: "admin",
      }),
    )
    await assertFails(
      firestore.collection("users").doc("users-staff").update({
        permissions: { users: true, payments: true },
      }),
    )
    await assertFails(
      firestore.collection("users").doc("admin").update({
        role: "client",
        permissions: {},
        status: "inactive",
      }),
    )
    await assertFails(
      firestore.collection("users").doc("booking-staff").update({
        permissions: { bookings: true, users: true },
      }),
    )
    await assertFails(
      firestore.collection("users").doc("client").update({
        role: "staff",
      }),
    )
  })

  it("keeps administrator authorization changes server-only", async () => {
    await seedProfilesAndRecords()
    const firestore = testEnv.authenticatedContext("admin").firestore()

    await assertSucceeds(
      firestore.collection("users").doc("admin").update({ phone: "+63 900 333 4444" }),
    )
    await assertFails(
      firestore.collection("users").doc("booking-staff").update({
        permissions: { bookings: true, reports: true },
      }),
    )
    await assertFails(
      firestore.collection("users").doc("booking-staff").update({ status: "inactive" }),
    )
  })

  it("keeps receipt reads owner-scoped and makes receipt/audit writes server-only", async () => {
    await seedProfilesAndRecords()
    const client = testEnv.authenticatedContext("client").firestore()
    const admin = testEnv.authenticatedContext("admin").firestore()
    const paymentStaff = testEnv.authenticatedContext("payment-staff").firestore()

    await assertSucceeds(client.collection("receipts").doc("RECEIPT-CLIENT").get())
    await assertFails(client.collection("receipts").doc("RECEIPT-OTHER").get())
    await assertFails(
      client.collection("receipts").doc("FORGED").set({
        bookingId: "BK001",
        paymentStatus: "Verified",
        paymentAmount: 100000,
        reviewedBy: "Forged Client",
      }),
    )
    await assertFails(
      client.collection("receipts").doc("RECEIPT-CLIENT").update({
        paymentAmount: 100000,
        reviewedBy: "Forged Client",
      }),
    )
    await assertFails(
      client.collection("bookings").doc("BK001").update({
        receipt: { bookingId: "BK001", paymentStatus: "Verified", paymentAmount: 100000 },
        paymentReceipts: [{ bookingId: "BK001", paymentStatus: "Verified", paymentAmount: 100000 }],
        receiptIssued: true,
        adminLogs: [{ action: "FORGED" }],
      }),
    )
    await assertFails(
      admin.collection("receipts").doc("ADMIN-FORGED").set({
        bookingId: "BK001",
        paymentStatus: "Verified",
      }),
    )
    await assertFails(
      paymentStaff.collection("receipts").doc("STAFF-FORGED").set({
        bookingId: "BK001",
        paymentStatus: "Verified",
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
