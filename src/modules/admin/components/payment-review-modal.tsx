"use client"

import type React from "react"
import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  FileText,
  History,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react"

import {
  ReceiptPaper,
  type ReceiptPaperData,
} from "@/src/modules/shared/components/receipt-paper"
import { PaymentReviewDetails } from "@/src/modules/shared/components/payment-review-details"
import { usePaymentHistorySelection } from "@/src/modules/shared/hooks/use-payment-history-selection"
import { resolvePaymentReviewNote } from "@/src/modules/shared/lib/payment-review"
import { isOfficeResourceBooking } from "@/src/modules/shared/lib/resource-identity"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Textarea } from "@/src/modules/shared/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/src/modules/shared/components/ui/dialog"
import type { PaymentRecord } from "@/src/modules/client/contexts/booking-context"
import {
  calculatePaymentSummary,
  findPaymentReceipt,
  getPaymentDisplayModel,
  getPaymentRecordStatusLabel,
  getReceiptPaymentNumber,
  getReceiptPaymentType,
  getReceiptPresentation,
  isIncompletePaymentRecord,
  isPendingPaymentRecord,
  isRejectedPaymentRecord,
  isUnresolvedPaymentRecord,
  isVerifiedPaymentRecord,
  type PaymentRecordLike,
} from "@/src/modules/shared/lib/payment-calculations"
import { cn } from "@/src/modules/shared/lib/utils"
import { db } from "@/lib/firebase"
import { collection, getDocs, orderBy, query, where } from "firebase/firestore"

export type PaymentAction = "verify" | "reject" | "incomplete"
export type BookingRecord = Record<string, any>

export type PendingPaymentAction = {
  type: PaymentAction
  payment: BookingRecord
  amount?: number
  note?: string
  paymentRecordId?: string
} | null

export function PaymentReviewModal({
  payment,
  onClose,
  onAction,
  childModalOpen,
  liveSubmissions,
  initialPaymentRecordId,
  onBackToQueue,
}: {
  payment: BookingRecord
  onClose: () => void
  onAction: (type: PaymentAction, submission?: PaymentRecord | null) => void
  childModalOpen?: boolean
  liveSubmissions?: PaymentRecord[]
  initialPaymentRecordId?: string | null
  onBackToQueue?: () => void
}) {
  const submissions: PaymentRecord[] =
    liveSubmissions !== undefined
      ? liveSubmissions
      : Array.isArray(payment.incomingPayments)
        ? payment.incomingPayments
        : []
  const { selected, selectedKey, select } = usePaymentHistorySelection(
    String(payment.id),
    submissions,
    initialPaymentRecordId,
  )
  const selectionUnavailable = Boolean(selectedKey) && !selected
  const submissionNumber = selected ? getReceiptPaymentNumber(selected, submissions) : 0
  const submissionLabel = selected
    ? `Submission ${submissionNumber} of ${submissions.length}`
    : "Payment Submission"

  const [storedReceipts, setStoredReceipts] = useState<any[]>([])

  useEffect(() => {
    let mounted = true
    readStoredReceipts(payment.id).then((receipts) => {
      if (mounted) setStoredReceipts(receipts)
    })
    return () => {
      mounted = false
    }
  }, [payment.id])

  const receiptPool = useMemo(() => {
    const fromBooking = Array.isArray(payment.paymentReceipts)
      ? payment.paymentReceipts
      : payment.receipt
        ? [payment.receipt]
        : []
    const all = [...fromBooking, ...storedReceipts]
    const seen = new Set<string>()
    const unique: any[] = []
    for (const receiptEntry of all) {
      const key = receiptEntry.receiptNumber || ""
      if (!key || seen.has(key)) continue
      seen.add(key)
      unique.push(receiptEntry)
    }
    return unique
  }, [payment.paymentReceipts, payment.receipt, storedReceipts])

  const selectedPaymentType = selected
    ? getReceiptPaymentType(selected, payment)
    : payment.paymentType
  // A booking's DP requirement is based on its complete payment history, not
  // on whichever history item is currently selected.
  const hasDownpaymentHistory = submissions.some(
    (record) => getReceiptPaymentType(record, payment) === "downpayment",
  )
  const summaryBase =
    hasDownpaymentHistory && payment.paymentType !== "downpayment"
      ? { ...payment, paymentType: "downpayment" }
      : payment
  // Canonical money ledger / remaining balance — derived from the booking's
  // complete payment history, never from the stored booking fields.
  const paymentSummary = calculatePaymentSummary(summaryBase, submissions)
  const displayModel = getPaymentDisplayModel(summaryBase, selected, paymentSummary)
  const receiptTarget: PaymentRecordLike | null = selected || (!selected && payment.receipt
    ? {
        ...payment.receipt,
        id: payment.receipt.paymentId,
        paymentId: payment.receipt.paymentId,
        receiptNumber: payment.receipt.receiptNumber,
        paymentPurpose: payment.receipt.paymentPurpose || payment.receipt.paymentType,
        paymentMethod: payment.receipt.paymentMethod,
        amount: payment.receipt.amountPaid ?? payment.receipt.paymentAmount,
        paymentStatus: payment.receipt.paymentStatus,
        submittedAt: payment.receipt.paymentSubmittedAt || payment.receipt.dateGenerated || payment.receipt.dateIssued,
      }
    : null)
  const receiptPresentation = getReceiptPresentation(summaryBase, submissions, receiptTarget, receiptPool)
  const receiptTransaction = receiptPresentation.transaction
  const receiptSummary = receiptPresentation.summary
  const resolvedRecord = receiptPresentation.record
  const submissionStatusLabel = selected ? displayModel.statusLabel : getPaymentStatusText(payment)
  const submittedAt = selected?.submittedAt || payment.paymentSubmittedAt || ""
  const isActionable = Boolean(selected && isPendingPaymentRecord(selected) && isUnresolvedPaymentRecord(selected))
  const selectedMethod = selected ? receiptTransaction.paymentMethod : payment.paymentMethod
  const selectedBankReference = receiptTransaction.bankReference
  const reviewNote = resolvePaymentReviewNote(resolvedRecord)

  const selectedProof = selected
    ? resolvedRecord?.proofUrl
    : ""
  const bookingProof = payment.proofUrl || payment.paymentProof || payment.proofOfPayment || payment.proofImage || payment.receiptImage
  const effectiveProof = selected ? selectedProof : bookingProof
  const proofFileName = selected
    ? String(resolvedRecord?.fileName || "Payment proof")
    : payment.proofFileName || "Payment proof"

  const matchedReceipt = findPaymentReceipt(payment, receiptTarget, receiptPool) as any
  const receiptAmountLabel = receiptTransaction.statusLabel === "Incomplete Payment"
    ? "Amount Received"
    : receiptTransaction.isVerified
      ? "Amount Paid"
      : "Amount Submitted"

  const paperData: ReceiptPaperData = {
    fullName:
      matchedReceipt?.fullName ||
      payment.userInfo?.name ||
      selected?.customerName ||
      "Client",
    email: payment.userInfo?.email || null,
    contactNumber: payment.userInfo?.phone || null,
    receiptNo:
      matchedReceipt?.receiptNumber ||
      matchedReceipt?.receiptNo ||
      (!selected ? payment.receiptNumber : "") ||
      (selected ? "No Receipt Record" : "—"),
    generatedAt:
      matchedReceipt?.dateGenerated ||
      matchedReceipt?.dateIssued ||
      submittedAt ||
      "",
    bookingId: payment.id || "",
    eventType: isOfficeRental(payment)
      ? "Office Space Rental"
      : matchedReceipt?.eventType ||
        payment.eventType ||
        payment.eventName ||
        "Event Venue Rental",
    venue:
      matchedReceipt?.venueReserved ||
      matchedReceipt?.venue ||
      payment.venueName ||
      payment.venue ||
      "N/A",
    eventDate: matchedReceipt?.startDate || payment.date || "Not set",
    reservationTime: isOfficeRental(payment)
      ? ""
      : getBookingTimeLabel(payment),
    paymentMethod:
      getPaymentMethodLabel(selectedMethod || matchedReceipt?.paymentMethod || receiptTransaction.paymentMethod),
    bankReference:
      getPaymentMethodLabel(selectedMethod) === "Bank Transfer" ? selectedBankReference || null : null,
    paymentTypeLabel: receiptTransaction.paymentTypeLabel || getPaymentTypeLabel(selectedPaymentType),
    paymentNumber: receiptTransaction.paymentNumber,
    submissionCount: submissions.length || undefined,
    paymentDate: receiptTransaction.paymentDate || submittedAt,
    totalAmount: receiptSummary.totalBookingAmount,
    amountPaid: receiptTransaction.amount,
    submittedAmount: receiptTransaction.submittedAmount,
    creditedAmount: receiptTransaction.creditedAmount,
    amountLabel: receiptAmountLabel,
    remainingBalanceLabel: receiptTransaction.paymentType === "downpayment" ? "Remaining DP" : "Remaining Balance",
    remainingBalance: receiptSummary.remainingBookingBalance,
    paymentSummary: receiptSummary,
    summaryContext: receiptPresentation.summaryContext,
    finalizedAt: receiptPresentation.finalizedAt,
    paymentStatus: receiptTransaction.statusLabel || submissionStatusLabel,
    isVerified: receiptTransaction.isVerified,
    isOfficeRental: isOfficeRental(payment),
    contractTerm:
      matchedReceipt?.contractTerm ||
      payment.contractTerm ||
      payment.rentalTerm ||
      null,
  }

  const receiptSupplement = (
    <PaymentReviewDetails
      key={selectedKey || String(payment.id)}
      proofUrl={String(effectiveProof || "")}
      fileName={proofFileName}
      paymentMethod={selectedMethod}
      reviewNote={reviewNote}
      cashDescription="No uploaded proof required. Verify this submission only after the physical cash payment is received."
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-slate-100 px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                {payment.id || "No ID"}
              </span>

              {selected && (
                <span className="rounded-full bg-orange-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-orange-700">
                  {submissionLabel}
                </span>
              )}

              {selected ? (
                <span className="inline-flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
                  Selected submission: <PaymentRecordBadge record={selected} />
                </span>
              ) : (
                <PaymentBadge payment={payment} />
              )}
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
              Current booking payment status: <PaymentBadge payment={payment} />
            </div>

            <DialogTitle className="break-words text-xl font-black leading-tight text-slate-950 sm:text-2xl">
              Payment Verification
            </DialogTitle>

            <p className="mt-1 break-words text-sm font-bold text-orange-600">
              {payment.eventName || "Untitled Event"}
            </p>

            {submittedAt && (
              <p className="mt-1 text-[11px] font-bold text-slate-400">
                Submitted {formatSubmittedAt(submittedAt)}
              </p>
            )}
          </div>

          {!childModalOpen && (
            <div className="flex shrink-0 items-center gap-2">
              {onBackToQueue && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onBackToQueue}
                  className="h-8 rounded-lg border-slate-200 px-2.5 text-[10px] font-black text-slate-700 hover:bg-slate-50"
                >
                  Back to Queue
                </Button>
              )}
              <button
                type="button"
                aria-label="Close payment review"
                onClick={onClose}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 flex flex-col overflow-y-auto md:flex-row">
        <aside className="flex shrink-0 flex-col border-b border-slate-100 md:w-[36%] md:min-h-0 md:border-b-0 md:border-r lg:w-[360px]">
          <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-100 px-4 py-3">
            <History className="h-3.5 w-3.5 text-slate-400" />
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
              Payment History
            </p>
            {submissions.length > 0 && (
              <span className="ml-auto rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                {submissions.length}
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {submissions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center">
                <p className="text-xs font-black text-slate-900">No payment submissions</p>
                <p className="mt-1 text-[10px] font-semibold text-slate-500">
                  This booking has no individual payment records on file.
                </p>
              </div>
            ) : (
              submissions.map((submission) => {
                const isSelected = submission.id === selected?.id
                const submissionDisplay = getPaymentDisplayModel(summaryBase, submission, paymentSummary)
                const receiptPaymentNumber = getReceiptPaymentNumber(submission, submissions)
                return (
                  <button
                    key={submission.id}
                    type="button"
                    onClick={() => select(submission)}
                    aria-pressed={isSelected}
                    className={cn(
                      "w-full rounded-2xl border p-3.5 text-left transition",
                      isSelected
                        ? "border-orange-200 bg-white shadow-md ring-1 ring-orange-200"
                        : "border-slate-200 bg-white/60 hover:border-orange-200 hover:bg-white hover:shadow-sm",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black text-slate-900">
                        Submission {receiptPaymentNumber}
                      </span>
                      {isSelected && <CheckCircle2 className="h-4 w-4 shrink-0 text-orange-600" />}
                    </div>
                    <span className="mt-1 block text-lg font-black tracking-tight text-slate-950">
                      {formatCurrency(submissionDisplay.amount)}
                    </span>
                    <span className="mt-0.5 block text-[10px] font-semibold text-slate-500">
                      Submitted {formatSubmittedAt(submission.submittedAt)}
                    </span>
                    <span
                      className={cn(
                        "mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-black uppercase tracking-[0.2em]",
                        isRejectedPaymentRecord(submission)
                          ? "bg-rose-50 text-rose-600"
                          : isIncompletePaymentRecord(submission)
                            ? "bg-amber-50 text-amber-600"
                            : isVerifiedPaymentRecord(submission)
                              ? "bg-emerald-50 text-emerald-600"
                              : "bg-amber-50 text-amber-600",
                      )}
                    >
                      {isRejectedPaymentRecord(submission) && <XCircle className="h-3 w-3" />}
                      {isVerifiedPaymentRecord(submission) && <CheckCircle2 className="h-3 w-3" />}
                      {submissionDisplay.statusLabel}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        <div className="min-w-0 flex-1 px-4 py-5 sm:px-5 md:min-h-0 md:overflow-y-auto">
          <div className="space-y-5">
            {selectionUnavailable ? (
              <p role="status" className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                The selected submission is no longer available. Choose a submission from history.
              </p>
            ) : (
              <ModalSection title="Payment Transaction Receipt">
                {matchedReceipt ? (
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 sm:p-4">
                    <ReceiptPaper {...paperData} beforeNotice={receiptSupplement} />
                  </div>
                ) : selected ? (
                  <>
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
                      <FileText className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                      <p className="text-sm font-black uppercase tracking-[0.2em] text-black">No Receipt Record</p>
                      <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">
                        The database has no transaction receipt for this exact payment (receipt.paymentId = {selected.id || "—"}).
                        Payments submitted before transaction receipts existed may lack one.
                      </p>
                    </div>
                    <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-3 sm:p-4">
                      <ReceiptPaper {...paperData} beforeNotice={receiptSupplement} />
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 sm:p-4">
                    <ReceiptPaper {...paperData} beforeNotice={receiptSupplement} />
                  </div>
                )}
              </ModalSection>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-5">
        {isActionable ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Button
              onClick={() => onAction("reject", selected)}
              variant="outline"
              className="h-11 rounded-xl border-rose-200 text-sm font-black text-rose-500 hover:bg-rose-50"
            >
              Reject Payment
            </Button>
            <Button
              onClick={() => onAction("incomplete", selected)}
              variant="outline"
              className="h-11 rounded-xl border-amber-200 text-sm font-black text-amber-600 hover:bg-amber-50"
            >
              Mark as Incomplete
            </Button>
            <Button
              onClick={() => onAction("verify", selected)}
              className="h-11 rounded-xl bg-emerald-500 text-sm font-black text-white hover:bg-emerald-600"
            >
              Verify Payment
            </Button>
          </div>
        ) : (
          <Button
            onClick={onClose}
            variant="outline"
            className="h-11 w-full rounded-xl border-slate-200 text-sm font-black text-slate-700 hover:bg-slate-50"
          >
            Close Window
          </Button>
        )}
      </div>
    </div>
  )
}

export function PaymentActionConfirmModal({
  pendingAction,
  note,
  setNote,
  onCancel,
  onConfirm,
  isProcessing,
}: {
  pendingAction: PendingPaymentAction
  note: string
  setNote: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
  isProcessing: boolean
}) {
  const actionType = pendingAction?.type
  const payment = pendingAction?.payment
  const isReject = actionType === "reject"
  const isIncomplete = actionType === "incomplete"

  const title = isReject
    ? "Reject Payment?"
    : isIncomplete
      ? "Mark Payment as Incomplete?"
      : "Verify Payment?"
  const description = isReject
    ? "Are you sure you want to reject this payment? Please provide a reason for rejection."
    : isIncomplete
      ? "Are you sure you want to mark this payment as incomplete? Please provide a note for the customer."
      : "Are you sure you want to verify this payment? This action will secure the customer's slot and update the booking status."
  const confirmLabel = isReject
    ? "Reject Payment"
    : isIncomplete
      ? "Mark as Incomplete"
      : "Yes, Verify Payment"
  const confirmColor = isReject
    ? "bg-rose-600 hover:bg-rose-700"
    : isIncomplete
      ? "bg-amber-600 hover:bg-amber-700"
      : "bg-emerald-600 hover:bg-emerald-700"

  return (
    <Dialog open={!!pendingAction} onOpenChange={(open) => !open && !isProcessing && onCancel()}>
      <DialogContent aria-describedby={undefined} className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] overflow-hidden rounded-3xl bg-white shadow-2xl [&>button]:hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 flex items-center gap-3 border-b border-slate-100 px-5 py-4">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isReject ? "bg-rose-50 text-rose-600" : isIncomplete ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}`}>
              {isReject ? <XCircle className="h-5 w-5" /> : isIncomplete ? <AlertCircle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
            </div>
            <DialogTitle className="text-lg font-black text-slate-950">{title}</DialogTitle>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 space-y-4">
            <p className="text-sm leading-5 text-slate-500">{description}</p>
            {payment && (
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
                <ConfirmLine label="Customer" value={payment.userInfo?.name || "No Name"} />
                <ConfirmLine label="Booking ID" value={payment.id || "No ID"} />
                <ConfirmLine label="Payment Method" value={getPaymentMethodLabel(payment.paymentMethod)} />
                {payment.paymentMethod === "bank" && <ConfirmLine label="Bank Reference No." value={getBankReferenceNumber(payment)} />}
                <ConfirmLine label="Amount Submitted" value={formatCurrency(getSafePrice(payment.pendingPaymentAmount || payment.paymentAmount || getAmountPaid(payment)))} />
                <ConfirmLine label="Booking Payment Status" value={getPaymentStatusText(payment)} />
                <ConfirmLine label="Action" value={getActionLabel(actionType || "verify")} />
              </div>
            )}

            {(isReject || isIncomplete) && (
              <div>
                <label htmlFor="payment-action-note" className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.2em] text-black">
                  {isReject ? "Rejection Reason" : "Customer Note"}
                </label>
                <Textarea
                  id="payment-action-note"
                  maxLength={2000}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={isReject ? "Enter reason for rejecting this payment..." : "Enter note about missing or insufficient amount..."}
                  className="min-h-[90px] w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm focus-visible:ring-orange-600"
                />
              </div>
            )}
          </div>

          <div className="shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t border-slate-100 bg-white px-5 py-5">
            <Button variant="outline" onClick={onCancel} disabled={isProcessing} className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700">
              Cancel
            </Button>
            <Button
              disabled={isProcessing || ((isReject || isIncomplete) && !note.trim())}
              aria-busy={isProcessing}
              onClick={onConfirm}
              className={`h-11 w-full sm:w-auto rounded-xl text-sm font-black text-white disabled:opacity-50 ${confirmColor}`}
            >
              {isProcessing ? "Saving..." : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function IncompletePaymentModal({
  booking,
  paymentRecords,
  onClose,
  onConfirm,
  isProcessing = false,
}: {
  booking: BookingRecord | null
  paymentRecords?: PaymentRecordLike[] | null
  onClose: () => void
  onConfirm: (updated: BookingRecord) => void | Promise<void>
  isProcessing?: boolean
}) {
  const [verifiedAmount, setVerifiedAmount] = useState("")
  const [adminReason, setAdminReason] = useState("")
  const [confirmStep, setConfirmStep] = useState(false)

  if (!booking) return null

  const office = isOfficeRental(booking)
  const isDownpayment = String(booking.paymentType || "").toLowerCase() === "downpayment"
  const totalAmount = getAmountValue(booking.totalAmount || booking.totalPrice || booking.amount || booking.price)
  const records = paymentRecords || []
  const summary = calculatePaymentSummary(booking, records)
  const currentAmountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0
  const currentDownpaymentPaid = getAmountValue(booking.downpaymentPaid)
  const submissionAmount = booking.submissionAmount || booking.paymentAmount || 0
  const expectedAmount = submissionAmount > 0 ? submissionAmount : (isDownpayment ? summary.remainingDownpayment : summary.remainingBalance)
  const enteredAmount = getAmountValue(verifiedAmount)
  const remainingAfterInput = Math.max(expectedAmount - enteredAmount, 0)
  const isEmpty = verifiedAmount.trim() === ""
  const isZeroOrNegative = enteredAmount <= 0
  const isEqualOrOver = enteredAmount >= expectedAmount
  const isValidIncompleteAmount = !isEmpty && enteredAmount > 0 && enteredAmount < expectedAmount

  const handleConfirm = () => {
    if (enteredAmount <= 0) return
    const hasPriorVerifiedPayment = currentAmountPaid > 0
    const latestStatus = isDownpayment
      ? "pending"
      : (office ? (hasPriorVerifiedPayment ? booking.status : "pending") : (hasPriorVerifiedPayment ? "confirmed" : "pending"))
    const latestBookingStatus = isDownpayment
      ? "Pending Verification"
      : (office ? (hasPriorVerifiedPayment ? booking.bookingStatus : "Pending Verification") : (hasPriorVerifiedPayment ? booking.bookingStatus : "Pending Verification"))

    const updatedBooking: BookingRecord = {
      ...booking,
      status: latestStatus,
      bookingStatus: latestBookingStatus,
      isSlotSecured: hasPriorVerifiedPayment ? booking.isSlotSecured === true : false,
      amountPaid: currentAmountPaid,
      paidAmount: office ? enteredAmount : undefined,
      downpaymentPaid: currentDownpaymentPaid,
      downpaymentRemaining: summary.remainingDownpayment,
      selectedDownpaymentAmount: isDownpayment ? (getAmountValue(booking.selectedDownpaymentAmount) || (totalAmount * (Number(booking.downPaymentPercentage || 50) / 100))) : 0,
      lastPaymentAmount: enteredAmount,
      paymentStatus: "incomplete",
      remainingBalance: summary.remainingBalance,
      balanceStatus: "With Remaining Balance",
      contractStatus: "Pending Signature",
      hasActivePaymentSubmission: false,
      incompletePaymentReason: adminReason.trim(),
      incompletePaymentNote: adminReason.trim(),
      verifiedAmount: office ? enteredAmount : undefined,
      remainingAmount: office ? remainingAfterInput : undefined,
      paymentVerifiedAt: new Date().toISOString(),
      paymentReviewedAt: new Date().toISOString(),
      paymentReviewedBy: "Administrator",
      paymentVerifiedBy: "Administrator",
      verifiedByAdmin: true,
      verifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      adminLogs: appendAdminLog(
        booking,
        "INCOMPLETE_PAYMENT_RECORDED",
        `Admin recorded incomplete payment. Amount received: ₱${enteredAmount.toLocaleString()}.${isDownpayment ? ` Downpayment remaining: ₱${summary.remainingDownpayment.toLocaleString()}.` : ` Remaining: ₱${summary.remainingBalance.toLocaleString()}.`} Note: ${adminReason.trim() || "N/A"}.`,
      ),
    }

    onConfirm(updatedBooking)
    setConfirmStep(false)
  }

  return (
    <Dialog open={!!booking} onOpenChange={(open) => !open && !isProcessing && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] overflow-hidden rounded-3xl bg-white shadow-2xl [&>button]:hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!confirmStep ? (
            <>
              <div className="shrink-0 flex items-center gap-3 border-b border-slate-100 px-5 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><AlertCircle className="h-5 w-5" /></div>
                <DialogTitle className="text-lg font-black text-slate-950">Incomplete Payment</DialogTitle>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 space-y-4">
                <p className="text-sm leading-5 text-slate-500">Enter the verified amount actually received from the customer. The system will calculate the remaining amount.</p>
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
                  <ConfirmLine label="Booking ID" value={booking.id} />
                  <ConfirmLine label="Customer" value={booking.userInfo?.name || "No Name"} />
                  <ConfirmLine label="Expected Amount" value={`₱${expectedAmount.toLocaleString()}`} />
                </div>
                <div>
                  <label htmlFor="incomplete-amount" className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.2em] text-black">Verified Amount Received *</label>
                  <Input
                    id="incomplete-amount"
                    value={verifiedAmount}
                    onChange={(event) => setVerifiedAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="Enter actual amount received"
                    className="h-10 rounded-xl border-slate-200 text-xs font-bold focus-visible:ring-amber-600"
                  />
                  {isEmpty ? <p className="mt-1.5 text-[11px] font-semibold text-slate-500">Enter the amount actually received.</p>
                    : isZeroOrNegative ? <p className="mt-1.5 text-[11px] font-semibold text-rose-600">Amount must be greater than ₱0.</p>
                      : isEqualOrOver ? <p className="mt-1.5 text-[11px] font-semibold text-rose-600">Amount received cannot exceed the remaining balance of ₱{expectedAmount.toLocaleString()}.</p>
                        : <p className="mt-1.5 text-[11px] font-semibold text-amber-700">Remaining Balance After This Payment: ₱{remainingAfterInput.toLocaleString()}</p>}
                </div>
                <div>
                  <label htmlFor="incomplete-note" className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.2em] text-black">Admin Note / Reason *</label>
                  <Textarea
                    id="incomplete-note"
                    maxLength={2000}
                    value={adminReason}
                    onChange={(event) => setAdminReason(event.target.value)}
                    placeholder="Example: Proof is valid, but amount received is only ₱5,000."
                    className="min-h-[80px] w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-xs focus-visible:ring-amber-600"
                  />
                </div>
              </div>
              <div className="shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t border-slate-100 bg-white px-5 py-5">
                <Button variant="outline" onClick={onClose} disabled={isProcessing} className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700">Cancel</Button>
                <Button disabled={!isValidIncompleteAmount || !adminReason.trim() || isProcessing} onClick={() => setConfirmStep(true)} className="h-11 w-full sm:w-auto rounded-xl bg-amber-600 text-sm font-black text-white hover:bg-amber-700 disabled:opacity-50">Continue</Button>
              </div>
            </>
          ) : (
            <>
              <div className="shrink-0 flex items-center gap-3 border-b border-slate-100 px-5 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><AlertCircle className="h-5 w-5" /></div>
                <DialogTitle className="text-lg font-black text-slate-950">Confirm Incomplete Payment</DialogTitle>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 space-y-4">
                <p className="text-sm leading-5 text-slate-500">Are you sure you want to record this as an incomplete payment?</p>
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
                  <ConfirmLine label="Booking ID" value={booking.id} />
                  <ConfirmLine label="Customer" value={booking.userInfo?.name || "No Name"} />
                  <ConfirmLine label="Amount Received" value={`₱${enteredAmount.toLocaleString()}`} />
                  <ConfirmLine label={isDownpayment ? "Downpayment Remaining" : "Remaining Balance"} value={`₱${(isDownpayment ? summary.remainingDownpayment : summary.remainingBalance).toLocaleString()}`} />
                  <ConfirmLine label="New Status" value="Incomplete Payment" />
                  {adminReason.trim() && <ConfirmLine label="Note" value={adminReason.trim()} />}
                </div>
              </div>
              <div className="shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t border-slate-100 bg-white px-5 py-5">
                <Button variant="outline" onClick={() => setConfirmStep(false)} disabled={isProcessing} className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700">Back</Button>
                <Button onClick={handleConfirm} disabled={isProcessing} className="h-11 w-full sm:w-auto rounded-xl bg-amber-600 text-sm font-black text-white hover:bg-amber-700">{isProcessing ? "Saving..." : "Confirm Incomplete Payment"}</Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function OnsiteVerifyModal({
  booking,
  paymentRecords,
  onClose,
  onConfirm,
  isProcessing = false,
}: {
  booking: BookingRecord | null
  paymentRecords?: PaymentRecordLike[] | null
  onClose: () => void
  onConfirm: (updated: BookingRecord, adminNote: string) => void | Promise<void>
  isProcessing?: boolean
}) {
  const [amountReceived, setAmountReceived] = useState(() => {
    if (!booking) return ""
    const summary = calculatePaymentSummary(booking, paymentRecords || [])
    const suggested = summary.requiredDownpayment > 0 && summary.remainingDownpayment > 0 ? summary.remainingDownpayment : summary.remainingBookingBalance
    return suggested > 0 ? String(suggested) : ""
  })
  const [adminNote, setAdminNote] = useState("")
  const [confirmStep, setConfirmStep] = useState(false)

  if (!booking) return null

  const records = paymentRecords || []
  const summary = calculatePaymentSummary(booking, records)
  const totalAmount = summary.totalBookingAmount
  const previouslySubmitted = summary.acceptedTotalPaid
  const currentPaymentAmount = getSafePrice(booking.pendingPaymentAmount || booking.paymentAmount || booking.submissionAmount || booking.lastPaymentAmount || 0)
  const remainingBefore = Math.max(totalAmount - previouslySubmitted, 0)
  const enteredAmount = getAmountValue(amountReceived)
  const newAmountPaid = previouslySubmitted + enteredAmount
  const newRemainingBalance = Math.max(totalAmount - newAmountPaid, 0)
  const isOverPayment = enteredAmount > remainingBefore
  const isDownpayment = String(booking.paymentType || "").toLowerCase() === "downpayment"
  const selectedDP = getAmountValue(booking.selectedDownpaymentAmount) || (isDownpayment ? totalAmount * (Number(booking.downPaymentPercentage || 50) / 100) : 0)
  const dpRemainingAfter = isDownpayment ? Math.max(selectedDP - newAmountPaid, 0) : 0
  const dpCompleteAfter = !isDownpayment || dpRemainingAfter <= 0
  const isFullyPaidAfter = newAmountPaid >= totalAmount

  const handleConfirm = () => {
    if (enteredAmount <= 0) return
    const office = isOfficeRental(booking)
    const nextStatus = office
      ? (isFullyPaidAfter ? "reservation_secured" : "verifying")
      : (isDownpayment ? (dpCompleteAfter ? "confirmed" : "verifying") : "confirmed")
    const nextBookingStatus = office
      ? (isFullyPaidAfter ? "Slot Secured" : "Pending Verification")
      : (isDownpayment ? (dpCompleteAfter ? "Confirmed" : "Pending Verification") : "Confirmed")
    const newDownpaymentPaid = isDownpayment ? Math.min(newAmountPaid, selectedDP) : 0
    const updatedBooking: BookingRecord = {
      ...booking,
      status: nextStatus,
      bookingStatus: nextBookingStatus,
      isSlotSecured: office ? isFullyPaidAfter : true,
      amountPaid: newAmountPaid,
      downpaymentPaid: isDownpayment ? newDownpaymentPaid : 0,
      downpaymentRemaining: dpRemainingAfter,
      selectedDownpaymentAmount: isDownpayment ? selectedDP : 0,
      lastPaymentAmount: enteredAmount,
      paymentStatus: isFullyPaidAfter ? "paid" : (!isDownpayment || dpCompleteAfter) ? "partial" : "incomplete",
      remainingBalance: newRemainingBalance,
      balanceStatus: isFullyPaidAfter ? "Settled" : "With Remaining Balance",
      contractStatus: "Pending Signature",
      hasActivePaymentSubmission: false,
      paymentVerifiedAt: new Date().toISOString(),
      paymentReviewedAt: new Date().toISOString(),
      paymentReviewedBy: "Administrator",
      paymentVerifiedBy: "Administrator",
      verifiedByAdmin: true,
      verifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      adminLogs: appendAdminLog(
        booking,
        "ONSITE_PAYMENT_VERIFIED",
        `Admin verified onsite payment. Amount received: ₱${enteredAmount.toLocaleString()}. Total paid: ₱${newAmountPaid.toLocaleString()}. Remaining: ₱${newRemainingBalance.toLocaleString()}.${adminNote.trim() ? ` Note: ${adminNote.trim()}` : ""}`,
      ),
    }
    onConfirm(updatedBooking, adminNote.trim())
    setConfirmStep(false)
  }

  return (
    <Dialog open={!!booking} onOpenChange={(open) => !open && !isProcessing && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] overflow-hidden rounded-3xl bg-white shadow-2xl [&>button]:hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!confirmStep ? (
            <>
              <div className="shrink-0 flex items-center gap-3 border-b border-slate-100 px-5 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Banknote className="h-5 w-5" /></div>
                <DialogTitle className="text-lg font-black text-slate-950">Verify Onsite Payment</DialogTitle>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 space-y-4">
                <p className="text-sm leading-5 text-slate-500">The customer selected Pay at the Office. Enter the actual amount received at the office.</p>
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
                  <ConfirmLine label="Booking ID" value={booking.id} />
                  <ConfirmLine label="Customer" value={booking.userInfo?.name || "No Name"} />
                  <ConfirmLine label="Total Amount" value={`₱${totalAmount.toLocaleString()}`} />
                  <ConfirmLine label="Previously Credited" value={`₱${previouslySubmitted.toLocaleString()}`} />
                  <ConfirmLine label="Current Payment" value={`₱${currentPaymentAmount.toLocaleString()}`} />
                </div>
                <div>
                  <label htmlFor="onsite-amount" className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.2em] text-black">Amount Received *</label>
                  <Input
                    id="onsite-amount"
                    value={amountReceived}
                    onChange={(event) => setAmountReceived(event.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="Enter amount received"
                    className="h-10 rounded-xl border-slate-200 text-xs font-bold focus-visible:ring-emerald-600"
                  />
                  {isOverPayment ? <p className="mt-1.5 text-[11px] font-semibold text-rose-600">Amount received cannot exceed the remaining balance of ₱{remainingBefore.toLocaleString()}.</p> : enteredAmount > 0 && <p className="mt-1.5 text-[11px] font-semibold text-emerald-700">Remaining balance after this: ₱{newRemainingBalance.toLocaleString()}</p>}
                </div>
                <div>
                  <label htmlFor="onsite-note" className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.2em] text-black">Admin Note (optional)</label>
                  <Textarea id="onsite-note" maxLength={2000} value={adminNote} onChange={(event) => setAdminNote(event.target.value)} placeholder="Optional note about the onsite payment" className="min-h-[80px] w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-xs focus-visible:ring-emerald-600" />
                </div>
              </div>
              <div className="shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t border-slate-100 bg-white px-5 py-5">
                <Button variant="outline" onClick={onClose} disabled={isProcessing} className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700">Cancel</Button>
                <Button disabled={enteredAmount <= 0 || isOverPayment || isProcessing} onClick={() => setConfirmStep(true)} className="h-11 w-full sm:w-auto rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50">Continue</Button>
              </div>
            </>
          ) : (
            <>
              <div className="shrink-0 flex items-center gap-3 border-b border-slate-100 px-5 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Banknote className="h-5 w-5" /></div>
                <DialogTitle className="text-lg font-black text-slate-950">Confirm Onsite Payment</DialogTitle>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 space-y-4">
                <p className="text-sm leading-5 text-slate-500">Confirm the onsite payment amount received from the customer.</p>
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
                  <ConfirmLine label="Booking ID" value={booking.id} />
                  <ConfirmLine label="Customer" value={booking.userInfo?.name || "No Name"} />
                  <ConfirmLine label="Amount Received" value={`₱${enteredAmount.toLocaleString()}`} />
                  <ConfirmLine label="Remaining Balance" value={`₱${newRemainingBalance.toLocaleString()}`} />
                  <ConfirmLine label="New Status" value={isFullyPaidAfter ? "Fully Paid" : dpCompleteAfter ? "Partial Payment" : "Incomplete Payment"} />
                  {adminNote.trim() && <ConfirmLine label="Note" value={adminNote.trim()} />}
                </div>
              </div>
              <div className="shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t border-slate-100 bg-white px-5 py-5">
                <Button variant="outline" onClick={() => setConfirmStep(false)} disabled={isProcessing} className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700">Back</Button>
                <Button onClick={handleConfirm} disabled={isProcessing} className="h-11 w-full sm:w-auto rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700">{isProcessing ? "Saving..." : "Confirm Verification"}</Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PaymentBadge({ payment, className }: { payment: BookingRecord; className?: string }) {
  const submissions = Array.isArray(payment?.incomingPayments) ? payment.incomingPayments : []
  const paymentSummary = calculatePaymentSummary(payment, submissions)
  const hasRecordHistory = submissions.length > 0
  const paymentStatus = hasRecordHistory ? paymentSummary.overallStatus : String(payment?.paymentStatus || "").toLowerCase()
  const totalAmount = paymentSummary.bookingTotal
  const amountPaid = paymentSummary.moneyReceivedTotal
  const remainingBalance = paymentSummary.remainingBalance
  const baseClass = cn("inline-flex items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap")

  if (paymentStatus === "completed") return <span className={`${baseClass} border-emerald-100 bg-emerald-50 text-emerald-700`}><CheckCircle2 className="h-3 w-3" />Fully Paid</span>
  if (paymentStatus === "partial") return <span className={`${baseClass} border-amber-100 bg-amber-50 text-amber-700`}><AlertCircle className="h-3 w-3" />Partial Payment</span>
  if (paymentStatus === "for_review") return <span className={`${baseClass} border-amber-100 bg-amber-50 text-amber-700`}><ShieldCheck className="h-3 w-3" />For Review</span>
  if (paymentStatus === "rejected") return <span className={`${baseClass} border-rose-100 bg-rose-50 text-rose-700`}><XCircle className="h-3 w-3" />Rejected</span>
  if (paymentStatus === "incomplete") return <span className={`${baseClass} border-amber-100 bg-amber-50 text-amber-700`}><AlertCircle className="h-3 w-3" />Incomplete Payment</span>
  if (paymentStatus === "paid" && remainingBalance === 0 && totalAmount > 0 && amountPaid >= totalAmount) return <span className={`${baseClass} border-emerald-100 bg-emerald-50 text-emerald-700`}><CheckCircle2 className="h-3 w-3" />Fully Paid</span>
  if (amountPaid === 0) return <span className={`${baseClass} border-slate-200 bg-slate-50 text-slate-700`}>Unpaid</span>
  return <span className={`${baseClass} border-slate-200 bg-slate-50 text-slate-700`}>{paymentStatus || "Unknown"}</span>
}

function PaymentRecordBadge({ record }: { record: PaymentRecord }) {
  const baseClass = "inline-flex items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap"
  const label = getPaymentRecordStatusLabel(record)
  if (isRejectedPaymentRecord(record)) return <span className={`${baseClass} border-rose-100 bg-rose-50 text-rose-700`}><XCircle className="h-3 w-3" />{label}</span>
  if (isIncompletePaymentRecord(record)) return <span className={`${baseClass} border-amber-100 bg-amber-50 text-amber-700`}><AlertCircle className="h-3 w-3" />{label}</span>
  if (isVerifiedPaymentRecord(record)) return <span className={`${baseClass} border-emerald-100 bg-emerald-50 text-emerald-700`}><CheckCircle2 className="h-3 w-3" />{label}</span>
  return <span className={`${baseClass} border-amber-100 bg-amber-50 text-amber-700`}><ShieldCheck className="h-3 w-3" />{label}</span>
}

function ModalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="border-b border-slate-100 pb-2 text-[10px] font-black uppercase tracking-[0.2em] text-black">{title}</h4>
      <div className="pt-4">{children}</div>
    </div>
  )
}

function ConfirmLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200/70 pb-2 last:border-b-0 last:pb-0">
      <p className="shrink-0 text-xs font-bold text-slate-500">{label}</p>
      <p className="min-w-0 break-words text-right text-xs font-black text-slate-900">{value}</p>
    </div>
  )
}

function readStoredReceipts(bookingId?: string): Promise<any[]> {
  const constraints: any[] = bookingId ? [where("bookingId", "==", bookingId)] : [orderBy("dateGenerated", "desc")]
  return getDocs(query(collection(db, "receipts"), ...constraints)).then(
    (snapshot) => {
      const result: any[] = []
      snapshot.forEach((docSnap) => result.push({ id: docSnap.id, ...docSnap.data() }))
      return result
    },
    () => [],
  )
}

function getSafePrice(value: unknown) {
  if (typeof value === "number") return value
  return Number(String(value || "0").replace(/[^\d.]/g, "")) || 0
}

function getAmountPaid(payment: BookingRecord) {
  if (payment.amountPaid && Number(payment.amountPaid) > 0) return getSafePrice(payment.amountPaid)
  return 0
}

function formatCurrency(value: number) {
  return `₱${Number(value || 0).toLocaleString()}`
}

function getPaymentMethodLabel(method?: string) {
  const normalized = String(method || "").toLowerCase()
  if (normalized === "bank" || normalized.includes("bank")) return "Bank Transfer"
  if (normalized === "cash" || normalized.includes("office") || normalized.includes("onsite")) return "Pay at the Office"
  return "Payment Method"
}

function getBankReferenceNumber(payment: BookingRecord) {
  const value = payment?.bankReferenceNumber || payment?.referenceNumber || payment?.transactionReferenceNumber
  return String(value || "").trim() || "No reference number"
}

function getPaymentTypeLabel(type?: string) {
  if (type === "full") return "Full Payment"
  if (type === "downpayment") return "Down Payment"
  if (type === "remaining_balance") return "Remaining Balance"
  if (type === "slot_reservation") return "Slot Reservation Only"
  return "Payment Type"
}

function formatSubmittedAt(value?: string) {
  if (!value) return "—"
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat("en-PH", { month: "short", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(date)
  } catch {
    return value
  }
}

function getBookingTimeLabel(payment: BookingRecord) {
  if (payment.time) return payment.time
  if (payment.reservationTime) return payment.reservationTime
  const start = payment.startTime || payment.start || ""
  const end = payment.endTime || payment.end || ""
  if (start && end) return `${start} - ${end}`
  if (start) return start
  if (end) return end
  return "N/A"
}

function getPaymentStatusText(payment: BookingRecord) {
  const ps = String(payment.paymentStatus || "").toLowerCase()
  switch (ps) {
    case "completed": return "Fully Paid"
    case "partial": return "Partial Payment"
    case "for_review": return "For Review"
    case "rejected": return "Rejected"
    case "incomplete": return "Incomplete Payment"
  }
  const totalAmount = getSafePrice(payment.totalAmount || payment.totalPrice || payment.amount || payment.price)
  const amountPaid = getSafePrice(payment.amountPaid || payment.paymentAmount || payment.paidAmount)
  if (ps === "paid" && totalAmount > 0 && amountPaid >= totalAmount) return "Fully Paid"
  if (amountPaid > 0 && amountPaid < totalAmount) return "Partial Payment"
  if (amountPaid === 0) return "Unpaid"
  return String(ps || payment.status || "Unknown")
}

function getActionLabel(action: PaymentAction) {
  if (action === "verify") return "Verify / Accept Payment"
  if (action === "reject") return "Reject Payment"
  if (action === "incomplete") return "Record Incomplete Payment"
  return "Verify Payment"
}

function getAmountValue(value: unknown) {
  const num = Number(String(value || 0).replace(/[^0-9.-]+/g, ""))
  return Number.isFinite(num) ? num : 0
}

function isOfficeRental(booking: BookingRecord) {
  return booking ? isOfficeResourceBooking(booking) : false
}

function appendAdminLog(booking: BookingRecord, action: string, message: string) {
  return [
    ...(Array.isArray(booking.adminLogs) ? booking.adminLogs : []),
    { action, message, createdAt: new Date().toISOString() },
  ]
}
