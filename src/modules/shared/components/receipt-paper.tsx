"use client"

import React from "react"
import { cn } from "@shared/lib/utils"

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
    <div className="flex gap-2 text-sm sm:gap-4">
      <span className="min-w-[6.5rem] max-w-[40%] shrink-0 break-words font-black text-slate-900 sm:min-w-[9rem]">
        {label}:
      </span>
      <span
        className={cn(
          "min-w-0 break-words font-black",
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
      <h3 className="mb-2 text-sm font-black uppercase tracking-[0.2em] text-slate-500">
        {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function ReceiptPaperDivider() {
  return <div className="border-t border-dashed border-slate-200" />
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
  paymentDate?: string | null
  totalAmount: number | null
  amountPaid: number | null
  amountLabel?: string
  acceptedAmountLabel?: string
  remainingBalanceLabel?: string
  remainingBalance: number | null
  paymentStatus: string
  isVerified: boolean
  isOfficeRental?: boolean
  contractTerm?: string | null
  paymentSummary?: {
    totalBookingAmount: number | null
    requiredDpAmount?: number | null
    totalVerifiedDpPaid?: number | null
    remainingDp?: number | null
    totalVerifiedPaid?: number | null
    remainingBalance: number | null
    isDownpayment?: boolean
  }
  downpaymentBreakdown?: {
    totalAmount: number
    totalPaid: number
    paymentUnderReview?: number | null
    remainingBalance: number
  }
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
  paymentDate,
  totalAmount,
  amountPaid,
  amountLabel,
  acceptedAmountLabel,
  remainingBalanceLabel,
  remainingBalance,
  paymentStatus,
  isVerified,
  isOfficeRental,
  contractTerm,
  paymentSummary,
  downpaymentBreakdown,
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
  const summaryVerifiedDp = paymentSummary?.totalVerifiedDpPaid ?? downpaymentBreakdown?.totalPaid
  const summaryRemainingDp = paymentSummary?.remainingDp ?? downpaymentBreakdown?.remainingBalance
  const summaryRemainingBalance = paymentSummary?.remainingBalance ?? remainingBalance
  const showVerifiedTotal = paymentSummary
    ? paymentSummary.isDownpayment !== true
    : false
  return (
    <div className="receipt-print mx-auto max-w-[680px]">
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
              label="Payment #"
              value={paymentNumber != null ? paymentNumber : "—"}
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
            <ReceiptPaperLine
              label={resolvedAmountLabel}
              value={amountPaid != null ? formatMoneyIncludingZero(amountPaid) : "—"}
              highlight
            />
            <ReceiptPaperLine
              label="Payment Status"
              value={paymentStatus || "—"}
            />
          </ReceiptPaperSection>

          <ReceiptPaperDivider />

          {/* Booking-wide verified payment context */}
          <ReceiptPaperSection title="Payment Summary">
            <ReceiptPaperLine
              label="Total Booking Amount"
              value={summaryTotal != null ? formatMoneyIncludingZero(summaryTotal) : "—"}
            />
            {summaryRequiredDp != null && summaryRequiredDp > 0 && (
              <>
                <ReceiptPaperLine
                  label="Required DP"
                  value={formatMoneyIncludingZero(summaryRequiredDp)}
                />
                <ReceiptPaperLine
                  label={paymentSummary ? "Total Verified DP Paid" : acceptedAmountLabel || "Verified DP Paid"}
                  value={summaryVerifiedDp != null ? formatMoneyIncludingZero(summaryVerifiedDp) : "—"}
                />
                <ReceiptPaperLine
                  label={remainingBalanceLabel === "Remaining Balance" ? "Remaining DP" : remainingBalanceLabel || "Remaining DP"}
                  value={summaryRemainingDp != null ? formatMoneyIncludingZero(summaryRemainingDp) : "—"}
                />
              </>
            )}
            {showVerifiedTotal && paymentSummary?.totalVerifiedPaid != null && (
              <ReceiptPaperLine
                label="Total Verified Paid"
                value={formatMoneyIncludingZero(paymentSummary.totalVerifiedPaid)}
              />
            )}
            <ReceiptPaperLine
              label="Remaining Balance"
              value={summaryRemainingBalance != null ? formatMoneyIncludingZero(summaryRemainingBalance) : "—"}
            />
          </ReceiptPaperSection>

          <ReceiptPaperDivider />

          {/* Important Notice */}
          <div className="rounded-xl bg-orange-50 p-4 text-center">
            <p className="text-sm font-black uppercase tracking-[0.2em] text-orange-700">
              Important Notice
            </p>
            <p className="mt-2 text-sm font-bold leading-5 text-orange-950">
              {isOfficeRental
                ? "This receipt serves as proof that the slot reservation payment has been verified. This is not full payment, not monthly rental payment, and not cheque payment. Succeeding payments are settled onsite via check."
                : "This receipt serves as proof that the reservation payment has been verified by the administrator of One Estela Place."}
            </p>
          </div>

          {/* Thank You */}
          <p className="text-center text-sm font-black text-slate-900">
            Thank you for choosing One Estela Place.
          </p>
      </div>
    </div>
  )
}
