import { describe, expect, it } from "vitest"

import {
  getBookingStatusPresentationClass,
  getBookingSchedulePresentationClass,
  getBookingListStatusPresentation,
  getPaymentStatusPresentationClass,
  getRefundStatusPresentationClass,
  getReportBookingStatusPresentationClass,
  getReportPaymentStatusPresentationClass,
} from "@/src/modules/shared/lib/status-presentation"

describe("status presentation mappings", () => {
  it("keeps schedule timing badges distinct from persisted lifecycle badges", () => {
    expect(getBookingSchedulePresentationClass("upcoming")).toContain("blue")
    expect(getBookingSchedulePresentationClass("active")).toContain("emerald")
    expect(getBookingSchedulePresentationClass("legacy")).toContain("slate")
  })

  it("keeps booking lifecycle meanings visually distinct", () => {
    expect(getBookingStatusPresentationClass("confirmed")).toContain("emerald")
    expect(getBookingStatusPresentationClass("pending")).toContain("orange")
    expect(getBookingStatusPresentationClass("cancelled")).toContain("rose")
    expect(getBookingStatusPresentationClass("rental_expired")).toContain("red")
    expect(getBookingStatusPresentationClass("active_rental")).toContain("sky")
  })

  it("projects client rows to one status badge without changing lifecycle data", () => {
    const now = new Date("2026-11-06T04:00:00.000Z")
    expect(getBookingListStatusPresentation({ status: "pending" }, now).label).toBe("Pending")
    expect(getBookingListStatusPresentation({ status: "confirmed", date: "2099-01-01" }, now).label).toBe("Confirmed")
    expect(getBookingListStatusPresentation({ status: "confirmed", date: "2026-11-06", startTime: "10:00", endTime: "16:00" }, now).label).toBe("Active")
    expect(getBookingListStatusPresentation({ status: "completed", date: "2026-01-01" }, now).label).toBe("Completed")
    expect(getBookingListStatusPresentation({ status: "cancelled", date: "2099-01-01" }, now).label).toBe("Cancelled")
    expect(getBookingListStatusPresentation({ status: "rejected", date: "2099-01-01" }, now).label).toBe("Rejected")
    expect(getBookingListStatusPresentation({ status: "confirmed" }, now).label).toBe("Confirmed")
  })

  it("gives refund state precedence without mutating payment state", () => {
    expect(getPaymentStatusPresentationClass("paid", "refunded")).toContain("slate")
    expect(getPaymentStatusPresentationClass("partial", "refund_requested")).toContain("orange")
    expect(getPaymentStatusPresentationClass("rejected")).toContain("rose")
  })

  it("maps report and refund domains independently", () => {
    expect(getReportBookingStatusPresentationClass("confirmed")).toContain("emerald")
    expect(getReportPaymentStatusPresentationClass("for review")).toContain("amber")
    expect(getPaymentStatusPresentationClass("for review")).toContain("amber")
    expect(getReportBookingStatusPresentationClass()).toContain("amber")
    expect(getRefundStatusPresentationClass()).toContain("amber")
    expect(getRefundStatusPresentationClass("eligible")).toContain("blue")
    expect(getRefundStatusPresentationClass("refunded")).toContain("emerald")
  })
})
