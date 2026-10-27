"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  FileText,
  Pencil,
  Plus,
  Receipt,
  Search,
  ShieldAlert,
  Star,
  X,
  Filter,
  XCircle,
  ListChecks,
  PartyPopper,
} from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/modules/shared/components/ui/select"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import {
  type Booking,
  type BookingReceipt,
  getCancellationMessage,
  isCancellationAllowed,
  isRefundEligible,
  canShowCancellationNotice,
  canRequestCancellation,
  useBookingData,
  useBookings,
} from "@/src/modules/client/contexts/booking-context"
import { Button } from "@/src/modules/shared/components/ui/button"
import { BookingDetailsFooter, bookingDetailsActionClassName, bookingDetailsActionRowClassName, bookingDetailsActionToneClassNames } from "@/src/modules/shared/components/booking-details-actions"
import { ReserveDialog } from "@/src/modules/client/components/reserve-dialog"
import { ContractPreviewModal } from "@/src/modules/client/components/contract-preview-modal"
import { ContractFileViewer } from "@/src/modules/client/components/contract-file-viewer"
import { BookingDetailField, BookingDetailSection } from "@/src/modules/client/components/booking-detail-fields"
import { BookingCancellationDetails } from "@/src/modules/client/components/booking-cancellation-details"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "@/src/modules/shared/components/ui/dialog"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Label } from "@/src/modules/shared/components/ui/label"
import { Textarea } from "@/src/modules/shared/components/ui/textarea"
import { getPaymentMethodLabel } from "@/src/modules/shared/lib/labels"
import {
  calculatePaymentSummary,
  getReceiptPaymentMethodLabel,
  getReceiptPresentation,
  getRecordsForBooking,
  type PaymentRecordLike,
  type ReceiptPresentation,
} from "@/src/modules/shared/lib/payment-calculations"
import { NotificationTargetWrapper } from "@/src/modules/shared/components/notification-target"
import { useNotifications } from "@/src/modules/shared/contexts/notification-context"
import type { NotificationType } from "@/src/modules/shared/lib/notifications"
import {
  ReceiptPaper,
  type ReceiptPaperData,
} from "@/src/modules/shared/components/receipt-paper"
import { cn } from "@/src/modules/shared/lib/utils"
import {
  getCurrentBooking,
  hasActiveModificationRequest as bookingHasActiveModificationRequest,
  getBookingLifecycleLabel,
  getBookingLifecycleStatus,
  hasActiveCancellationRequest as bookingHasActiveCancellationRequest,
  isActiveBooking,
} from "@/src/modules/shared/lib/booking-helpers"
import { getRemainingDurationFromDates } from "@/src/modules/shared/lib/date-utils"
import { useCMS } from "@/src/modules/admin/contexts/cms-context"
import { getPublicSpacesFromData } from "@/src/modules/client/lib/venue-data"
import { useSpaceAvailability } from "@/src/modules/shared/hooks/use-space-availability"
import { getAvailabilityTimeRange, getEventSlots } from "@/src/modules/shared/lib/availability"
import { isOfficeResourceBooking, resolveResourceSpace } from "@/src/modules/shared/lib/resource-identity"
import type { AvailabilityRequest } from "@/src/modules/shared/lib/availability-client"
import { Progress } from "@/src/modules/shared/components/ui/progress"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/src/modules/shared/components/ui/tooltip"
import { db } from "@/lib/firebase"
import { collection, addDoc, getDocs, query, orderBy, where, limit, doc, getDoc } from "firebase/firestore"

type ReviewRecord = {
  id: string
  bookingId: string
  eventId?: string
  eventName: string
  venue?: string
  customerName?: string
  rating: number
  comment: string
  createdAt: string
}

type BookingFilter =
  | "all"
  | "current"
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "cancellation_requested"

const REVIEW_STORAGE_KEY = "oneestela_event_reviews_v1"
const REVIEW_EVENT_NAME = "oneestela_reviews_updated"
const PAGE_SIZE = 10

const FILTER_OPTIONS: { value: BookingFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "current", label: "Current" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancellation_requested", label: "Cancel Requested" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
]

function isDateInRange(value: string, from?: string, to?: string) {
  if (!from && !to) return true
  if (!value) return false
  const target = new Date(value).getTime()
  if (Number.isNaN(target)) return false
  if (from) {
    const fromTime = new Date(from).getTime()
    if (!Number.isNaN(fromTime) && target < fromTime) return false
  }
  if (to) {
    const toTime = new Date(to).getTime()
    if (!Number.isNaN(toTime) && target > toTime) return false
  }
  return true
}

function normalizeStatus(value: any) {
  return String(value || "").trim().toLowerCase()
}

function getBookingStatus(booking: any) {
  return normalizeStatus(booking.bookingStatus || booking.status)
}

function getBookingId(booking: any) {
  return String(
    booking.id ||
    booking.bookingId ||
    booking.referenceId ||
    booking.transactionId ||
    ""
  ).trim()
}

function getBookingTime(booking: any) {
  return new Date(
    booking.createdAt ||
    booking.bookingDate ||
    booking.eventDate ||
    booking.startDate ||
    booking.date ||
    0
  ).getTime()
}

function isPastBooking(booking: any) {
  const statuses = ["completed", "cancelled", "declined", "rental_expired"]
  return statuses.includes(getBookingStatus(booking))
}

function isCurrentBooking(booking: any) {
  return !isPastBooking(booking)
}

function getBookingCustomerName(booking: Booking | null) {
  const userInfo = (booking as any)?.userInfo
  return userInfo?.name || userInfo?.fullName || userInfo?.email || "Customer"
}

function getBookingEventName(booking: Booking | null) {
  if (!booking) return "Booked Event"
  return booking.eventName || booking.eventType || booking.venue || "Booked Event"
}

function formatDate(date?: string) {
  if (!date) return "No date"
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat("en-PH", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  }).format(parsed)
}

function formatMoney(value?: number | string) {
  const amount = Number(value || 0)
  return `₱${Number.isFinite(amount) ? amount.toLocaleString("en-PH") : "0"}`
}

function getRemainingDuration(endDate?: string, startDate?: string) {
  return getRemainingDurationFromDates(endDate, startDate)
}

function getRentalProgress(startDate?: string, endDate?: string) {
  if (!startDate || !endDate) return null
  const start = new Date(startDate + "T00:00:00")
  const end = new Date(endDate + "T23:59:59")
  const now = new Date()
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null

  const totalMs = end.getTime() - start.getTime()
  const elapsedMs = now.getTime() - start.getTime()
  if (totalMs <= 0) return null

  const progress = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100))
  const totalDays = Math.ceil(totalMs / (1000 * 60 * 60 * 24))
  const daysUsed = Math.ceil(elapsedMs / (1000 * 60 * 60 * 24))
  const daysRemaining = Math.max(0, totalDays - daysUsed)

  return { progress: Math.round(progress), totalDays, daysUsed: Math.max(0, daysUsed), daysRemaining }
}

function safeParseReviews(value: string | null): ReviewRecord[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const reviewsRef = collection(db, "reviews")

async function loadReviews(bookingIds: (string | number)[]): Promise<ReviewRecord[]> {
  try {
    const uniqueIds = [...new Set(bookingIds.map((id) => String(id)).filter(Boolean))]
    if (uniqueIds.length === 0) return []
    const result: ReviewRecord[] = []
    for (let i = 0; i < uniqueIds.length; i += 10) {
      const chunk = uniqueIds.slice(i, i + 10)
      const snapshot = await getDocs(
        query(reviewsRef, where("bookingId", "in", chunk)),
      )
      snapshot.forEach((docSnap) => {
        const data = docSnap.data()
        result.push({
          id: docSnap.id,
          bookingId: data.bookingId || "",
          eventId: data.eventId || "",
          eventName: data.eventName || "",
          venue: data.venue || "",
          customerName: data.customerName || "",
          rating: data.rating || 5,
          comment: data.comment || "",
          createdAt: data.createdAt || new Date().toISOString(),
        })
      })
    }
    return result
  } catch {
    return []
  }
}

async function saveReview(review: ReviewRecord) {
  await addDoc(reviewsRef, {
    bookingId: review.bookingId,
    eventId: review.eventId || "",
    eventName: review.eventName,
    venue: review.venue || "",
    customerName: review.customerName || "",
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt || new Date().toISOString(),
  })
}

function hasReviewForBooking(reviews: ReviewRecord[], bookingId: string | number) {
  return reviews.some((review) => String(review.bookingId) === String(bookingId))
}

function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function formatTextLabel(value?: string) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function getStatusBadgeClass(status?: string) {
  const normalized = String(status || "").toLowerCase()
  if (["confirmed", "reservation_secured", "slot_verified", "slot_secured", "active_rental"].includes(normalized)) {
    return "border-emerald-100 bg-emerald-50 text-emerald-700"
  }
  if (["completed", "complete"].includes(normalized)) {
    return "border-blue-100 bg-blue-50 text-blue-700"
  }
  if (["pending", "verifying"].includes(normalized)) {
    return "border-orange-100 bg-orange-50 text-orange-700"
  }
  if (["contract_signing_required"].includes(normalized)) {
    return "border-yellow-100 bg-yellow-50 text-yellow-700"
  }
  if (["cancellation_requested", "cancellation requested"].includes(normalized)) {
    return "border-amber-100 bg-amber-50 text-amber-700"
  }
  if (["cancelled", "declined"].includes(normalized)) {
    return "border-rose-100 bg-rose-50 text-rose-700"
  }
  if (["rental_expired"].includes(normalized)) {
    return "border-red-100 bg-red-50 text-red-700"
  }
  return "border-slate-200 bg-slate-50 text-slate-600"
}

function getStatusLabel(status?: string) {
  return getBookingLifecycleLabel({ status })
}

function hasPendingCancellationIndicator(booking: Booking) {
  const cancellationStatus = normalizeStatus(booking.cancellationStatus)
  return Boolean(
    booking.cancellationRequested === true ||
      booking.status === "cancellation_requested" ||
      ["pending", "under review", "requested"].includes(cancellationStatus) ||
      normalizeStatus((booking as any).cancelRequestStatus) === "pending",
  )
}

function getPaymentStatusLabel(paymentStatus?: string, paymentStage?: string, remainingBalance?: number, status?: string) {
  const bookingStatus = String(status || "").toLowerCase()
  if (bookingStatus === "cancelled") return "Cancelled"
  if (bookingStatus === "declined") return "Declined"
  if (bookingStatus === "completed") return "Completed"
  if (bookingStatus === "rental_expired") return "Rental Expired"

  const v = String(paymentStatus || "").toLowerCase()
  const stage = String(paymentStage || "").toLowerCase()
  const hasRemaining = typeof remainingBalance === "number" ? remainingBalance > 0 : false

  if (hasRemaining && v !== "unpaid" && v !== "rejected" && v !== "for_review" && v !== "cash_pending" && v !== "slot_pending") {
    return "Partial Payment"
  }
  if ((stage === "fully paid" || v === "paid" || v === "fully paid") && !hasRemaining) return "Fully Paid"
  if (v === "verified" || v === "slot_verified") return "Verified"
  if (v === "for_review" || v === "cash_pending" || v === "slot_pending") return "For Review"
  if (v === "partial") return "Partial Payment"
  if (v === "rejected") return "Rejected"
  if (v === "incomplete") return "Incomplete Payment"
  if (v === "unpaid") return "Unpaid"
  if (!v) return "Not Set"
  return formatTextLabel(paymentStatus)
}

function getPaymentBadgeClass(paymentStatus?: string, paymentStage?: string, remainingBalance?: number, status?: string) {
  const bookingStatus = String(status || "").toLowerCase()
  if (["cancelled", "declined"].includes(bookingStatus)) return "border-rose-100 bg-rose-50 text-rose-700"
  if (bookingStatus === "completed") return "border-blue-100 bg-blue-50 text-blue-700"
  if (bookingStatus === "rental_expired") return "border-red-100 bg-red-50 text-red-700"

  const v = String(paymentStatus || "").toLowerCase()
  const stage = String(paymentStage || "").toLowerCase()
  const hasRemaining = typeof remainingBalance === "number" ? remainingBalance > 0 : false

  if (hasRemaining && v !== "unpaid" && v !== "rejected" && v !== "for_review" && v !== "cash_pending" && v !== "slot_pending") {
    return "border-amber-100 bg-amber-50 text-amber-700"
  }
  if ((stage === "fully paid" || v === "paid" || v === "fully paid") && !hasRemaining) {
    return "border-emerald-100 bg-emerald-50 text-emerald-700"
  }
  if (["verified", "slot_verified"].includes(v)) {
    return "border-emerald-100 bg-emerald-50 text-emerald-700"
  }
  if (v === "partial" || stage === "complete downpayment" || stage === "settle remaining balance") {
    return "border-amber-100 bg-amber-50 text-amber-700"
  }
  if (["for_review", "cash_pending", "slot_pending"].includes(v)) {
    return "border-amber-100 bg-amber-50 text-amber-700"
  }
  if (v === "rejected") return "border-rose-100 bg-rose-50 text-rose-700"
  if (!v) return "border-slate-200 bg-slate-50 text-slate-600"
  return "border-slate-200 bg-slate-50 text-slate-700"
}

function readStoredReceipts(bookingId?: string): Promise<BookingReceipt[]> {
  const constraints: any[] = bookingId
    ? [where("bookingId", "==", bookingId)]
    : [orderBy("dateGenerated", "desc")]
  return getDocs(query(collection(db, "receipts"), ...constraints)).then(
    (snapshot) => {
      const result: BookingReceipt[] = []
      snapshot.forEach((docSnap) => {
        const d = docSnap.data()
        result.push({
          receiptNumber: d.receiptNumber || "",
          bookingId: d.bookingId || "",
          paymentId: d.paymentId || undefined,
          fullName: d.fullName || "",
          bookingDate: d.bookingDate || "",
          startDate: d.startDate || "",
          endDate: d.endDate || "",
          rentalType: d.rentalType || "",
          bookingType: d.bookingType || "",
          contractTerm: d.contractTerm,
          paymentPurpose: d.paymentPurpose || "",
          paymentMethod: d.paymentMethod || "",
          amountPaid: d.amountPaid ?? d.paymentAmount ?? 0,
          paymentAmount: d.paymentAmount ?? d.amountPaid ?? 0,
          remainingBalance:
            d.remainingBalance == null ? undefined : Number(d.remainingBalance),
          paymentStatus: d.paymentStatus || "",
          dateGenerated: d.dateGenerated || "",
          dateIssued: d.dateIssued || "",
          paymentSubmittedAt: d.paymentSubmittedAt || undefined,
        })
      })
      result.sort(
        (a, b) =>
          new Date(b.dateGenerated || b.dateIssued || b.paymentSubmittedAt || 0).getTime() -
          new Date(a.dateGenerated || a.dateIssued || a.paymentSubmittedAt || 0).getTime(),
      )
      return result
    },
    () => [] as BookingReceipt[]
  )
}

async function getStoredReceiptByBookingId(
  bookingId: string,
): Promise<BookingReceipt | undefined> {
  const receipts = await readStoredReceipts(bookingId)
  return receipts[0]
}

function HorizontalBookingCard({
  booking,
  onView,
}: {
  booking: Booking
  onView: (b: Booking) => void
}) {
  const isOfficeRental = isOfficeResourceBooking(booking)
  const typeLabel = isOfficeRental
    ? "Office Space Rental"
    : booking.eventType || "Event Venue Rental"

  return (
    <div className="group flex w-full min-w-0 flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange-200 hover:shadow-md sm:flex-row sm:items-center sm:gap-4">
      {/* ---- Mobile layout (hidden on sm+) ---- */}
      <div className="sm:hidden">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
            {isOfficeRental ? <FileText className="h-5 w-5" /> : <Calendar className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="break-words whitespace-normal text-base font-black leading-snug text-slate-900">
              {booking.eventName || "Untitled"}
            </p>
            <p className="mt-0.5 text-sm font-bold text-orange-600">
              {typeLabel}
            </p>
          </div>
        </div>
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black">Booking ID</p>
            <p className="mt-0.5 break-all text-xs font-black text-slate-800">{booking.id}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black">Venue</p>
            <p className="mt-0.5 break-words text-xs font-bold text-slate-800">{booking.venue || "N/A"}</p>
          </div>
        </div>
      </div>

      {/* ---- Tablet: grouped info block (sm to md) ---- */}
      <div className="hidden min-w-0 items-center gap-3 sm:flex md:hidden">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
          {isOfficeRental ? <FileText className="h-5 w-5" /> : <Calendar className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
            {isOfficeRental ? "Rental" : "Event"}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-black text-slate-900">
            <span className="break-words whitespace-normal min-w-0">{booking.eventName || "Untitled"}</span>
            <span className="shrink-0 whitespace-nowrap text-xs font-black text-slate-800">• {booking.id}</span>
          </p>
          <p className="mt-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-black">Venue</p>
          <p className="mt-0.5 truncate text-xs font-bold text-slate-800">{booking.venue || "N/A"}</p>
          <p className="mt-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-black">Type</p>
          <p className="mt-0.5 break-words text-[11px] font-bold text-orange-600">{typeLabel}</p>
        </div>
      </div>

      {/* ---- Desktop: Event block + 3-col info grid (md+) ---- */}
      <div className="hidden shrink-0 items-center gap-3 md:flex md:w-[220px]">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
          {isOfficeRental ? <FileText className="h-5 w-5" /> : <Calendar className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
            {isOfficeRental ? "Rental" : "Event"}
          </p>
          <p className="break-words whitespace-normal text-sm font-black leading-snug text-slate-900 min-w-0">
            {booking.eventName || "Untitled"}
          </p>
          <p className="break-words whitespace-normal text-[11px] font-bold text-orange-600">
            {typeLabel}
          </p>
        </div>
      </div>

      <div className="hidden min-w-0 flex-1 grid-cols-[1fr_1fr] gap-x-8 md:grid">
        <div className="min-w-0 max-w-full">
          <p className="whitespace-normal break-words text-[9px] font-black uppercase tracking-[0.2em] text-black">Booking ID</p>
          <p className="whitespace-normal break-words text-xs font-black text-slate-800 truncate">{booking.id}</p>
        </div>
        <div className="min-w-0 max-w-full">
          <p className="whitespace-normal break-words text-[9px] font-black uppercase tracking-[0.2em] text-black">Venue</p>
          <p className="whitespace-normal break-words text-xs font-bold text-slate-800">{booking.venue || "N/A"}</p>
        </div>
      </div>

      {/* ---- RIGHT: Status + Actions ---- */}
      <div className="flex flex-col items-stretch gap-2.5 w-full sm:mt-0 sm:w-auto sm:shrink-0 sm:ml-auto sm:flex-col sm:items-end sm:gap-2.5">
        <span
          className={cn(
            "inline-flex w-full items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap sm:w-auto",
            getStatusBadgeClass(booking.status),
          )}
        >
          {getStatusLabel(booking.status)}
        </span>
        {hasPendingCancellationIndicator(booking) && (
          <span className="inline-flex w-full items-center justify-center rounded-md border border-amber-100 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-amber-700 whitespace-nowrap sm:w-auto">
            Cancellation Requested
          </span>
        )}
        <Button
          variant="outline"
          onClick={() => onView(booking)}
          className="h-9 w-full shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:w-auto"
        >
          View Details
        </Button>
      </div>
    </div>
  )
}

function HistoryRow({
  booking,
  onView,
}: {
  booking: Booking
  onView: (b: Booking) => void
}) {
  const isOfficeRental = isOfficeResourceBooking(booking)
  const typeLabel = isOfficeRental
    ? "Office Space Rental"
    : booking.eventType || "Event Venue Rental"

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-orange-200 sm:flex-row sm:items-center sm:gap-3 md:gap-4">
      {/* ---- Mobile layout ---- */}
      <div className="sm:hidden">
        <p className="break-words whitespace-normal text-sm font-black text-slate-900">
          {booking.eventName || "Untitled"}
        </p>
        <p className="mt-0.5 break-all text-[10px] font-semibold text-slate-500">
          {booking.id}
        </p>
      </div>

      {/* ---- Tablet: grouped info block (sm to md) ---- */}
      <div className="hidden items-center gap-3 min-w-0 sm:flex md:hidden">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
          {isOfficeRental ? <FileText className="h-4 w-4" /> : <Calendar className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-black text-slate-900">
            <span className="break-words whitespace-normal min-w-0">{booking.eventName || "Untitled"}</span>
            <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-slate-500">• {booking.id}</span>
          </p>
          <p className="mt-1 text-[9px] font-black uppercase tracking-[0.2em] text-black">Venue</p>
          <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-700">{booking.venue || "N/A"}</p>
          <p className="mt-1 text-[9px] font-black uppercase tracking-[0.2em] text-black">Type</p>
          <p className="mt-0.5 whitespace-nowrap text-[10px] font-semibold text-orange-600">{typeLabel}</p>
        </div>
      </div>

      {/* ---- Desktop layout (md+) ---- */}
      <div className="hidden items-center gap-3 min-w-0 md:flex md:flex-1">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
          {isOfficeRental ? <FileText className="h-4 w-4" /> : <Calendar className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-slate-900">
            {booking.eventName || "Untitled"}
          </p>
          <p className="truncate text-[10px] font-semibold text-slate-500 sm:text-[11px]">
            {booking.id}
            <span className="hidden md:inline">
              {" · "}{typeLabel}{" · "}{booking.venue || "N/A"}
            </span>
          </p>
        </div>
      </div>

      {/* ---- Status + Actions ---- */}
      <div className="flex flex-col items-stretch gap-2.5 w-full sm:mt-0 sm:w-auto sm:shrink-0 sm:ml-auto sm:flex-col sm:items-end sm:gap-2.5">
        <span
          className={cn(
            "inline-flex w-full items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap sm:w-auto",
            getStatusBadgeClass(booking.status),
          )}
        >
          {getStatusLabel(booking.status)}
        </span>
        {hasPendingCancellationIndicator(booking) && (
          <span className="inline-flex w-full items-center justify-center rounded-md border border-amber-100 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-amber-700 whitespace-nowrap sm:w-auto">
            Cancellation Requested
          </span>
        )}
        <Button
          variant="outline"
          onClick={() => onView(booking)}
          className="h-9 w-full shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:w-auto"
        >
          View Details
        </Button>
      </div>
    </div>
  )
}

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number
  totalPages: number
  onPageChange: (p: number) => void
}) {
  if (totalPages <= 1) return null
  return (
    <div className="mt-4 flex items-center justify-between gap-2">
      <p className="text-[11px] font-bold text-slate-500">
        Page <span className="font-black text-slate-900">{page}</span> of{" "}
        <span className="font-black text-slate-900">{totalPages}</span>
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
          className="h-9 w-9 rounded-lg border-slate-200"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={page === totalPages}
          onClick={() => onPageChange(page + 1)}
          className="h-9 w-9 rounded-lg border-slate-200"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function BookingDetailsModal({
  booking: propBooking,
  open,
  onClose,
  onPay,
  onCancel,
  onViewReceipt,
  onEdit,
  paymentRecords,
}: {
  booking: Booking | null
  open: boolean
  onClose: () => void
  onPay?: (b: Booking) => void
  onCancel?: (b: Booking) => void
  onViewReceipt?: (b: Booking) => void
  onEdit?: (b: Booking) => void
  paymentRecords?: PaymentRecordLike[] | null
}) {
  const [showContractPreview, setShowContractPreview] = useState(false)
  const [showContractFile, setShowContractFile] = useState(false)
  const { bookings, requestRefund } = useBookings()
  const { cmsData } = useCMS()

  const booking = useMemo(() => {
    if (!propBooking) return null
    return bookings.find((b) => b.id === propBooking.id) || propBooking
  }, [bookings, propBooking?.id])

  if (!booking) return null

  // Canonical overall payment state — same source the Admin Payment
  // Verification page and the client My Transactions page use.
  const bookingPaymentRecords = getRecordsForBooking(paymentRecords, booking)
  const hasPaymentRecords = bookingPaymentRecords.length > 0
  const paymentSummary = calculatePaymentSummary(
    booking,
    bookingPaymentRecords,
  )
  const canonicalPayStatus = paymentSummary.overallStatus
  const storedPayStatus = String(booking.paymentStatus || "").toLowerCase()
  const effectivePayStatus = hasPaymentRecords ? canonicalPayStatus : storedPayStatus

  const isCancelled =
    String(booking.status || "").toLowerCase() === "cancelled" ||
    String(booking.status || "").toLowerCase() === "declined"

  const isOfficeRental = isOfficeResourceBooking(booking)
  const contractFile = isOfficeRental
    ? cmsData?.officeRentalContract ?? null
    : cmsData?.eventVenueContract ?? null
  const typeLabel = isOfficeRental
    ? "Office Space Rental"
    : booking.eventType || "Event Venue Rental"
  const startDate = formatDate(booking.date)
  const endDate = (booking as any)?.endDate
    ? formatDate((booking as any).endDate)
    : startDate
  const showNotice = canShowCancellationNotice(booking) && ["", "none"].includes(normalizeStatus(booking.cancellationStatus))
  const payStatus = storedPayStatus
  const amountPaid = paymentSummary.moneyReceivedTotal
  const balanceStatus = String((booking as any).balanceStatus || "").toLowerCase()
  const paymentStage = String((booking as any).paymentStage || "").toLowerCase()
  const remainingBalance = paymentSummary.remainingBalance
  const hasRemainingPayment =
    (remainingBalance > 0 || paymentSummary.remainingBalance > 0) &&
    !["cancelled", "declined", "completed", "rental_expired"].includes(String(booking.status || "").toLowerCase()) && (
      effectivePayStatus === "partial" ||
      effectivePayStatus === "incomplete" ||
      balanceStatus === "with remaining balance" ||
      paymentStage === "complete downpayment" ||
      paymentStage === "settle remaining balance"
    )

  const isPayUnderReview = hasPaymentRecords
    ? paymentSummary.hasPendingSubmission || canonicalPayStatus === "for_review"
    : payStatus === "for_review" || payStatus === "cash_pending" || payStatus === "slot_pending"
  const showPay =
    onPay &&
    !isPayUnderReview &&
    effectivePayStatus !== "verified" &&
    effectivePayStatus !== "paid" &&
    effectivePayStatus !== "slot_verified" &&
    effectivePayStatus !== "completed" &&
    !["cancelled", "declined", "completed", "rental_expired"].includes(String(booking.status || "").toLowerCase())

  const hasActiveCancellationRequest = bookingHasActiveCancellationRequest(booking as unknown as Record<string, unknown>) ||
    normalizeStatus(booking.bookingStatus) === "cancellation under review"

  const hasActiveModificationRequest = bookingHasActiveModificationRequest(
    booking as unknown as Record<string, unknown>,
  )

  const cancellationStatus = normalizeStatus(booking.cancellationStatus)
  const hasCancellationHistory =
    Boolean(cancellationStatus) &&
    !["none", "declined", "cancellation declined"].includes(cancellationStatus)

  const showCancelAction =
    onCancel &&
    canRequestCancellation(booking) &&
    !["cancelled", "declined", "completed", "rental_expired"].includes(String(booking.status || "").toLowerCase()) &&
    booking.cancellationStatus !== "Approved" &&
    !hasCancellationHistory

  const showModify =
    !["cancelled", "declined", "completed", "rental_expired"].includes(String(booking.status || "").toLowerCase()) &&
    !hasActiveCancellationRequest &&
    booking.cancellationStatus !== "Approved" &&
    !hasCancellationHistory

  const hasReceipt = !!(booking.receipt)
  const showReceipt =
    onViewReceipt &&
    (hasReceipt ||
      (hasPaymentRecords
        ? canonicalPayStatus === "partial" || canonicalPayStatus === "completed"
        : payStatus === "verified" || payStatus === "paid" || payStatus === "slot_verified"))

  const hasManagementActions = isCancelled
    ? amountPaid > 0 && booking.refundStatus === "eligible"
    : showModify || showCancelAction || (!showReceipt && (showPay || (isPayUnderReview && showPay === false) || hasRemainingPayment))

  const hasContract = contractFile?.fileUrl && contractFile?.fileName
  const showContractDocument = !isCancelled && hasContract
  const showReceiptDocument = isCancelled || showReceipt
  const contractSignatureStatus = (
    <div className="flex flex-wrap items-center gap-2">
      {booking.status === "contract_signing_required" && (
        <span className="inline-block rounded-md border border-yellow-100 bg-yellow-50 px-2.5 py-1 text-xs font-semibold text-yellow-700">
          Contract signing required
        </span>
      )}
      <span className={cn(
        "inline-block rounded-md border px-2.5 py-1 text-xs font-semibold",
        booking.contractStatus === "Signed"
          ? "border-emerald-100 bg-emerald-50 text-emerald-700"
          : "border-orange-100 bg-orange-50 text-orange-700",
      )}>
        {booking.contractStatus === "Signed" ? "Signed" : "Pending Signature"}
      </span>
    </div>
  )
  const contractInstructions = (
    <>
      {booking.contractStatus === "Signed" && (
        <p className="text-sm font-bold text-emerald-700">
          {booking.contractSignedDate
            ? `Signed on ${formatDate(booking.contractSignedDate)}`
            : "Contract has been signed."}
        </p>
      )}
      {booking.contractStatus !== "Signed" && booking.status === "contract_signing_required" && (
        <p className="text-sm leading-5 text-slate-700">
          Contract signing must be completed onsite at the One Estela Place office.
        </p>
      )}
    </>
  )

  const timeValue =
    booking.time ||
    `${booking.startTime || ""}${booking.startTime && booking.endTime ? " – " : ""}${booking.endTime || ""}` ||
    "—"

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent aria-describedby={undefined}
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] min-h-0 w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-w-[640px]"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <header className="shrink-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-orange-700">
                Booking Details
              </p>
              <DialogTitle title={booking.eventName || "Untitled Booking"} className="mt-1 line-clamp-2 text-lg font-bold leading-6 text-black [overflow-wrap:anywhere] sm:text-xl">
                {booking.eventName || "Untitled Booking"}
              </DialogTitle>
              <p className="mt-1 line-clamp-1 text-xs font-medium text-slate-600 [overflow-wrap:anywhere]">
                {typeLabel}{" "}
                <span className="mx-1.5">·</span> #
                {booking.id}
              </p>
            </div>
            <DialogClose asChild>
              <button
                type="button"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </DialogClose>
          </header>

          <div data-booking-details-body className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            <div className="divide-y divide-slate-200 space-y-4 [&>section+section]:pt-4">
              <BookingDetailSection title="Booking Information">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                  <BookingDetailField label="Booking Title" wide>{booking.eventName || "Untitled Booking"}</BookingDetailField>
                  <BookingDetailField label="Booking Date">{formatDate(booking.createdAt)}</BookingDetailField>
                  <BookingDetailField label="Booking ID">#{booking.id}</BookingDetailField>
                  <BookingDetailField label={isOfficeRental ? "Office / Room" : "Venue"} wide>{booking.venue || "—"}</BookingDetailField>
                  <BookingDetailField label={isOfficeRental ? "Rental Start Date" : "Event Date"}>{startDate}</BookingDetailField>
                  <BookingDetailField label={isOfficeRental ? "Rental End Date" : "Event End Date"}>{endDate}</BookingDetailField>
                  <BookingDetailField label={isOfficeRental ? "Rental Type" : "Event Type"}>{typeLabel}</BookingDetailField>
                  {isOfficeRental ? <>
                    <BookingDetailField label="Rental Term">{formatTextLabel(booking.officeRentalTerm || booking.rentalTerm || booking.contractTerm) || "—"}</BookingDetailField>
                    <BookingDetailField label="Company Name" wide>{booking.companyName || booking.eventName || "N/A"}</BookingDetailField>
                    <BookingDetailField label="Nature of Business" wide>{booking.natureOfBusiness || booking.eventType || "N/A"}</BookingDetailField>
                    {!isCancelled && <BookingDetailField label="Remaining Duration">{getRemainingDuration(booking.endDate || booking.date, booking.date) || "—"}</BookingDetailField>}
                  </> : <>
                    <BookingDetailField label="Guests">{booking.guestCount ? `${booking.guestCount} pax` : "—"}</BookingDetailField>
                    <BookingDetailField label="Time" wide>{timeValue}</BookingDetailField>
                  </>}
                </dl>
              </BookingDetailSection>

              {isOfficeRental && booking.status === "active_rental" && (() => {
                const progress = getRentalProgress(booking.date, (booking as any).endDate)
                if (!progress) return null
                return (
                  <BookingDetailSection title="Rental Progress">
                    <div className="space-y-3">
                      <Progress value={progress.progress} className="h-2.5 rounded-full bg-slate-100" />
                      <dl className="grid grid-cols-3 gap-3">
                        <BookingDetailField label="Days Used">{progress.daysUsed}</BookingDetailField>
                        <BookingDetailField label="Days Left">{progress.daysRemaining}</BookingDetailField>
                        <BookingDetailField label="Progress">{progress.progress}%</BookingDetailField>
                      </dl>
                    </div>
                  </BookingDetailSection>
                )
              })()}

              {booking.specialRequests && (
                <BookingDetailSection title="Special Requests">
                  <p className="whitespace-pre-wrap text-sm font-bold leading-5 text-black [overflow-wrap:anywhere]">
                    {booking.specialRequests}
                  </p>
                </BookingDetailSection>
              )}

              {showNotice && (
                <section className="text-sm leading-5 text-slate-700">
                  <p>Cancellation requests are unavailable within 7 days of the {isOfficeRental ? "rental start" : "event"}. Refund eligibility is determined at cancellation approval using the 14-day policy and recorded payment; approval and refund processing are separate steps.</p>
                  {!isOfficeRental && <p className="mt-2">Remaining balances must be settled at least 7 days before the event date.</p>}
                </section>
              )}
              {isPayUnderReview && !["cancelled", "declined", "completed", "rental_expired"].includes(String(booking.status || "").toLowerCase()) && (
                <section><p role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-800">Payment is awaiting admin verification.</p></section>
              )}

            {isCancelled || hasActiveCancellationRequest ||
              (booking.cancellationStatus && booking.cancellationStatus !== "None") ||
              ((booking as any).cancelRequestStatus && (booking as any).cancelRequestStatus !== "None") ? (
              <BookingCancellationDetails booking={booking} pending={hasActiveCancellationRequest} isOffice={isOfficeRental} />
            ) : null}

              {!isCancelled && !hasContract && (
                <BookingDetailSection title="Contract">
                  {contractSignatureStatus}
                  <p className="text-sm text-slate-600">No contract document uploaded yet.</p>
                  {contractInstructions}
                </BookingDetailSection>
              )}

              {(showContractDocument || showReceiptDocument) && (
                <BookingDetailSection title="Documents">
                  <div className="divide-y divide-slate-100">
                    {showContractDocument && (
                      <div data-booking-document="contract" className="space-y-3 pb-3 last:pb-0">
                        <div className="flex min-w-0 flex-col gap-3">
                          <div className="min-w-0 space-y-2">
                            <h4 className="text-sm font-semibold text-slate-700">Contract</h4>
                            {contractSignatureStatus}
                          </div>
                          <div className={bookingDetailsActionRowClassName}>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => { setShowContractFile(true) }}
                              className={cn(bookingDetailsActionClassName, bookingDetailsActionToneClassNames.orange)}
                            >
                              <FileText className="size-4" /> View Contract
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                const a = document.createElement("a")
                                a.href = contractFile.fileUrl
                                a.download = contractFile.fileName
                                a.click()
                              }}
                              className={cn(bookingDetailsActionClassName, bookingDetailsActionToneClassNames.slate)}
                            >
                              <Download className="size-4" /> Download Contract
                            </Button>
                          </div>
                        </div>
                        {contractInstructions}
                      </div>
                    )}
                    {showReceiptDocument && (
                      <div data-booking-document="receipt" className="flex min-w-0 flex-col gap-3 pt-3 first:pt-0">
                        <h4 className="text-sm font-semibold text-slate-700">Receipt</h4>
                        <Button variant="outline" onClick={() => { if (onViewReceipt) { onViewReceipt(booking); onClose() } }}
                          className={cn(bookingDetailsActionClassName, bookingDetailsActionToneClassNames.orange)}>
                          <Receipt className="size-4" /> View Receipt
                        </Button>
                      </div>
                    )}
                  </div>
                </BookingDetailSection>
              )}
            </div>
          </div>

          {hasManagementActions && <BookingDetailsFooter>
              {isCancelled ? <>
                {amountPaid > 0 && booking.refundStatus === "eligible" && <Button onClick={() => { if (booking.id) requestRefund(booking.id) }}
                  className={cn(bookingDetailsActionClassName, bookingDetailsActionToneClassNames.primary)}>Request Refund</Button>}
              </> : <>
                  {showModify && (
                    <Button
                      variant="outline"
                      disabled={hasActiveModificationRequest}
                      onClick={() => {
                        if (onEdit && !hasActiveModificationRequest) {
                          onEdit(booking)
                          onClose()
                        }
                      }}
                      className={cn(bookingDetailsActionClassName, bookingDetailsActionToneClassNames.primary)}
                    >
                      <Pencil className="size-4" />
                      Modify Booking
                    </Button>
                  )}
                  {!showReceipt && (showPay && !isPayUnderReview ? (
                    <Button
                      disabled={hasActiveCancellationRequest}
                      onClick={() => {
                        if (!hasActiveCancellationRequest) {
                          onPay(booking)
                          onClose()
                        }
                      }}
                      className={cn(
                        bookingDetailsActionClassName,
                        showModify ? bookingDetailsActionToneClassNames.orange : bookingDetailsActionToneClassNames.primary
                      )}
                    >
                      <CreditCard className="size-4" />
                      Pay Now
                    </Button>
                  ) : isPayUnderReview && showPay === false ? (
                    <Button
                      disabled
                      variant="outline"
                      className={cn(bookingDetailsActionClassName, bookingDetailsActionToneClassNames.slate)}
                    >
                      <CreditCard className="size-4" />
                      Pay Now
                    </Button>
                  ) : hasRemainingPayment && !showPay && !showReceipt ? (
                    <Button
                      onClick={() => {
                        if (onPay && !isPayUnderReview) {
                          onPay(booking)
                          onClose()
                        }
                      }}
                      disabled={isPayUnderReview}
                      className={cn(
                        bookingDetailsActionClassName,
                        showModify ? bookingDetailsActionToneClassNames.orange : bookingDetailsActionToneClassNames.primary
                      )}
                    >
                      <CreditCard className="size-4" />
                       {isPayUnderReview ? "Payment Submitted" : "Continue Payment"}
                    </Button>
                  ) : null)}
              {showCancelAction && (
                <Button
                  variant="ghost"
                  disabled={hasActiveCancellationRequest}
                  onClick={() => {
                    if (onCancel && !hasActiveCancellationRequest) {
                      onCancel(booking)
                      onClose()
                    }
                  }}
                  className={cn(bookingDetailsActionClassName, bookingDetailsActionToneClassNames.destructive)}
                >
                  <X className="size-4" />
                  Cancel Booking
                </Button>
              )}
              </>}
          </BookingDetailsFooter>}
        </div>
      </DialogContent>

      <ContractPreviewModal
        booking={booking}
        open={showContractPreview}
        onClose={() => setShowContractPreview(false)}
      />
      <ContractFileViewer
        open={showContractFile}
        onClose={() => setShowContractFile(false)}
        file={contractFile}
      />
    </Dialog>
  )
}

function ReceiptModal({
  receipt,
  open,
  onClose,
  booking,
  receiptPresentation,
}: {
  receipt: BookingReceipt | null
  open: boolean
  onClose: () => void
  booking?: Booking | null
  receiptPresentation?: ReceiptPresentation | null
}) {
  if (!receipt) return null

  const isOfficeRental = booking ? isOfficeResourceBooking(booking) : false
  const receiptRecord: PaymentRecordLike = {
    ...receipt,
    id: receipt.paymentId,
    paymentId: receipt.paymentId,
    paymentNumber: (receipt as any).paymentNumber,
    receiptNumber: receipt.receiptNumber,
    paymentPurpose: receipt.paymentPurpose,
    paymentMethod: receipt.paymentMethod,
    amount: receipt.amountPaid ?? receipt.paymentAmount,
    paymentStatus: receipt.paymentStatus,
    submittedAt: receipt.paymentSubmittedAt || receipt.dateGenerated || receipt.dateIssued,
  }
  const presentation = receiptPresentation || getReceiptPresentation(booking || {}, [], receiptRecord)
  const transaction = presentation.transaction
  const paymentSummary = presentation.summary

  const timeStr = booking
    ? booking.time ||
      `${booking.startTime || ""}${booking.startTime && booking.endTime ? " – " : ""}${booking.endTime || ""}` ||
      "—"
    : "—"

  const amountLabel = transaction.statusLabel === "Incomplete Payment"
    ? "Amount Received"
    : transaction.isVerified
      ? "Amount Paid"
      : "Amount Submitted"

  const eventTypeLabel = isOfficeRental
    ? "Office Space Rental"
    : booking?.eventType || receipt.bookingType || "Event Venue Rental"

  const paymentTypeLabel = transaction.paymentTypeLabel || receipt.paymentPurpose || "Booking Payment"

  const paperData: ReceiptPaperData = {
    fullName: receipt.fullName || booking?.userInfo?.name || "Client",
    email: booking?.userInfo?.email || null,
    contactNumber: booking?.userInfo?.phone || null,
    receiptNo: receipt.receiptNumber,
    generatedAt: receipt.dateGenerated || receipt.dateIssued,
    bookingId: receipt.bookingId,
    eventType: eventTypeLabel,
    venue: booking?.venue || "—",
    eventDate: booking?.date || receipt.startDate || "—",
    reservationTime: timeStr,
    paymentMethod: getReceiptPaymentMethodLabel(transaction.paymentMethod || receipt.paymentMethod),
    bankReference: transaction.bankReference || null,
    paymentTypeLabel,
    paymentNumber: transaction.paymentNumber,
    paymentDate: transaction.paymentDate || receipt.dateGenerated || receipt.dateIssued,
    totalAmount: paymentSummary.totalBookingAmount,
    amountPaid: transaction.amount,
    submittedAmount: transaction.submittedAmount,
    creditedAmount: transaction.creditedAmount,
    amountLabel,
    remainingBalanceLabel: transaction.paymentType === "downpayment" ? "Remaining DP" : "Remaining Balance",
    remainingBalance: paymentSummary.remainingBookingBalance,
    paymentStatus: transaction.statusLabel || "—",
    isVerified: transaction.isVerified,
    isOfficeRental,
    contractTerm: receipt.contractTerm || null,
    paymentSummary,
    summaryContext: presentation.summaryContext,
    finalizedAt: presentation.finalizedAt,
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent aria-describedby={undefined}
        showCloseButton={false}
        className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] overflow-y-auto rounded-3xl bg-white shadow-2xl"
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="shrink-0 flex items-start justify-between gap-4 border-b border-slate-100 bg-white px-5 py-5">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">
                E-Receipt
              </p>
              <DialogTitle className="mt-1.5 break-words text-2xl font-black text-slate-900">
                {receipt.receiptNumber}
              </DialogTitle>
              <p className="mt-1 text-sm font-black text-slate-900">
                {receipt.bookingId}
              </p>
            </div>
            <DialogClose asChild>
              <button
                type="button"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </DialogClose>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <ReceiptPaper {...paperData} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const WriteReviewModal = ({
  open,
  booking,
  reviews,
  onClose,
  onSaved,
}: {
  open: boolean
  booking: Booking | null
  reviews: ReviewRecord[]
  onClose: () => void
  onSaved: (reviews: ReviewRecord[]) => void
}) => {
  const { toast } = useToast()
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState("")

  useEffect(() => {
    if (!open) {
      setRating(5)
      setComment("")
    }
  }, [open])

  const eventName = getBookingEventName(booking)

  const handleSubmit = () => {
    if (!booking) return
    if (!comment.trim()) {
      toast({
        title: "Review required",
        description: "Please write a short review before submitting.",
        variant: "destructive",
      })
      return
    }
    if (hasReviewForBooking(reviews, booking.id)) {
      toast({
        title: "Already reviewed",
        description: "You already wrote a review for this booking.",
        variant: "destructive",
      })
      return
    }
    const nextReview: ReviewRecord = {
      id: createLocalId("review"),
      bookingId: String(booking.id),
      eventId: String((booking as any)?.eventId || (booking as any)?.venueId || ""),
      eventName,
      venue: booking.venue,
      customerName: getBookingCustomerName(booking),
      rating: Math.min(5, Math.max(1, rating)),
      comment: comment.trim(),
      createdAt: new Date().toISOString(),
    }
    saveReview(nextReview)
    onSaved([nextReview, ...reviews])
    toast({
      title: "Review submitted",
      description: "Your review has been added.",
      className: "bg-slate-900 text-white border-none",
    })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[95vw] sm:max-w-md max-h-[90dvh] overflow-y-auto rounded-3xl border-0 bg-white p-6 shadow-2xl">
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <DialogTitle className="shrink-0 text-xl font-black text-slate-900">
            Write a Review
          </DialogTitle>
          <p className="shrink-0 mt-1 text-sm font-medium text-slate-500">
            Share your experience for{" "}
            <span className="font-bold text-orange-600">{eventName}</span>.
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto mt-5 space-y-4">
          <div>
            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
              Rating
            </Label>
            <div className="mt-2 flex gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRating(value)}
                  className="rounded-full p-1 transition hover:scale-110"
                >
                  <Star
                    className={cn(
                      "h-7 w-7",
                      value <= rating
                        ? "fill-orange-500 text-orange-500"
                        : "text-slate-300",
                    )}
                  />
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
              Review
            </Label>
            <Textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Tell us about your experience..."
              className="mt-2 min-h-[120px] w-full resize-none rounded-xl border-slate-200 bg-slate-50 text-sm focus-visible:ring-2 focus-visible:ring-orange-500"
            />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-10 w-full sm:w-auto rounded-xl border-slate-200 text-xs font-bold"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              className="h-10 w-full sm:w-auto rounded-xl bg-orange-600 text-xs font-bold text-white shadow-sm hover:bg-orange-700"
            >
              Submit Review
            </Button>
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const CancellationDialog = ({
  booking,
  reason,
  setReason,
  onClose,
  onSubmit,
  submitting,
}: {
  booking: Booking | null
  reason: string
  setReason: (value: string) => void
  onClose: () => void
  onSubmit: () => void | Promise<void>
  submitting?: boolean
}) => {
  const [reasonError, setReasonError] = useState(false)

  if (!booking) return null
  const allowed = isCancellationAllowed(booking.date)
  const refundEligible = isRefundEligible(booking.date)

  const handleSubmit = async () => {
    if (submitting) return
    if (!reason.trim()) {
      setReasonError(true)
      return
    }
    setReasonError(false)
    await onSubmit()
  }

  const handleReasonChange = (value: string) => {
    setReason(value)
    if (reasonError && value.trim()) setReasonError(false)
  }

  const startDate = formatDate(booking.date)
  const endDate = (booking as any)?.endDate
    ? formatDate((booking as any).endDate)
    : startDate

  return (
    <Dialog open={!!booking} onOpenChange={(v) => !v && onClose()}>
      <DialogContent aria-describedby={undefined}
        showCloseButton={false}
        className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] overflow-y-auto rounded-3xl bg-white shadow-2xl"
      >
        <div className="flex max-h-[90dvh] flex-col overflow-hidden">
          <header className="shrink-0 flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">
                Cancellation
              </p>
              <DialogTitle className="mt-1 text-lg font-black tracking-tight text-slate-900">
                Request Cancellation
              </DialogTitle>
            </div>
            <DialogClose asChild>
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close"
              >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="break-words whitespace-normal min-w-0 text-sm font-black text-slate-900">{booking.eventName || "Untitled"}</span>
                  <span className="shrink-0 text-[11px] font-bold text-slate-400">#{booking.id}</span>
                </div>
                <p className="mt-1 text-[11px] font-semibold text-slate-500">
                  {booking.venue || "N/A"} · {startDate}{endDate !== startDate ? ` – ${endDate}` : ""}
                </p>
              </div>

              <div className="rounded-2xl bg-amber-50 p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-[11px] font-semibold leading-5 text-amber-800">
                    Cancellations 14+ days before event may be refund eligible. Cancellations within 7 days are non-refundable. Remaining balances must be settled at least 7 days before the event.
                  </p>
                </div>
              </div>

              <div
                className={cn(
                  "rounded-2xl p-4",
                  allowed
                    ? refundEligible
                      ? "bg-emerald-50"
                      : "bg-orange-50"
                    : "bg-rose-50",
                )}
              >
                <div className="flex items-start gap-2">
                  <ShieldAlert
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      allowed
                        ? refundEligible
                          ? "text-emerald-600"
                          : "text-orange-600"
                        : "text-rose-600",
                    )}
                  />
                  <p
                    className={cn(
                      "text-[11px] font-semibold leading-5",
                      allowed
                        ? refundEligible
                          ? "text-emerald-700"
                          : "text-orange-800"
                        : "text-rose-700",
                    )}
                  >
                    {getCancellationMessage(booking.date)}
                  </p>
                </div>
              </div>

              {allowed && (
                <div>
                  <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
                    Reason for Cancellation *
                  </Label>
                  <Textarea
                    value={reason}
                    onChange={(e) => handleReasonChange(e.target.value)}
                    placeholder="Type your reason here..."
                    className={cn(
                      "min-h-[110px] w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm focus-visible:ring-2 focus-visible:ring-orange-500",
                      reasonError && "border-rose-300 focus-visible:ring-rose-500",
                    )}
                  />
                  {reasonError && (
                    <p className="mt-1.5 text-[11px] font-semibold text-rose-600">
                      Please provide a reason for cancellation.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <footer className="shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t border-slate-100 bg-white px-5 py-4">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-10 w-full sm:w-auto rounded-lg border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="h-10 w-full sm:w-auto rounded-lg bg-orange-600 px-5 text-xs font-bold text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Submitting..." : "Submit Cancellation Request"}
            </Button>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ModifyBookingFlowModal({
  booking,
  open,
  onClose,
  onSubmitChanges,
}: {
  booking: Booking | null
  open: boolean
  onClose: () => void
  onSubmitChanges: (changes: Record<string, unknown>, reason: string) => void
}) {
  const { toast } = useToast()
  const { cmsData } = useCMS()

  const allSpaces = useMemo(() => {
    const { eventVenues, officeSpaces } = getPublicSpacesFromData(cmsData)
    return [...eventVenues, ...officeSpaces]
  }, [cmsData])

  const [step, setStep] = useState<"schedule" | "details">("schedule")
  const [eventName, setEventName] = useState("")
  const [eventType, setEventType] = useState("")
  const [customEventType, setCustomEventType] = useState("")
  const [guestCount, setGuestCount] = useState("")
  const [notes, setNotes] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [natureOfBusiness, setNatureOfBusiness] = useState("")
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState(false)
  const eventTypeOptions = ["Birthday", "Wedding", "Debut", "Corporate Event", "Conference / Seminar", "Baptism / Christening", "Reunion", "Private Celebration", "Other"]
  const isCustomEventType = !eventTypeOptions.includes(eventType) || eventType === "Other"
  const resolvedEventType = isCustomEventType ? customEventType : eventType
  const businessTypeOptions: Record<string, string> = {
    tech: "Technology / IT",
    freelance: "Freelance / Professional Services",
    agency: "Agency / Creative Studio",
    corporate: "Corporate Office",
    others: "Others",
  }
  const hasBusinessTypeOption = Object.hasOwn(businessTypeOptions, natureOfBusiness)

  // Calendar state (matching New Booking Step 3)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date()
    const minDate = new Date(d)
    minDate.setMonth(minDate.getMonth() + 1)
    minDate.setHours(0, 0, 0, 0)
    return new Date(minDate.getFullYear(), minDate.getMonth(), 1)
  })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedDuration, setSelectedDuration] = useState<string | null>(null)

  const resourceResolution = useMemo(() => booking ? resolveResourceSpace(cmsData, booking) : null, [cmsData, booking])
  const availabilitySpace = resourceResolution?.status === "resolved" ? resourceResolution.space : null
  const resourceError = resourceResolution && resourceResolution.status !== "resolved"
    ? "This booking's exact space could not be identified. Please contact support before modifying its schedule."
    : null

  const venueInfo = useMemo(() => {
    if (!availabilitySpace) return null
    return allSpaces.find(v => v.category === availabilitySpace.category && v.id === (availabilitySpace.officeId || availabilitySpace.venueId)) || null
  }, [availabilitySpace, allSpaces])

  const venueMaxPax = useMemo(() => {
    if (!venueInfo?.capacity) return 100
    const matches = String(venueInfo.capacity).match(/\d+/g)
    return matches ? Math.max(...matches.map(Number)) : 100
  }, [venueInfo])

  const isOffice = booking ? isOfficeResourceBooking(booking) : false
  const rentalTermToDisplay: Record<string, string> = {
    "6_months": "6 Months",
    "1_year": "1 Year",
    "2_years": "2 Years",
  }
  const displayToRentalTerm: Record<string, NonNullable<AvailabilityRequest["rentalTerm"]>> = {
    "6 Months": "6_months",
    "1 Year": "1_year",
    "2 Years": "2_years",
  }
  const selectedRentalTerm = isOffice ? displayToRentalTerm[selectedDuration || ""] : undefined

  const { days: availabilityDays, loading: availabilityLoading, error: availabilityError } = useSpaceAvailability(
    open, availabilitySpace, calendarMonth, booking?.id || "", selectedRentalTerm,
  )
  const selectedDay = selectedDate ? availabilityDays[selectedDate] : undefined
  const selectedScheduleIsAvailable = Boolean(availabilitySpace && selectedDuration && selectedDay && !availabilityLoading && !availabilityError
    && (isOffice ? selectedRentalTerm && selectedDay.status === "available" : selectedDay.availableSlots.some((slot) => slot.label === selectedDuration)))
  if (!isOffice && selectedDate && selectedDuration && !availabilityLoading && selectedDay && !selectedScheduleIsAvailable) setSelectedDuration(null)

  // Calendar calculations (replicating New Booking Step 3)
  const minBookableDate = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setMonth(d.getMonth() + 1)
    return d
  }, [])

  const year = calendarMonth.getFullYear()
  const month = calendarMonth.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay = new Date(year, month, 1).getDay()
  const emptySlots = Array.from({ length: firstDay }).map((_, i) => null)
  const days = Array.from({ length: daysInMonth }).map((_, i) => i + 1)

  const availableVenueSlots = selectedDate
    ? availabilityDays[selectedDate]?.availableSlots || []
    : []
  const occupiedIntervals = [...(selectedDay?.occupiedIntervals || [])]
    .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes)

  // Pre-fill from booking data
  useEffect(() => {
    if (open && booking) {
      setStep("schedule")
      setEventName(booking.eventName || "")
      setEventType(booking.eventType || "")
      setCustomEventType(booking.eventType || "")
      setGuestCount(String(booking.guestCount || ""))
      setNotes(booking.specialRequests || "")
      setCompanyName((booking as any).companyName || booking.eventName || "")
      const biz = (booking as any).natureOfBusiness || booking.eventType || ""
      setNatureOfBusiness(biz)
      setReason("")
      setReasonError(false)

      const date = new Date(`${booking.date}T00:00:00`)
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(booking.date || "") && !Number.isNaN(date.getTime())
        && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` === booking.date
      const initialMonth = validDate ? date : minBookableDate
      setCalendarMonth(new Date(initialMonth.getFullYear(), initialMonth.getMonth(), 1))
      setSelectedDate(validDate ? booking.date : null)

      const storedRental =
        (booking as any).rentalTerm ||
        (booking as any).contractTerm ||
        (booking as any).officeRentalTerm ||
        ""
      if (isOfficeResourceBooking(booking) && storedRental) {
        setSelectedDuration(rentalTermToDisplay[storedRental] || null)
      } else {
        const interval = getAvailabilityTimeRange({ ...booking })
        setSelectedDuration(getEventSlots(undefined).find((slot) => slot.startMinutes === interval?.startMinutes && slot.endMinutes === interval?.endMinutes)?.label || null)
      }
    }
  }, [open, booking, minBookableDate])

  if (!booking) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) {
      setReasonError(true)
      return
    }
    const selectedAvailability = selectedDate ? availabilityDays[selectedDate] : undefined
    const selectedSlotIsAvailable = isOffice
      ? selectedAvailability?.status === "available"
      : selectedAvailability?.availableSlots.some((slot) => slot.label === selectedDuration)
    if (!selectedDate || !availabilitySpace || availabilityLoading || availabilityError || !selectedAvailability || selectedAvailability.status === "maintenance" || selectedAvailability.status === "full" || !selectedSlotIsAvailable || (isOffice && !selectedRentalTerm)) {
      toast({
        title: "Date Unavailable",
        description: resourceError || availabilityError || "The selected date or time is no longer available. Please choose another slot.",
        variant: "destructive",
      })
      return
    }
    const changes: Record<string, unknown> = {}
    if (selectedDate !== booking.date) changes.date = selectedDate
    if (isOfficeResourceBooking(booking)) {
      if (companyName !== ((booking as any).companyName || booking.eventName || "")) {
        changes.companyName = companyName
        changes.eventName = companyName
      }
      if (natureOfBusiness !== ((booking as any).natureOfBusiness || booking.eventType || "")) {
        changes.natureOfBusiness = natureOfBusiness
        changes.eventType = natureOfBusiness
      }
      changes.bookingType = "office"
      changes.bookingCategory = "office"
      changes.isOfficeRental = true
      const storedRental =
        (booking as any).rentalTerm ||
        (booking as any).contractTerm ||
        (booking as any).officeRentalTerm ||
        ""
      const displayRental = rentalTermToDisplay[storedRental] || ""
      if (selectedDuration && selectedDuration !== displayRental) {
        changes.time = selectedDuration
        const term = selectedRentalTerm
        changes.rentalTerm = term
        changes.contractTerm = term
        changes.officeRentalTerm = term
      }
    } else {
      if (eventName !== booking.eventName) changes.eventName = eventName
      if (resolvedEventType !== booking.eventType) changes.eventType = resolvedEventType
      if (String(guestCount) !== String(booking.guestCount)) changes.guestCount = Number(guestCount) || booking.guestCount
      if ((notes || "") !== (booking.specialRequests || "")) changes.specialRequests = notes
      const interval = getAvailabilityTimeRange({ ...booking })
      const selectedSlot = availableVenueSlots.find((slot) => slot.label === selectedDuration)
      if (selectedSlot && (selectedSlot.startMinutes !== interval?.startMinutes || selectedSlot.endMinutes !== interval?.endMinutes)) {
        changes.time = selectedSlot.label
        changes.startTime = selectedSlot.startTimeLabel
        changes.endTime = selectedSlot.endTimeLabel
      }
    }
    onSubmitChanges(changes, reason.trim())
    onClose()
  }

  const currentStepIdx = step === "schedule" ? 0 : 1
  const steps = ["Schedule", "Details"]

  const renderDay = (day: number) => {
    const iterDate = new Date(year, month, day)
    const iterDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const isSelected = selectedDate === iterDateStr
    const isBookingOwnDate = booking?.date === iterDateStr
    const isBeforeAllowedWindow = iterDate < minBookableDate && !isBookingOwnDate
    const dayAvailability = availabilityDays[iterDateStr]

    let statusClass = "border-slate-200 bg-white text-slate-700 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700"
    let isDisabled = false

    if (isBeforeAllowedWindow) {
      statusClass = "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-300 opacity-60"
      isDisabled = true
    } else if (availabilityLoading || !dayAvailability) {
      statusClass = "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-300 opacity-60"
      isDisabled = true
    } else if (dayAvailability.status === "maintenance") {
      statusClass = "cursor-not-allowed border-slate-900 bg-slate-900 text-slate-400"
      isDisabled = true
    } else if (dayAvailability.status === "full") {
      statusClass = "cursor-not-allowed border-rose-100 bg-rose-50 text-rose-300"
      isDisabled = true
    } else if (dayAvailability.status === "few") {
      statusClass = "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100"
    }

    if (isSelected && !isDisabled) {
      statusClass = `${statusClass} ring-2 ring-orange-600 ring-offset-1 scale-105`
    }

    return (
      <button
        key={day}
        type="button"
        disabled={isDisabled}
        onClick={() => {
          setSelectedDate(iterDateStr)
          if (!isOffice) setSelectedDuration(null)
        }}
        className={`flex h-7 w-7 2xl:h-8 2xl:w-8 items-center justify-center rounded-full border text-[10px] xl:text-[11px] font-black outline-none transition-all focus-visible:ring-2 focus-visible:ring-orange-300 ${statusClass}`}
      >
        {day}
      </button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent aria-describedby={undefined}
        showCloseButton={false}
        className={cn(
          "!flex !flex-col !gap-0 !p-0 overflow-y-auto max-h-[90dvh] bg-white rounded-none sm:rounded-[2rem] border-0 [&>button]:hidden shadow-2xl w-[95vw] sm:max-w-2xl",
          step === "schedule" && "sm:!max-w-[95vw] lg:!max-w-[1000px]",
          step === "details" && "sm:!max-w-[660px]",
        )}
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <DialogTitle className="sr-only">Modify Booking</DialogTitle>

        {/* Close button */}
        <div className="shrink-0 absolute top-5 right-5 z-50">
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-full bg-white text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-colors border border-slate-200"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5 md:w-5 md:h-5" />
          </button>
        </div>

        {/* Back button */}
        {step === "details" && (
          <div className="shrink-0 absolute top-5 left-5 z-50">
            <button
              type="button"
              onClick={() => setStep("schedule")}
              className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center rounded-full bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors border border-slate-200 shadow-sm"
              aria-label="Go Back"
            >
              <ArrowLeft className="w-3.5 h-3.5 md:w-5 md:h-5" />
            </button>
          </div>
        )}

        {/* Step indicator */}
        <div className="shrink-0 px-3 pt-5 pb-1 bg-white border-b border-slate-100">
          <div className="flex items-center justify-center gap-0">
            {steps.map((label, i) => (
              <React.Fragment key={label}>
                {i > 0 && (
                  <div className={`h-px w-4 md:w-6 transition-colors ${i <= currentStepIdx ? 'bg-[#ea580c]' : 'bg-slate-200'}`} />
                )}
                <div className="flex items-center gap-1.5">
                  <div className={`flex h-6 w-6 md:h-7 md:w-7 items-center justify-center rounded-full text-[10px] md:text-[11px] font-black transition-colors ${i <= currentStepIdx ? 'bg-[#ea580c] text-white' : 'bg-slate-100 text-slate-400'}`}>
                    {i + 1}
                  </div>
                  <span className={`hidden sm:inline text-[8px] md:text-[9px] font-bold uppercase tracking-[0.2em] ${i <= currentStepIdx ? 'text-slate-900' : 'text-slate-400'}`}>
                    {label}
                  </span>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Schedule Step - replicating New Booking Step 3 */}
        {step === "schedule" ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
              <div className="mx-auto w-full max-w-[680px] space-y-6">
                {/* Venue info header (like New Booking Step 3) */}
                <div>
                  <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
                    {availabilitySpace ? [availabilitySpace.name, availabilitySpace.roomName].filter(Boolean).join(" - ") : booking.venue}
                  </h2>
                  {venueInfo && (
                    <p className="text-[#ea580c] font-black text-lg leading-tight">
                      ₱{venueInfo.price.toLocaleString()}
                      <span className="text-black font-bold text-[9px] tracking-[0.2em] uppercase ml-1">
                        / {isOffice ? 'Per Month' : 'Per 6 Hrs'}
                      </span>
                    </p>
                  )}
                  <p className="text-slate-500 mt-2 text-xs">
                    Update your preferred date and time for this booking.
                  </p>
                  {(resourceError || availabilityError) && <p role="alert" className="mt-3 text-xs font-semibold text-rose-700">{resourceError || availabilityError}</p>}
                  {availabilityLoading && <p role="status" className="mt-3 text-xs font-semibold text-slate-500">Checking availability...</p>}
                </div>

                {/* Two-column layout: Calendar + Time (like New Booking) */}
                <div className="grid grid-cols-1 xl:grid-cols-[minmax(240px,300px)_minmax(200px,1fr)] gap-4 xl:gap-6 w-full items-start">
                  {/* Calendar column */}
                  <div>
                    <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-900 mb-3">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-950 text-[9px] text-white shadow-sm">1</span>
                      Select Date
                    </h3>
                    <div className="overflow-hidden rounded-[1rem] border border-slate-200 bg-white shadow-sm">
                      {/* Calendar header */}
                      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-2.5 py-2">
                        <button
                          type="button"
                          aria-label="Previous month"
                          onClick={() => {
                            setCalendarMonth(new Date(year, month - 1, 1))
                            setSelectedDate(null)
                            if (!isOffice) setSelectedDuration(null)
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <div className="text-center">
                          <h5 className="text-[13px] font-black leading-none text-slate-950 md:text-sm">
                            {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                          </h5>
                          <p className="mt-0.5 text-[7px] font-bold uppercase tracking-[0.2em] text-black">
                            Choose an available day
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label="Next month"
                          onClick={() => {
                            setCalendarMonth(new Date(year, month + 1, 1))
                            setSelectedDate(null)
                            if (!isOffice) setSelectedDuration(null)
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {/* Day-of-week headers */}
                      <div className="mt-3 mb-1.5 grid grid-cols-7 text-center px-2">
                        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(dayLabel => (
                          <div key={dayLabel} className="text-[7px] font-black uppercase tracking-[0.1em] text-black">
                            {dayLabel}
                          </div>
                        ))}
                      </div>
                      {/* Days grid */}
                      <div className="grid grid-cols-7 justify-items-center gap-0.5 px-2 pb-3">
                        {emptySlots.map((_, i) => <div key={`e-${i}`} />)}
                        {days.map(renderDay)}
                      </div>
                      {/* Legend */}
                      <div className="mx-2 mb-2 grid grid-cols-4 gap-1 border-t border-slate-100 pt-2">
                        <div className="flex items-center justify-center gap-1.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.08em] text-emerald-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Avail
                        </div>
                        <div className="flex items-center justify-center gap-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.08em] text-amber-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-300" /> Few
                        </div>
                        <div className="flex items-center justify-center gap-1.5 rounded-full bg-rose-50 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.08em] text-rose-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-200" /> Full
                        </div>
                        <div className="flex items-center justify-center gap-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.08em] text-slate-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-900" /> Maint.
                        </div>
                      </div>
                    </div>
                    {/* Earliest bookable date info */}
                    <div className="mt-3 rounded-2xl border border-orange-100 bg-orange-50 px-2.5 py-2">
                      <p className="text-[8px] font-black uppercase tracking-[0.2em] text-orange-700">
                        Earliest bookable date
                      </p>
                      <p className="mt-0.5 text-[10px] font-bold leading-3 text-orange-900">
                        {minBookableDate.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
                        . Gray dates are not available for booking.
                      </p>
                    </div>
                  </div>

                  {/* Time / Duration column */}
                  <div>
                    <h3 className="text-[10px] font-black text-slate-900 tracking-[0.2em] uppercase mb-2 flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-[9px]">2</div>
                      Select {isOffice ? 'Duration' : 'Time'}
                    </h3>
                    {!isOffice && selectedDate && !availabilityLoading && !availabilityError && occupiedIntervals.length > 0 && (
                      <section aria-label="Selected date availability" className="mb-3 space-y-2 rounded-lg border border-amber-100 bg-amber-50/60 p-3 text-xs">
                        <div>
                          <p className="font-bold text-slate-700">Existing booking(s)</p>
                          {occupiedIntervals.map((interval, index) => <p key={`${interval.startMinutes}:${interval.endMinutes}:${index}`} className="mt-1 font-semibold tabular-nums text-slate-600">{interval.startTimeLabel} - {interval.endTimeLabel}</p>)}
                        </div>
                        <div>
                          <p className="font-bold text-slate-700">Available start times</p>
                          <p className="mt-1 font-semibold tabular-nums text-orange-700">{availableVenueSlots.map((slot) => slot.startTimeLabel).join(", ") || "None"}</p>
                        </div>
                      </section>
                    )}
                    {(selectedDate || isOffice) && (
                      <div className="space-y-3 animate-in fade-in rounded-[1rem] border border-slate-200 bg-white p-3 shadow-sm">
                        {isOffice && selectedRentalTerm && selectedDay && !availabilityLoading && !availabilityError && selectedDay.status !== "available" && <p role="alert" className="text-xs font-semibold text-rose-700">The selected rental term is unavailable from this date. Choose another date or duration.</p>}
                        {isOffice ? (
                          ["6 Months", "1 Year", "2 Years"].map((slot) => (
                            <button
                              key={slot}
                              type="button"
                              onClick={() => setSelectedDuration(slot)}
                              className={`w-full flex items-center justify-between p-3 min-h-[44px] rounded-lg border-2 transition-all focus-visible:ring-2 focus-visible:ring-orange-200 outline-none ${
                                selectedDuration === slot
                                  ? 'border-[#ea580c] bg-orange-50 shadow-sm ring-2 ring-orange-50'
                                  : 'border-slate-100 bg-white hover:border-[#ea580c]'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <Calendar className={`w-4 h-4 ${selectedDuration === slot ? 'text-[#ea580c]' : 'text-slate-400'}`} />
                                <span className={`font-bold text-xs ${selectedDuration === slot ? 'text-orange-900' : 'text-slate-700'}`}>{slot}</span>
                              </div>
                              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                selectedDuration === slot ? 'border-[#ea580c] bg-[#ea580c]' : 'border-slate-200'
                              }`}>
                                {selectedDuration === slot && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                              </div>
                            </button>
                          ))
                        ) : (
                          <>
                            <Select value={selectedDuration || ""} onValueChange={setSelectedDuration} disabled={availabilityLoading || Boolean(availabilityError) || availableVenueSlots.length === 0}>
                              <SelectTrigger className="w-full h-10 md:h-11 rounded-lg bg-white border-2 border-slate-200 px-3 font-bold text-xs text-slate-700 focus-visible:ring-2 focus-visible:ring-[#ea580c] transition-all data-[state=open]:border-[#ea580c]">
                                <SelectValue placeholder="Select Start Time" />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border-slate-200 shadow-xl max-h-[150px] md:max-h-[180px] z-[10003]">
                                {availableVenueSlots.map(slot => (
                                    <SelectItem key={slot.label} value={slot.label} className="font-bold text-xs text-slate-700 py-2 cursor-pointer focus:bg-orange-50 focus:text-[#ea580c]">
                                      <div className="flex items-center gap-2">
                                        <Clock className="w-3 h-3 text-[#ea580c]" />
                                        {slot.startTimeLabel}
                                      </div>
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                            {/* Selected time confirmation card */}
                            {selectedDuration && availableVenueSlots.some(s => s.label === selectedDuration) && (
                              <div className="p-3 bg-orange-50 border border-orange-100 rounded-lg flex items-start gap-2 animate-in fade-in">
                                <CheckCircle2 className="w-4 h-4 text-[#ea580c] shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-[8px] font-bold text-orange-900 uppercase tracking-[0.2em] leading-relaxed">
                                    Selected 6-Hour Schedule
                                  </p>
                                  <p className="text-[10px] font-black text-[#ea580c]">
                                    {selectedDuration}
                                  </p>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom bar */}
            <div className="shrink-0 px-4 py-3 border-t border-slate-100 bg-white">
              <Button
                disabled={!selectedScheduleIsAvailable}
                onClick={() => setStep("details")}
                className="w-full lg:max-w-[385px] mx-auto block bg-[#ea580c] hover:bg-[#c2410c] text-white rounded-full h-10 font-bold text-xs md:text-sm transition-transform active:scale-95 disabled:opacity-50"
              >
                Proceed to Details
              </Button>
            </div>
          </div>
        ) : (
          /* Details Step - replicating New Booking Step 4 */
          <div className="flex-1 flex flex-col overflow-y-auto">
            <div className="flex-1 flex flex-col md:justify-center px-4 py-4 md:py-6">
              <div className="mx-auto w-full max-w-[520px] flex flex-col">
                <div className="shrink-0 mb-5 text-center">
                  <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
                    Final Details
                  </h2>
                  <p className="text-slate-500 mt-1 text-xs">
                    {isOffice ? "Update your office rental details." : "Update your event information."}
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  {isOffice ? (
                    <>
                      <h3 className="shrink-0 text-xs font-black text-slate-900 flex items-center gap-2 mb-1">
                        <Calendar className="w-4 h-4 text-[#ea580c]" />
                        Office Details
                      </h3>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-black uppercase tracking-[0.2em]">
                          Company Name <span className="text-rose-500">*</span>
                        </label>
                        <Input
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          placeholder="e.g. Acme Corp"
                          className="h-10 w-full rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs focus-visible:ring-2 focus-visible:ring-[#ea580c]"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-black uppercase tracking-[0.2em]">
                          Nature of Business <span className="text-rose-500">*</span>
                        </label>
                        <select
                          aria-label="Nature of Business"
                          value={natureOfBusiness}
                          onChange={(e) => setNatureOfBusiness(e.target.value)}
                          className="h-10 w-full rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs focus:ring-2 focus:ring-[#ea580c] outline-none"
                        >
                          <option value="" disabled>Select Nature of Business</option>
                          {natureOfBusiness && !hasBusinessTypeOption && <option value={natureOfBusiness}>{natureOfBusiness}</option>}
                          {Object.entries(businessTypeOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        {(!hasBusinessTypeOption || natureOfBusiness === "others") && (
                          <Input
                            aria-label="Custom nature of business"
                            required
                            value={natureOfBusiness}
                            onChange={(e) => setNatureOfBusiness(e.target.value)}
                            placeholder="Specify your nature of business"
                            className="mt-2 h-10 w-full rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs focus-visible:ring-2 focus-visible:ring-[#ea580c]"
                          />
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-black uppercase tracking-[0.2em]">
                          Rental Term / Contract Duration <span className="text-rose-500">*</span>
                        </label>
                        <div className="flex flex-col gap-2">
                          {["6 Months", "1 Year", "2 Years"].map((slot) => (
                            <button
                              key={slot}
                              type="button"
                              onClick={() => setSelectedDuration(slot)}
                              className={`w-full flex items-center justify-between p-3 min-h-[44px] rounded-lg border-2 transition-all focus-visible:ring-2 focus-visible:ring-orange-200 outline-none ${
                                selectedDuration === slot
                                  ? 'border-[#ea580c] bg-orange-50 shadow-sm ring-2 ring-orange-50'
                                  : 'border-slate-100 bg-white hover:border-[#ea580c]'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <Calendar className={`w-4 h-4 ${selectedDuration === slot ? 'text-[#ea580c]' : 'text-slate-400'}`} />
                                <span className={`font-bold text-xs ${selectedDuration === slot ? 'text-orange-900' : 'text-slate-700'}`}>{slot}</span>
                              </div>
                              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                selectedDuration === slot ? 'border-[#ea580c] bg-[#ea580c]' : 'border-slate-200'
                              }`}>
                                {selectedDuration === slot && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 className="shrink-0 text-xs font-black text-slate-900 flex items-center gap-2 mb-1">
                        <PartyPopper className="w-4 h-4 text-[#ea580c]" />
                        Event Information
                      </h3>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-black uppercase tracking-[0.2em]">
                          Event Name <span className="text-rose-500">*</span>
                        </label>
                        <Input
                          value={eventName}
                          onChange={(e) => setEventName(e.target.value)}
                          placeholder="e.g. 18th Birthday Party"
                          className="h-10 w-full rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs focus-visible:ring-2 focus-visible:ring-[#ea580c]"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-black uppercase tracking-[0.2em]">
                            Event Type <span className="text-rose-500">*</span>
                          </label>
                          <Select value={eventType} onValueChange={setEventType}>
                            <SelectTrigger aria-label="Event Type" className="h-10 w-full rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs focus:ring-2 focus:ring-[#ea580c]">
                              <SelectValue placeholder="Choose Event Type" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-slate-200 shadow-xl max-h-[200px] z-[10003]">
                              {(eventType && !eventTypeOptions.includes(eventType) ? [eventType, ...eventTypeOptions] : eventTypeOptions).map((value) => (
                                <SelectItem key={value} value={value} className="font-bold text-xs text-slate-700 py-2 cursor-pointer focus:bg-orange-50 focus:text-[#ea580c]">{value}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-black uppercase tracking-[0.2em]">
                            Estimated Guests <span className="text-rose-500">*</span>
                          </label>
                          <Input
                            type="number"
                            min={1}
                            max={venueMaxPax}
                            value={guestCount}
                            onChange={(e) => {
                              let val = parseInt(e.target.value)
                              if (val > venueMaxPax) val = venueMaxPax
                              if (val < 1) val = 1
                              setGuestCount(val ? String(val) : "")
                            }}
                            placeholder={`Up to ${venueMaxPax} pax`}
                            className="h-10 w-full rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs focus-visible:ring-2 focus-visible:ring-[#ea580c]"
                          />
                        </div>
                      </div>
                      {isCustomEventType && (
                        <Input aria-label="Custom event type" required value={customEventType} onChange={(e) => setCustomEventType(e.target.value)} placeholder="Please specify event type..." className="h-10 w-full rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs focus-visible:ring-2 focus-visible:ring-[#ea580c]" />
                      )}
                    </>
                  )}

                  {/* Reason for Modification */}
                  <div className="space-y-1.5 pt-3 border-t border-slate-100">
                    <label className="text-[10px] font-bold text-black uppercase tracking-[0.2em]">
                      Reason for Modification <span className="text-rose-500">*</span>
                    </label>
                    <Textarea
                      value={reason}
                      onChange={(e) => {
                        setReason(e.target.value)
                        if (reasonError && e.target.value.trim()) setReasonError(false)
                      }}
                      placeholder="Type your reason for requesting this modification..."
                      className={cn(
                        "min-h-[80px] w-full rounded-xl bg-slate-50 border px-3 py-2 text-xs focus-visible:ring-2 focus-visible:ring-[#ea580c] resize-none",
                        reasonError ? "border-rose-300" : "border-slate-200",
                      )}
                    />
                    {reasonError && (
                      <p className="text-[11px] font-semibold text-rose-600">
                        Please provide a reason for modification.
                      </p>
                    )}
                  </div>

                  {/* No Terms & Conditions */}

                  {/* Submit */}
                  <div className="pt-1">
                    <Button
                      type="submit"
                      disabled={!selectedScheduleIsAvailable}
                      className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-full h-12 font-bold text-sm shadow-sm active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                    >
                      Submit Modification Request
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
      </DialogContent>
    </Dialog>
  )
}

export default function MyBookingsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { getUserBookings, requestCancellation, issueReceipt, requestModification, bookings, paymentRecords } =
    useBookingData({ bookings: true, maintenance: true, payments: true })
  const { toast } = useToast()

  const { markByBookingId } = useNotifications()
  const CLIENT_BOOKING_TYPES: NotificationType[] = useMemo(
    () => ["booking_approved", "booking_rejected", "cancellation_approved", "cancellation_declined", "modification_approved", "modification_declined"],
    [],
  )

  const [myBookings, setMyBookings] = useState<Booking[]>([])
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null)
  const [cancelReason, setCancelReason] = useState("")
  const [isSubmittingCancellation, setIsSubmittingCancellation] = useState(false)
  const [modifyTarget, setModifyTarget] = useState<Booking | null>(null)
  const [reviews, setReviews] = useState<ReviewRecord[]>([])
  const [reviewTarget, setReviewTarget] = useState<Booking | null>(null)
  const [paymentTarget, setPaymentTarget] = useState<Booking | null>(null)
  const [viewingBooking, setViewingBooking] = useState<Booking | null>(null)
  const [receiptToView, setReceiptToView] = useState<BookingReceipt | null>(
    null,
  )
  const [receiptBooking, setReceiptBooking] = useState<Booking | null>(null)

  const [searchQuery, setSearchQuery] = useState("")
  const [filter, setFilter] = useState<BookingFilter>("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [showDateFilter, setShowDateFilter] = useState(false)
  const [historyPage, setHistoryPage] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    if (user) {
      setMyBookings(getUserBookings(user.id))
    } else {
      setMyBookings([])
    }
  }, [user, getUserBookings, bookings])

  // Reviews load lazily and are scoped to THIS user's bookings only
  // (where bookingId IN [...my booking ids]) instead of fetching the entire
  // reviews collection on page load.
  useEffect(() => {
    if (!user || myBookings.length === 0) {
      setReviews([])
      return
    }
    loadReviews(myBookings.map((b) => b.id)).then(setReviews)
  }, [user, myBookings])

  const searchParams = useSearchParams()

  useEffect(() => {
    const bookingId = searchParams.get("bookingId")
    const isHistory = searchParams.get("history") === "true"
    if (bookingId && myBookings.length > 0) {
      const found = myBookings.find((b) => b.id === bookingId)
      if (found) {
        setViewingBooking(found)
        markByBookingId(found.id, CLIENT_BOOKING_TYPES)
        if (isHistory) {
          setShowHistory(true)
        }
      }
    }
  }, [searchParams, myBookings, markByBookingId, CLIENT_BOOKING_TYPES])

  const latestPaymentActivityByBooking = useMemo(() => {
    const map = new Map<string, number>()
    for (const record of paymentRecords || []) {
      const bookingId = record.bookingId
      if (!bookingId) continue
      const time = new Date(
        String(record.submittedAt || record.updatedAt || ""),
      ).getTime()
      if (Number.isFinite(time) && time > 0 && time > (map.get(bookingId) || 0)) {
        map.set(bookingId, time)
      }
    }
    return map
  }, [paymentRecords])

  const getBookingActivityTime = (booking: Booking) => {
    const fromPayment = latestPaymentActivityByBooking.get(booking.id)
    if (fromPayment) return fromPayment
    const fallback = new Date(
      String(
        (booking as any).paymentSubmittedAt ||
          (booking as any).latestPaymentSubmittedAt ||
          booking.createdAt ||
          "",
      ),
    ).getTime()
    return Number.isFinite(fallback) ? fallback : 0
  }

  const sortedBookings = useMemo(
    () =>
      [...myBookings].sort(
        (a, b) => getBookingActivityTime(b) - getBookingActivityTime(a),
      ),
    [myBookings, latestPaymentActivityByBooking],
  )

  const { currentBooking, otherActiveBookings, historyBookings } = useMemo(() => {
    const current = getCurrentBooking(sortedBookings)
    const currentId = current ? getBookingId(current) : ""

    return {
      currentBooking: current,
      otherActiveBookings: sortedBookings.filter(
        (b) => isActiveBooking(b) && getBookingId(b) !== currentId,
      ),
      historyBookings: sortedBookings.filter(isPastBooking),
    }
  }, [sortedBookings])

  const searchMatch = (booking: Booking, query: string) => {
    if (!query) return true
    const q = query.toLowerCase().trim()
    const fields = [
      booking.id,
      booking.eventName,
      booking.eventType,
      booking.venue,
      getBookingCustomerName(booking),
      booking.status,
      booking.paymentStatus,
    ]
    return fields.some(
      (f) => f && String(f).toLowerCase().includes(q),
    )
  }

  const matchesFilter = (booking: Booking, f: BookingFilter) => {
    if (f === "all") return true
    if (f === "current") return isCurrentBooking(booking)
    if (f === "cancellation_requested") {
      return String(booking.status || "").toLowerCase() === f
    }
    return getBookingLifecycleStatus(booking as unknown as Record<string, unknown>) === f
  }

  const filteredOtherActive = useMemo(
    () => otherActiveBookings.filter((b) => searchMatch(b, searchQuery)),
    [otherActiveBookings, searchQuery],
  )

  const otherActivePageSize = 10
  const totalOtherActivePages = Math.max(1, Math.ceil(filteredOtherActive.length / otherActivePageSize))
  const safeCurrentPage = Math.min(currentPage, totalOtherActivePages)
  const paginatedOtherActive = useMemo(
    () =>
      filteredOtherActive.slice(
        (safeCurrentPage - 1) * otherActivePageSize,
        safeCurrentPage * otherActivePageSize,
      ),
    [filteredOtherActive, safeCurrentPage],
  )

  useEffect(() => {
    setCurrentPage(1)
  }, [showHistory])

  const filteredHistory = useMemo(
    () =>
      historyBookings.filter(
        (b) =>
          matchesFilter(b, filter) &&
          searchMatch(b, searchQuery) &&
          isDateInRange(b.date, dateFrom || undefined, dateTo || undefined),
      ),
    [historyBookings, filter, searchQuery, dateFrom, dateTo],
  )

  const totalHistoryPages = Math.max(
    1,
    Math.ceil(filteredHistory.length / PAGE_SIZE),
  )
  const safeHistoryPage = Math.min(historyPage, totalHistoryPages)
  const paginatedHistory = useMemo(
    () =>
      filteredHistory.slice(
        (safeHistoryPage - 1) * PAGE_SIZE,
        safeHistoryPage * PAGE_SIZE,
      ),
    [filteredHistory, safeHistoryPage],
  )

  useEffect(() => {
    setHistoryPage(1)
  }, [searchQuery, filter, dateFrom, dateTo])

  const [highlightedBookingId, setHighlightedBookingId] = useState<string | null>(null)
  const bookingHighlightHandledRef = useRef(false)
  const bookingHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const h = sessionStorage.getItem("client_booking_highlight")
    if (h) {
      setHighlightedBookingId(h)
      setSearchQuery("")
      setFilter("all")
      setDateFrom("")
      setDateTo("")
    }
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ bookingId: string }>
      const bookingId = customEvent.detail?.bookingId
      if (!bookingId) return
      if (bookingHighlightTimeoutRef.current) {
        clearTimeout(bookingHighlightTimeoutRef.current)
        bookingHighlightTimeoutRef.current = null
      }
      bookingHighlightHandledRef.current = false
      if (highlightedBookingId === bookingId) {
        setHighlightedBookingId(null)
        requestAnimationFrame(() => {
          bookingHighlightHandledRef.current = false
          setHighlightedBookingId(bookingId)
        })
      } else {
        setHighlightedBookingId(bookingId)
      }
      setSearchQuery("")
      setFilter("all")
      setDateFrom("")
      setDateTo("")
    }
    window.addEventListener("client-booking-highlight", handler)
    return () => {
      window.removeEventListener("client-booking-highlight", handler)
    }
  }, [highlightedBookingId])

  useEffect(() => {
    if (!highlightedBookingId) return
    if (bookingHighlightHandledRef.current) return
    const target = myBookings.find((b) => b.id === highlightedBookingId)
    if (!target) return

    const past = isPastBooking(target)

    if (past && !showHistory) {
      setShowHistory(true)
      return
    }
    if (!past && showHistory) {
      setShowHistory(false)
      return
    }

    if (past) {
      const idx = filteredHistory.findIndex((b) => b.id === highlightedBookingId)
      if (idx === -1) return
      const page = Math.floor(idx / PAGE_SIZE) + 1
      if (page !== safeHistoryPage) {
        setHistoryPage(page)
        return
      }
    } else {
      const isCurrent =
        currentBooking && getBookingId(currentBooking) === highlightedBookingId
      if (!isCurrent) {
        const idx = otherActiveBookings.findIndex(
          (b) => b.id === highlightedBookingId,
        )
        if (idx === -1) return
        const page = Math.floor(idx / otherActivePageSize) + 1
        if (page !== safeCurrentPage) {
          setCurrentPage(page)
          return
        }
      }
    }

    bookingHighlightHandledRef.current = true
    sessionStorage.removeItem("client_booking_highlight")
    bookingHighlightTimeoutRef.current = setTimeout(() => {
      setHighlightedBookingId(null)
      bookingHighlightTimeoutRef.current = null
    }, 3000)
    return () => {
      if (bookingHighlightTimeoutRef.current) {
        clearTimeout(bookingHighlightTimeoutRef.current)
        bookingHighlightTimeoutRef.current = null
      }
    }
  }, [
    highlightedBookingId,
    myBookings,
    showHistory,
    filteredHistory,
    safeHistoryPage,
    otherActiveBookings,
    safeCurrentPage,
    currentBooking,
  ])

  const canWriteReview = (booking: Booking) => {
    const status = String(booking.status || "").toLowerCase()
    if (status !== "completed" && status !== "complete") return false
    if (isOfficeResourceBooking(booking)) return false
    return !hasReviewForBooking(reviews, booking.id)
  }

  const handlePay = (booking: Booking) => {
    if (booking.status === "pending") {
      router.push(`/portal/payments?bookingId=${booking.id}`)
    } else {
      setPaymentTarget(booking)
    }
  }

  const handleCancel = (booking: Booking) => {
    setBookingToCancel(booking)
    setCancelReason("")
  }

  const handleReview = (booking: Booking) => {
    setReviewTarget(booking)
  }

  const handleView = (booking: Booking) => {
    setViewingBooking(booking)
    markByBookingId(booking.id, CLIENT_BOOKING_TYPES)
  }

  const handleEdit = (booking: Booking) => {
    setModifyTarget(booking)
  }

  const handleViewReceipt = async (booking: Booking) => {
    markByBookingId(booking.id, CLIENT_BOOKING_TYPES)
    const existing =
      booking.receipt || await getStoredReceiptByBookingId(booking.id)
    if (existing) {
      setReceiptToView(existing)
      setReceiptBooking(booking)
      return
    }
    const payStatus = String(booking.paymentStatus || "").toLowerCase()
    const records = getRecordsForBooking(paymentRecords, booking)
    const summary = calculatePaymentSummary(booking, records)
    const canIssueReceipt =
      summary.overallStatus === "partial" ||
      summary.overallStatus === "completed" ||
      (records.length === 0 &&
        (payStatus === "verified" || payStatus === "paid" || payStatus === "slot_verified"))
    if (canIssueReceipt) {
      try {
        const updatedBooking = await issueReceipt(booking.id)
        const updated = updatedBooking.receipt || await getStoredReceiptByBookingId(booking.id)
        if (!updated) throw new Error("Unable to generate receipt. Please contact support.")
        setReceiptToView(updated)
        setReceiptBooking(updatedBooking)
      } catch (error) {
        toast({
          title: "Receipt Not Available",
          description: error instanceof Error ? error.message : "Unable to generate receipt. Please contact support.",
          variant: "destructive",
        })
      }
    } else {
      toast({
        title: "Receipt Not Available",
        description:
          "Receipt will be available after payment verification.",
        variant: "destructive",
      })
    }
  }

  const receiptPresentation = useMemo<ReceiptPresentation | null>(() => {
    if (!receiptBooking || !receiptToView) return null
    const selectedReceipt: PaymentRecordLike = {
      ...receiptToView,
      id: receiptToView.paymentId,
      paymentId: receiptToView.paymentId,
      paymentNumber: (receiptToView as any).paymentNumber,
      receiptNumber: receiptToView.receiptNumber,
      paymentPurpose: receiptToView.paymentPurpose,
      paymentMethod: receiptToView.paymentMethod,
      amount: receiptToView.amountPaid ?? receiptToView.paymentAmount,
      paymentStatus: receiptToView.paymentStatus,
      submittedAt: receiptToView.paymentSubmittedAt || receiptToView.dateGenerated || receiptToView.dateIssued,
    }
    return getReceiptPresentation(
      receiptBooking,
      getRecordsForBooking(paymentRecords, receiptBooking),
      selectedReceipt,
    )
  }, [paymentRecords, receiptBooking, receiptToView])

  const submitCancellation = async () => {
    if (!bookingToCancel) return
    if (isSubmittingCancellation) return
    if (!isCancellationAllowed(bookingToCancel.date)) {
      toast({
        title: "Cancellation Not Available",
        description: getCancellationMessage(bookingToCancel.date),
        variant: "destructive",
      })
      return
    }
    if (!cancelReason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please provide a reason for cancellation.",
        variant: "destructive",
      })
      return
    }
    setIsSubmittingCancellation(true)
    try {
      const updated = await requestCancellation(bookingToCancel.id, cancelReason.trim())
      setViewingBooking(updated)
      toast({
        title: "Cancellation Requested",
        description: "Your cancellation request is awaiting admin review.",
        className: "bg-slate-900 text-white border-none",
      })
      setBookingToCancel(null)
      setCancelReason("")
    } catch (error: unknown) {
      toast({
        title: "Cancellation Request Failed",
        description: error instanceof Error ? error.message : "Unable to submit the cancellation request.",
        variant: "destructive",
      })
    } finally {
      setIsSubmittingCancellation(false)
    }
  }

  const historyEmpty = filteredHistory.length === 0
  const hasHistoryRecords = historyBookings.length > 0
  const hasOtherActive = otherActiveBookings.length > 0

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 animate-in fade-in duration-500">
        <WriteReviewModal
          open={!!reviewTarget}
          booking={reviewTarget}
          reviews={reviews}
          onClose={() => setReviewTarget(null)}
          onSaved={setReviews}
        />

        <CancellationDialog
          booking={bookingToCancel}
          reason={cancelReason}
          setReason={setCancelReason}
          submitting={isSubmittingCancellation}
          onClose={() => {
            setBookingToCancel(null)
            setCancelReason("")
          }}
          onSubmit={submitCancellation}
        />

        <ModifyBookingFlowModal
          booking={modifyTarget}
          open={!!modifyTarget}
          onClose={() => setModifyTarget(null)}
          onSubmitChanges={async (changes, reason) => {
            if (modifyTarget) {
              try {
                const updated = await requestModification(modifyTarget.id, changes, reason)
                setViewingBooking(updated)
                toast({
                  title: "Modification Requested",
                  description: "Your modification request is under review.",
                  className: "bg-slate-900 text-white border-none",
                })
                setModifyTarget(null)
              } catch (error) {
                toast({
                  title: "Modification Request Failed",
                  description: error instanceof Error ? error.message : "Unable to submit the modification request.",
                  variant: "destructive",
                })
              }
            }
          }}
        />

        <BookingDetailsModal
          booking={viewingBooking}
          open={!!viewingBooking}
          onClose={() => setViewingBooking(null)}
          onPay={handlePay}
          onCancel={handleCancel}
          onViewReceipt={handleViewReceipt}
          onEdit={handleEdit}
          paymentRecords={paymentRecords}
        />

        <ReceiptModal
          receipt={receiptToView}
          open={!!receiptToView}
          onClose={() => {
            const prevBooking = receiptBooking
            setReceiptToView(null)
            setReceiptBooking(null)
            if (prevBooking) setViewingBooking(prevBooking)
          }}
          booking={receiptBooking}
          receiptPresentation={receiptPresentation}
        />

        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ID, event, venue, status..."
              className="h-11 w-full rounded-xl border-slate-200 pl-9 pr-9 text-sm focus-visible:ring-2 focus-visible:ring-orange-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            <TooltipProvider delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ReserveDialog>
                      <Button className="flex h-11 items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 font-bold text-white shadow-sm transition-all hover:bg-orange-700">
                        <Plus className="h-4 w-4" />
                        New Booking
                      </Button>
                    </ReserveDialog>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px] font-semibold">
                    Create a new reservation
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                variant="outline"
                onClick={() => setShowHistory((v) => !v)}
                className="h-11 whitespace-nowrap rounded-xl border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                <Receipt className="mr-1.5 h-3.5 w-3.5" />
                {showHistory ? "Hide Booking History" : "View Booking History"}
              </Button>
            </div>
          </div>

      {/* Current Booking */}
      {!showHistory && (
        <section>
          <SectionHeader
          title="Current Booking"
          subtitle="Your active reservation"
          icon={<ListChecks className="h-4 w-4" />}
        />
        {currentBooking ? (
          <div className="mt-3 space-y-3">
            <NotificationTargetWrapper
              bookingTarget={currentBooking.id}
              isHighlighted={highlightedBookingId === currentBooking.id}
              storageKey="client_booking_highlight"
            >
              <HorizontalBookingCard
                booking={currentBooking}
                onView={handleView}
              />
            </NotificationTargetWrapper>
            {canWriteReview(currentBooking) && (
              <div className="flex justify-end">
                <TooltipProvider delayDuration={400}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => handleReview(currentBooking)}
                        className="h-9 rounded-lg bg-blue-600 px-3 text-[11px] font-bold text-white shadow-sm hover:bg-blue-700"
                      >
                        <Star className="mr-1.5 h-3.5 w-3.5" />
                        Write a Review
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-[10px] font-semibold">
                      Share your experience
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 sm:p-8 text-center">
            <Calendar className="mb-3 h-10 w-10 text-slate-300" />
            <h3 className="text-sm font-black text-slate-900">No current booking found.</h3>
            <p className="mt-1 max-w-sm text-xs text-slate-500">
              You don&apos;t have any upcoming or active reservations. Once you make a new
              booking, it will appear here.
            </p>
            <ReserveDialog>
              <Button className="mt-4 h-9 rounded-xl bg-orange-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-orange-700">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Book Now
              </Button>
            </ReserveDialog>
          </div>
        )}
      </section>
      )}

      {/* Other Current Bookings */}
      {!showHistory && (hasOtherActive || searchQuery) && (
        <section>
          <SectionHeader
            title="Other Current Bookings"
            subtitle="Other active reservations that are still ongoing."
            icon={<ListChecks className="h-4 w-4" />}
          />
          <div className="mt-3 space-y-2">
            {paginatedOtherActive.length > 0 ? (
              paginatedOtherActive.map((booking) => (
                <NotificationTargetWrapper
                  key={booking.id}
                  bookingTarget={booking.id}
                  isHighlighted={highlightedBookingId === booking.id}
                  storageKey="client_booking_highlight"
                >
                  <HistoryRow
                    booking={booking}
                    onView={handleView}
                  />
                </NotificationTargetWrapper>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                <p className="text-sm font-black text-slate-900">No matching bookings</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  Try a different search term.
                </p>
              </div>
            )}
            <Pagination
              page={safeCurrentPage}
              totalPages={totalOtherActivePages}
              onPageChange={setCurrentPage}
            />
          </div>
        </section>
      )}

      {/* Booking History (hidden by default) */}
      {showHistory && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by ID, event, venue, status..."
                className="h-9 rounded-xl border-slate-200 pl-9 pr-9 text-sm focus-visible:ring-2 focus-visible:ring-orange-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as BookingFilter)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-orange-500"
            >
              {FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              onClick={() => setShowDateFilter((v) => !v)}
              className={cn(
                "h-9 shrink-0 rounded-xl border-slate-200 px-3 text-xs font-bold",
                showDateFilter && "bg-orange-50 text-orange-700 border-orange-200",
              )}
            >
              <Filter className="mr-1.5 h-3.5 w-3.5" />
              Date
            </Button>
          </div>

          {showDateFilter && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 rounded-lg border-slate-200 text-xs"
                placeholder="From"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 rounded-lg border-slate-200 text-xs"
                placeholder="To"
              />
              <Button
                variant="outline"
                onClick={() => { setDateFrom(""); setDateTo("") }}
                className="h-9 rounded-lg border-slate-200 px-3 text-xs font-bold"
              >
                <XCircle className="mr-1.5 h-3.5 w-3.5" />
                Clear
              </Button>
            </div>
          )}

          <section>
            <SectionHeader
              title="Booking History"
              subtitle={`${filteredHistory.length} record${filteredHistory.length === 1 ? "" : "s"}`}
              icon={<Receipt className="h-4 w-4" />}
            />

          {historyEmpty ? (
            <div className="mt-3 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 sm:p-8 text-center">
              <FileText className="mb-3 h-10 w-10 text-slate-300" />
              <h3 className="text-sm font-black text-slate-900">No matching bookings</h3>
              <p className="mt-1 text-xs text-slate-500">
                Try adjusting your search, filter, or date range.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {paginatedHistory.map((booking) => (
                <NotificationTargetWrapper
                  key={booking.id}
                  bookingTarget={booking.id}
                  isHighlighted={highlightedBookingId === booking.id}
                  storageKey="client_booking_highlight"
                >
                  <HistoryRow
                    booking={booking}
                    onView={handleView}
                  />
                </NotificationTargetWrapper>
              ))}
              <Pagination
                page={safeHistoryPage}
                totalPages={totalHistoryPages}
                onPageChange={setHistoryPage}
              />
            </div>
          )}
          </section>
        </>
      )}
      </div>
    </div>
  )
}

function BookingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex animate-pulse flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex shrink-0 items-center gap-3 sm:w-[200px]">
            <div className="h-11 w-11 rounded-xl bg-slate-200" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-16 rounded bg-slate-200" />
              <div className="h-4 w-32 rounded bg-slate-200" />
              <div className="h-3 w-24 rounded bg-slate-200" />
            </div>
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-2 gap-y-1.5 sm:grid-cols-4 sm:gap-x-3">
            {[1, 2, 3, 4].map((j) => (
              <div key={j} className="space-y-1">
                <div className="h-3 w-16 rounded bg-slate-200" />
                <div className="h-4 w-24 rounded bg-slate-200" />
              </div>
            ))}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end sm:gap-1">
            <div className="h-5 w-24 rounded-md bg-slate-200" />
            <div className="h-8 w-20 rounded-lg bg-slate-200" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SectionHeader({
  title,
  subtitle,
  icon,
}: {
  title: string
  subtitle?: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5">
      {icon && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs font-semibold text-slate-400">{subtitle}</p>
        )}
      </div>
    </div>
  )
}
