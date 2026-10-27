// Regression harness for the canonical payment flow.
// Run: node --experimental-strip-types scripts/verify-payment-flow.mts
//
// Encodes the FINAL payment-flow spec:
//   - acceptedVerifiedTotal  = verified records only (official acceptance)
//   - downpaymentCreditedTotal = verified + received amounts of INCOMPLETE
//     payments (rejected/pending credit ₱0)
//   - moneyReceivedTotal drives remainingBalance, downpayment completion,
//     PARTIAL and FULLY PAID
//   - individual record statuses are INDEPENDENT of the overall booking
//     status; receipts are never reused or deleted.
import {
  calculatePaymentSummary,
  getOverallPaymentStatus,
  getPaymentRecordAmount,
  getPaymentRecordStatusLabel,
  isIncompletePaymentRecord,
  type BookingLike,
  type PaymentRecordLike,
} from "../src/modules/shared/lib/payment-calculations.ts"

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"} ${name} -> ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`)
}

const TOTAL = 15000
const DP = 7500

const booking = (extra: Partial<BookingLike> & Record<string, unknown> = {}): BookingLike => ({
  id: "BK-TEST",
  totalPrice: TOTAL,
  paymentType: "downpayment",
  selectedDownpaymentAmount: DP,
  amountPaid: 0,
  ...extra,
})

type RecStatus = "Verified" | "Incomplete" | "Rejected" | "For Verification"
const rec = (
  id: string,
  status: RecStatus,
  amount: number,
  submittedAt: string,
  extra: Record<string, unknown> = {},
): PaymentRecordLike => ({
  id,
  bookingId: "BK-TEST",
  status,
  amount,
  submittedAt,
  ...extra,
})

// ---------------------------------------------------------------------------
// SECTION 1 — overall status flow
// ---------------------------------------------------------------------------
{
  const s = calculatePaymentSummary(booking(), [rec("p1", "Verified", 5500, "2026-01-01T10:00:00Z")])
  check("S1 [5.5k VERIFIED] status", s.overallStatus, "incomplete")
  check("S1 moneyReceivedTotal", s.moneyReceivedTotal, 5500)
  check("S1 remainingBalance (booking)", s.remainingBalance, 9500)
  check("S1 remainingDownpayment", s.remainingDownpayment, 2000)
}
{
  const s = calculatePaymentSummary(booking(), [rec("p1", "Incomplete", 5500, "2026-01-01T10:00:00Z")])
  check("S2 [5.5k INCOMPLETE] status", s.overallStatus, "incomplete")
  check("S2 acceptedTotal stays ₱0", s.acceptedVerifiedTotal, 0)
  check("S2 moneyReceivedTotal credits receipt", s.moneyReceivedTotal, 5500)
  check("S2 remainingBalance (booking)", s.remainingBalance, 9500)
  check("S2 remainingDownpayment", s.remainingDownpayment, 2000)
}
{
  // KEY RULE — incomplete money + later verified money covering the DP ⇒ PARTIAL,
  // while record #1 stays INCOMPLETE (independence asserted in Section 4).
  const s = calculatePaymentSummary(booking(), [
    rec("p1", "Incomplete", 5500, "2026-01-01T10:00:00Z"),
    rec("p2", "Verified", 2000, "2026-01-02T10:00:00Z"),
  ])
  check("S3 [5.5k INC + 2k VER] status PARTIAL", s.overallStatus, "partial")
  check("S3 accepted stays verified-only", s.acceptedVerifiedTotal, 2000)
  check("S3 moneyReceivedTotal", s.moneyReceivedTotal, 7500)
  check("S3 settle amount (remaining booking balance)", s.remainingBalance, 7500)
  check("S3 remainingDownpayment", s.remainingDownpayment, 0)
}
{
  const s = calculatePaymentSummary(booking(), [rec("p1", "Verified", 7500, "2026-01-01T10:00:00Z")])
  check("S4 [7.5k VERIFIED] status PARTIAL", s.overallStatus, "partial")
  check("S4 settle amount", s.remainingBalance, 7500)
}
{
  const s = calculatePaymentSummary(booking(), [
    rec("p1", "Verified", 7500, "2026-01-01T10:00:00Z"),
    rec("p2", "Verified", 7500, "2026-01-02T10:00:00Z"),
  ])
  check("S5 fully paid", s.overallStatus, "completed")
  check("S5 remaining balance ₱0", s.remainingBalance, 0)
}
{
  // Old rejected record must not change a covered downpayment.
  const s = calculatePaymentSummary(booking(), [
    rec("p1", "Verified", 5000, "2026-01-01T10:00:00Z"),
    rec("p2", "Verified", 2500, "2026-01-02T10:00:00Z"),
    rec("p3", "Rejected", 2000, "2026-01-03T10:00:00Z"),
  ])
  check("S6 rejected ignored → PARTIAL", s.overallStatus, "partial")
  check("S6 moneyReceivedTotal", s.moneyReceivedTotal, 7500)
}
{
  const s = calculatePaymentSummary(booking(), [
    rec("p1", "Incomplete", 5500, "2026-01-01T10:00:00Z"),
    rec("p2", "Incomplete", 1000, "2026-01-02T10:00:00Z"),
  ])
  check("S7 two incompletes status", s.overallStatus, "incomplete")
  check("S7 credited 6,500", s.downpaymentCreditedTotal, 6500)
  check("S7 remainingDownpayment ₱1,000", s.remainingDownpayment, 1000)
  check("S7 remainingBalance (booking)", s.remainingBalance, 8500)
}
{
  const s = calculatePaymentSummary(booking(), [
    rec("p1", "Incomplete", 5500, "2026-01-01T10:00:00Z"),
    rec("p2", "Rejected", 2000, "2026-01-02T10:00:00Z"),
  ])
  check("S8 rejected credits nothing", s.downpaymentCreditedTotal, 5500)
  check("S8 NOT partial", s.overallStatus !== "partial", true)
  check("S8 remainingDownpayment ₱2,000", s.remainingDownpayment, 2000)
  check("S8 remainingBalance (booking)", s.remainingBalance, 9500)
}
{
  const s = calculatePaymentSummary(booking(), [
    rec("p1", "Incomplete", 5500, "2026-01-01T10:00:00Z"),
    rec("p2", "Rejected", 2000, "2026-01-02T10:00:00Z"),
    rec("p3", "Verified", 2500, "2026-01-03T10:00:00Z"),
  ])
  check("S9 mixed history → PARTIAL", s.overallStatus, "partial")
  check("S9 moneyReceivedTotal", s.moneyReceivedTotal, 8000)
  check("S9 settle amount", s.remainingBalance, 7000)
}
{
  // Pending submissions gate actions only while the DP is still open.
  const s1 = calculatePaymentSummary(booking(), [
    rec("p1", "Verified", 5500, "2026-01-01T10:00:00Z"),
    rec("p2", "For Verification", 1000, "2026-01-02T10:00:00Z"),
  ])
  check("S10 open DP + pending → for_review", s1.overallStatus, "for_review")
  const s2 = calculatePaymentSummary(booking(), [
    rec("p1", "Verified", 7500, "2026-01-01T10:00:00Z"),
    rec("p2", "For Verification", 2000, "2026-01-02T10:00:00Z"),
  ])
  check("S10 covered DP + pending stays PARTIAL", s2.overallStatus, "partial")
}
{
  // Convergence per the flow chart: settle → verified → FULLY PAID even when
  // an earlier short payment was kept as INCOMPLETE.
  const s = calculatePaymentSummary(booking(), [
    rec("p1", "Incomplete", 5500, "2026-01-01T10:00:00Z"),
    rec("p2", "Verified", 9500, "2026-01-02T10:00:00Z"),
  ])
  check("S11 credited covers total → completed", s.overallStatus, "completed")
  check("S11 remaining balance ₱0", s.remainingBalance, 0)
}
{
  const s = calculatePaymentSummary(booking(), [])
  check("S12 legacy no records → remainingDownpayment full", s.remainingDownpayment, 7500)
  check("S12 legacy remainingBalance", s.remainingBalance, 15000)
}
{
  // Admin-entered received amount overrides the submitted claim.
  const s = calculatePaymentSummary(booking(), [
    rec("p1", "Incomplete", 7000, "2026-01-01T10:00:00Z", { amountReceived: 3000 }),
  ])
  check("S13 credited uses received amount", s.downpaymentCreditedTotal, 3000)
  check("S13 remainingDownpayment ₱4,500", s.remainingDownpayment, 4500)
  check("S13 acceptedTotal stays ₱0", s.acceptedVerifiedTotal, 0)
}
{
  // TEST 3 — ₱5,500 INCOMPLETE followed by a full ₱7,500 VERIFIED payment.
  // The old incomplete money is NOT promoted to verified; it only credits
  // what the client actually handed over, so the booking follows the
  // canonical credited-ledger rules.
  const p1 = rec("p1", "Incomplete", 5500, "2026-01-01T10:00:00Z")
  const records = [p1, rec("p2", "Verified", 7500, "2026-01-02T10:00:00Z")]
  const s = calculatePaymentSummary(booking(), records)
  check("T3 status PARTIAL (DP covered, balance left)", s.overallStatus, "partial")
  check("T3 old incomplete NOT counted as verified", s.acceptedVerifiedTotal, 7500)
  check("T3 money held = 5,500 + 7,500", s.moneyReceivedTotal, 13000)
  check("T3 settle amount = true outstanding ₱2,000", s.remainingBalance, 2000)
  check("T3 downpayment requirement closed", s.remainingDownpayment, 0)
  check("T3 record #1 label still INCOMPLETE", getPaymentRecordStatusLabel(p1), "Incomplete Payment")
}

// ---------------------------------------------------------------------------
// SECTION 2 — CLIENT UI DECISION MIRROR
// (exact branch logic from app/portal/payments/page.tsx:
//  summarizedTransactions overwrite + PaymentActionButtons + pay view)
// ---------------------------------------------------------------------------

// summarizedTransactions overwrite (portal payments page).
function summarize(b: BookingLike, records: PaymentRecordLike[]): BookingLike {
  const summary = calculatePaymentSummary(b, records)
  return {
    ...b,
    paymentStatus: summary.overallStatus,
    amountPaid: summary.moneyReceivedTotal,
    remainingBalance: summary.remainingBalance,
  } as BookingLike
}

// PaymentActionButtons conditions.
function clientActions(b: BookingLike, records: PaymentRecordLike[]) {
  const summary = calculatePaymentSummary(b, records)
  const canSettle =
    summary.overallStatus === "partial" &&
    summary.moneyReceivedTotal >= summary.requiredDownpayment &&
    summary.moneyReceivedTotal < summary.bookingTotal &&
    summary.remainingBalance > 0
  const makePayment =
    !canSettle &&
    (summary.overallStatus === "incomplete" || summary.overallStatus === "rejected")
  return { status: summary.overallStatus, canSettle, makePayment }
}

// Pay-view heading + amount (selectedBookingToPay block). rawFields simulate
// the booking document exactly as each admin action leaves it.
function payView(rawFields: {
  paymentStage?: string
  balanceStatus?: string
  downpaymentRemaining?: number
}) {
  return function inner(summarized: BookingLike, records: PaymentRecordLike[]) {
    const summary = calculatePaymentSummary(summarized, records)
    const totalPrice = Number((summarized as any).totalPrice || 0)
    const requiredDownpayment = summary.requiredDownpayment
    const selectedDP = Number(
      (summarized as any).selectedDownpaymentAmount ||
        (Number((summarized as any).downPaymentPercentage || 50) / 100) * totalPrice,
    )
    const downpaymentRemaining =
      requiredDownpayment > 0
        ? summary.remainingDownpayment
        : Number(
            (summarized as any).downpaymentRemaining ||
              Math.max(selectedDP - Number((summarized as any).downpaymentPaid || 0), 0),
          )
    const paymentStage = String(rawFields.paymentStage ?? "").toLowerCase()
    const bs = String(rawFields.balanceStatus ?? "").toLowerCase()
    const ps = String((summarized as any).paymentStatus || "").toLowerCase()
    const isSettlingBalance =
      (summarized as any).status === "confirmed" &&
      (summarized as any).paymentType === "downpayment"
    const isCompletingDownpayment =
      (paymentStage === "complete downpayment" || isSettlingBalance) && downpaymentRemaining > 0
    const isRemainingPaymentFlow =
      ps === "partial" ||
      ps === "incomplete" ||
      bs === "with remaining balance" ||
      paymentStage === "complete downpayment" ||
      paymentStage === "settle remaining balance"
    const currentAmountPaid = Number((summarized as any).amountPaid || 0)
    const remainingBalance =
      records.length > 0
        ? summary.remainingBalance
        : Number(
            (summarized as any).remainingBalance ||
              Math.max(totalPrice - currentAmountPaid, 0),
          )
    const heading = isCompletingDownpayment
      ? "Complete Your Downpayment"
      : isRemainingPaymentFlow
        ? "Settle Remaining Balance"
        : "Secure Your Booking"
    // Faithful copy of the page's full amountToPay chain.
    const downpaymentAmount =
      (Number((summarized as any).downPaymentPercentage || 50) / 100) * totalPrice
    const isFullTerm =
      String((summarized as any).paymentType || "").toLowerCase() === "full"
    const amountToPay = isCompletingDownpayment
      ? downpaymentRemaining
      : isRemainingPaymentFlow
        ? remainingBalance
        : isSettlingBalance
          ? remainingBalance || downpaymentAmount
          : isFullTerm
            ? totalPrice
            : downpaymentAmount
    return { heading, amountToPay }
  }
}

// Raw booking-doc fields as each admin action leaves them.
const RAW_AFTER_INCOMPLETE = { paymentStage: "Complete Downpayment", balanceStatus: "With Remaining Balance" }
const RAW_AFTER_PARTIAL_VERIFY = { paymentStage: "Complete Downpayment", balanceStatus: "With Remaining Balance" }
const RAW_AFTER_DP_COMPLETE = { paymentStage: "Settle Remaining Balance", balanceStatus: "With Remaining Balance" }

{
  // U1 — client paid ₱5,500, admin marked it INCOMPLETE.
  const records = [rec("p1", "Incomplete", 5500, "2026-01-01T10:00:00Z")]
  const s = summarize(booking({ status: "verifying" }), records)
  const actions = clientActions(s, records)
  const view = payView(RAW_AFTER_INCOMPLETE)(s, records)
  check("U1 heading", view.heading, "Complete Your Downpayment")
  check("U1 amount to pay ₱2,000", view.amountToPay, 2000)
  check("U1 settle hidden", actions.canSettle, false)
  check("U1 make-payment available", actions.makePayment, true)
}
{
  // U2 — admin VERIFIED the ₱5,500 (partial toward DP): same client outcome.
  const records = [rec("p1", "Verified", 5500, "2026-01-01T10:00:00Z")]
  const s = summarize(booking({ status: "confirmed", downpaymentPaid: 5500 }), records)
  const actions = clientActions(s, records)
  const view = payView(RAW_AFTER_PARTIAL_VERIFY)(s, records)
  check("U2 heading", view.heading, "Complete Your Downpayment")
  check("U2 amount to pay ₱2,000", view.amountToPay, 2000)
  check("U2 settle hidden", actions.canSettle, false)
  check("U2 make-payment available", actions.makePayment, true)
}
{
  // U3 — client then pays ₱2,000, admin verifies → downpayment complete.
  const records = [
    rec("p1", "Incomplete", 5500, "2026-01-01T10:00:00Z"),
    rec("p2", "Verified", 2000, "2026-01-02T10:00:00Z"),
  ]
  const s = summarize(booking({ status: "confirmed", downpaymentPaid: 2000 }), records)
  const actions = clientActions(s, records)
  const view = payView(RAW_AFTER_DP_COMPLETE)(s, records)
  check("U3 heading", view.heading, "Settle Remaining Balance")
  check("U3 settle amount ₱7,500", view.amountToPay, 7500)
  check("U3 settle visible", actions.canSettle, true)
  check("U3 make-payment hidden", actions.makePayment, false)
}
{
  // U4 — fully settled: no actions at all.
  const records = [
    rec("p1", "Verified", 7500, "2026-01-01T10:00:00Z"),
    rec("p2", "Verified", 7500, "2026-01-02T10:00:00Z"),
  ]
  const s = summarize(booking(), records)
  const actions = clientActions(s, records)
  check("U4 no settle", actions.canSettle, false)
  check("U4 no make-payment", actions.makePayment, false)
}
{
  // U5 — multiple incompletes: ask only for what remains (₱1,000).
  const records = [
    rec("p1", "Incomplete", 5500, "2026-01-01T10:00:00Z"),
    rec("p2", "Incomplete", 1000, "2026-01-02T10:00:00Z"),
  ]
  const s = summarize(booking({ status: "verifying" }), records)
  const view = payView(RAW_AFTER_INCOMPLETE)(s, records)
  check("U5 amount to pay ₱1,000", view.amountToPay, 1000)
  check("U5 heading", view.heading, "Complete Your Downpayment")
}
{
  // U6 — old failed attempts must not erase progress or hide the action.
  const records = [
    rec("p1", "Incomplete", 5500, "2026-01-01T10:00:00Z"),
    rec("p2", "Rejected", 2000, "2026-01-02T10:00:00Z"),
  ]
  const s = summarize(booking({ status: "verifying" }), records)
  const actions = clientActions(s, records)
  const view = payView(RAW_AFTER_INCOMPLETE)(s, records)
  check("U6 still owes ₱2,000 toward DP", view.amountToPay, 2000)
  check("U6 action remains available", actions.makePayment, true)
  check("U6 settle hidden", actions.canSettle, false)
}
{
  // U7 — legacy booking without records: full downpayment requested once.
  const s = summarize(booking(), [])
  const view = payView({})(s, [])
  check("U7 legacy asks ₱7,500", view.amountToPay, 7500)
}

// ---------------------------------------------------------------------------
// SECTION 3 — record/receipt independence
// ---------------------------------------------------------------------------
{
  const p1 = rec("p1", "Incomplete", 5500, "2026-01-01T10:00:00Z")
  const records = [p1, rec("p2", "Verified", 2000, "2026-01-02T10:00:00Z")]
  const s = calculatePaymentSummary(booking(), records)
  check("R1 booking PARTIAL while record #1 INCOMPLETE", s.overallStatus, "partial")
  check("R2 record #1 label unchanged", getPaymentRecordStatusLabel(p1), "Incomplete Payment")
  check("R3 record #1 flagged incomplete", isIncompletePaymentRecord(p1), true)
  check("R4 record amounts untouched", [p1.amount, records[1].amount], [5500, 2000])
  check(
    "R5 helper agreement",
    getOverallPaymentStatus(booking(), records),
    s.overallStatus,
  )
}

// ---------------------------------------------------------------------------
// SECTION 4 — MANDATORY END-TO-END SCENARIO (₱15,000 / DP ₱7,500 / ₱5,500 INC)
// Each step simulates the EXACT booking-doc + record state the real mutation
// functions leave behind (submitPayment / markIncompletePayment /
// verifyPayment), then asserts the canonical summary + client UI decisions.
// ---------------------------------------------------------------------------
{
  const t = "2026-03-01T09:00:00Z"
  // STEP 1 — client submits ₱5,500 (FOR REVIEW)
  let records = [rec("p1", "For Verification", 5500, t)]
  let b = booking({
    status: "verifying",
    paymentStatus: "for_review",
    paymentAmount: 5500,
    pendingPaymentAmount: 5500,
    paymentSubmittedAt: t,
    hasActivePaymentSubmission: true,
  })
  let s = calculatePaymentSummary(b, records)
  check("STEP 1 record pending → for_review", s.overallStatus, "for_review")
  check("STEP 1 settle hidden", s.overallStatus === "partial", false)

  // STEP 2 — admin marks Payment #1 INCOMPLETE (received ₱5,500)
  records = [rec("p1", "Incomplete", 5500, t)]
  b = booking({
    status: "verifying",
    paymentStatus: "incomplete",
    paymentStage: "Complete Downpayment",
    balanceStatus: "With Remaining Balance",
  })
  s = calculatePaymentSummary(b, records)
  check("STEP 2 status INCOMPLETE", s.overallStatus, "incomplete")
  check("STEP 2 accepted stays ₱0", s.acceptedVerifiedTotal, 0)
  check("STEP 2 submitted-toward-DP remembered", s.downpaymentCreditedTotal, 5500)
  check("STEP 2 remainingDownpayment ₱2,000", s.remainingDownpayment, 2000)
  check("STEP 2 settle hidden", s.overallStatus === "partial", false)

  // STEP 3 — client submits ₱2,000 (FOR REVIEW); old record untouched
  records = [
    rec("p1", "Incomplete", 5500, t),
    rec("p2", "For Verification", 2000, "2026-03-02T09:00:00Z"),
  ]
  b = booking({
    status: "verifying",
    paymentStatus: "for_review",
    paymentStage: "Complete Downpayment",
    paymentAmount: 2000,
    pendingPaymentAmount: 2000,
    paymentSubmittedAt: "2026-03-02T09:00:00Z",
    hasActivePaymentSubmission: true,
  })
  s = calculatePaymentSummary(b, records)
  check("STEP 3 while FOR REVIEW → for_review (no settle)", s.overallStatus, "for_review")
  check("STEP 3 credited unchanged", s.downpaymentCreditedTotal, 5500)

  // STEP 4 — admin verifies Payment #2 → downpayment covered → PARTIAL
  records = [
    rec("p1", "Incomplete", 5500, t),
    rec("p2", "Verified", 2000, "2026-03-02T09:00:00Z"),
  ]
  b = booking({
    status: "confirmed",
    paymentStatus: "incomplete",
    paymentStage: "Complete Downpayment",
    amountPaid: 2000,
    downpaymentPaid: 2000,
    selectedDownpaymentAmount: DP,
  })
  s = calculatePaymentSummary(b, records)
  check("STEP 4 overall PARTIAL PAYMENT", s.overallStatus, "partial")
  check("STEP 4 DP covered 5,500+2,000", s.downpaymentCreditedTotal, 7500)
  check("STEP 4 verified total stays ₱2,000", s.acceptedVerifiedTotal, 2000)
  check("STEP 4 remaining booking balance ₱7,500", s.remainingBalance, 7500)
  check(
    "STEP 4 settle visible",
    s.overallStatus === "partial" && s.moneyReceivedTotal >= DP && s.remainingBalance > 0,
    true,
  )

  // STEP 5 — client settles ₱7,500, admin verifies → FULLY PAID
  records.push(rec("p3", "Verified", 7500, "2026-03-03T09:00:00Z"))
  b = booking({
    status: "confirmed",
    paymentStatus: "paid",
    paymentStage: "Fully Paid",
    amountPaid: 9500,
    downpaymentPaid: 2000,
    selectedDownpaymentAmount: DP,
  })
  s = calculatePaymentSummary(b, records)
  check("STEP 5 FULLY PAID", s.overallStatus, "completed")
  check("STEP 5 remaining balance ₱0", s.remainingBalance, 0)
  check("STEP 5 history kept intact (3 payments)", records.length, 3)
}

// ---------------------------------------------------------------------------
// SECTION 5 — additional regressions
// ---------------------------------------------------------------------------
{
  // Regression A — zero/absent amountReceived on an INCOMPLETE record must
  // fall back to the SUBMITTED amount (never zero out the credit).
  const s = calculatePaymentSummary(booking(), [
    rec("p1", "Incomplete", 7500, "2026-01-01T10:00:00Z", { amountReceived: 0 }),
  ])
  check("REG amountReceived=0 falls back to submitted", s.downpaymentCreditedTotal, 7500)
  check("REG remainingDownpayment stays ₱0", s.remainingDownpayment, 0)
}
{
  // Regression B — rejected ₱5,500 only → full DP still owed.
  const s = calculatePaymentSummary(booking(), [rec("p1", "Rejected", 5500, "2026-01-01T10:00:00Z")])
  check("REG-B rejected credits ₱0", s.downpaymentCreditedTotal, 0)
  check("REG-B remainingDownpayment ₱7,500", s.remainingDownpayment, 7500)
  check("REG-B status rejected (make-payment available)", s.overallStatus, "rejected")
}
{
  // Regression C/D — verified paths unchanged.
  const c = calculatePaymentSummary(booking(), [rec("p1", "Verified", 7500, "2026-01-01T10:00:00Z")])
  check("REG-C verified DP → PARTIAL", c.overallStatus, "partial")
  check("REG-C settle ₱7,500", c.remainingBalance, 7500)
  const d = calculatePaymentSummary(booking(), [
    rec("p1", "Verified", 5500, "2026-01-01T10:00:00Z"),
    rec("p2", "Verified", 2000, "2026-01-02T10:00:00Z"),
  ])
  check("REG-D 5,500+2,000 verified → PARTIAL", d.overallStatus, "partial")
  check("REG-D settle ₱7,500", d.remainingBalance, 7500)
}
{
  // Regression E — verified DP + verified balance → FULLY PAID.
  const e = calculatePaymentSummary(booking(), [
    rec("p1", "Verified", 7500, "2026-01-01T10:00:00Z"),
    rec("p2", "Verified", 7500, "2026-01-02T10:00:00Z"),
  ])
  check("REG-E FULLY PAID, ₱0 remaining", [e.overallStatus, e.remainingBalance], ["completed", 0])
}
{
  // Regression F — Mark as Incomplete REWRITES the record to the ACTUAL
  // money received (₱5,500 of a ₱7,500 request) and preserves the original
  // request separately. Exactly the shape markIncompletePayment now saves.
  const p1 = rec("p1", "Incomplete", 5500, "2026-01-01T10:00:00Z", {
    amountPaid: 5500,
    amountReceived: 5500,
    requestedAmount: 7500,
  })
  const s = calculatePaymentSummary(booking(), [p1])
  check("REG-F displayed Amount Paid = ₱5,500", getPaymentRecordAmount(p1), 5500)
  check("REG-F credited toward DP = ₱5,500", s.downpaymentCreditedTotal, 5500)
  check("REG-F accepted total stays ₱0", s.acceptedVerifiedTotal, 0)
  check("REG-F remainingDownpayment ₱2,000", s.remainingDownpayment, 2000)
  check("REG-F status INCOMPLETE", s.overallStatus, "incomplete")
  check("REG-F requested amount preserved on record", p1.requestedAmount, 7500)
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
