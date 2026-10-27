import { describe, expect, it } from "vitest"
import {
  calculateBookingVerifiedPaymentSummary,
  buildBookingReceiptProjection,
  calculateReceiptPaymentSummary,
  findPaymentReceipt,
  getNextPaymentNumber,
  getReceiptPresentation,
  type PaymentRecordLike,
  type FinalizedPaymentSnapshot,
} from "../payment-calculations"
import { buildPaymentDecisionTransition, buildVerifiedPaymentTransition } from "../payment-verification"
import { resolvePaymentReviewNote } from "../payment-review"

const booking = { id: "BK-HISTORY", totalPrice: 10000, paymentType: "downpayment",
  selectedDownpaymentAmount: 5000, downPaymentPercentage: 50 }
const payment = (n: number, extra: Partial<PaymentRecordLike> = {}): PaymentRecordLike => ({
  id: `PAY-${n}`, bookingId: booking.id, paymentNumber: n, amount: 2500, term: "Down Payment",
  status: "For Verification", submittedAt: new Date(Date.UTC(2026, 8, n)).toISOString(),
  proofUrl: `https://example.test/proof-${n}.png`, ...extra,
})
const options = { verifiedAmount: 2500, adminName: "Reviewer", now: "2026-10-01T12:00:00.000Z" }

function history(count: number) {
  let records: PaymentRecordLike[] = []
  const frozen: FinalizedPaymentSnapshot[] = []
  for (let n = 1; n <= count; n++) {
    const target = payment(n, { amount: 250 })
    const transition = n % 3 === 2
      ? buildPaymentDecisionTransition(booking, [...records, target], target, "reject", { ...options, adminNote: `Rejected ${n}` })
      : buildVerifiedPaymentTransition(booking, [...records, target], target, { ...options, verifiedAmount: 250 })
    records = transition.records
    frozen.push(structuredClone(transition.payment.reviewSnapshot as FinalizedPaymentSnapshot))
  }
  return { records, frozen }
}

describe("selected finalized payment history", () => {
  it("keeps 7,500 / 7,500 / 5,000 balances for the illustrative three-submission history", () => {
    const first = buildVerifiedPaymentTransition(booking, [payment(1)], payment(1), options)
    const second = buildPaymentDecisionTransition(booking, [...first.records, payment(2)], payment(2), "reject", {
      ...options, adminNote: "Wrong proof", now: "2026-10-02T12:00:00.000Z",
    })
    const third = buildVerifiedPaymentTransition(booking, [...second.records, payment(3)], payment(3), {
      ...options, now: "2026-10-03T12:00:00.000Z",
    })
    expect(third.records.map((record) => getReceiptPresentation(booking, third.records, record).summary.remainingBookingBalance))
      .toEqual([7500, 7500, 5000])
    expect(getReceiptPresentation(booking, third.records, third.records[1]).transaction.creditedAmount).toBe(0)
    expect(third.records[0].reviewSnapshot).toEqual(first.payment.reviewSnapshot)
  })

  it.each([4, 10, 25])("preserves every snapshot in a %i-submission history across reordering, paging, and later price changes", (count) => {
    const { records, frozen } = history(count)
    const currentBooking = { ...booking, totalPrice: 99999, selectedDownpaymentAmount: 80000, paymentType: "full" }
    records.forEach((record, index) => {
      const admin = getReceiptPresentation(currentBooking, [...records].reverse(), record)
      // The client may have just one history page, or only this payment's receipt.
      const receipt = { bookingId: booking.id, paymentId: record.id, receiptNumber: `ER-${index}`,
        reviewSnapshot: record.reviewSnapshot }
      const client = getReceiptPresentation(currentBooking, [record], { ...record, receipt })
      const receiptOnly = getReceiptPresentation(currentBooking, [], receipt)
      expect(admin).toEqual(client)
      expect(receiptOnly.summary).toEqual(admin.summary)
      expect(admin.summary).toMatchObject(frozen[index].summary)
      expect(admin.summary.totalBookingAmount).toBe(10000)
      expect(record.reviewSnapshot).toEqual(frozen[index])
      expect(admin.transaction.paymentNumber).toBe(index + 1)
    })
    expect(getNextPaymentNumber(records)).toBe(count + 1)
  })

  it("captures the ledger at review finalization, independent of submission order", () => {
    const earlierSubmitted = payment(1)
    const laterSubmitted = payment(2)
    const reviewedFirst = buildVerifiedPaymentTransition(booking, [earlierSubmitted, laterSubmitted], laterSubmitted, options)
    const reviewedSecond = buildVerifiedPaymentTransition(booking, reviewedFirst.records, earlierSubmitted, {
      ...options, now: "2026-10-02T12:00:00.000Z",
    })
    expect(getReceiptPresentation(booking, reviewedSecond.records, reviewedSecond.records[1]).summary.remainingBookingBalance).toBe(7500)
    expect(getReceiptPresentation(booking, reviewedSecond.records, reviewedSecond.records[0]).summary.remainingBookingBalance).toBe(5000)
  })

  it("preserves original submitted amounts, incomplete credits, own notes/proofs, and excludes pending/rejected claims", () => {
    const first = buildPaymentDecisionTransition(booking, [payment(1)], payment(1), "incomplete", {
      ...options, verifiedAmount: 1500, adminNote: "Only 1,500 received",
    })
    const second = buildVerifiedPaymentTransition(booking, [...first.records, payment(2)], payment(2), {
      ...options, verifiedAmount: 1000, adminNote: "",
    })
    const later = [...second.records, payment(3)]
    const one = getReceiptPresentation(booking, later, later[0])
    const two = getReceiptPresentation(booking, later, later[1])
    expect(one.transaction).toMatchObject({ submittedAmount: 2500, creditedAmount: 1500, statusLabel: "Incomplete Payment" })
    expect(one.summary).toMatchObject({ acceptedTotalPaid: 1500, remainingBookingBalance: 8500,
      requiredDpAmount: 5000, acceptedDpPaid: 1500, remainingDpBalance: 3500 })
    expect(two.transaction).toMatchObject({ submittedAmount: 2500, creditedAmount: 1000 })
    expect(two.summary.acceptedTotalPaid).toBe(2500)
    expect(resolvePaymentReviewNote(one.record)).toBe("Only 1,500 received")
    expect(resolvePaymentReviewNote(two.record)).toBe("")
    expect(one.record?.proofUrl).toBe("https://example.test/proof-1.png")
    expect(getReceiptPresentation(booking, later, later[2]).transaction.creditedAmount).toBe(0)
    expect(getReceiptPresentation(booking, later, later[2]).summaryContext).toBe("pending")
  })

  it("does not let a changed payment projection or later verification retry overwrite a finalized snapshot", () => {
    const first = buildVerifiedPaymentTransition(booking, [payment(1)], payment(1), { ...options, adminNote: "Original" })
    const changed = { ...first.payment, amount: 9999, adminNote: "Unrelated note", proofUrl: "later.png" }
    const retry = buildVerifiedPaymentTransition({ ...booking, totalPrice: 20000 }, [changed], changed, options)
    expect(retry.payment.reviewSnapshot).toEqual(first.payment.reviewSnapshot)
    const view = getReceiptPresentation(booking, [changed], changed)
    expect(view.transaction.amount).toBe(2500)
    expect(resolvePaymentReviewNote(view.record)).toBe("Original")
    expect(view.record?.proofUrl).toBe("https://example.test/proof-1.png")
  })

  it("retains historical summary/notes in a compact booking projection and resolves the exact canonical proof", () => {
    const inlineProof = "data:image/webp;base64," + "A".repeat(220000)
    const target = payment(3, { proofUrl: inlineProof })
    const result = buildVerifiedPaymentTransition(booking, [target], target, { ...options, adminNote: "Own immutable review note" })
    const receipt = { bookingId: booking.id, paymentId: target.id, receiptNumber: "ER-3", reviewSnapshot: result.payment.reviewSnapshot }
    const original = structuredClone(receipt)
    const projection = buildBookingReceiptProjection(receipt)
    expect(Buffer.byteLength(JSON.stringify(projection))).toBeLessThan(5000)
    expect(projection.reviewSnapshot).toBeUndefined()
    expect(receipt).toEqual(original)
    const receiptOnly = getReceiptPresentation({ ...booking, totalPrice: 99999 }, [], projection)
    expect(receiptOnly.summaryContext).toBe("finalized")
    expect(receiptOnly.summary.remainingBookingBalance).toBe(7500)
    expect(resolvePaymentReviewNote(receiptOnly.record)).toBe("Own immutable review note")
    const canonical = getReceiptPresentation(booking, [], projection, [projection, receipt])
    expect(canonical.record?.proofUrl).toBe(inlineProof)
    expect(canonical.summary).toEqual(receiptOnly.summary)
    expect(getReceiptPresentation(booking, [result.payment], projection, [projection]).record?.proofUrl).toBe(inlineProof)
  })
})

describe("legacy historical evidence and identity", () => {
  it("never fabricates history from current totals, current statuses, or a loaded page", () => {
    const legacy = payment(1, { status: "Verified" })
    const view = getReceiptPresentation({ ...booking, amountPaid: 10000 }, [legacy, payment(2, { status: "Verified" })], legacy)
    expect(view.summaryContext).toBe("unavailable")
    expect(Object.values(view.summary)).toEqual([null, null, null, null, null, null])
  })

  it("uses only the selected finalized legacy receipt's stored values", () => {
    const legacy = payment(1, { status: "Verified", receiptNumber: "ER-1" })
    const ownReceipt = { bookingId: booking.id, paymentId: legacy.id, receiptNumber: "ER-1",
      paymentStatus: "Verified", remainingBalance: 7500 }
    const latestReceipt = { ...ownReceipt, paymentId: "PAY-99", receiptNumber: "ER-99", remainingBalance: 0 }
    const view = getReceiptPresentation(booking, [legacy], legacy, [latestReceipt, ownReceipt])
    expect(view.summary.remainingBookingBalance).toBe(7500)
    expect(view.summary.totalBookingAmount).toBeNull()
    expect(view.summary.acceptedTotalPaid).toBeNull()
    expect(view.summary.requiredDpAmount).toBeNull()
    expect(findPaymentReceipt(booking, legacy, [latestReceipt])).toBeNull()
    expect(findPaymentReceipt(booking, legacy, [{ ...ownReceipt, bookingId: "OTHER" }])).toBeNull()
    expect(findPaymentReceipt(booking, legacy, [{ ...ownReceipt, paymentId: "", receiptNumber: "OTHER", submittedAt: legacy.submittedAt }])).toBeNull()
  })

  it("ignores a pending receipt's pre-review balance and a snapshot tied to another payment/booking", () => {
    const { records } = history(4)
    const snapshot = records[0].reviewSnapshot
    const selected = payment(2, { status: "Verified", reviewSnapshot: snapshot })
    const view = getReceiptPresentation(booking, [selected], selected, [{ bookingId: booking.id, paymentId: selected.id,
      paymentStatus: "For Verification", remainingBalance: 1234 }])
    expect(view.summaryContext).toBe("unavailable")
    expect(view.summary.remainingBookingBalance).toBeNull()
    expect(getReceiptPresentation({ ...booking, id: "OTHER" }, [], records[0]).summaryContext).toBe("unavailable")
    expect(getReceiptPresentation({ ...booking, id: "OTHER" }, [], records[0]).record).toBeNull()
  })

  it("resolves an exact receipt-only transaction's own credited amount from its finalized receipt outcome", () => {
    const receipt = { paymentId: "LEGACY", bookingId: booking.id, receiptNumber: "ER-LEGACY",
      paymentStatus: "Verified", amountPaid: 2500, remainingBalance: 7500 }
    const verified = getReceiptPresentation(booking, [], receipt)
    expect(verified.transaction.creditedAmount).toBe(2500)
    expect(verified.summary.remainingBookingBalance).toBe(7500)
    expect(getReceiptPresentation(booking, [], { ...receipt, paymentStatus: "Rejected" }).transaction.creditedAmount).toBe(0)
    expect(getReceiptPresentation(booking, [], { ...receipt, paymentStatus: "Incomplete", amountReceived: 1000 }).transaction.creditedAmount).toBe(1000)
  })
})

describe("live credited ledger and verified-only diagnostics", () => {
  it("preserves legacy incomplete credit, office handling, DP requirements, and nonnegative/capped balances", () => {
    const records = [payment(1, { status: "Incomplete", amount: 1500, requestedAmount: 5000 }),
      payment(2, { status: "Verified", amount: 1000 }), payment(3), payment(4, { status: "Rejected" })]
    const summary = calculateReceiptPaymentSummary({ ...booking, paymentType: "full" }, records)
    expect(summary).toMatchObject({ acceptedTotalPaid: 2500, acceptedDpPaid: 2500, requiredDpAmount: 5000,
      remainingDpBalance: 2500, remainingBookingBalance: 7500 })
    expect(calculateBookingVerifiedPaymentSummary(booking, records).totalVerifiedPaid).toBe(1000)
    expect(calculateReceiptPaymentSummary(booking, [payment(1, { status: "Verified", amount: 20000 })]).remainingBalance).toBe(0)
    expect(calculateReceiptPaymentSummary({ ...booking, paymentType: "slot_reservation", selectedDownpaymentAmount: 0 },
      [payment(1, { term: "Slot Reservation", status: "Verified" })]).requiredDpAmount).toBe(0)
    expect(calculateReceiptPaymentSummary({ ...booking, amountPaid: 2500 }, []).acceptedTotalPaid).toBe(2500)
  })
})
