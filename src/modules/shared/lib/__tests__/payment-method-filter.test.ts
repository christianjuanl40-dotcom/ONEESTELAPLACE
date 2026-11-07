import { describe, expect, it } from "vitest"
import {
  calculatePaymentSummary,
  filterPaymentRecordsByMethod,
  getReceiptPaymentMethodKey,
  getReceiptPaymentMethodLabel,
  getReceiptPresentation,
  type PaymentRecordLike,
} from "../payment-calculations"

const booking = {
  id: "BK-METHODS",
  totalPrice: 15000,
  paymentType: "full",
}

const records: PaymentRecordLike[] = [
  {
    id: "BANK-1",
    bookingId: booking.id,
    paymentMethod: "bank",
    status: "Verified",
    amount: 7500,
    submittedAt: "2026-10-01T10:00:00.000Z",
  },
  {
    id: "OFFICE-1",
    bookingId: booking.id,
    method: "Cash / Onsite",
    status: "Verified",
    amount: 7500,
    submittedAt: "2026-10-02T10:00:00.000Z",
  },
  {
    id: "BANK-PENDING",
    bookingId: booking.id,
    paymentMethod: "Bank Transfer",
    status: "For Verification",
    amount: 1000,
    submittedAt: "2026-10-03T10:00:00.000Z",
  },
]

describe("payment method history filtering", () => {
  it("normalizes bank and office aliases without guessing unknown methods", () => {
    expect(getReceiptPaymentMethodKey(records[0])).toBe("bank")
    expect(getReceiptPaymentMethodKey(records[1])).toBe("office")
    expect(getReceiptPaymentMethodKey({ id: "UNKNOWN", paymentMethod: "manual" })).toBe("other")
  })

  it("preserves stable source ordering and keeps all records in All Payments", () => {
    expect(filterPaymentRecordsByMethod(records, "all").map((record) => record.id)).toEqual([
      "BANK-1",
      "OFFICE-1",
      "BANK-PENDING",
    ])
    expect(filterPaymentRecordsByMethod(records, "bank").map((record) => record.id)).toEqual([
      "BANK-1",
      "BANK-PENDING",
    ])
    expect(filterPaymentRecordsByMethod(records, "office").map((record) => record.id)).toEqual(["OFFICE-1"])
    expect(filterPaymentRecordsByMethod(records, "office")).not.toBe(records)
  })

  it("keeps the booking ledger whole while receipt presentation stays transaction-specific", () => {
    const allSummary = calculatePaymentSummary(booking, records)
    const bankSummary = calculatePaymentSummary(booking, filterPaymentRecordsByMethod(records, "bank"))
    const officeSummary = calculatePaymentSummary(booking, filterPaymentRecordsByMethod(records, "office"))

    expect(allSummary.moneyReceivedTotal).toBe(15000)
    expect(allSummary.remainingBalance).toBe(0)
    expect(bankSummary.moneyReceivedTotal).toBe(7500)
    expect(officeSummary.moneyReceivedTotal).toBe(7500)

    const bankReceipt = {
      bookingId: booking.id,
      paymentId: "BANK-1",
      receiptNumber: "ER-BANK-1",
      paymentStatus: "Verified",
      paymentMethod: "Bank Transfer",
      amountPaid: 7500,
    }
    const officeReceipt = {
      bookingId: booking.id,
      paymentId: "OFFICE-1",
      receiptNumber: "ER-OFFICE-1",
      paymentStatus: "Verified",
      paymentMethod: "Pay at the Office",
      amountPaid: 7500,
    }

    expect(getReceiptPaymentMethodLabel(getReceiptPresentation(booking, records, records[0], [bankReceipt, officeReceipt]).transaction.paymentMethod))
      .toBe("Bank Transfer")
    expect(getReceiptPaymentMethodLabel(getReceiptPresentation(booking, records, records[1], [bankReceipt, officeReceipt]).transaction.paymentMethod))
      .toBe("Pay at the Office")
    expect(getReceiptPresentation(booking, records, records[0], [bankReceipt, officeReceipt]).transaction.amount)
      .toBe(7500)
  })
})
