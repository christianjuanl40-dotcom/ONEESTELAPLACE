"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  FileImage,
  Filter,
  Info,
  Loader2,
  MapPin,
  Receipt,
  Search,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";

import { Button } from "@/src/modules/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/src/modules/shared/components/ui/dialog";
import { Input } from "@/src/modules/shared/components/ui/input";
import { Label } from "@/src/modules/shared/components/ui/label";
import { useToast } from "@/src/modules/shared/hooks/use-toast";
import {
  useBookings,
  type Booking,
} from "@/src/modules/client/contexts/booking-context";
import { useAuth } from "@/src/modules/shared/auth/auth-context";
import { useCMS } from "@/src/modules/admin/contexts/cms-context";
import { BankTransferQR } from "@/src/modules/shared/components/bank-transfer-qr";
import { PAYMENT_LABELS, getPaymentMethodLabel } from "@/src/modules/shared/lib/labels";
import {
  ReceiptPaper,
  type ReceiptPaperData,
} from "@/src/modules/shared/components/receipt-paper";
import { cn } from "@/src/modules/shared/lib/utils";

const PAYMENT_WINDOW_HOURS = 24;
const PAYMENT_WINDOW_MS = PAYMENT_WINDOW_HOURS * 60 * 60 * 1000;
const MAX_PROOF_FILE_MB = 5;
const MAX_PROOF_FILE_SIZE = MAX_PROOF_FILE_MB * 1024 * 1024;
const PAGE_SIZE = 10;

type TransactionFilter =
  | "all"
  | "verified"
  | "for_review"
  | "rejected"
  | "incomplete"
  | "refund_eligible"
  | "non_refundable"

const FILTER_OPTIONS: { value: TransactionFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "verified", label: "Verified" },
  { value: "for_review", label: "Pending Verification" },
  { value: "rejected", label: "Rejected" },
  { value: "incomplete", label: "Incomplete" },
  { value: "refund_eligible", label: "Refund Eligible" },
  { value: "non_refundable", label: "Non-Refundable" },
];

function getDeadline(booking?: Booking | null) {
  if (!booking?.createdAt) return null;
  const created = new Date(booking.createdAt).getTime();
  if (Number.isNaN(created)) return null;
  return created + PAYMENT_WINDOW_MS;
}

function formatCountdown(ms: number) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0",
  )}:${String(seconds).padStart(2, "0")}`;
}

function getRemainingMs(booking?: Booking | null) {
  const deadline = getDeadline(booking);
  if (!deadline) return PAYMENT_WINDOW_MS;
  return deadline - Date.now();
}

async function compressImageToDataUrl(file: File, maxWidth = 900, quality = 0.7): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please upload an image file only.")
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width)
        const canvas = document.createElement("canvas")
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          reject(new Error("Unable to compress image."))
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL("image/jpeg", quality))
      }
      img.onerror = () => reject(new Error("Invalid image file."))
      img.src = String(reader.result)
    }
    reader.onerror = () => reject(new Error("Unable to read uploaded file."))
    reader.readAsDataURL(file)
  })
}

function formatMoney(value: number) {
  return `₱${Number(value || 0).toLocaleString("en-PH")}`;
}

function isOfficeRentalBooking(booking?: Partial<Booking> | null) {
  return (
    booking?.isOfficeRental === true ||
    booking?.bookingCategory === "office" ||
    String(booking?.venue || "")
      .toLowerCase()
      .includes("office")
  );
}

function getOfficeReservationFee(booking: Partial<Booking>) {
  return Number(booking.officeReservationFee || booking.totalPrice || 0) || 0;
}

function getOfficeTermLabel(term?: string) {
  if (term === "6_months") return "6 months";
  if (term === "1_year") return "1 year";
  if (term === "2_years") return "2 years";
  return "Not selected";
}

function getPaymentTermLabel(
  type: "full" | "downpayment",
  isSettlingBalance: boolean,
) {
  if (isSettlingBalance) return "Remaining Balance";
  return type === "full" ? "Full Payment" : "Down Payment";
}

function getTransactionDisplayAmount(booking: Booking): number {
  const b = booking as any;
  const totalPrice = Number(b.totalPrice || 0);
  const isDownPayment =
    b.paymentType === "downpayment" ||
    String(b.paymentType || "").toLowerCase().includes("down");

  if (isDownPayment) {
    const dpRemaining = Number(b.downpaymentRemaining || 0);
    const dpPaid = Number(b.downpaymentPaid || 0);

    if (dpRemaining > 0 && dpPaid > 0) {
      return dpRemaining;
    }

    return Number(b.selectedDownpaymentAmount || (Number(b.downPaymentPercentage || 50) / 100) * totalPrice || 0);
  }

  return totalPrice;
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="font-semibold text-slate-500 shrink-0">{label}</span>
      <span className="max-w-[180px] sm:max-w-[230px] break-all text-right text-xs font-black text-slate-900">
        {value}
      </span>
    </div>
  );
}

function isCurrentTransaction(booking: Booking) {
  const status = String(booking.status || "").toLowerCase();
  return status !== "completed";
}

function hasPaymentRecord(booking: Booking) {
  const amt = Number((booking as any).amountPaid || 0);
  const payAmt = Number((booking as any).paymentAmount || 0);
  const proof = (booking as any).proofUrl || (booking as any).paymentProof || (booking as any).proofOfPayment;
  const ps = String(booking.paymentStatus || "").toLowerCase();
  if (amt > 0 || payAmt > 0) return true;
  if (proof) return true;
  if (ps === "unpaid") return true;
  return ["for review", "pending verification", "partial payment", "partial", "fully paid", "verified", "rejected", "incomplete"].includes(ps);
}

function paymentMatchesFilter(paymentStatus: string, status: string, filter: TransactionFilter) {
  if (filter === "all") return true;
  const ps = paymentStatus.toLowerCase();
  const st = status.toLowerCase();
  if (filter === "verified") {
    return ["verified", "paid", "slot_verified"].includes(ps);
  }
  if (filter === "for_review") {
    return ["for_review", "cash_pending", "slot_pending", "pending_verification"].includes(ps);
  }
  if (filter === "rejected") return ps === "rejected";
  if (filter === "incomplete") {
    return ps === "incomplete" || (!ps && st === "pending");
  }
  if (filter === "refund_eligible") {
    return st === "cancelled" && ps !== "rejected";
  }
  if (filter === "non_refundable") {
    return st === "cancelled" && ps === "rejected";
  }
  return true;
}

function isDateInRange(value: string, from?: string, to?: string) {
  if (!from && !to) return true;
  if (!value) return false;
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return false;
  if (from) {
    const fromTime = new Date(from).getTime();
    if (!Number.isNaN(fromTime) && target < fromTime) return false;
  }
  if (to) {
    const toTime = new Date(to).getTime();
    if (!Number.isNaN(toTime) && target > toTime) return false;
  }
  return true;
}

function getStatusBadgeClass(paymentStatus?: string, status?: string, paymentStage?: string, remainingBalance?: number) {
  const bookingStatus = String(status || "").toLowerCase();
  if (["cancelled", "declined"].includes(bookingStatus)) return "border-rose-100 bg-rose-50 text-rose-700";
  if (bookingStatus === "completed") return "border-blue-100 bg-blue-50 text-blue-700";
  if (bookingStatus === "rental_expired") return "border-red-100 bg-red-50 text-red-700";

  const v = String(paymentStatus || "").toLowerCase();
  const stage = String(paymentStage || "").toLowerCase();
  const hasRemaining = typeof remainingBalance === "number" ? remainingBalance > 0 : false;

  if (hasRemaining && v !== "unpaid" && v !== "rejected" && v !== "for_review" && v !== "cash_pending" && v !== "slot_pending" && v !== "pending_verification") {
    return "border-amber-100 bg-amber-50 text-amber-700";
  }
  if ((stage === "fully paid" || v === "paid") && !hasRemaining) return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (["verified", "slot_verified"].includes(v)) return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (v === "partial" || stage === "complete downpayment" || stage === "settle remaining balance") return "border-amber-100 bg-amber-50 text-amber-700";
  if (["for_review", "cash_pending", "slot_pending", "pending_verification", "incomplete"].includes(v)) return "border-amber-100 bg-amber-50 text-amber-700";
  if (v === "rejected") return "border-rose-100 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function getStatusLabel(paymentStatus?: string, _status?: string, paymentStage?: string, remainingBalance?: number) {
  const stage = String(paymentStage || "").toLowerCase();

  if (stage === "fully paid") return "Fully Paid";

  const hasRemaining = typeof remainingBalance === "number" ? remainingBalance > 0 : true;

  if (!hasRemaining) return "Fully Paid";

  const v = String(paymentStatus || "").toLowerCase();

  if (v === "paid" || v === "verified" || v === "slot_verified") {
    return hasRemaining ? "Partial Payment" : "Fully Paid";
  }

  if (["for_review", "cash_pending", "slot_pending", "pending_verification", "incomplete", "partial"].includes(v)) {
    return "Partial Payment";
  }

  if (stage === "complete downpayment" || stage === "settle remaining balance") return "Partial Payment";

  if (v && v !== "unpaid" && v !== "rejected" && v !== "cancelled") return "Partial Payment";

  return "Unpaid";
}

function getBookingStatusBadgeClass(status?: string) {
  const v = String(status || "").toLowerCase();
  if (["confirmed", "reservation_secured", "slot_secured", "active_rental"].includes(v))
    return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (["completed", "complete"].includes(v))
    return "border-blue-100 bg-blue-50 text-blue-700";
  if (["pending", "verifying"].includes(v))
    return "border-orange-100 bg-orange-50 text-orange-700";
  if (["contract_signing_required"].includes(v))
    return "border-yellow-100 bg-yellow-50 text-yellow-700";
  if (["cancellation_requested", "cancellation requested"].includes(v))
    return "border-amber-100 bg-amber-50 text-amber-700";
  if (["cancelled", "declined", "rental_expired"].includes(v))
    return "border-rose-100 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function getBookingStatusLabel(status?: string) {
  const v = String(status || "").toLowerCase();
  if (v === "pending") return "Pending";
  if (v === "verifying") return "Verifying";
  if (v === "confirmed") return "Confirmed";
  if (v === "completed" || v === "complete") return "Completed";
  if (v === "cancelled") return "Cancelled";
  if (v === "declined") return "Declined";
  if (v === "cancellation_requested" || v === "cancellation requested")
    return "Cancel Req";
  if (v === "reservation_secured") return "Secured";
  if (v === "contract_signing_required") return "Contract Signing Required";
  if (v === "active_rental") return "Active Rental";
  if (v === "rental_expired") return "Rental Expired";
  return v ? v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";
}

function PaymentActionButtons({
  booking,
  onPay,
  onSettle,
  compact,
}: {
  booking: Booking;
  onPay: (b: Booking) => void;
  onSettle: (b: Booking) => void;
  compact?: boolean;
}) {
  const total = (booking as any).totalPrice || 0;
  const amountPaid = (booking as any).amountPaid ?? 0;
  const remaining = (booking as any).remainingBalance ?? Math.max(total - amountPaid, 0);
  const paymentStatus = String(booking.paymentStatus || "").toLowerCase();
  const balanceStatus = String((booking as any).balanceStatus || "").toLowerCase();
  const paymentStage = String((booking as any).paymentStage || "").toLowerCase();
  const remainingMs = getRemainingMs(booking);
  const isExpired = booking.status === "pending" && remainingMs <= 0;
  const isCashPending = booking.paymentMethod === "cash" && booking.paymentStatus === "cash_pending";
  const isUnderReview = (booking as any).hasActivePaymentSubmission || paymentStatus === "for_review";
  const isDownpaymentActive =
    booking.status === "confirmed" && booking.paymentType === "downpayment" && !["cancelled", "declined"].includes(String(booking.status).toLowerCase()) && remaining > 0 && paymentStatus !== "paid";
  const hasRemainingPaymentDue =
    remaining > 0 &&
    !["cancelled", "declined"].includes(String(booking.status).toLowerCase()) && (
      paymentStatus === "partial" ||
      paymentStatus === "incomplete" ||
      balanceStatus === "with remaining balance" ||
      paymentStage === "complete downpayment" ||
      paymentStage === "settle remaining balance"
    );
  const isPendingRemainingDP = isUnderReview &&
    !["cancelled", "declined"].includes(String(booking.status).toLowerCase()) &&
    booking.paymentType === "downpayment" &&
    Number((booking as any).downpaymentPaid || 0) > 0;

  if (isUnderReview) return null;

  const isFullyPaid =
    paymentStatus === "paid" ||
    paymentStatus === "fully paid" ||
    remaining <= 0;
  if (isFullyPaid) return null;

  const showSettle = isDownpaymentActive || hasRemainingPaymentDue || isPendingRemainingDP;
  const showPayNow = booking.status === "pending" && !isCashPending && !isExpired && !showSettle;

  if (showSettle) {
    return (
      <Button
        onClick={() => onSettle(booking)}
        className={cn(
          compact
            ? "h-9 rounded-lg px-4 text-xs font-bold"
            : "h-9 rounded-lg px-4 text-xs font-bold shadow-sm",
          "bg-emerald-600 text-white hover:bg-emerald-700 w-full whitespace-nowrap sm:w-auto"
        )}
      >
        Settle Remaining Balance
      </Button>
    );
  }

  if (showPayNow) {
    return (
      <Button
        onClick={() => onPay(booking)}
        className={cn(
          compact
            ? "h-9 rounded-lg px-4 text-xs font-bold"
            : "h-9 rounded-lg px-4 text-xs font-bold shadow-sm",
          "bg-orange-600 text-white hover:bg-orange-700 w-full whitespace-nowrap sm:w-auto"
        )}
      >
        <CreditCard className="mr-1 h-3.5 w-3.5" />
        {"Pay Now"}
      </Button>
    );
  }

  return null;
}

function CurrentTransactionCard({
  booking,
  onPay,
  onSettle,
  onView,
}: {
  booking: Booking;
  onPay: (b: Booking) => void;
  onSettle: (b: Booking) => void;
  onView: (b: Booking) => void;
}) {
  const total = (booking as any).totalPrice || 0;
  const amountPaid = (booking as any).amountPaid ?? 0;
  const remaining = (booking as any).remainingBalance ?? Math.max(total - amountPaid, 0);
  const paymentStatus = String(booking.paymentStatus || "").toLowerCase();
  const balanceStatus = String((booking as any).balanceStatus || "").toLowerCase();
  const paymentStage = String((booking as any).paymentStage || "").toLowerCase();
  const isDownpaymentActive =
    booking.status === "confirmed" && booking.paymentType === "downpayment" && !["cancelled", "declined"].includes(String(booking.status).toLowerCase()) && remaining > 0 && paymentStatus !== "paid";
  const hasRemainingPaymentDue =
    remaining > 0 &&
    !["cancelled", "declined"].includes(String(booking.status).toLowerCase()) && (
      paymentStatus === "partial" ||
      paymentStatus === "incomplete" ||
      balanceStatus === "with remaining balance" ||
      paymentStage === "complete downpayment" ||
      paymentStage === "settle remaining balance"
    );
  const remainingMs = getRemainingMs(booking);
  const isExpired = booking.status === "pending" && remainingMs <= 0;
  const isCashPending = booking.paymentMethod === "cash" && booking.paymentStatus === "cash_pending";
  const isUnderReview = (booking as any).hasActivePaymentSubmission || paymentStatus === "for_review";
  const isPendingRemainingDP = isUnderReview &&
    !["cancelled", "declined"].includes(String(booking.status).toLowerCase()) &&
    booking.paymentType === "downpayment" &&
    Number((booking as any).downpaymentPaid || 0) > 0;

  const showSettleAction =
    !isUnderReview &&
    (isDownpaymentActive || hasRemainingPaymentDue || isPendingRemainingDP);

  return (
    <div className="group flex w-full min-w-0 flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange-200 hover:shadow-md sm:flex-row sm:items-center sm:gap-4">
      {/* ---- Mobile layout (hidden on sm+) ---- */}
      <div className="sm:hidden">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
            <Receipt className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="break-words whitespace-normal text-base font-black leading-snug text-slate-900">
              {booking.eventName || "Untitled"}
            </p>
            <p className="mt-0.5 text-sm font-bold text-orange-600">
              {formatMoney(getTransactionDisplayAmount(booking))}
            </p>
          </div>
        </div>
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Booking ID</p>
            <p className="mt-0.5 break-all text-xs font-black text-slate-800">{booking.id}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Method</p>
            <p className="mt-0.5 break-words text-xs font-bold text-slate-800">
              {getPaymentMethodLabel(booking.paymentMethod)}
            </p>
          </div>
        </div>
      </div>

      {/* ---- Tablet: grouped info block (sm to md) ---- */}
      <div className="hidden min-w-0 items-center gap-3 sm:flex md:hidden">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
          <Receipt className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
            Current Transaction
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-black text-slate-900">
            <span className="break-words whitespace-normal min-w-0">{booking.eventName || "Untitled"}</span>
            <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-slate-500">• {booking.id}</span>
          </p>
          <p className="mt-1.5 break-words whitespace-normal text-[11px] font-bold text-orange-600">
            {formatMoney(getTransactionDisplayAmount(booking))}
          </p>
        </div>
      </div>

      {/* ---- Desktop: Event block + 2-col info grid (md+) ---- */}
      <div className="hidden shrink-0 items-center gap-3 md:flex md:w-[220px]">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
          <Receipt className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
            Current Transaction
          </p>
          <p className="break-words whitespace-normal text-sm font-black leading-snug text-slate-900 min-w-0">
            {booking.eventName || "Untitled"}
          </p>
          <p className="break-words whitespace-normal text-[11px] font-bold text-orange-600">
            {formatMoney(getTransactionDisplayAmount(booking))}
          </p>
        </div>
      </div>

      <div className="hidden min-w-0 flex-1 grid-cols-[1fr_1fr] gap-x-8 md:grid">
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Booking ID</p>
          <p className="mt-0.5 break-all text-xs font-black text-slate-800 truncate">{booking.id}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Method</p>
          <p className="mt-0.5 break-words text-xs font-bold text-slate-800">
            {getPaymentMethodLabel(booking.paymentMethod)}
          </p>
        </div>
      </div>

      {/* ---- Actions column ---- */}
      <div className="flex flex-col items-end gap-2 sm:ml-auto">
        {booking.status === "pending" && !isCashPending && !isExpired && (
          <p className="rounded-md bg-orange-50 px-2 py-1 text-[10px] font-black text-orange-700 self-end sm:self-auto sm:text-right">
            Time left: {formatCountdown(remainingMs)}
          </p>
        )}
        <div className="flex flex-col items-stretch gap-2.5 w-full sm:mt-0 sm:w-auto sm:shrink-0 sm:ml-auto sm:flex-col sm:items-end sm:gap-2.5">
          <span
            className={cn(
              "inline-flex w-full items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap sm:w-auto",
              getStatusBadgeClass(booking.paymentStatus, booking.status, (booking as any).paymentStage, (booking as any).remainingBalance),
            )}
          >
            {getStatusLabel(booking.paymentStatus, booking.status, (booking as any).paymentStage, (booking as any).remainingBalance)}
          </span>
          <div className="flex flex-col items-stretch gap-2 w-full sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-2">
            {hasPaymentRecord(booking) && !showSettleAction && paymentStatus !== "unpaid" && (
              <Button
                variant="outline"
                onClick={() => onView(booking)}
                className="h-9 w-full shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:w-auto"
              >
                View Details
              </Button>
            )}
            <PaymentActionButtons booking={booking} onPay={onPay} onSettle={onSettle} compact />
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryRow({
  booking,
  expanded,
  onToggle,
  onView,
  onPay,
}: {
  booking: Booking;
  expanded: boolean;
  onToggle: () => void;
  onView: (b: Booking) => void;
  onPay: (b: Booking) => void;
}) {
  const isOfficeRental = isOfficeRentalBooking(booking);
  const total = (booking as any).totalPrice || 0;
  const isCancelled =
    String(booking.status).toLowerCase() === "cancelled" ||
    String(booking.status).toLowerCase() === "declined";
  const displayTotal = isCancelled ? 0 : total;
  const isUnpaid = String(booking.paymentStatus || "").toLowerCase() === "unpaid";
  const amountPaid =
    typeof (booking as any).amountPaid === "number" && (booking as any).amountPaid > 0
      ? (booking as any).amountPaid
      : ["paid", "verified", "slot_verified"].includes(
          String(booking.paymentStatus).toLowerCase(),
        )
        ? (booking as any).paymentType === "downpayment" ? displayTotal * (Number((booking as any).downPaymentPercentage || 50) / 100) : displayTotal
        : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full min-w-0 grid-cols-[1fr_auto] items-center gap-3 p-3 text-left transition hover:bg-slate-50 md:grid-cols-[2.5fr_1.2fr_1fr_auto] md:gap-4"
      >
        <div className="min-w-0">
          {/* Tablet: Event Name • BK (sm to md) */}
          <p className="mt-0.5 hidden items-center gap-1.5 text-sm font-black text-slate-900 sm:flex md:hidden">
            <span className="break-words whitespace-normal min-w-0">{booking.eventName || "Untitled"}</span>
            <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-slate-500">• {booking.id}</span>
          </p>
          {/* Desktop: Event Name only */}
          <p className="hidden break-words whitespace-normal text-sm font-black leading-snug text-slate-900 min-w-0 md:block">
            {booking.eventName || "Untitled"}
          </p>
          {/* Tablet grouped + labeled (sm to md) */}
          <div className="mt-0.5 hidden flex-col gap-1 sm:flex md:hidden">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Venue</p>
              <p className="truncate text-[11px] font-semibold text-slate-700">{booking.venue || "N/A"}</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Method</p>
                <p className="whitespace-nowrap text-[11px] font-bold text-slate-700">
                  {getPaymentMethodLabel(booking.paymentMethod)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Amount</p>
                <p className="whitespace-nowrap text-[11px] font-black text-slate-900">
                  {formatMoney(displayTotal)}
                </p>
              </div>
            </div>
          </div>
          {/* Desktop inline: ID · venue (md+) */}
          <p className="mt-0.5 hidden truncate text-[11px] font-bold text-slate-500 md:inline-block">
            <span className="inline-block whitespace-nowrap align-bottom">{booking.id}</span>
            <span className="hidden md:inline">
              {" · "}
              <span className="inline-block max-w-[200px] align-bottom truncate">{booking.venue || "N/A"}</span>
            </span>
          </p>
        </div>
        <div className="hidden text-left md:block min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Method</p>
          <p className="whitespace-nowrap text-[11px] font-bold text-slate-700">
            {getPaymentMethodLabel(booking.paymentMethod)}
          </p>
        </div>
        <div className="hidden text-left md:block min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Amount</p>
          <p className="whitespace-nowrap text-[11px] font-black text-slate-900">
            {formatMoney(displayTotal)}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2.5 w-full sm:mt-0 sm:w-auto sm:shrink-0 sm:ml-auto sm:flex-col sm:items-end sm:gap-2.5">
          <span
            className={cn(
              "inline-flex w-full items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap sm:w-auto",
              getStatusBadgeClass(booking.paymentStatus, booking.status, (booking as any).paymentStage, (booking as any).remainingBalance),
            )}
          >
            {getStatusLabel(booking.paymentStatus, booking.status, (booking as any).paymentStage, (booking as any).remainingBalance)}
          </span>
          {isUnpaid ? (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onPay(booking);
              }}
              className="h-9 w-full shrink-0 whitespace-nowrap rounded-lg bg-orange-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-orange-700 sm:w-auto"
            >
              <CreditCard className="mr-1 h-3.5 w-3.5" />
              Pay Now
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onView(booking);
              }}
              className="h-9 w-full shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:w-auto"
            >
                View Details
            </Button>
          )}
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 -rotate-180 text-slate-400 transition" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400 transition" />
          )}
      </button>
      {expanded && (
        <div className="grid gap-3 border-t border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-3">
          <DetailItem label="Booking Status" value={
            <span
              className={cn(
                "inline-block rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.2em]",
                getBookingStatusBadgeClass(booking.status),
              )}
            >
              {getBookingStatusLabel(booking.status)}
            </span>
          } />
          <DetailItem label="Type" value={isOfficeRental ? "Slot Reservation" : (booking as any).paymentType === "downpayment" ? "Down Payment" : "Full Payment"} />
          <DetailItem label="Amount Paid" value={formatMoney(amountPaid)} />
          <div className="sm:col-span-3 flex justify-end mt-1">
            {isUnpaid ? (
              <Button
                onClick={() => onPay(booking)}
                className="h-9 shrink-0 whitespace-nowrap rounded-lg bg-orange-600 px-4 text-[11px] font-bold text-white shadow-sm hover:bg-orange-700 w-auto"
              >
                <CreditCard className="mr-1.5 h-3.5 w-3.5" />
                Pay Now
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => onView(booking)}
                className="h-9 shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-4 text-[11px] font-bold text-slate-700 hover:bg-white w-auto"
              >
                <Receipt className="mr-1.5 h-3.5 w-3.5" />
                Open Full Details
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 max-w-full">
      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">
        {label}
      </p>
      <div className="mt-0.5 whitespace-normal text-xs font-bold text-slate-800">{value}</div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between gap-2 flex-wrap">
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
  );
}

function TransactionsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlBookingId = searchParams.get("bookingId");

  const { toast } = useToast();
  const { bookings, submitPayment, cancelBooking } = useBookings();
  const { user } = useAuth();
  const { paymentInfo } = useCMS();

  const [selectedBookingToPay, setSelectedBookingToPay] = useState<string | null>(null);
  const [localBookings, setLocalBookings] = useState<Booking[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  const [paymentType, setPaymentType] = useState<"full" | "downpayment">("full");
  const [paymentMethod, setPaymentMethod] = useState<"bank" | "cash">("bank");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [bankReferenceNumber, setBankReferenceNumber] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPaymentConfirmOpen, setIsPaymentConfirmOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<TransactionFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<Booking | null>(null);

  useEffect(() => {
    if (urlBookingId) setSelectedBookingToPay(urlBookingId);
  }, [urlBookingId]);

  useEffect(() => {
    setLocalBookings(bookings || []);
    setIsHydrated(true);
  }, [bookings]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const myTransactions = useMemo(() => {
    return (
      localBookings
        .filter((booking) => booking.userId === user?.id)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ) || []
    );
  }, [localBookings, user?.id]);

  const transactionsWithPayment = useMemo(
    () => myTransactions.filter(hasPaymentRecord),
    [myTransactions],
  );

  useEffect(() => {
    if (!isHydrated) return;

    const expiredPendingBookings = myTransactions.filter((booking) => {
      if (booking.status !== "pending") return false;
      if (
        booking.paymentStatus === "verified" ||
        booking.paymentStatus === "paid"
      ) {
        return false;
      }
      return getRemainingMs(booking) <= 0;
    });

    if (expiredPendingBookings.length === 0) return;

    expiredPendingBookings.forEach((booking) => cancelBooking(booking.id));

    setLocalBookings((prev) =>
      prev.map((booking) =>
        expiredPendingBookings.some((expired) => expired.id === booking.id)
          ? { ...booking, status: "cancelled" }
          : booking,
      ),
    );

    if (
      selectedBookingToPay &&
      expiredPendingBookings.some(
        (booking) => booking.id === selectedBookingToPay,
      )
    ) {
      setSelectedBookingToPay(null);
      router.replace("/portal/payments");
      toast({
        title: "Booking Automatically Cancelled",
        description:
          "The 24-hour payment window ended, so the pending booking was cancelled.",
        variant: "destructive",
      });
    }
  }, [
    now,
    isHydrated,
    myTransactions,
    selectedBookingToPay,
    cancelBooking,
    router,
    toast,
  ]);

  const searchMatch = (booking: Booking, query: string) => {
    if (!query) return true;
    const q = query.toLowerCase().trim();
    const fields = [
      booking.id,
      booking.eventName,
      booking.eventType,
      booking.venue,
      booking.status,
      booking.paymentStatus,
      booking.paymentMethod,
    ];
    return fields.some((f) => f && String(f).toLowerCase().includes(q));
  };

  const currentTransactions = useMemo(
    () => transactionsWithPayment.filter(isCurrentTransaction),
    [transactionsWithPayment],
  );

  const currentTransaction = useMemo(
    () => currentTransactions[0] || null,
    [currentTransactions],
  );

  const otherActiveTransactions = useMemo(
    () => currentTransactions.slice(1),
    [currentTransactions],
  );

  const historyTransactions = useMemo(
    () => transactionsWithPayment.filter((b) => !isCurrentTransaction(b)),
    [transactionsWithPayment],
  );

  const hasHistoryRecords = useMemo(
    () => historyTransactions.length > 0,
    [historyTransactions],
  );

  const otherActivePageSize = 10
  const totalOtherActivePages = Math.max(1, Math.ceil(otherActiveTransactions.length / otherActivePageSize))
  const safeCurrentPage = Math.min(currentPage, totalOtherActivePages)
  const paginatedOtherActive = useMemo(
    () =>
      otherActiveTransactions.slice(
        (safeCurrentPage - 1) * otherActivePageSize,
        safeCurrentPage * otherActivePageSize,
      ),
    [otherActiveTransactions, safeCurrentPage],
  )

  useEffect(() => {
    setCurrentPage(1)
  }, [showHistory])

  const filteredHistory = useMemo(
    () =>
      historyTransactions.filter(
        (b) =>
          paymentMatchesFilter(
            String(b.paymentStatus || ""),
            String(b.status || ""),
            filter,
          ) &&
          searchMatch(b, searchQuery) &&
          isDateInRange(b.date, dateFrom || undefined, dateTo || undefined),
      ),
    [historyTransactions, filter, searchQuery, dateFrom, dateTo],
  );

  const totalHistoryPages = Math.max(
    1,
    Math.ceil(filteredHistory.length / PAGE_SIZE),
  );
  const safeHistoryPage = Math.min(historyPage, totalHistoryPages);
  const paginatedHistory = useMemo(
    () =>
      filteredHistory.slice(
        (safeHistoryPage - 1) * PAGE_SIZE,
        safeHistoryPage * PAGE_SIZE,
      ),
    [filteredHistory, safeHistoryPage],
  );

  useEffect(() => {
    setHistoryPage(1);
  }, [searchQuery, filter, dateFrom, dateTo]);

  if (!isHydrated) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
      </div>
    );
  }

  if (selectedBookingToPay) {
    const booking = myTransactions.find(
      (item) => item.id === selectedBookingToPay,
    );

    if (!booking) {
      return (
        <div className="animate-in fade-in py-20 text-center">
          <h2 className="mb-2 text-xl font-black text-slate-900">
            Transaction not found
          </h2>
          <p className="mb-6 text-sm text-slate-500">
            We couldn&apos;t find the booking you are trying to pay for.
          </p>
          <Button
            onClick={() => {
              setSelectedBookingToPay(null);
              router.replace("/portal/payments");
            }}
            className="h-10 rounded-xl bg-orange-600 px-4 sm:px-6 font-bold text-white hover:bg-orange-700"
          >
            Back to Transactions
          </Button>
        </div>
      );
    }

    const isOfficeRental = isOfficeRentalBooking(booking);
    const isOfficeSecured =
      isOfficeRental &&
      (booking.status === "reservation_secured" ||
        booking.officeReservationStatus === "reservation_secured");
    const ps = String(booking.paymentStatus || "").toLowerCase();
    const isUnderReview = (booking as any).hasActivePaymentSubmission || ps === "for_review";
    const bs = String((booking as any).balanceStatus || "").toLowerCase();
    const paymentStage = String((booking as any).paymentStage || "").toLowerCase();
    const totalPrice = booking.totalPrice || 15000;
    const selectedDP = Number((booking as any).selectedDownpaymentAmount || Number((booking as any).downPaymentPercentage || 50) / 100 * totalPrice);
    const downpaymentRemaining = Number((booking as any).downpaymentRemaining || Math.max(selectedDP - Number((booking as any).downpaymentPaid || 0), 0));
    const isSettlingBalance =
      !isOfficeRental &&
      booking.status === "confirmed" &&
      booking.paymentType === "downpayment";
    const isRemainingPaymentFlow =
      !isOfficeRental &&
      (ps === "partial" || ps === "incomplete" || bs === "with remaining balance" ||
        paymentStage === "complete downpayment" || paymentStage === "settle remaining balance");

    const currentAmountPaid = Number((booking as any).amountPaid || 0);
    const remainingBalance = Math.max(totalPrice - currentAmountPaid, 0);
    const isOfficeRemainingPayment =
      isOfficeRental && currentAmountPaid > 0 && remainingBalance > 0;
    const officeReservationFee = getOfficeReservationFee(booking) || totalPrice;
    const downpaymentAmount = Number((booking as any).downPaymentPercentage || 50) / 100 * totalPrice;
    const isCompletingDownpayment = paymentStage === "complete downpayment" || (isSettlingBalance && downpaymentRemaining > 0);
    const amountToPay = isOfficeRental
      ? (currentAmountPaid > 0 ? remainingBalance : officeReservationFee)
      : isCompletingDownpayment
        ? downpaymentRemaining
        : isRemainingPaymentFlow
          ? remainingBalance
          : isSettlingBalance
            ? remainingBalance || downpaymentAmount
            : paymentType === "full"
              ? totalPrice
              : downpaymentAmount;

    const remainingMs = getRemainingMs(booking);
    const isExpired = booking.status === "pending" && remainingMs <= 0;

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        toast({
          title: "Invalid File",
          description: "Please upload an image file only.",
          variant: "destructive",
        });
        event.target.value = "";
        return;
      }

      if (file.size > MAX_PROOF_FILE_SIZE) {
        toast({
          title: "File Too Large",
          description: `Please upload an image below ${MAX_PROOF_FILE_MB}MB.`,
          variant: "destructive",
        });
        event.target.value = "";
        return;
      }

      setProofFile(file);
    };

    const submitSelectedPayment = async () => {
      if (isSubmitting) return;
      if ((booking as any).hasActivePaymentSubmission || String(booking.paymentStatus || "").toLowerCase() === "for_review") {
        toast({
          title: "Already Submitted",
          description: "This payment is already pending admin review.",
          variant: "destructive",
        });
        setIsPaymentConfirmOpen(false);
        return;
      }
      setIsSubmitting(true);
      try {
        const finalPaymentType = isOfficeRental
          ? ("slot_reservation" as any)
          : isCompletingDownpayment
            ? "downpayment"
            : isSettlingBalance
              ? "full"
              : paymentType;
        const proofDataUrl =
          paymentMethod === "bank" && proofFile
            ? await compressImageToDataUrl(proofFile)
            : undefined;

        submitPayment(booking.id, {
          type: finalPaymentType,
          method: paymentMethod,
          proof: proofDataUrl,
          bankReferenceNumber:
            paymentMethod === "bank" ? bankReferenceNumber.trim() : undefined,
          amount: amountToPay,
        });

        toast({
          title: isOfficeRental
            ? "Slot Reservation Payment Submitted"
            : paymentMethod === "cash"
              ? "Pay at the Office Selected"
              : "Payment Submitted!",
          description: isOfficeRental
            ? paymentMethod === "cash"
              ? "Please visit One Estela Place within 24 hours to pay the slot reservation fee. After admin verification, your office slot will be secured."
              : "Your slot reservation payment proof is now under admin review."
            : paymentMethod === "cash"
              ? "Please visit One Estela Place within 24 hours to settle your payment."
              : "Your bank transfer payment is now under review by the admin.",
          className: "border-none bg-emerald-500 text-white",
        });

        setIsPaymentConfirmOpen(false);
        setSelectedBookingToPay(null);
        setProofFile(null);
        setBankReferenceNumber("");
        setPaymentType("full");
        setPaymentMethod("bank");
        router.replace("/portal/payments");
      } catch (error) {
        console.error("Payment submit failed:", error)
        toast({
          title: "Payment Failed",
          description:
            error instanceof Error ? error.message : "Something went wrong while submitting your payment. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsSubmitting(false);
      }
    };

    const handleSubmitPayment = () => {
      if (["cancelled", "declined"].includes(String(booking.status).toLowerCase())) {
        toast({
          title: "Booking Cancelled",
          description: "This booking has been cancelled and no longer accepts payments.",
          variant: "destructive",
        });
        return;
      }
      if ((booking as any).hasActivePaymentSubmission || String(booking.paymentStatus || "").toLowerCase() === "for_review") {
        toast({
          title: "Payment Already Submitted",
          description: "You already have a payment pending review. Please wait for admin verification before submitting again.",
          variant: "destructive",
        });
        return;
      }
      if (isOfficeSecured) {
        toast({
          title: "Reservation Already Secured",
          description:
            "Succeeding office rental payments are settled onsite via check and recorded by admin.",
        });
        return;
      }
      if (isExpired) {
        toast({
          title: "Payment Window Expired",
          description: "This booking has already expired and cannot be paid.",
          variant: "destructive",
        });
        return;
      }
      if (paymentMethod === "bank" && !proofFile) {
        toast({
          title: "Proof Required",
          description: "Please upload your proof of payment for Bank Transfer.",
          variant: "destructive",
        });
        return;
      }
      if (
        paymentMethod === "bank" &&
        bankReferenceNumber.replace(/\D/g, "").length < 13
      ) {
        toast({
          title: "Invalid Reference Number",
          description:
            "Please enter at least 13 digits for your bank reference number.",
          variant: "destructive",
        });
        return;
      }
      setIsPaymentConfirmOpen(true);
    };

    return (
      <div className="mx-auto w-full max-w-6xl space-y-5 p-4 pb-6 md:pb-10 md:p-6">
        <Dialog
          open={isPaymentConfirmOpen}
          onOpenChange={setIsPaymentConfirmOpen}
        >
          <DialogContent aria-describedby={undefined} showCloseButton={false} className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="flex max-h-[90dvh] flex-col overflow-hidden">
              <header className="shrink-0 flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                      paymentMethod === "cash"
                        ? "bg-orange-50 text-orange-600"
                        : "bg-blue-50 text-blue-600",
                    )}
                  >
                    {paymentMethod === "cash" ? (
                      <Banknote className="h-5 w-5" />
                    ) : (
                      <CreditCard className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <DialogTitle className="text-lg font-black text-slate-950">
                      {paymentMethod === "cash"
                        ? isOfficeRental
                          ? "Submit office slot reservation pay-at-the-office payment?"
                          : "Are you sure you want to pay at the office?"
                        : isOfficeRental
                          ? "Submit office slot reservation proof?"
                          : "Are you sure you want to submit bank transfer?"}
                    </DialogTitle>
                  </div>
                </div>
                <DialogClose asChild>
                  <button
                    type="button"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </DialogClose>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <div className="space-y-4">
                  <p className="text-sm leading-6 text-slate-600">
                    {paymentMethod === "cash"
                      ? isOfficeRental
                        ? "You selected Pay at the Office for the office slot reservation fee. Your office slot is not secured until admin verifies the payment."
                        : "You selected Pay at the Office. Your booking will remain as Pencil Booking until the admin verifies your office payment."
                      : isOfficeRental
                        ? "You are submitting proof for slot reservation only. After verification, customer-side online payments stop and succeeding office rental payments are tracked by admin."
                        : "You are about to submit your bank transfer proof. Please make sure the uploaded receipt and amount are correct before continuing."}
                  </p>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                      Payment Summary
                    </p>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <span className="font-semibold text-slate-500">Booking</span>
                        <span className="max-w-[230px] break-words text-right font-black text-slate-900">
                          {booking.eventName}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <span className="font-semibold text-slate-500">Method</span>
                        <span className="text-right font-black text-slate-900">
                          {getPaymentMethodLabel(paymentMethod)}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <span className="font-semibold text-slate-500">Term</span>
                        <span className="text-right font-black text-slate-900">
                          {isOfficeRental
                            ? (isOfficeRemainingPayment ? "Remaining Balance" : "Slot Reservation Only")
                            : getPaymentTermLabel(paymentType, isSettlingBalance)}
                        </span>
                      </div>
                      {paymentMethod === "bank" && bankReferenceNumber.trim() && (
                        <SummaryLine
                          label="Bank Reference No."
                          value={bankReferenceNumber.trim()}
                        />
                      )}
                      {paymentMethod === "bank" && proofFile && (
                        <div className="flex items-start justify-between gap-4">
                          <span className="font-semibold text-slate-500">Proof</span>
                          <span className="max-w-[220px] break-all text-right text-xs font-black text-slate-900">
                            {proofFile.name}
                          </span>
                        </div>
                      )}
                      <div className="border-t border-dashed border-slate-300 pt-3">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                            Amount to Pay
                          </span>
                          <span className="text-2xl font-black text-orange-600">
                            {formatMoney(amountToPay)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {paymentMethod === "cash" && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-black text-amber-900">
                        Pay at the Office Reminder
                      </p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-amber-700">
                        {isOfficeRental
                          ? "Please visit One Estela Place within 24 hours to pay the slot reservation fee. After admin verification, the office slot will be secured and contract signing is required onsite."
                          : "Please visit One Estela Place within 24 hours to settle your payment. Admin can manually verify your payment once paid at the office."}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <footer className="shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t border-slate-100 bg-white px-5 py-4">
                <Button
                type="button"
                variant="outline"
                onClick={() => setIsPaymentConfirmOpen(false)}
                disabled={isSubmitting}
                className="h-10 w-full sm:w-auto rounded-xl border-slate-200 px-4 text-xs font-bold"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={submitSelectedPayment}
                disabled={isSubmitting}
                className="h-10 w-full sm:w-auto rounded-xl bg-orange-600 px-4 text-xs font-bold text-white hover:bg-orange-700"
              >
                {isSubmitting
                  ? "Submitting..."
                  : paymentMethod === "cash"
                    ? "Yes, Pay at the Office"
                    : "Yes, Submit Bank Transfer"}
              </Button>
            </footer>
            </div>
          </DialogContent>
        </Dialog>

        <Button
          variant="ghost"
          onClick={() => {
            setSelectedBookingToPay(null);
            router.replace("/portal/payments");
          }}
          className="-ml-3 h-10 rounded-xl text-sm font-bold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to My Transactions
        </Button>

        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 shadow-sm md:p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-600">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-black text-orange-950">
                  {isOfficeRental
                    ? (isOfficeRemainingPayment ? "Settle Remaining Balance" : "Secure Office Reservation Slot")
                    : isCompletingDownpayment
                      ? "Complete Your Downpayment"
                      : isRemainingPaymentFlow
                        ? "Settle Remaining Balance"
                        : isSettlingBalance
                          ? "Settle Your Balance"
                          : "Secure Your Booking"}
                </h2>
                <p className="mt-1 text-sm leading-6 text-orange-800">
                  {isOfficeRental
                    ? (isOfficeRemainingPayment
                      ? `Please settle your remaining balance of ₱${remainingBalance.toLocaleString()}.`
                      : "This payment is for slot reservation only. After admin verification, succeeding office rental payments are settled onsite via check.")
                    : isCompletingDownpayment
                      ? `Please complete your downpayment of ₱${downpaymentRemaining.toLocaleString()}.`
                      : isRemainingPaymentFlow
                        ? `Please settle your remaining balance of ₱${remainingBalance.toLocaleString()}.`
                        : isSettlingBalance
                          ? "Please settle your remaining balance."
                          : "Please complete your payment within 24 hours to confirm your slot."}
                </p>
              </div>
            </div>

            {!isSettlingBalance && booking.status === "pending" && (
              <div className="rounded-2xl border border-orange-200 bg-white px-5 py-3 text-center shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-500">
                  Time Left
                </p>
                <p className="mt-1 text-2xl font-black tabular-nums text-orange-700">
                  {formatCountdown(remainingMs)}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
              <h3 className="mb-5 flex items-center gap-2 text-lg font-black text-slate-900">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-600">
                  1
                </span>
                Payment Term
              </h3>

              {isOfficeRental && !isOfficeRemainingPayment ? (
                <div className="rounded-xl border-2 border-orange-600 bg-orange-50 p-5">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-slate-900">
                      Slot Reservation Only
                    </p>
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-orange-600" />
                  </div>
                  <p className="text-2xl font-black text-orange-600">
                    ₱{officeReservationFee.toLocaleString()}
                  </p>
                  <p className="mt-3 text-xs font-semibold leading-5 text-orange-800">
                    This is not full payment or down payment. After admin
                    verifies this reservation fee, succeeding payments are
                    settled onsite via check and tracked by admin.
                  </p>
                  <div className="mt-3 rounded-lg bg-white p-3 text-xs font-bold text-slate-700">
                    Contract term:{" "}
                    {getOfficeTermLabel(booking.officeRentalTerm)} · Required
                    onsite: contract signing, 1 month advance, and 2 months
                    deposit.
                  </div>
                </div>
              ) : isOfficeRental && isOfficeRemainingPayment ? (
                <div className="rounded-xl border-2 border-orange-600 bg-orange-50 p-5">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-slate-900">
                      Remaining Balance
                    </p>
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-orange-600" />
                  </div>
                  <p className="text-2xl font-black text-orange-600">
                    ₱{remainingBalance.toLocaleString()}
                  </p>
                  <p className="mt-3 text-xs font-semibold leading-5 text-orange-800">
                    Complete the remaining balance for this reservation.
                  </p>
                  <div className="mt-3 space-y-1 rounded-lg bg-white p-3 text-xs font-bold text-slate-700">
                    <p>Already Paid: ₱{currentAmountPaid.toLocaleString()}</p>
                    <p>Remaining: ₱{remainingBalance.toLocaleString()}</p>
                  </div>
                </div>
              ) : isCompletingDownpayment || isRemainingPaymentFlow || isSettlingBalance ? (
                <div className="rounded-xl border-2 border-orange-600 bg-orange-50 p-5">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-slate-900">
                      {isCompletingDownpayment ? "Complete Downpayment" : isRemainingPaymentFlow ? "Remaining Payment Needed" : "Remaining Balance Settlement"}
                    </p>
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-orange-600" />
                  </div>
                  <p className="text-2xl font-black text-orange-600">
                    ₱{amountToPay.toLocaleString()}
                  </p>
                  {isCompletingDownpayment && (
                    <p className="mt-2 text-xs font-semibold text-orange-700">
                      Complete your selected downpayment. The remaining booking balance will be settled separately.
                    </p>
                  )}
                  {isRemainingPaymentFlow && (
                    <p className="mt-2 text-xs font-semibold text-orange-700">
                      This is the remaining balance to fully pay for this booking.
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <button
                    onClick={() => setPaymentType("full")}
                    className={cn(
                      "rounded-xl border-2 p-5 text-left transition-all",
                      paymentType === "full"
                        ? "border-orange-600 bg-orange-50"
                        : "border-slate-100 hover:border-slate-300",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900">
                        Full Payment
                      </p>
                      {paymentType === "full" && (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-orange-600" />
                      )}
                    </div>
                    <p className="text-2xl font-black text-orange-600">
                      ₱{totalPrice.toLocaleString()}
                    </p>
                  </button>

                  <button
                    onClick={() => setPaymentType("downpayment")}
                    className={cn(
                      "rounded-xl border-2 p-5 text-left transition-all",
                      paymentType === "downpayment"
                        ? "border-orange-600 bg-orange-50"
                        : "border-slate-100 hover:border-slate-300",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900">
                        Down Payment
                      </p>
                      {paymentType === "downpayment" && (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-orange-600" />
                      )}
                    </div>
                    <p className="text-2xl font-black text-orange-600">
                      ₱{downpaymentAmount.toLocaleString()}
                    </p>
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
              <h3 className="mb-5 flex items-center gap-2 text-lg font-black text-slate-900">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-600">
                  2
                </span>
                Payment Method
              </h3>

              <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <button
                  onClick={() => setPaymentMethod("bank")}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all",
                    paymentMethod === "bank"
                      ? "border-orange-600 bg-orange-50"
                      : "border-slate-100 hover:border-slate-300",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                      paymentMethod === "bank"
                        ? "bg-orange-600 text-white"
                        : "bg-slate-100 text-slate-500",
                    )}
                  >
                    <CreditCard className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-bold text-slate-900">
                    Bank Transfer
                  </p>
                </button>

                <button
                  onClick={() => setPaymentMethod("cash")}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all",
                    paymentMethod === "cash"
                      ? "border-orange-600 bg-orange-50"
                      : "border-slate-100 hover:border-slate-300",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                      paymentMethod === "cash"
                        ? "bg-orange-600 text-white"
                        : "bg-slate-100 text-slate-500",
                    )}
                  >
                    <Banknote className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-bold text-slate-900">
                    {PAYMENT_LABELS.payAtOffice}
                  </p>
                </button>
              </div>

              {paymentMethod === "bank" ? (
                <div className="animate-in fade-in space-y-5">
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm">
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                      Bank Details
                    </p>
                    <div className="flex flex-col gap-1 border-b border-slate-200 pb-3 sm:flex-row sm:justify-between">
                      <span className="text-slate-600">{paymentInfo.bankName || "BDO"}</span>
                      <span className="break-words font-bold text-slate-900">
                        {paymentInfo.accountNumber || "0012 3456 7890"}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 pt-3 sm:flex-row sm:justify-between">
                      <span className="text-slate-600">Account Name</span>
                      <span className="break-words font-bold text-slate-900">
                        {paymentInfo.accountName || "One Estela Place"}
                      </span>
                    </div>
                    {paymentInfo.instructions && (
                      <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-500">
                        {paymentInfo.instructions}
                      </p>
                    )}
                  </div>

                  <BankTransferQR />

                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-900">
                      Bank Reference Number / Transaction Reference Number
                    </Label>
                    <Input
                      value={bankReferenceNumber}
                      onChange={(event) => {
                        const digitsOnly = event.target.value.replace(/\D/g, "");
                        setBankReferenceNumber(digitsOnly);
                      }}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={32}
                      placeholder="Enter at least 13 digits"
                      className="h-11 rounded-xl border-slate-200 bg-white text-sm font-bold focus-visible:ring-orange-600"
                    />
                    <p
                      className={cn(
                        "text-[11px] font-semibold leading-5",
                        bankReferenceNumber.length > 0 &&
                          bankReferenceNumber.length < 13
                          ? "text-rose-600"
                          : "text-slate-500",
                      )}
                    >
                      Required for Bank Transfer payments. Numbers only, minimum
                      13 digits. ({bankReferenceNumber.length}/13)
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-900">
                      Upload Proof
                    </Label>

                    {!proofFile ? (
                      <div className="relative cursor-pointer rounded-xl border-2 border-dashed border-slate-300 p-6 sm:p-8 text-center transition-colors hover:bg-slate-50">
                        <input
                          type="file"
                          accept="image/*"
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                          onChange={handleFileChange}
                        />
                        <UploadCloud className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                        <p className="text-sm font-bold text-slate-900">
                          Click to upload
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Upload your payment screenshot or receipt.
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <FileImage className="h-5 w-5 shrink-0 text-emerald-600" />
                          <p className="break-all text-xs font-bold text-emerald-900">
                            {proofFile.name}
                          </p>
                        </div>
                        <button
                          onClick={() => setProofFile(null)}
                          className="shrink-0 p-1 text-emerald-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="animate-in fade-in flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <Info className="h-5 w-5 shrink-0 text-amber-600" />
                  <p className="text-xs leading-relaxed text-amber-800">
                    You selected {PAYMENT_LABELS.payAtOffice}. Please visit One Estela
                    Place within 24 hours to settle your payment. Your booking
                    will remain as Pencil Booking until the payment is verified
                    by the admin.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-6 rounded-2xl bg-slate-900 p-5 shadow-lg">
              <h3 className="mb-4 text-lg font-black text-white">Summary</h3>

              <div className="mb-4 rounded-xl border border-slate-700 bg-slate-800 p-4">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                  Event
                </p>
                <p className="break-words text-sm font-bold text-white">
                  {booking.eventName}
                </p>

                <div className="mt-3 grid gap-2 text-xs text-slate-400">
                  <p className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5" />
                    {booking.date}
                  </p>
                  <p className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="break-words">{booking.venue}</span>
                  </p>
                </div>
              </div>

              <div className="mb-6 space-y-3 rounded-xl border border-slate-700 bg-slate-800 p-4">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-slate-400">
                    {isOfficeRental ? "Slot Reservation Fee" : "Total Fee"}
                  </span>
                  <span className="font-bold text-white">
                    ₱{totalPrice.toLocaleString()}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-dashed border-slate-700 pt-3">
                  <span className="text-xs font-black uppercase text-slate-300">
                    Amount to Pay
                  </span>
                  <span className="text-xl font-black text-orange-500">
                    ₱{amountToPay.toLocaleString()}
                  </span>
                </div>
              </div>

              <Button
                onClick={handleSubmitPayment}
                disabled={
                  isSubmitting ||
                  isUnderReview ||
                  isOfficeSecured ||
                  isExpired ||
                  (paymentMethod === "bank" &&
                    (!proofFile ||
                      bankReferenceNumber.replace(/\D/g, "").length < 13))
                }
                className="h-11 w-full rounded-xl bg-orange-600 font-bold text-white shadow-sm transition-transform hover:bg-orange-700 active:scale-95 disabled:opacity-50"
              >
                {isSubmitting
                  ? "Processing..."
                  : isUnderReview
                    ? "Payment Submitted"
                    : isOfficeSecured
                    ? "Reservation Secured"
                    : isExpired
                      ? "Payment Expired"
                      : paymentMethod === "cash"
                        ? PAYMENT_LABELS.payAtOfficeButton
                        : "Submit Verification"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 animate-in fade-in duration-500">
        <section className="border-b border-slate-200 pb-5 mb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-orange-600">
                Payments
              </p>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
                My Transactions
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Manage your payments and invoices.
              </p>
            </div>
            {hasHistoryRecords && (
              <Button
                variant="outline"
                onClick={() => setShowHistory((v) => !v)}
                className="h-11 whitespace-nowrap rounded-xl border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                <Receipt className="mr-1.5 h-3.5 w-3.5" />
                {showHistory ? "Hide Transaction History" : "View Transaction History"}
              </Button>
            )}
          </div>
        </section>

      {/* Current Transactions (hidden when viewing history) */}
      {!showHistory && (
        <>
          <section>
            <SectionHeader
              title="Current Transaction"
              subtitle="Active payment"
              icon={<CreditCard className="h-4 w-4" />}
            />
            {currentTransaction ? (
              <div className="mt-3">
                <CurrentTransactionCard
                  booking={currentTransaction}
                  onPay={(b) => setSelectedBookingToPay(b.id)}
                  onSettle={(b) => setSelectedBookingToPay(b.id)}
                  onView={(b) => setViewingReceipt(b)}
                />
              </div>
            ) : (
              <div className="mt-3 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 sm:p-8 text-center">
                <Receipt className="mb-3 h-10 w-10 text-slate-300" />
                <h3 className="text-sm font-black text-slate-900">No active transaction</h3>
                <p className="mt-1 max-w-sm text-xs text-slate-500">
                  You don&apos;t have any active payment right now. Settled payments will appear in
                  your transaction history.
                </p>
              </div>
            )}
          </section>

          {otherActiveTransactions.length > 0 && (
            <section>
              <SectionHeader
                title="Other Current Transactions"
                subtitle="Other active payment records."
                icon={<Receipt className="h-4 w-4" />}
              />
              <div className="mt-3 space-y-2">
                {paginatedOtherActive.map((booking) => {
                  const isOfficeRental = isOfficeRentalBooking(booking);
                  const _total = (booking as any).totalPrice || 0;
                  const _amountPaid = (booking as any).amountPaid ?? 0;
                  const _remaining = (booking as any).remainingBalance ?? Math.max(_total - _amountPaid, 0);
                  const _paymentStatus = String(booking.paymentStatus || "").toLowerCase();
                  const _balanceStatus = String((booking as any).balanceStatus || "").toLowerCase();
                  const _paymentStage = String((booking as any).paymentStage || "").toLowerCase();
                  const _isUnderReview = (booking as any).hasActivePaymentSubmission || _paymentStatus === "for_review";
                  const _isDownpaymentActive =
                    booking.status === "confirmed" && booking.paymentType === "downpayment" && !["cancelled", "declined"].includes(String(booking.status).toLowerCase()) && _remaining > 0 && _paymentStatus !== "paid";
                  const _hasRemainingPaymentDue =
                    _remaining > 0 &&
                    !["cancelled", "declined"].includes(String(booking.status).toLowerCase()) && (
                      _paymentStatus === "partial" ||
                      _paymentStatus === "incomplete" ||
                      _balanceStatus === "with remaining balance" ||
                      _paymentStage === "complete downpayment" ||
                      _paymentStage === "settle remaining balance"
                    );
                  const _isPendingRemainingDP = _isUnderReview &&
                    !["cancelled", "declined"].includes(String(booking.status).toLowerCase()) &&
                    booking.paymentType === "downpayment" &&
                    Number((booking as any).downpaymentPaid || 0) > 0;
                  const showSettleAction =
                    !_isUnderReview &&
                    (_isDownpaymentActive || _hasRemainingPaymentDue || _isPendingRemainingDP);
                  return (
                      <div
                        key={booking.id}
                        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-orange-200 sm:flex-row sm:items-center sm:gap-3"
                      >
                        {/* ---- Mobile: event name + ID ---- */}
                        <div className="sm:hidden">
                           <p className="break-words whitespace-normal text-sm font-black text-slate-900">
                             {booking.eventName || "Untitled"}
                           </p>
                          <p className="mt-0.5 break-all text-[10px] font-semibold text-slate-500">
                            {booking.id}
                          </p>
                        </div>

                        {/* ---- Desktop: icon + event name + ID ---- */}
                        <div className="hidden items-center gap-3 min-w-0 flex-1 sm:flex">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                            {isOfficeRental ? <Banknote className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-slate-900">
                              {booking.eventName || "Untitled"}
                            </p>
                            <p className="truncate text-[10px] font-semibold text-slate-500 sm:text-[11px]">
                              {booking.id}
                              <span className="hidden sm:inline">
                                {" · "}{getPaymentMethodLabel(booking.paymentMethod)}{" · "}{booking.venue || "N/A"}
                              </span>
                            </p>
                          </div>
                        </div>

                        {/* ---- Status badge + actions ---- */}
                        <div className="flex flex-col items-stretch gap-2.5 w-full sm:mt-0 sm:w-auto sm:shrink-0 sm:ml-auto sm:flex-col sm:items-end sm:gap-2.5">
                          <span
                            className={cn(
                              "inline-flex w-full items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap sm:w-auto",
                  getStatusBadgeClass(booking.paymentStatus, booking.status, (booking as any).paymentStage, (booking as any).remainingBalance),
                            )}
                          >
                            {getStatusLabel(booking.paymentStatus, booking.status, (booking as any).paymentStage, (booking as any).remainingBalance)}
                          </span>
                          <div className="flex flex-col items-stretch gap-2 w-full sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-2">
                            {hasPaymentRecord(booking) && !showSettleAction && _paymentStatus !== "unpaid" && (
                              <Button
                                variant="outline"
                                onClick={() => setViewingReceipt(booking)}
                                className="h-9 w-full shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:w-auto"
                              >
                                View Details
                              </Button>
                            )}
                            <PaymentActionButtons
                              booking={booking}
                              onPay={(b) => setSelectedBookingToPay(b.id)}
                              onSettle={(b) => setSelectedBookingToPay(b.id)}
                              compact
                            />
                          </div>
                        </div>
                      </div>
                  );
                })}
                <Pagination
                  page={safeCurrentPage}
                  totalPages={totalOtherActivePages}
                  onPageChange={setCurrentPage}
                />
              </div>
            </section>
          )}
        </>
      )}

      <Dialog
        open={!!viewingReceipt}
        onOpenChange={(v) => !v && setViewingReceipt(null)}
      >
        <DialogContent aria-describedby={undefined}
          showCloseButton={false}
          className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] overflow-y-auto rounded-3xl bg-white shadow-2xl">
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-slate-100 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <DialogTitle className="text-lg font-black text-slate-900">
                    Transaction Details
                  </DialogTitle>
                  <p className="mt-0.5 break-words text-[11px] font-bold text-slate-500">
                    {viewingReceipt?.id}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setViewingReceipt(null)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {viewingReceipt && (
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <ReceiptDetails
                  booking={viewingReceipt}
                  isCancelled={
                    String(viewingReceipt.status).toLowerCase() === "cancelled" ||
                    String(viewingReceipt.status).toLowerCase() === "declined"
                  }
                  displayTotal={
                    ["cancelled", "declined"].includes(
                      String(viewingReceipt.status).toLowerCase(),
                    )
                      ? 0
                      : (viewingReceipt as any).totalPrice || 0
                  }
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Transaction History (hidden by default) */}
      {showHistory && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by ID, event, venue, status..."
                className="h-9 rounded-xl border-slate-200 pl-9 text-sm focus-visible:ring-2 focus-visible:ring-orange-500"
              />
            </div>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as TransactionFilter)}
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
              title="Transaction History"
              subtitle={`${filteredHistory.length} record${filteredHistory.length === 1 ? "" : "s"}`}
              icon={<Receipt className="h-4 w-4" />}
            />
            {filteredHistory.length === 0 ? (
              <div className="mt-3 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 sm:p-8 text-center">
                <FileImage className="mb-3 h-10 w-10 text-slate-300" />
                <h3 className="text-sm font-black text-slate-900">No matching transactions</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Try adjusting your search, filter, or date range.
                </p>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {paginatedHistory.map((booking) => (
                  <HistoryRow
                    key={booking.id}
                    booking={booking}
                    expanded={expandedBookingId === booking.id}
                    onToggle={() =>
                      setExpandedBookingId(
                        expandedBookingId === booking.id ? null : booking.id,
                      )
                    }
                    onView={(b) => setViewingReceipt(b)}
                    onPay={(b) => setSelectedBookingToPay(b.id)}
                  />
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
  );
}

function SectionHeader({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {icon && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs font-semibold text-slate-400">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

function OfficePaymentTracker({
  payments,
  compact = false,
}: {
  payments: any[];
  compact?: boolean;
}) {
  if (!payments || payments.length === 0) {
    return (
      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-600">
        No onsite check payment records yet. Once admin records monthly
        payments, they will appear here.
      </div>
    );
  }
  const visiblePayments = compact ? payments.slice(0, 3) : payments;
  return (
    <div className="space-y-2">
      {visiblePayments.map((payment) => (
        <div
          key={payment.id}
          className="rounded-xl border border-slate-100 bg-slate-50 p-3"
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black text-slate-900">
                {payment.billingPeriod || "Billing period"}
              </p>
              <p className="mt-0.5 text-[10px] font-semibold text-slate-500">
                Check #{payment.checkNumber || "N/A"}
              </p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em]",
                getStatusBadgeClass(payment.paymentStatus),
              )}
            >
              {payment.paymentStatus || "Pending"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] font-semibold text-slate-600">
            <span>Due: {payment.dueDate || "No due date"}</span>
            <span className="text-right">
              {formatMoney(Number(payment.amountPaid || 0))}
            </span>
          </div>
        </div>
      ))}
      {compact && payments.length > 3 && (
        <p className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
          +{payments.length - 3} more check payment records
        </p>
      )}
    </div>
  );
}

function ReceiptDetails({
  booking,
  isCancelled,
  displayTotal,
}: {
  booking: Booking;
  isCancelled: boolean;
  displayTotal: number;
}) {
  const receipt = booking.receipt as any;
  const isOfficeRental = isOfficeRentalBooking(booking);

  if (!receipt) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-black leading-tight text-slate-900">
            E-Receipt Not Generated Yet
          </h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">
            The system will automatically generate your e-receipt after admin
            verifies your payment.
          </p>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 sm:p-6 text-center">
          <Receipt className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-black text-slate-700">
            No system-generated receipt yet.
          </p>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
            Booking ID: {booking.id}
          </p>
        </div>
      </div>
    );
  }

  const totalAmount =
    (booking as any).totalPrice ?? displayTotal ?? null;
  const amountPaid =
    receipt?.amountPaid ??
    receipt?.paymentAmount ??
    (booking as any).amountPaid ??
    (booking as any).paymentAmount ??
    (booking as any).downPayment ??
    null;
  const remainingBalance =
    receipt?.remainingBalance ??
    (booking as any).remainingBalance ??
    (totalAmount != null && amountPaid != null
      ? Math.max(0, Number(totalAmount) - Number(amountPaid))
      : null);
  const contractTerm =
    receipt?.contractTerm || (booking as any).contractTerm || (booking as any).rentalTerm;
  const paymentType = isOfficeRental
    ? "Slot Reservation Only"
    : receipt?.paymentType || receipt?.paymentPurpose || "Booking Payment";
  const paymentMethod =
    receipt?.paymentMethod || booking.paymentMethod || "Not specified";
  const paymentStatus =
    receipt?.paymentStatus || booking.paymentStatus || "Payment Verified";
  const dateGenerated =
    receipt?.dateGenerated || receipt?.dateIssued || new Date().toISOString();
  const payStatus = String(paymentStatus).toLowerCase();
  const isVerified =
    payStatus === "verified" ||
    payStatus === "paid" ||
    payStatus === "slot_verified" ||
    !isCancelled;

  const paperData: ReceiptPaperData = {
    fullName: receipt.fullName || booking.userInfo?.name || "Client",
    email: booking.userInfo?.email || null,
    contactNumber: booking.userInfo?.phone || null,
    receiptNo: receipt.receiptNumber || receipt.receiptNo || "N/A",
    generatedAt: dateGenerated,
    bookingId: receipt.bookingId || booking.id,
    eventType: isOfficeRental
      ? "Office Space Rental"
      : receipt.eventType || (booking as any).eventType || "Event Venue Rental",
    venue: receipt.venueReserved || receipt.venue || booking.venue || "N/A",
    eventDate: receipt.startDate || booking.date || "Not set",
    reservationTime: isOfficeRental ? "" : getBookingTime(booking),
    paymentMethod: paymentMethod,
    bankReference: booking.bankReferenceNumber || null,
    paymentTypeLabel: paymentType,
    totalAmount,
    amountPaid,
    remainingBalance,
    paymentStatus,
    isVerified,
    isOfficeRental,
    contractTerm: contractTerm || null,
  };

  return <ReceiptPaper {...paperData} />;
}

function getBookingTime(booking: any) {
  if (!booking) return "N/A";
  if (booking.time) return booking.time;
  if (booking.reservationTime) return booking.reservationTime;
  const startTime =
    booking.startTime || booking.start_time || booking.start || booking.bookingStartTime || "";
  const endTime =
    booking.endTime || booking.end_time || booking.end || booking.bookingEndTime || "";
  if (startTime && endTime) return `${startTime} - ${endTime}`;
  if (startTime) return startTime;
  if (endTime) return endTime;
  return "N/A";
}

export default function ClientTransactionsPageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
        </div>
      }
    >
      <TransactionsContent />
    </Suspense>
  );
}