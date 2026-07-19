"use client"

import { useMemo, useState } from "react"
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  FileText,
  PhilippinePeso,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
  Hourglass,
} from "lucide-react"

import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useBookings, type Booking } from "@/src/modules/client/contexts/booking-context"
import { useCMS } from "@/src/modules/admin/contexts/cms-context"
import { ContractFileViewer } from "@/src/modules/client/components/contract-file-viewer"
import { Card, CardContent } from "@/src/modules/shared/components/ui/card"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Label } from "@/src/modules/shared/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/modules/shared/components/ui/select"
import { cn } from "@/src/modules/shared/lib/utils"
import { getPaymentMethodLabel } from "@/src/modules/shared/lib/labels"
import Link from "next/link"

type StatusBooking = Booking & { _isCurrent?: boolean }

function isOfficeBooking(booking: Booking) {
  const text = [
    (booking as any)?.bookingType,
    (booking as any)?.rentalType,
    booking?.venue,
    booking?.eventType,
  ]
    .join(" ")
    .toLowerCase()
  return text.includes("office")
}

function formatDate(date?: string) {
  if (!date) return "—"
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(parsed)
}

function formatMoney(value?: number | string) {
  const amount = Number(value || 0)
  return `₱${Number.isFinite(amount) ? amount.toLocaleString("en-PH") : "0"}`
}

function StatusPill({
  label,
  tone = "slate",
}: {
  label: string
  tone?: "slate" | "emerald" | "amber" | "rose" | "blue" | "orange" | "purple"
}) {
  const tones: Record<string, string> = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    orange: "border-orange-200 bg-orange-50 text-orange-700",
    purple: "border-purple-200 bg-purple-50 text-purple-700",
  }
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.2em]",
        tones[tone],
      )}
    >
      {label}
    </span>
  )
}

function getBookingStatusTone(status?: string): "emerald" | "amber" | "rose" | "blue" | "orange" | "slate" {
  const v = String(status || "").toLowerCase()
  if (["confirmed", "reservation_secured", "slot_secured"].includes(v)) return "emerald"
  if (["completed", "complete"].includes(v)) return "blue"
  if (["pending", "verifying"].includes(v)) return "orange"
  if (["cancellation_requested", "cancellation requested"].includes(v)) return "amber"
  if (["cancelled", "declined"].includes(v)) return "rose"
  return "slate"
}

function getBookingStatusLabel(status?: string) {
  const v = String(status || "").toLowerCase()
  if (v === "pending") return "Pending"
  if (v === "verifying") return "Verifying"
  if (v === "confirmed") return "Confirmed"
  if (v === "completed" || v === "complete") return "Completed"
  if (v === "cancelled") return "Cancelled"
  if (v === "declined") return "Declined"
  if (v === "cancellation_requested" || v === "cancellation requested")
    return "Cancellation Under Review"
  if (v === "reservation_secured") return "Reservation Secured"
  return v
    ? v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Unknown"
}

function getPaymentStatusTone(
  paymentStatus?: string,
  status?: string,
): "emerald" | "amber" | "rose" | "blue" | "slate" {
  const v = String(paymentStatus || "").toLowerCase()
  if (["verified", "paid", "slot_verified", "partial"].includes(v)) return "emerald"
  if (["for_review", "cash_pending", "slot_pending", "pending_verification", "incomplete"].includes(v))
    return "amber"
  if (v === "rejected") return "rose"
  if (status === "cancelled") return "rose"
  return "slate"
}

function getPaymentStatusLabel(paymentStatus?: string) {
  const v = String(paymentStatus || "").toLowerCase()
  if (["verified", "paid", "slot_verified"].includes(v)) return "Verified"
  if (v === "partial") return "Partial"
  if (["for_review", "cash_pending", "slot_pending", "pending_verification"].includes(v))
    return "For Review"
  if (v === "incomplete") return "Incomplete"
  if (v === "rejected") return "Rejected"
  if (!v) return "Not Set"
  return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function StatusTimelineRow({
  label,
  status,
  date,
  active,
  isLast,
}: {
  label: string
  status: "done" | "current" | "pending" | "rejected"
  date?: string
  active?: boolean
  isLast?: boolean
}) {
  const dotClass = {
    done: "bg-emerald-500 text-white",
    current: "bg-orange-500 text-white animate-pulse",
    pending: "bg-slate-200 text-slate-500",
    rejected: "bg-rose-500 text-white",
  }[status]

  return (
    <div className="relative flex gap-3 pb-4 last:pb-0">
      {!isLast && (
        <span className="absolute left-3 top-6 h-full w-px bg-slate-200" />
      )}
      <div
        className={cn(
          "z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          dotClass,
        )}
      >
        {status === "done" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : status === "rejected" ? (
          <XCircle className="h-4 w-4" />
        ) : status === "current" ? (
          <Hourglass className="h-3.5 w-3.5" />
        ) : (
          <Clock className="h-3.5 w-3.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-xs font-black",
            active ? "text-slate-900" : "text-slate-500",
          )}
        >
          {label}
        </p>
        {date && <p className="mt-0.5 text-[10px] font-semibold text-slate-400">{date}</p>}
      </div>
    </div>
  )
}

function StatusCard({ booking, cmsData }: { booking: StatusBooking; cmsData?: any }) {
  const [contractFileViewerOpen, setContractFileViewerOpen] = useState(false)
  const isOfficeRental = isOfficeBooking(booking)
  const isCancelled =
    String(booking.status).toLowerCase() === "cancelled" ||
    String(booking.status).toLowerCase() === "declined"
  const isCompleted =
    String(booking.status).toLowerCase() === "completed" ||
    String(booking.status).toLowerCase() === "complete"

  const cancellationStatus = String(
    booking.cancellationStatus || "",
  ).toLowerCase()
  const isCancelReq =
    String(booking.status).toLowerCase() === "cancellation_requested" ||
    cancellationStatus === "under review" ||
    cancellationStatus === "pending" ||
    cancellationStatus === "requested"

  const refundStatus = (booking as any).refundStatus as string | undefined
  const contractStatus = (booking as any).contractStatus as string | undefined
  const contractSigned = Boolean(
    (booking as any).contractSigned || contractStatus === "Signed",
  )

  const isContractSigningRequired =
    String(booking.status).toLowerCase() === "contract_signing_required"
  const contractFile = isOfficeRental
    ? cmsData?.officeRentalContract
    : cmsData?.eventVenueContract
  const hasContractFile = contractFile?.fileName && contractFile?.fileUrl

  return (
    <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-1 border-b border-slate-100 bg-gradient-to-r from-orange-50 to-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">
            {isOfficeRental ? "Office Rental" : "Event Booking"}
          </p>
          <h2 className="mt-1 truncate text-lg font-black text-slate-900">
            {booking.eventName || "Untitled"}
          </h2>
          <p className="mt-0.5 text-[11px] font-bold text-slate-500">
            {booking.venue} · {formatDate(booking.date)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill
            label={getBookingStatusLabel(booking.status)}
            tone={getBookingStatusTone(booking.status)}
          />
          <StatusPill
            label={`Pay: ${getPaymentStatusLabel(booking.paymentStatus)}`}
            tone={getPaymentStatusTone(booking.paymentStatus, booking.status)}
          />
        </div>
      </div>

      <CardContent className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
            Booking Status
          </p>
          <div className="mt-3">
            <StatusTimelineRow
              label="Booking placed"
              status="done"
              date={formatDate(booking.createdAt)}
              active
            />
            <StatusTimelineRow
              label="Payment verification"
              status={
                isCancelled
                  ? "rejected"
                  : booking.paymentStatus === "verified" ||
                      booking.paymentStatus === "paid" ||
                      booking.paymentStatus === "slot_verified"
                    ? "done"
                    : isCompleted
                      ? "done"
                      : "current"
              }
              active
            />
            <StatusTimelineRow
              label={isOfficeRental ? "Slot secured" : "Confirmed by admin"}
              status={
                isCancelled
                  ? "rejected"
                  : ["confirmed", "reservation_secured", "slot_secured"].includes(
                        String(booking.status).toLowerCase(),
                      )
                    ? "done"
                    : isCompleted
                      ? "done"
                      : "pending"
              }
              active
            />
            <StatusTimelineRow
              label={isCompleted ? "Completed" : "Event completed"}
              status={isCompleted ? "done" : "pending"}
              isLast
              active
            />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
              Payment Status
            </p>
            <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-2 gap-2 text-[11px] font-bold text-slate-700">
                <div>
                  <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400">
                    Method
                  </p>
                  <p className="mt-0.5 text-slate-900">
                    {getPaymentMethodLabel(booking.paymentMethod)}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400">
                    Amount
                  </p>
                  <p className="mt-0.5 text-slate-900">
                    {formatMoney((booking as any).totalPrice)}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400">
                    Type
                  </p>
                  <p className="mt-0.5 text-slate-900">
                    {isOfficeRental
                      ? "Slot Reservation"
                      : (booking as any).paymentType === "downpayment"
                        ? "Down Payment"
                        : "Full Payment"}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400">
                    Payment Status
                  </p>
                  <p className="mt-0.5 text-slate-900">
                    {getPaymentStatusLabel(booking.paymentStatus)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {isCancelReq && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                Cancellation Status
              </p>
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <Hourglass className="h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-[11px] font-bold text-amber-800">
                    Cancellation Under Review
                  </p>
                </div>
                <p className="text-[10px] font-semibold text-amber-700 pl-6">
                  Cancellation Status: Under Review
                </p>
                <p className="text-[10px] font-semibold text-amber-700 pl-6">
                  Refund Status: Pending Review
                </p>
                {booking.refundEligibilityNote && (
                  <p className="text-[10px] font-semibold text-amber-700 pl-6">
                    {booking.refundEligibilityNote}
                  </p>
                )}
              </div>
            </div>
          )}

          {isCancelled && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                Cancellation Status
              </p>
              <div className={cn(
                "mt-2 rounded-xl border p-3 space-y-1",
                booking.cancellationStatus === "Approved"
                  ? refundStatus === "Refund Eligible" || refundStatus === "Refund Pending" || refundStatus === "Refund Ready for Claiming" || refundStatus === "Refund Claimed"
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-rose-200 bg-rose-50"
                  : "border-rose-200 bg-rose-50"
              )}>
                <div className="flex items-center gap-2">
                  {booking.cancellationStatus === "Approved" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-rose-600" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  )}
                  <p className="text-[11px] font-bold text-rose-700">
                    Booking Status: Cancelled
                  </p>
                </div>
                <p className="text-[10px] font-semibold text-rose-700 pl-6">
                  Cancellation Status: {booking.cancellationStatus || "Approved"}
                </p>
                <p className="text-[10px] font-semibold text-rose-700 pl-6">
                  Refund Status: {(booking as any).amountPaid > 0 ? (booking.refundStatus || "Not Applicable") : "Not Applicable"}
                </p>
                {booking.refundClaimNote && (
                  <p className="text-[10px] font-semibold pl-6 mt-1"
                    style={{ color: (refundStatus === "Refund Eligible" || refundStatus === "Refund Ready for Claiming") ? '#059669' : '#e11d48' }}
                  >
                    {booking.refundClaimNote}
                  </p>
                )}
                {booking.cancellationDeclineReason && (
                  <div className="mt-2 pl-6 rounded-lg bg-rose-100 p-2">
                    <p className="text-[10px] font-bold text-rose-800">
                      Admin Decline Reason: {booking.cancellationDeclineReason}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {refundStatus && !isCancelled && !isCancelReq && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                Refund Status
              </p>
              <div
                className={cn(
                  "mt-2 flex items-center gap-2 rounded-xl border p-3",
                  refundStatus === "Refund Claimed" ||
                    refundStatus === "Refund Ready for Claiming"
                    ? "border-emerald-200 bg-emerald-50"
                    : refundStatus === "Refund Pending"
                      ? "border-amber-200 bg-amber-50"
                      : refundStatus === "Non-Refundable" ||
                          refundStatus === "Not Eligible for Refund"
                        ? "border-rose-200 bg-rose-50"
                        : "border-slate-200 bg-slate-50",
                )}
              >
                <RefreshCw className="h-4 w-4 shrink-0 text-slate-500" />
                <p className="text-[11px] font-bold text-slate-700">
                  {refundStatus}
                </p>
              </div>
            </div>
          )}

          {hasContractFile && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                Contract Document
              </p>
              <div
                className="mt-2 cursor-pointer rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-2 transition hover:bg-blue-100"
                onClick={() => setContractFileViewerOpen(true)}
              >
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-blue-600" />
                  <p className="text-[11px] font-bold text-blue-800 truncate flex-1">
                    {contractFile.fileName}
                  </p>
                  <span className="text-[10px] font-semibold text-blue-500 shrink-0">
                    Click to View
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setContractFileViewerOpen(true) }}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-[10px] font-bold text-blue-700 hover:bg-blue-50 transition"
                  >
                    <FileText className="h-3 w-3" /> View Contract
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      const a = document.createElement("a")
                      a.href = contractFile.fileUrl
                      a.download = contractFile.fileName
                      a.click()
                    }}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-[10px] font-bold text-blue-700 hover:bg-blue-50 transition"
                  >
                    <Download className="h-3 w-3" /> Download Contract
                  </button>
                </div>
              </div>
            </div>
          )}

          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
              Contract Status
            </p>
            <div
              className={cn(
                "mt-2 flex items-center gap-2 rounded-xl border p-3",
                contractStatus === "Signed"
                  ? "border-emerald-200 bg-emerald-50"
                  : contractStatus === "Not Available"
                    ? "border-slate-200 bg-slate-50"
                    : "border-orange-200 bg-orange-50",
              )}
            >
              {contractStatus === "Signed" ? (
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
              ) : contractStatus === "Not Available" ? (
                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
              ) : (
                <ShieldAlert className="h-4 w-4 shrink-0 text-orange-600" />
              )}
              <p
                className={cn(
                  "text-[11px] font-bold",
                  contractStatus === "Signed"
                    ? "text-emerald-700"
                    : contractStatus === "Not Available"
                      ? "text-slate-500"
                      : "text-orange-700",
                )}
              >
                {contractStatus === "Not Available"
                  ? "Not Available"
                  : contractStatus === "Signed"
                    ? `Signed${(booking as any).contractSignedDate ? ` · ${formatDate((booking as any).contractSignedDate)}` : ""}`
                    : "Pending Signature — Please visit the office to sign the contract."}
              </p>
            </div>
            {contractStatus === "Signed" && (booking as any).contractSignedBy && (
              <p className="mt-1 text-[10px] font-semibold text-slate-400 pl-8">
                Signed by: {(booking as any).contractSignedBy}
              </p>
            )}
          </div>
        </div>
      </CardContent>

      <ContractFileViewer
        open={contractFileViewerOpen}
        onClose={() => setContractFileViewerOpen(false)}
        file={contractFile}
      />
    </Card>
  )
}

export default function StatusPage() {
  const { user } = useAuth()
  const { getUserBookings } = useBookings()
  const { cmsData } = useCMS()
  const bookings = useMemo(
    () => (user ? getUserBookings(user.id) : []),
    [user, getUserBookings],
  )
  const [filter, setFilter] = useState<"current" | "all">("current")

  const sorted = useMemo(
    () =>
      [...bookings].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [bookings],
  )

  const visible = useMemo(() => {
    if (filter === "all") return sorted
    return sorted.filter((b) => {
      const s = String(b.status || "").toLowerCase()
      if (["completed", "cancelled", "declined"].includes(s)) return false
      if (!b.date) return true
      const event = new Date(b.date).getTime()
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      return event >= today.getTime()
    })
  }, [sorted, filter])

  if (!user) return null

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 animate-in fade-in duration-500">
        <section className="border-b border-slate-200 pb-5 mb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-orange-600">
                Reservations
              </p>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
                Status
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Track the progress of your bookings, payments, cancellations, refunds, and contracts.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex rounded-full border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setFilter("current")}
                  className={cn(
                    "rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] transition",
                    filter === "current"
                      ? "bg-orange-600 text-white"
                      : "text-slate-600 hover:text-slate-900",
                  )}
                >
                  Current
                </button>
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className={cn(
                    "rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] transition",
                    filter === "all"
                      ? "bg-orange-600 text-white"
                      : "text-slate-600 hover:text-slate-900",
                  )}
                >
                  All
                </button>
              </div>
            </div>
          </div>
        </section>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 mt-3 text-center">
          <Calendar className="mb-3 h-10 w-10 text-slate-300" />
          <h3 className="text-sm font-black text-slate-900">No status to show</h3>
          <p className="mt-1 max-w-sm text-xs text-slate-500">
            Once you make a booking, its status will appear here in real time.
          </p>
          <Button
            asChild
            className="mt-4 h-9 rounded-xl bg-orange-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-orange-700"
          >
            <Link href="/portal/bookings">View My Bookings</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((b) => (
            <StatusCard key={b.id} booking={b} cmsData={cmsData} />
          ))}
        </div>
      )}
      </div>
    </div>
  )
}
