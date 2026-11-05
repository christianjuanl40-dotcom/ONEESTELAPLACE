import { describe, expect, it } from "vitest"

import {
  getBookingStatusPresentationClass,
  getPaymentStatusPresentationClass,
  getRefundStatusPresentationClass,
  getReportBookingStatusPresentationClass,
  getReportPaymentStatusPresentationClass,
} from "@/src/modules/shared/lib/status-presentation"

describe("status presentation mappings", () => {
  it("keeps booking lifecycle meanings visually distinct", () => {
    expect(getBookingStatusPresentationClass("confirmed")).toContain("emerald")
    expect(getBookingStatusPresentationClass("pending")).toContain("orange")
    expect(getBookingStatusPresentationClass("cancelled")).toContain("rose")
    expect(getBookingStatusPresentationClass("rental_expired")).toContain("red")
    expect(getBookingStatusPresentationClass("active_rental")).toContain("sky")
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
