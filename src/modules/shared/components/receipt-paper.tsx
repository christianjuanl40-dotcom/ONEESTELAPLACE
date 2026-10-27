"use client"

import React from "react"
import { cn } from "@shared/lib/utils"
import type { HistoricalPaymentSummary, ReceiptPresentation } from "@shared/lib/payment-calculations"

function formatMoneyIncludingZero(value?: number | string | null): string {
  if (value === null || value === undefined || value === "") return "—"
  const num = typeof value === "string" ? Number.parseFloat(value) : value
  if (Number.isNaN(num)) return "—"
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(num)
}

function formatReceiptDate(value?: string | null): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function ReceiptPaperLine({
  label,
  value,
  highlight,
}: {
  label: string
  value: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div className="grid grid-cols-[minmax(6.5rem,40%)_minmax(0,1fr)] items-start gap-x-2 text-sm sm:grid-cols-[minmax(9rem,40%)_minmax(0,1fr)] sm:gap-x-4">
      <span className="min-w-0 break-words font-black text-slate-900">
        {label}:
      </span>
      <span
        className={cn(
          "min-w-0 break-words text-right font-black",
          highlight ? "text-orange-600" : "text-slate-900",
        )}
      >
        {value ?? "—"}
      </span>
    </div>
  )
}

function ReceiptPaperSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-black uppercase tracking-[0.2em] text-black">
        {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function ReceiptPaperDivider() {
  return <div className="border-t border-dashed border-slate-200" />
}

export function ReceiptPaperNotice({
  isOfficeRental,
  isVerified = true,
}: {
  isOfficeRental?: boolean
  isVerified?: boolean
}) {
  return (
    <div className="rounded-xl bg-orange-50 p-4 text-center">
      <p className="text-sm font-black uppercase tracking-[0.2em] text-orange-700">
        Important Notice
      </p>
      <p className="mt-2 text-sm font-bold leading-5 text-orange-950">
        {!isVerified
          ? isOfficeRental
            ? "This document records a slot reservation submission awaiting verification or correction. It is not proof of verified payment. Succeeding rental payments are settled onsite via check."
            : "This document records the selected payment submission. It is not proof of verified payment. Check the submission status above for the administrator's decision."
          : isOfficeRental
          ? "This receipt serves as proof that the slot reservation payment has been verified. This is not full payment, not monthly rental payment, and not cheque payment. Succeeding payments are settled onsite via check."
          : "This receipt serves as proof that the reservation payment has been verified by the administrator of One Estela Place."}
      </p>
    </div>
  )
}

export interface ReceiptPaperData {
  fullName: string
  email?: string | null
  contactNumber?: string | null
  receiptNo: string
  generatedAt: string
  bookingId: string
  eventType: string
  venue: string
  eventDate: string
  reservationTime: string
  paymentMethod: string
  bankReference?: string | null
  paymentTypeLabel: string
  paymentNumber?: number | string | null
  submissionCount?: number
  paymentDate?: string | null
  totalAmount: number | null
  amountPaid: number | null
  submittedAmount?: number
  creditedAmount?: number
  amountLabel?: string
  acceptedAmountLabel?: string
  remainingBalanceLabel?: string
  remainingBalance: number | null
  paymentStatus: string
  isVerified: boolean
  isOfficeRental?: boolean
  contractTerm?: string | null
  paymentSummary?: HistoricalPaymentSummary
  summaryContext?: ReceiptPresentation["summaryContext"]
  finalizedAt?: string
  downpaymentBreakdown?: {
    totalAmount: number
    totalPaid: number
    paymentUnderReview?: number | null
    remainingBalance: number
  }
  beforeNotice?: React.ReactNode
}

export function ReceiptPaper({
  fullName,
  email,
  contactNumber,
  receiptNo,
  generatedAt,
  bookingId,
  eventType,
  venue,
  eventDate,
  reservationTime,
  paymentMethod,
  bankReference,
  paymentTypeLabel,
  paymentNumber,
  submissionCount,
  paymentDate,
  totalAmount,
  amountPaid,
  submittedAmount,
  creditedAmount,
  amountLabel,
  acceptedAmountLabel,
  remainingBalanceLabel,
  remainingBalance,
  paymentStatus,
  isVerified,
  isOfficeRental,
  contractTerm,
  paymentSummary,
  summaryContext = "unavailable",
  finalizedAt,
  downpaymentBreakdown,
  beforeNotice,
}: ReceiptPaperData) {
  const normalizedPaymentStatus = String(paymentStatus || "").toLowerCase()
  const resolvedAmountLabel = amountLabel || (
    ["incomplete", "incomplete payment"].includes(normalizedPaymentStatus)
      ? "Amount Received"
      : isVerified
        ? "Amount Paid"
        : "Amount Submitted"
  )
  const summaryTotal = paymentSummary?.totalBookingAmount ?? totalAmount
  const summaryRequiredDp = paymentSummary?.requiredDpAmount ?? downpaymentBreakdown?.totalAmount
  const summaryCreditedDp = paymentSummary?.acceptedDpPaid ?? downpaymentBreakdown?.totalPaid
  const summaryRemainingDp = paymentSummary?.remainingDpBalance ?? downpaymentBreakdown?.remainingBalance
  const summaryRemainingBalance = paymentSummary?.remainingBookingBalance ?? remainingBalance
  const summaryCreditedTotal = paymentSummary?.acceptedTotalPaid ?? (
    summaryTotal != null && summaryRemainingBalance != null ? Math.max(summaryTotal - summaryRemainingBalance, 0) : null
  )
  const formatShortMoney = (value: number) => new Intl.NumberFormat("en-PH", {
    style: "currency", currency: "PHP", minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(value)
  return (
    <div className="receipt-print mx-auto min-w-0 max-w-[680px] [overflow-wrap:anywhere]">
      {/* ── HEADER ── */}
      <div className="relative border-b border-dashed border-slate-200 px-5 py-4 text-center">
        <h2 className="text-xl font-black tracking-wide text-slate-950 sm:text-2xl">
          ONE ESTELA PLACE
        </h2>
        <p className="mt-1 text-xs font-black uppercase tracking-[0.2em] text-orange-600">
          System-Generated E-Receipt
        </p>
        <div className="mx-auto mt-3 grid max-w-xl gap-1 text-sm font-black text-slate-900 sm:grid-cols-2 sm:text-left">
          <p className="break-words">
            <span className="text-slate-900">Receipt No:</span>{" "}
            <span className="text-slate-900">{receiptNo || "—"}</span>
          </p>
          <p className="break-words sm:text-right">
            <span className="text-slate-900">Date Generated:</span>{" "}
            <span className="text-slate-900">
              {formatReceiptDate(generatedAt)}
            </span>
          </p>
        </div>
      </div>

        {/* ── BODY ── */}
        <div className="space-y-3 px-5 py-4">
          {/* Customer Information */}
          <ReceiptPaperSection title="Customer Information">
            <ReceiptPaperLine label="Customer Name" value={fullName || "—"} />
            {email && <ReceiptPaperLine label="Email" value={email} />}
            {contactNumber && (
              <ReceiptPaperLine label="Contact Number" value={contactNumber} />
            )}
          </ReceiptPaperSection>

          <ReceiptPaperDivider />

          {/* Booking Details */}
          <ReceiptPaperSection
            title={isOfficeRental ? "Reservation Details" : "Booking Details"}
          >
            <ReceiptPaperLine label="Booking ID" value={bookingId || "—"} />
            <ReceiptPaperLine
              label={isOfficeRental ? "Rental Type" : "Event Type"}
              value={eventType || "—"}
            />
            <ReceiptPaperLine
              label={isOfficeRental ? "Office Reserved" : "Venue Reserved"}
              value={venue || "—"}
            />
            <ReceiptPaperLine
              label={isOfficeRental ? "Reservation Date" : "Event Date"}
              value={eventDate || "—"}
            />
            <ReceiptPaperLine
              label={isOfficeRental ? "Contract Term" : "Reservation Time"}
              value={
                isOfficeRental
                  ? contractTerm || "—"
                  : reservationTime || "—"
              }
            />
          </ReceiptPaperSection>

          <ReceiptPaperDivider />

          {/* Selected transaction only */}
          <ReceiptPaperSection title="Transaction Information">
            <ReceiptPaperLine
               label="Submission"
               value={paymentNumber != null ? `${paymentNumber}${submissionCount ? ` of ${submissionCount}` : ""}` : "—"}
            />
            <ReceiptPaperLine
              label="Payment Date"
              value={formatReceiptDate(paymentDate)}
            />
            <ReceiptPaperLine
              label="Payment Type"
              value={paymentTypeLabel || "—"}
            />
            <ReceiptPaperLine
              label="Payment Method"
              value={paymentMethod || "—"}
            />
            {bankReference && (
              <ReceiptPaperLine
                label="Bank Reference No."
                value={bankReference}
              />
            )}
            {submittedAmount !== undefined && creditedAmount !== undefined ? <>
              <ReceiptPaperLine label="Amount Submitted" value={formatMoneyIncludingZero(submittedAmount)} />
              <ReceiptPaperLine label="Amount Credited for This Payment" value={formatMoneyIncludingZero(creditedAmount)} highlight />
            </> : <ReceiptPaperLine
              label={resolvedAmountLabel}
              value={amountPaid != null ? formatMoneyIncludingZero(amountPaid) : "—"}
              highlight
            />}
            <ReceiptPaperLine
               label="Submission Status"
              value={paymentStatus || "—"}
            />
          </ReceiptPaperSection>

          <ReceiptPaperDivider />

          <ReceiptPaperSection title={summaryContext === "pending" ? "Current Booking Summary" : "Historical Payment Summary"}>
            <p className="mb-3 text-xs font-medium leading-5 text-slate-600">
              {summaryContext === "finalized"
                ? `Financial state immediately after this review was finalized${finalizedAt ? ` on ${formatReceiptDate(finalizedAt)}` : ""}.`
                : summaryContext === "pending"
                  ? "Live booking totals while this submission awaits review. Pending submissions receive no credit."
                  : "Historical values are unavailable where the stored record does not provide reliable evidence."}
            </p>
            <ReceiptPaperLine
              label="Total Booking Amount"
              value={summaryTotal != null ? formatMoneyIncludingZero(summaryTotal) : "Unavailable"}
            />
            <ReceiptPaperLine
              label="Total Credited Payments"
              value={summaryCreditedTotal != null ? formatMoneyIncludingZero(summaryCreditedTotal) : "Unavailable"}
            />
            <div className="!mt-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
              <p className="text-sm font-bold text-slate-900">Total Unpaid Balance</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-orange-700 sm:text-3xl">
                 {summaryRemainingBalance != null ? formatMoneyIncludingZero(summaryRemainingBalance) : "Unavailable"}
              </p>
            </div>
          </ReceiptPaperSection>

          {(summaryRequiredDp == null || summaryRequiredDp > 0) && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <ReceiptPaperSection title="Down Payment Requirement">
                <ReceiptPaperLine label="Required Down Payment" value={summaryRequiredDp != null ? formatMoneyIncludingZero(summaryRequiredDp) : "Unavailable"} />
                <ReceiptPaperLine label="Credited Toward Down Payment" value={summaryCreditedDp != null ? formatMoneyIncludingZero(summaryCreditedDp) : "Unavailable"} />
                <ReceiptPaperLine label="Additional Payment Needed to Complete DP" value={summaryRemainingDp != null ? formatMoneyIncludingZero(summaryRemainingDp) : "Unavailable"} />
              </ReceiptPaperSection>
              <p className="mt-3 text-xs font-medium leading-5 text-slate-600">
                {summaryRemainingDp == null
                  ? "The historical down-payment requirement and progress were not stored for this submission."
                  : summaryRemainingDp > 0 && summaryRemainingBalance != null
                  ? `Your ${formatShortMoney(summaryRemainingBalance)} unpaid balance includes ${formatShortMoney(summaryRemainingDp)} needed to complete your down payment.`
                  : "Your down-payment requirement is complete. Any total unpaid balance shown above is the amount still due for this booking."}
              </p>
            </div>
          )}

          {beforeNotice && (
            <>
              <ReceiptPaperDivider />
              {beforeNotice}
            </>
          )}

          <ReceiptPaperDivider />
          <ReceiptPaperNotice isOfficeRental={isOfficeRental} isVerified={isVerified} />

          {/* Thank You */}
          <p className="text-center text-sm font-black text-slate-900">
            Thank you for choosing One Estela Place.
          </p>
      </div>
    </div>
  )
}
