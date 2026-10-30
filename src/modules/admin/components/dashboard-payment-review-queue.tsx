"use client"

import { useEffect, useRef, useState } from "react"
import {
  ArrowRight,
  Building2,
  Inbox,
  Tent,
  X,
} from "lucide-react"

import { useAuth } from "@/src/modules/shared/auth/auth-context"
import {
  useBookings,
  type Booking,
  type PaymentRecord,
} from "@/src/modules/client/contexts/booking-context"
import {
  calculatePaymentSummary,
  getPaymentRecordAmount,
  getPaymentRecordStatusLabel,
  getRecordsForBooking,
  isPendingPaymentRecord,
  isUnresolvedPaymentRecord,
} from "@/src/modules/shared/lib/payment-calculations"
import { isOfficeResourceBooking } from "@/src/modules/shared/lib/resource-identity"
import { cn } from "@/src/modules/shared/lib/utils"
import { Button } from "@/src/modules/shared/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/src/modules/shared/components/ui/dialog"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import {
  IncompletePaymentModal,
  OnsiteVerifyModal,
  PaymentActionConfirmModal,
  PaymentReviewModal,
  type BookingRecord,
  type PaymentAction,
  type PendingPaymentAction,
} from "@/src/modules/admin/components/payment-review-modal"

export interface PaymentReviewQueueEntry {
  booking: BookingRecord
  payment: PaymentRecord
  submissions: PaymentRecord[]
}

function normalizeKey(value: unknown) {
  return String(value || "").trim().toLowerCase()
}

function getPaymentMethodLabel(method?: string) {
  const normalized = String(method || "").toLowerCase()
  if (normalized === "bank" || normalized.includes("bank")) return "Bank Transfer"
  if (normalized === "cash" || normalized.includes("office") || normalized.includes("onsite")) return "Pay at the Office"
  return "Payment Method"
}

function getPaymentTime(value?: unknown) {
  const time = value ? new Date(String(value)).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function formatCurrency(value: number) {
  return `₱${Number(value || 0).toLocaleString()}`
}

function formatSubmittedAt(value?: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date)
}

function buildPaymentReviewBooking(
  booking: BookingRecord,
  submissions: PaymentRecord[],
  target: PaymentRecord,
) {
  const amount = getPaymentRecordAmount(target)
  const isCash = target.paymentMethod === "cash" || String(target.method || "").toLowerCase().includes("office")
  const paymentSummary = calculatePaymentSummary(booking, submissions)
  const bookingId = String(booking.id || target.bookingId || target.bookingCode || "")
  const venue = booking.venue || target.venueName || ""
  const paymentMethod = isCash ? "cash" : target.paymentMethod || "bank"
  const proof = target.proofUrl || (submissions.length === 1 ? booking.proofUrl || booking.paymentProof : "")

  return {
    ...booking,
    id: bookingId,
    bookingId,
    bookingCode: booking.bookingCode || target.bookingCode,
    incomingPayments: submissions,
    paymentCount: submissions.length,
    latestPayment: target,
    paymentRecordId: target.id,
    userInfo: booking.userInfo || (target.customerName ? { name: target.customerName, email: "", phone: "" } : undefined),
    eventName: booking.eventName || target.eventName || "",
    venue,
    venueName: booking.venueName || venue,
    paymentMethod,
    actualPaymentMethod: target.method || booking.actualPaymentMethod,
    paymentType: target.term || booking.paymentType,
    paymentStatus: paymentSummary.overallStatus,
    amountPaid: paymentSummary.moneyReceivedTotal,
    remainingBalance: paymentSummary.remainingBalance,
    hasActivePaymentSubmission: true,
    pendingPaymentAmount: amount,
    paymentAmount: amount,
    proofUrl: proof,
    paymentProof: proof,
    bankReferenceNumber: target.referenceNo || booking.bankReferenceNumber,
    paymentReference: target.referenceNo || booking.paymentReference,
    paymentSubmissionType: isCash ? "onsite" : "bank_transfer",
    paymentSubmittedAt: target.submittedAt,
    latestPaymentAmount: amount,
    latestPaymentMethod: target.method,
    latestPaymentSubmittedAt: target.submittedAt,
    totalPrice: booking.totalPrice || booking.totalAmount || 0,
    updatedAt: target.updatedAt || booking.updatedAt,
  }
}

/**
 * Build one queue row per unresolved payment submission. A booking with two
 * pending submissions therefore has two rows, while the detail view receives
 * the complete history and pins the selected payment by its document ID.
 */
export function buildPaymentReviewQueue(
  bookings: Booking[],
  paymentRecords: PaymentRecord[],
): PaymentReviewQueueEntry[] {
  const bookingByIdentifier = new Map<string, BookingRecord>()
  for (const booking of bookings) {
    if (normalizeKey(booking.id)) bookingByIdentifier.set(normalizeKey(booking.id), booking)
    const bookingCode = (booking as BookingRecord).bookingCode
    if (normalizeKey(bookingCode)) bookingByIdentifier.set(normalizeKey(bookingCode), booking)
  }

  return paymentRecords
    .filter((record) => isPendingPaymentRecord(record) && isUnresolvedPaymentRecord(record))
    .map((payment): PaymentReviewQueueEntry | null => {
      const booking: BookingRecord = bookingByIdentifier.get(normalizeKey(payment.bookingId))
        || bookingByIdentifier.get(normalizeKey(payment.bookingCode))
        || { id: payment.bookingId || payment.bookingCode || payment.id }
      const bookingId = String(booking.id || payment.bookingId || payment.bookingCode || "")
      if (!bookingId) return null
      const bookingWithId = { ...booking, id: bookingId }
      const submissions = getRecordsForBooking(paymentRecords, bookingWithId).slice() as PaymentRecord[]
      submissions.sort((a, b) => getPaymentTime(b.submittedAt) - getPaymentTime(a.submittedAt))
      if (!submissions.some((record) => record.id === payment.id)) submissions.push(payment)
      return {
        booking: bookingWithId,
        payment,
        submissions,
      }
    })
    .filter((entry): entry is PaymentReviewQueueEntry => Boolean(entry))
    .sort((a, b) => getPaymentTime(b.payment.submittedAt) - getPaymentTime(a.payment.submittedAt))
}

export function DashboardPaymentReviewQueueModal({
  open,
  entries,
  onClose,
}: {
  open: boolean
  entries: PaymentReviewQueueEntry[]
  onClose: () => void
}) {
  const { user } = useAuth()
  const bookingCtx = useBookings()
  const { toast } = useToast()
  const [view, setView] = useState<"queue" | "details">("queue")
  const [selectedEntry, setSelectedEntry] = useState<PaymentReviewQueueEntry | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingPaymentAction>(null)
  const [actionNote, setActionNote] = useState("")
  const [isReviewing, setIsReviewing] = useState(false)
  const [incompletePaymentTarget, setIncompletePaymentTarget] = useState<BookingRecord | null>(null)
  const [onsiteVerifyTarget, setOnsiteVerifyTarget] = useState<BookingRecord | null>(null)
  const reviewInFlight = useRef(false)
  const canReviewPayments = user?.role === "admin" || user?.permissions?.payments === true

  const livePaymentRecords = bookingCtx.paymentRecords || []
  const liveSubmissions = selectedEntry
    ? getRecordsForBooking(livePaymentRecords, selectedEntry.booking).slice().sort((a, b) => getPaymentTime(b.submittedAt) - getPaymentTime(a.submittedAt)) as PaymentRecord[]
    : []
  const selectedPayment = selectedEntry
    ? buildPaymentReviewBooking(selectedEntry.booking, liveSubmissions.length > 0 ? liveSubmissions : selectedEntry.submissions, selectedEntry.payment)
    : null

  useEffect(() => {
    if (!open) {
      setView("queue")
      setSelectedEntry(null)
      setPendingAction(null)
      setIncompletePaymentTarget(null)
      setOnsiteVerifyTarget(null)
      setActionNote("")
    }
  }, [open])

  useEffect(() => {
    if (!selectedEntry) return
    const current = entries.find((entry) => entry.payment.id === selectedEntry.payment.id)
    if (current) setSelectedEntry(current)
  }, [entries, selectedEntry?.payment.id])

  const closeDetail = () => {
    if (pendingAction || incompletePaymentTarget || onsiteVerifyTarget) return
    setSelectedEntry(null)
    setView("queue")
  }

  const openEntry = (entry: PaymentReviewQueueEntry) => {
    setSelectedEntry(entry)
    setView("details")
  }

  const paymentSubmissionById = (recordId?: string | null) => (
    recordId ? livePaymentRecords.find((record) => record.id === recordId) : undefined
  )

  const openActionModal = (payment: BookingRecord, type: PaymentAction, submission?: PaymentRecord | null) => {
    if (!canReviewPayments) {
      toast({ title: "Permission Required", description: "You do not have permission to review payments.", variant: "destructive" })
      return
    }
    if (!submission?.id || !isPendingPaymentRecord(submission) || !isUnresolvedPaymentRecord(submission)) {
      toast({ title: "Payment No Longer Awaiting Review", description: "Refresh the queue and select a payment that is still pending review.", variant: "destructive" })
      return
    }
    setActionNote("")
    setPendingAction(null)
    setIncompletePaymentTarget(null)
    setOnsiteVerifyTarget(null)
    const amount = getPaymentRecordAmount(submission)
    const isCashSubmission = submission.paymentMethod === "cash" || String(submission.method || "").toLowerCase().includes("office")
    const actionPayment = {
      ...payment,
      paymentAmount: amount,
      pendingPaymentAmount: amount,
      paymentMethod: isCashSubmission ? "cash" : "bank",
      bankReferenceNumber: submission.referenceNo || payment.bankReferenceNumber,
      paymentReference: submission.referenceNo || payment.paymentReference,
      paymentRecordId: submission.id,
      submissionAmount: amount,
    }
    if (type === "incomplete") {
      setIncompletePaymentTarget(actionPayment)
      return
    }
    if (type === "verify" && actionPayment.paymentMethod === "cash") {
      setOnsiteVerifyTarget(actionPayment)
      return
    }
    setPendingAction({ payment: actionPayment, type, paymentRecordId: submission.id, amount: amount > 0 ? amount : undefined })
  }

  const closeActionModal = () => {
    if (isReviewing) return
    setPendingAction(null)
    setActionNote("")
  }

  const finishReview = () => {
    setPendingAction(null)
    setIncompletePaymentTarget(null)
    setOnsiteVerifyTarget(null)
    setActionNote("")
    setSelectedEntry(null)
    setView("queue")
  }

  const handleConfirmPaymentAction = async () => {
    if (!pendingAction || reviewInFlight.current || !canReviewPayments) return
    const { payment, type, paymentRecordId, amount } = pendingAction
    const note = actionNote.trim()
    if ((type === "reject" || type === "incomplete") && !note) {
      toast({ title: type === "reject" ? "Reason Required" : "Note Required", description: type === "reject" ? "Please provide a reason for rejecting this payment." : "Please provide a note explaining the missing or insufficient amount.", variant: "destructive" })
      return
    }

    reviewInFlight.current = true
    setIsReviewing(true)
    try {
      const reviewerName = user?.name || "Administrator"
      if (type === "verify") {
        await bookingCtx.reviewPayment(payment.id, { verifiedAmount: amount, adminNote: note || undefined, adminName: reviewerName, paymentRecordId })
      } else if (type === "reject") {
        await bookingCtx.rejectPayment(payment.id, note, reviewerName, paymentRecordId)
      } else {
        await bookingCtx.markIncompletePayment(payment.id, {
          verifiedAmount: amount || getPaymentRecordAmount(paymentSubmissionById(paymentRecordId)),
          adminNote: note,
          adminName: reviewerName,
          paymentRecordId,
        })
      }
      toast({
        title: type === "reject" ? "Payment Rejected" : type === "incomplete" ? "Payment Marked Incomplete" : "Payment Verified",
        description: `Booking ${payment.id} payment review was saved.`,
        className: type === "reject" ? "border-none bg-rose-500 text-white" : type === "incomplete" ? "border-none bg-amber-500 text-white" : "border-none bg-emerald-500 text-white",
      })
      finishReview()
    } catch (error) {
      toast({ title: "Action Failed", description: error instanceof Error ? error.message : "Unable to review the selected payment. Please try again.", variant: "destructive" })
    } finally {
      reviewInFlight.current = false
      setIsReviewing(false)
    }
  }

  const handleOnsiteConfirm = async (updatedBooking: BookingRecord, adminNote: string) => {
    if (reviewInFlight.current || !canReviewPayments) return
    reviewInFlight.current = true
    setIsReviewing(true)
    try {
      await bookingCtx.reviewPayment(updatedBooking.id, {
        verifiedAmount: updatedBooking.lastPaymentAmount || updatedBooking.paymentVerifiedAmount,
        adminNote: adminNote || undefined,
        adminName: user?.name || "Administrator",
        paymentRecordId: updatedBooking.paymentRecordId,
      })
      toast({ title: "Onsite Payment Verified", description: `Onsite payment verified for booking ${updatedBooking.id}.`, className: "border-none bg-emerald-500 text-white" })
      finishReview()
    } catch (error) {
      toast({ title: "Action Failed", description: error instanceof Error ? error.message : "Something went wrong while verifying the payment.", variant: "destructive" })
    } finally {
      reviewInFlight.current = false
      setIsReviewing(false)
    }
  }

  const handleIncompleteConfirm = async (updatedBooking: BookingRecord) => {
    if (reviewInFlight.current || !canReviewPayments) return
    reviewInFlight.current = true
    setIsReviewing(true)
    try {
      await bookingCtx.markIncompletePayment(updatedBooking.id, {
        verifiedAmount: updatedBooking.lastPaymentAmount || updatedBooking.paymentVerifiedAmount || 0,
        adminNote: updatedBooking.incompletePaymentNote || updatedBooking.incompletePaymentReason || "",
        adminName: user?.name || "Administrator",
        paymentRecordId: updatedBooking.paymentRecordId,
      })
      toast({ title: "Incomplete Payment Recorded", description: `Booking ${updatedBooking.id} has been updated with partial payment.`, className: "border-none bg-amber-500 text-white" })
      finishReview()
    } catch (error) {
      toast({ title: "Action Failed", description: error instanceof Error ? error.message : "Unable to record the incomplete payment.", variant: "destructive" })
    } finally {
      reviewInFlight.current = false
      setIsReviewing(false)
    }
  }

  const childModalOpen = Boolean(pendingAction || incompletePaymentTarget || onsiteVerifyTarget)

  return (
    <>
      <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
        <DialogContent
          aria-describedby={undefined}
          plain
          showCloseButton={false}
          className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1100px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        >
          {view === "queue" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">Dashboard Queue</p>
                  <DialogTitle className="mt-1 text-lg font-black leading-snug text-slate-950 sm:text-xl">Payments Under Review</DialogTitle>
                  <DialogDescription className="mt-1 text-xs font-medium leading-5 text-slate-500">Review individual payment submissions without leaving the Dashboard.</DialogDescription>
                </div>
                <DialogClose asChild>
                  <button type="button" aria-label="Close payment review queue" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2">
                    <X className="h-4 w-4" />
                  </button>
                </DialogClose>
              </header>

              <div role="region" aria-label="Payments under review queue" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-600 sm:px-6">
                {entries.length === 0 ? (
                  <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                    <Inbox className="mb-3 h-9 w-9 text-slate-300" />
                    <h3 className="text-sm font-black text-slate-900">No payments under review</h3>
                    <p className="mt-1 max-w-sm text-xs font-medium leading-5 text-slate-500">New payment submissions requiring verification will appear here.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {entries.map((entry) => {
                      const booking = entry.booking
                      const payment = entry.payment
                      const office = isOfficeResourceBooking(booking)
                      const venue = booking.venue || payment.venueName || "—"
                      const officeName = office ? ((booking as any).officeName || venue) : "—"
                      const roomName = office ? ((booking as any).roomName || (booking as any).spaceName || booking.spaceId || "—") : "—"
                      const eventName = booking.eventName || payment.eventName || "Untitled booking"
                      const businessName = (booking.companyName || booking.natureOfBusiness || "").trim()
                      const statusLabel = getPaymentRecordStatusLabel(payment)
                      return (
                        <article key={payment.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange-200 hover:shadow-md sm:p-5">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="flex min-w-0 items-start gap-3">
                              <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", office ? "bg-blue-50 text-blue-600" : "bg-orange-50 text-orange-600")}>
                                {office ? <Building2 className="h-5 w-5" /> : <Tent className="h-5 w-5" />}
                              </div>
                              <div className="min-w-0">
                                <p className="break-all text-[11px] font-black text-orange-700">Booking ID: {booking.id || payment.bookingId || "—"}</p>
                                <p className="mt-1 break-words text-sm font-black leading-snug text-slate-950">{eventName}</p>
                                {businessName && <p className="mt-0.5 break-words text-xs font-semibold text-slate-500">Business: {businessName}</p>}
                                <p className="mt-1 break-words text-xs font-semibold text-slate-500">Customer: {booking.userInfo?.name || payment.customerName || "Customer unavailable"}</p>
                              </div>
                            </div>
                            <span className="inline-flex w-fit items-center rounded-md border border-amber-100 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-amber-700">{statusLabel}</span>
                          </div>

                          <dl className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
                            <QueueField label="Venue" value={office ? "—" : venue} />
                            <QueueField label="Office" value={officeName} />
                            <QueueField label="Room" value={roomName} />
                            <QueueField label="Submitted" value={formatSubmittedAt(payment.submittedAt)} />
                            <QueueField label="Amount Submitted" value={formatCurrency(getPaymentRecordAmount(payment))} />
                            <QueueField label="Payment Method" value={getPaymentMethodLabel(payment.paymentMethod || payment.method)} />
                          </dl>

                          <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
                            <Button type="button" onClick={() => openEntry(entry)} className="h-10 w-full rounded-xl bg-orange-600 px-4 text-xs font-black text-white hover:bg-orange-700 sm:w-auto">
                              Review Payment
                              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : selectedPayment ? (
            <PaymentReviewModal
              key={`${selectedPayment.id}:${selectedEntry?.payment.id}`}
              payment={selectedPayment}
              initialPaymentRecordId={selectedEntry?.payment.id}
              liveSubmissions={liveSubmissions.length > 0 ? liveSubmissions : selectedEntry?.submissions}
              onAction={(type, submission) => openActionModal(selectedPayment, type, submission)}
              childModalOpen={childModalOpen}
              onBackToQueue={closeDetail}
              onClose={closeDetail}
            />
          ) : (
            <div className="p-6 text-sm text-slate-600">The selected payment is no longer available.</div>
          )}
        </DialogContent>
      </Dialog>

      {pendingAction && (
        <PaymentActionConfirmModal
          key={`${pendingAction.payment.id}:${pendingAction.paymentRecordId}:${pendingAction.type}`}
          pendingAction={pendingAction}
          note={actionNote}
          setNote={setActionNote}
          onCancel={closeActionModal}
          onConfirm={() => { void handleConfirmPaymentAction() }}
          isProcessing={isReviewing}
        />
      )}
      {onsiteVerifyTarget && (
        <OnsiteVerifyModal
          key={`${onsiteVerifyTarget.id}:${onsiteVerifyTarget.paymentRecordId}:verify`}
          booking={onsiteVerifyTarget}
          paymentRecords={getRecordsForBooking(livePaymentRecords, onsiteVerifyTarget)}
          onClose={() => setOnsiteVerifyTarget(null)}
          onConfirm={handleOnsiteConfirm}
          isProcessing={isReviewing}
        />
      )}
      {incompletePaymentTarget && (
        <IncompletePaymentModal
          key={`${incompletePaymentTarget.id}:${incompletePaymentTarget.paymentRecordId}:incomplete`}
          booking={incompletePaymentTarget}
          paymentRecords={getRecordsForBooking(livePaymentRecords, incompletePaymentTarget)}
          onClose={() => setIncompletePaymentTarget(null)}
          onConfirm={handleIncompleteConfirm}
          isProcessing={isReviewing}
        />
      )}
    </>
  )
}

function QueueField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-xs font-bold leading-5 text-slate-800">{value}</dd>
    </div>
  )
}
