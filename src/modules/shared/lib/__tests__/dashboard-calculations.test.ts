import { describe, expect, it } from "vitest"
import {
  calculateAdminDashboardMetrics,
  calculateClientPaymentOverview,
} from "../dashboard-calculations"

const bookings = [
  {
    id: "CONFIRMED",
    status: "confirmed",
    totalPrice: 10000,
    paymentType: "downpayment",
    selectedDownpaymentAmount: 5000,
  },
  {
    id: "PENDING",
    status: "pending",
    totalPrice: 5000,
    paymentType: "downpayment",
    selectedDownpaymentAmount: 2500,
  },
  {
    id: "CANCELLED",
    status: "cancelled",
    totalPrice: 3000,
    paymentType: "full",
  },
]

const payments = [
  { id: "VERIFIED", bookingId: "CONFIRMED", status: "Verified", amount: 2000 },
  { id: "PENDING", bookingId: "CONFIRMED", status: "For Review", amount: 3000 },
  { id: "PENDING-BOOKING", bookingId: "PENDING", status: "For Review", amount: 1000 },
]

describe("dashboard calculations", () => {
  it("keeps booked value separate from credited and pending payment money", () => {
    const metrics = calculateAdminDashboardMetrics(bookings, payments, 2)

    expect(metrics.bookedValue).toBe(10000)
    expect(metrics.receivedPayments).toBe(2000)
    expect(metrics.pendingPaymentTotal).toBe(4000)
    expect(metrics.pending).toBe(1)
    expect(metrics.confirmed).toBe(1)
    expect(metrics.cancelled).toBe(1)
    expect(metrics.verifying).toBe(2)
  })

  it("derives the client payment overview from the canonical ledger", () => {
    const overview = calculateClientPaymentOverview(bookings, payments)

    expect(overview.totalBookingValue).toBe(18000)
    expect(overview.receivedPayments).toBe(2000)
    expect(overview.pendingVerification).toBe(4000)
    expect(overview.outstandingBalance).toBe(16000)
  })
})
