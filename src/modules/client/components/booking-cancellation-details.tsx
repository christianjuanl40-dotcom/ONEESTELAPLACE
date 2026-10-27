import type { Booking } from "@/src/modules/client/contexts/booking-context"
import { getCancellationAudit } from "@/src/modules/shared/lib/cancellation"
import { REFUND_STATUS_LABELS } from "@/src/modules/shared/lib/labels"
import { BookingDetailField, BookingDetailSection } from "./booking-detail-fields"

function activityDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric",
    ...(!/^\d{4}-\d{2}-\d{2}$/.test(value) ? { hour: "numeric", minute: "2-digit" } as const : {}),
  }).format(date)
}

export function BookingCancellationDetails({ booking, pending, isOffice }: { booking: Booking; pending: boolean; isOffice: boolean }) {
  const audit = getCancellationAudit(booking as unknown as Record<string, unknown>)
  const legacy = booking as unknown as Record<string, string | undefined>
  const requestedAt = booking.cancellationRequestedAt || legacy.cancelRequestedAt
  const reviewedAt = booking.cancellationReviewedAt
  const cancelledAt = booking.cancelledAt
  const approvedAt = booking.cancellationApprovedAt
  const status = booking.refundStatus || "Not Applicable"
  const refundLabel = status === "eligible" ? "Eligible — not yet requested"
    : status === "requested" ? "Requested — awaiting processing"
    : status === "refunded" ? "Completed"
    : REFUND_STATUS_LABELS[status as keyof typeof REFUND_STATUS_LABELS] || status
  // Approval writes this generic guidance alongside its definitive state. Do
  // not present the old hedge as a second, contradictory eligibility decision.
  const note = booking.refundEligibilityNote
  const showEligibilityNote = note && !(normalize(note) === "may be eligible for refund"
    && ["eligible", "requested", "refunded"].includes(status))
  const instructions = [...new Set([booking.refundClaimNote, booking.refundInstructions].filter(Boolean))]

  return (
    <BookingDetailSection title="Cancellation & Refund">
      {pending && <p role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-800">
        Cancellation is awaiting admin review. Your reservation remains in place until cancellation is approved.
      </p>}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <BookingDetailField label="Cancellation Status">{pending ? "Pending Review" : booking.cancellationStatus || legacy.cancelRequestStatus || "Not recorded"}</BookingDetailField>
        <BookingDetailField label="Refund Status">{refundLabel}</BookingDetailField>
        <BookingDetailField label="Cancellation Source">{audit.source}</BookingDetailField>
        <BookingDetailField label="Cancellation Type">{audit.type}</BookingDetailField>
        <BookingDetailField label="Recorded Actor">{audit.actorName}</BookingDetailField>
        {(booking.cancellationReviewedByName || booking.cancellationReviewedBy) && <BookingDetailField label="Reviewed By">{booking.cancellationReviewedByName || booking.cancellationReviewedBy}</BookingDetailField>}
        {requestedAt && <BookingDetailField label="Cancellation Requested At">{activityDate(requestedAt)}</BookingDetailField>}
        {reviewedAt && <BookingDetailField label="Cancellation Reviewed At">{activityDate(reviewedAt)}</BookingDetailField>}
        {approvedAt && <BookingDetailField label="Cancellation Approved At">{activityDate(approvedAt)}</BookingDetailField>}
        {cancelledAt && <BookingDetailField label="Cancelled At">{activityDate(cancelledAt)}</BookingDetailField>}
        {booking.cancellationDeclinedAt && <BookingDetailField label="Cancellation Declined At">{activityDate(booking.cancellationDeclinedAt)}</BookingDetailField>}
        {!requestedAt && !reviewedAt && !approvedAt && !cancelledAt && <BookingDetailField label="Cancellation Activity Date">{audit.date === "Not recorded" ? audit.date : activityDate(audit.date)}</BookingDetailField>}
        <BookingDetailField label="Cancellation Reason" wide>{audit.reason}</BookingDetailField>
        <BookingDetailField label="Cancellation Notes" wide>{audit.notes}</BookingDetailField>
        {booking.cancellationDeclineReason && booking.cancellationDeclineReason !== audit.notes && <BookingDetailField label="Decline Reason" wide>{booking.cancellationDeclineReason}</BookingDetailField>}
        {booking.daysBeforeEventAtCancellation != null && <BookingDetailField label={isOffice ? "Days Before Rental Start at Cancellation" : "Days Before Event at Cancellation"}>{booking.daysBeforeEventAtCancellation} days</BookingDetailField>}
        {showEligibilityNote && <BookingDetailField label={pending ? "Policy Guidance — Subject to Review" : "Recorded Eligibility Note"} wide>{note}</BookingDetailField>}
        {booking.refundAmount != null && <BookingDetailField label="Recorded Refund Amount">₱{Number(booking.refundAmount).toLocaleString("en-PH")}</BookingDetailField>}
        {(booking.refundMode || booking.refundMethod) && <BookingDetailField label="Refund Method">{booking.refundMode || booking.refundMethod}</BookingDetailField>}
        {booking.refundReadyDate && <BookingDetailField label="Refund Ready Date">{activityDate(booking.refundReadyDate)}</BookingDetailField>}
        {booking.refundRequestedAt && <BookingDetailField label="Refund Requested At">{activityDate(booking.refundRequestedAt)}</BookingDetailField>}
        {booking.refundedAt && <BookingDetailField label="Refund Completed At">{activityDate(booking.refundedAt)}</BookingDetailField>}
        {booking.refundClaimedDate && <BookingDetailField label="Refund Claimed Date">{activityDate(booking.refundClaimedDate)}</BookingDetailField>}
        {legacy.refundProcessedBy && <BookingDetailField label="Refund Processed By">{legacy.refundProcessedBy}</BookingDetailField>}
      </dl>
      {(["eligible", "requested", "refunded"].includes(status) || instructions.length > 0) && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-5 text-slate-700 [overflow-wrap:anywhere]">
          {status === "eligible" && <p>Refund eligibility is recorded. Use Request Refund to begin the separate refund process.</p>}
          {status === "requested" && <p>Your refund request is recorded and awaiting processing. Cancellation approval does not mean the refund has been completed.</p>}
          {status === "refunded" ? <p>Your refund has been processed and claimed.</p> : <>
            {instructions.map((instruction) => <p key={instruction} className="whitespace-pre-wrap">{instruction}</p>)}
            {["eligible", "requested"].includes(status) && <p>For onsite processing, bring your Official Receipt and a valid government-issued ID to the One Estela Place Management Office.</p>}
          </>}
        </div>
      )}
    </BookingDetailSection>
  )
}

function normalize(value: string) { return value.trim().toLowerCase().replace(/[.!]+$/, "") }
