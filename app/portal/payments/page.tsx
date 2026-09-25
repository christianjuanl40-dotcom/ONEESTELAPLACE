"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Calendar,
  Check,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/src/modules/shared/components/ui/collapsible";
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
  useBookingData,
  type Booking,
} from "@/src/modules/client/contexts/booking-context";
import { useAuth } from "@/src/modules/shared/auth/auth-context";
import { useCMS } from "@/src/modules/admin/contexts/cms-context";
import { BankTransferQR } from "@/src/modules/shared/components/bank-transfer-qr";
import { NotificationTargetWrapper } from "@/src/modules/shared/components/notification-target";
import { useNotifications } from "@/src/modules/shared/contexts/notification-context";
import type { NotificationType } from "@/src/modules/shared/lib/notifications";
import { PAYMENT_LABELS, getPaymentMethodLabel } from "@/src/modules/shared/lib/labels";
import {
  ReceiptPaper,
  type ReceiptPaperData,
} from "@/src/modules/shared/components/receipt-paper";
import {
  isPaymentProofImage,
  PaymentProofPreview,
  PaymentProofRow,
} from "@/src/modules/shared/components/payment-proof-preview";
import { cn } from "@/src/modules/shared/lib/utils";
import { getBookingLifecycleLabel } from "@/src/modules/shared/lib/booking-helpers";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { PaymentRecord } from "@/src/modules/client/contexts/booking-context";
import {
  calculatePaymentSummary,
  getReceiptPaymentAmount,
  getReceiptPaymentMethodLabel,
  getReceiptPaymentNumber,
  getReceiptPaymentTime,
  getReceiptPresentation,
  getPaymentDisplayModel,
  getRecordsForBooking,
  type PaymentRecordLike,
  type ReceiptPresentation,
} from "@/src/modules/shared/lib/payment-calculations";

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

function isSupportedProofImage(file: File): boolean {
  return ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.type.toLowerCase())
}

function getTransactionDisplayAmount(
  booking: Booking,
  remainingDownpaymentOverride?: number,
  remainingBalanceOverride?: number,
): number {
  const b = booking as any;
  const totalPrice = Number(b.totalPrice || 0);
  const isDownPayment =
    b.paymentType === "downpayment" ||
    String(b.paymentType || "").toLowerCase().includes("down");

  if (isDownPayment) {
    const dpRemaining = Number(b.downpaymentRemaining || 0);
    const dpPaid = Number(b.downpaymentPaid || 0);

    // Mid-downpayment top-ups must show what the client STILL OWES toward
    // the downpayment (canonical credited remainder), never the original
    // full downpayment target.
    if (typeof remainingDownpaymentOverride === "number") {
      if (remainingDownpaymentOverride > 0) return remainingDownpaymentOverride;
      return typeof remainingBalanceOverride === "number" ? remainingBalanceOverride : 0;
    }

    if (dpRemaining > 0 && dpPaid > 0) {
      return dpRemaining;
    }

    return Number(b.selectedDownpaymentAmount || (Number(b.downPaymentPercentage || 50) / 100) * totalPrice || 0);
  }

  return typeof remainingBalanceOverride === "number" ? remainingBalanceOverride : totalPrice;
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
  return ["for review", "pending verification", "partial payment", "partial", "fully paid", "verified", "paid", "completed", "rejected", "incomplete", "for_review", "cash_pending", "slot_pending", "pending_verification", "slot_verified"].includes(ps);
}

function paymentMatchesFilter(paymentStatus: string, status: string, filter: TransactionFilter) {
  if (filter === "all") return true;
  const ps = paymentStatus.toLowerCase();
  const st = status.toLowerCase();
  if (filter === "verified") {
    return ["verified", "paid", "slot_verified", "completed"].includes(ps);
  }
  if (filter === "for_review") {
    return ["for_review", "cash_pending", "slot_pending", "pending_verification", "for review", "pending verification"].includes(ps);
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

function getStatusBadgeClass(paymentStatus?: string, status?: string, paymentStage?: string, remainingBalance?: number, booking?: any) {
  const bookingStatus = String(status || "").toLowerCase();
  const payStatus = String(paymentStatus || "").toLowerCase();
  const refundStatus = String(booking?.refundStatus || "").toLowerCase();

  if (refundStatus === "refunded") return "border-slate-200 bg-slate-50 text-slate-700";
  if (refundStatus === "requested") return "border-orange-100 bg-orange-50 text-orange-700";
  if (["cancelled", "declined"].includes(bookingStatus)) return "border-rose-100 bg-rose-50 text-rose-700";
  if (bookingStatus === "completed") return "border-blue-100 bg-blue-50 text-blue-700";
  // Canonical payment-level statuses are authoritative over the booking-level
  // status: an incomplete payment must NOT render as "For Verification".
  if (payStatus === "incomplete") return "border-amber-100 bg-amber-50 text-amber-700";
  if (payStatus === "rejected") return "border-rose-100 bg-rose-50 text-rose-700";
  if (payStatus === "for_review" || payStatus === "for review" || payStatus === "pending_verification" || payStatus === "pending verification") return "border-amber-100 bg-amber-50 text-amber-700";
  if (payStatus === "partial") return "border-amber-100 bg-amber-50 text-amber-700";
  if (payStatus === "completed" || payStatus === "paid" || payStatus === "verified" || payStatus === "slot_verified") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (bookingStatus === "pending") return "border-orange-100 bg-orange-50 text-orange-700";
  if (bookingStatus === "verifying") return "border-amber-100 bg-amber-50 text-amber-700";
  if (["confirmed", "reservation_secured", "active_rental", "contract_signing_required"].includes(bookingStatus)) return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (bookingStatus === "rental_expired") return "border-red-100 bg-red-50 text-red-700";

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function getStatusLabel(paymentStatus?: string, status?: string, paymentStage?: string, remainingBalance?: number, booking?: any) {
  const normStatus = String(status || "").toLowerCase();
  const payStatus = String(paymentStatus || "").toLowerCase();
  const refundStatus = String(booking?.refundStatus || "").toLowerCase();

  if (refundStatus === "refunded") return "Refunded";
  if (refundStatus === "requested") return "Refund Requested";
  if (["cancelled", "declined"].includes(normStatus)) return "Cancelled";
  if (normStatus === "completed") return "Completed";
  // Canonical payment-level statuses are authoritative: an INCOMPLETE PAYMENT
  // is a distinct payment state and must NOT be shown as "For Verification"
  // just because the booking status is "verifying".
  if (payStatus === "incomplete") return "Incomplete Payment";
  if (payStatus === "rejected") return "Rejected";
  if (payStatus === "partial") return "Partial Payment";
  if (payStatus === "for_review" || payStatus === "for review" || payStatus === "pending_verification" || payStatus === "pending verification") return "For Verification";
  if (payStatus === "completed" || payStatus === "fully paid" || payStatus === "fully_paid") return "Fully Paid";
  if (normStatus === "pending") return "Pending";
  if (normStatus === "verifying") return "For Verification";
  if (["confirmed", "reservation_secured", "active_rental", "contract_signing_required"].includes(normStatus)) return "Paid";

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
  return getBookingLifecycleLabel({ status });
}

async function readStoredReceipts(bookingId?: string): Promise<any[]> {
  try {
    const constraints: any[] = bookingId
      ? [where("bookingId", "==", bookingId)]
      : [orderBy("dateGenerated", "desc")];
    const snapshot = await getDocs(query(collection(db, "receipts"), ...constraints));
    const result: any[] = [];
    snapshot.forEach((docSnap) => {
      const d = docSnap.data();
      result.push({ id: docSnap.id, ...d });
    });
    return result;
  } catch {
    return [];
  }
}

function getSettlementState(booking: Booking, records?: PaymentRecordLike[] | null) {
  const summary = calculatePaymentSummary(booking, records || []);
  const status = String(booking.status || "").toLowerCase();
  const storedPaymentStatus = String(booking.paymentStatus || "").toLowerCase();
  const isCancelled = ["cancelled", "declined"].includes(status);
  const isCompleted = status === "completed";
  const isLegacyAwaitingInitialPayment =
    (records?.length || 0) === 0 &&
    ["unpaid", "pending"].includes(storedPaymentStatus);
  const hasActivePaymentSubmission = booking.hasActivePaymentSubmission === true;
  // Existing business rule (same signal the original payment flow used): a
  // booking whose submission is still awaiting admin resolution is UNDER
  // REVIEW and must expose neither Pay Now nor Settle Remaining Balance.
  // summary.hasPendingSubmission covers bookings whose records carry the
  // pending state; hasActivePaymentSubmission covers the booking-document
  // marker written at submission time and cleared by every admin action.
  // A merely PARTIAL booking therefore never exposes the settle action on
  // its own — only once its pending submission has been resolved.
  const isUnderReview =
    summary.hasPendingSubmission ||
    hasActivePaymentSubmission ||
    (summary.overallStatus === "for_review" && !isLegacyAwaitingInitialPayment);

  return {
    isCancelled,
    isCompleted,
    isUnderReview,
    summary,
  };
}

function getLatestPaymentStatus(
  records: PaymentRecord[] | undefined,
  booking: Booking | string,
): string {
  const latest = getRecordsForBooking(records, booking)
    .sort(
      (a, b) =>
        new Date(String(b.submittedAt || 0)).getTime() -
        new Date(String(a.submittedAt || 0)).getTime(),
    )[0];
  return String(latest?.status || latest?.verificationStatus || "");
}

function PaymentActionButtons({
  booking,
  onPay,
  onSettle,
  compact,
  paymentCount = 0,
  latestPaymentStatus = "",
  records,
}: {
  booking: Booking;
  onPay: (b: Booking) => void;
  onSettle: (b: Booking) => void;
  compact?: boolean;
  paymentCount?: number;
  latestPaymentStatus?: string;
  records?: PaymentRecordLike[] | null;
}) {
  const remainingMs = getRemainingMs(booking);
  const isExpired = booking.status === "pending" && remainingMs <= 0;
  const isCashPending =
    booking.paymentMethod === "cash" &&
    booking.paymentStatus === "cash_pending";
  const { isUnderReview, isCancelled, isCompleted, summary } = getSettlementState(
    booking,
    records,
  );

  // The settlement button is driven ENTIRELY by the canonical payment summary.
  // It appears ONLY for a booking that completed its required downpayment but
  // still has an outstanding balance (overallStatus === "partial"). Fully paid,
  // for-review, incomplete and rejected bookings never show it.
  const canSettleRemainingBalance =
    summary.overallStatus === "partial" &&
    summary.moneyReceivedTotal >= summary.requiredDownpayment &&
    summary.moneyReceivedTotal < summary.bookingTotal &&
    summary.remainingBalance > 0 &&
    !isCancelled &&
    !isCompleted &&
    !isUnderReview;

  // Pending bookings keep the existing Pay Now flow (24h window, no payment
  // submitted yet). Every other active booking with a payable balance gets
  // the settlement button.
  const showPayNow =
    booking.status === "pending" &&
    !isCashPending &&
    !isExpired &&
    !isUnderReview;
  const showSettle = canSettleRemainingBalance;
  // INCOMPLETE / REJECTED — the required downpayment is NOT yet complete, so
  // the client MUST still have a way to submit another payment toward it.
  // An old incomplete/rejected record must never leave the client without a
  // payment action; only a completed downpayment (partial) upgrades this to
  // Settle Remaining Balance, and fully_paid shows no action at all.
  const showMakePayment =
    !isCancelled &&
    !isCompleted &&
    !showSettle &&
    (summary.overallStatus === "incomplete" || summary.overallStatus === "rejected");

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

  if (showMakePayment) {
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
        {"Make Payment"}
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
  paymentCount = 0,
  latestPaymentStatus = "",
  records,
}: {
  booking: Booking;
  onPay: (b: Booking) => void;
  onSettle: (b: Booking) => void;
  onView: (b: Booking) => void;
  paymentCount?: number;
  latestPaymentStatus?: string;
  records?: PaymentRecordLike[] | null;
}) {
  const paymentSummary = calculatePaymentSummary(booking, records || []);
  const latestRecord = [...(records || [])].sort(
    (a, b) => new Date(String(b.submittedAt || b.updatedAt || 0)).getTime() - new Date(String(a.submittedAt || a.updatedAt || 0)).getTime(),
  )[0];
  const displayModel = latestRecord
    ? getPaymentDisplayModel(booking, latestRecord, paymentSummary)
    : null;
  const amountPaid = paymentSummary.moneyReceivedTotal;
  const remaining = paymentSummary.remainingBalance;
  const storedPaymentStatus = String(booking.paymentStatus || "").toLowerCase();
  const paymentStatus =
    (records?.length || 0) > 0 ? paymentSummary.overallStatus : storedPaymentStatus || paymentSummary.overallStatus;
  const remainingMs = getRemainingMs(booking);
  const isExpired = booking.status === "pending" && remainingMs <= 0;
  const isCashPending = booking.paymentMethod === "cash" && storedPaymentStatus === "cash_pending";
  // Canonical credited remainder — what the client still owes toward the
  // required downpayment (verified payments + received amounts of short
  // incomplete payments already subtracted from the requirement).
  const cardDownpaymentRemainder = paymentSummary.remainingDownpayment;
  const displayAmount = getTransactionDisplayAmount(booking, cardDownpaymentRemainder, remaining);
  const showDisplayAmount = displayAmount !== 0 || !paymentSummary.fullyPaid;

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
            {showDisplayAmount && (
              <p className="mt-0.5 text-sm font-bold text-orange-600">
                {formatMoney(displayAmount)}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black">Booking ID</p>
            <p className="mt-0.5 break-all text-xs font-black text-slate-800">{booking.id}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black">Method</p>
            <p className="mt-0.5 break-words text-xs font-bold text-slate-800">
              {getPaymentMethodLabel(booking.paymentMethod)}
            </p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
            <div>
               <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black">Money Received</p>
              <p className="mt-0.5 text-xs font-black text-emerald-700">{formatMoney(amountPaid)}</p>
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black">Balance</p>
              <p className={cn("mt-0.5 text-xs font-black", remaining > 0 ? "text-amber-700" : "text-emerald-700")}>
                {formatMoney(remaining)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Tablet: grouped info block (sm to md) ---- */}
      <div className="hidden min-w-0 items-center gap-3 sm:flex md:hidden">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
          <Receipt className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
            Current Transaction
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-black text-slate-900">
            <span className="break-words whitespace-normal min-w-0">{booking.eventName || "Untitled"}</span>
            <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-slate-500">• {booking.id}</span>
          </p>
          {showDisplayAmount && (
            <p className="mt-1.5 break-words whitespace-normal text-[11px] font-bold text-orange-600">
              {formatMoney(displayAmount)}
            </p>
          )}
        </div>
      </div>

      {/* ---- Desktop: Event block + 2-col info grid (md+) ---- */}
      <div className="hidden shrink-0 items-center gap-3 md:flex md:w-[220px]">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
          <Receipt className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
            Current Transaction
          </p>
          <p className="break-words whitespace-normal text-sm font-black leading-snug text-slate-900 min-w-0">
            {booking.eventName || "Untitled"}
          </p>
          {showDisplayAmount && (
            <p className="break-words whitespace-normal text-[11px] font-bold text-orange-600">
              {formatMoney(displayAmount)}
            </p>
          )}
        </div>
      </div>

      <div className="hidden min-w-0 flex-1 grid-cols-[1fr_1fr] gap-x-8 md:grid">
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black">Booking ID</p>
          <p className="mt-0.5 break-all text-xs font-black text-slate-800 truncate">{booking.id}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black">Method</p>
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
              getStatusBadgeClass(paymentStatus, booking.status, (booking as any).paymentStage, remaining, booking),
            )}
          >
            {displayModel?.statusLabel || getStatusLabel(paymentStatus, booking.status, (booking as any).paymentStage, remaining, booking)}
          </span>
          <div className="flex flex-col items-stretch gap-2 w-full sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-2">
            {hasPaymentRecord(booking) && (
              <Button
                variant="outline"
                onClick={() => onView(booking)}
                className="h-9 w-full shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:w-auto"
              >
                View Details
              </Button>
            )}
            <PaymentActionButtons booking={booking} onPay={onPay} onSettle={onSettle} compact paymentCount={paymentCount} latestPaymentStatus={latestPaymentStatus} records={records} />
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
  records,
}: {
  booking: Booking;
  expanded: boolean;
  onToggle: () => void;
  onView: (b: Booking) => void;
  onPay: (b: Booking) => void;
  records?: PaymentRecordLike[] | null;
}) {
  const isOfficeRental = isOfficeRentalBooking(booking);
  const isCancelled =
    String(booking.status).toLowerCase() === "cancelled" ||
    String(booking.status).toLowerCase() === "declined";
  const paymentRecords = getRecordsForBooking(records, booking);
  const paymentSummary = calculatePaymentSummary(booking, paymentRecords);
  const latestRecord = [...paymentRecords].sort(
    (a, b) => new Date(String(b.submittedAt || b.updatedAt || 0)).getTime() - new Date(String(a.submittedAt || a.updatedAt || 0)).getTime(),
  )[0];
  const displayModel = latestRecord
    ? getPaymentDisplayModel(booking, latestRecord, paymentSummary)
    : null;
  const paymentStatus = paymentRecords.length > 0
    ? paymentSummary.overallStatus
    : String(booking.paymentStatus || "").toLowerCase();
  const displayTotal = isCancelled ? 0 : paymentSummary.bookingTotal;
  const isUnpaid = paymentRecords.length === 0 && paymentStatus === "unpaid";
  const amountPaid = paymentSummary.moneyReceivedTotal;
  const remainingBalance = paymentSummary.remainingBalance;

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
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black">Venue</p>
              <p className="truncate text-[11px] font-semibold text-slate-700">{booking.venue || "N/A"}</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black">Method</p>
                <p className="whitespace-nowrap text-[11px] font-bold text-slate-700">
                  {getPaymentMethodLabel(booking.paymentMethod)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black">Amount</p>
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
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black">Method</p>
          <p className="whitespace-nowrap text-[11px] font-bold text-slate-700">
            {getPaymentMethodLabel(booking.paymentMethod)}
          </p>
        </div>
        <div className="hidden text-left md:block min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black">Amount</p>
          <p className="whitespace-nowrap text-[11px] font-black text-slate-900">
            {formatMoney(displayTotal)}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2.5 w-full sm:mt-0 sm:w-auto sm:shrink-0 sm:ml-auto sm:flex-col sm:items-end sm:gap-2.5">
          <span
            className={cn(
              "inline-flex w-full items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap sm:w-auto",
              getStatusBadgeClass(paymentStatus, booking.status, (booking as any).paymentStage, remainingBalance, booking),
            )}
          >
            {displayModel?.statusLabel || getStatusLabel(paymentStatus, booking.status, (booking as any).paymentStage, remainingBalance, booking)}
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
           <DetailItem label={displayModel?.acceptedLabel || "Money Received"} value={formatMoney(displayModel?.acceptedAmount ?? amountPaid)} />
           <DetailItem label={displayModel?.remainingLabel || "Remaining Balance"} value={formatMoney(displayModel?.remainingAmount ?? remainingBalance)} />
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
      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black">
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
  const urlViewId = searchParams.get("view");

  const { toast } = useToast();
  const { bookings, submitPayment, cancelBooking, isLoading: bookingsLoading, paymentRecords } = useBookingData({ bookings: true, payments: true });
  const { user } = useAuth();
  const { paymentInfo } = useCMS();

  const { markByBookingId } = useNotifications();
  const CLIENT_PAYMENT_TYPES: NotificationType[] = useMemo(
    () => ["payment_approved", "payment_rejected", "payment_incomplete", "remaining_balance_approved", "remaining_balance_rejected", "refund_completed"],
    [],
  );

  const [selectedBookingToPay, setSelectedBookingToPay] = useState<string | null>(null);
  const [localBookings, setLocalBookings] = useState<Booking[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  const [paymentType, setPaymentType] = useState<"full" | "downpayment">("full");
  const [paymentMethod, setPaymentMethod] = useState<"bank" | "cash">("bank");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [proofPreviewOpen, setProofPreviewOpen] = useState(false);
  const proofObjectUrlRef = useRef<string | null>(null);
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
  const [viewingReceiptNo, setViewingReceiptNo] = useState<string | null>(null);
  const [isPaymentHistoryOpen, setIsPaymentHistoryOpen] = useState(false);
  const [storedReceiptsByBooking, setStoredReceiptsByBooking] = useState<Map<string, any[]>>(new Map());

  const setSelectedProofFile = (file: File | null) => {
    if (proofObjectUrlRef.current) {
      URL.revokeObjectURL(proofObjectUrlRef.current);
      proofObjectUrlRef.current = null;
    }

    const nextPreviewUrl = file ? URL.createObjectURL(file) : null;
    proofObjectUrlRef.current = nextPreviewUrl;
    setProofFile(file);
    setProofPreviewUrl(nextPreviewUrl);
    setProofPreviewOpen(false);
  };

  useEffect(() => {
    return () => {
      if (proofObjectUrlRef.current) {
        URL.revokeObjectURL(proofObjectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!viewingReceipt?.id) return;
    let mounted = true;
    readStoredReceipts(viewingReceipt.id).then((receipts) => {
      if (!mounted) return;
      setStoredReceiptsByBooking((prev) => {
        const next = new Map(prev);
        next.set(viewingReceipt.id, receipts);
        return next;
      });
    });
    return () => {
      mounted = false;
    };
  }, [viewingReceipt?.id]);

  const viewingStoredReceipts = useMemo(() => {
    if (!viewingReceipt) return [] as any[];
    return storedReceiptsByBooking.get(viewingReceipt.id) || [];
  }, [viewingReceipt, storedReceiptsByBooking]);

  const viewingReceiptRecords = useMemo(
    () => viewingReceipt ? getRecordsForBooking(paymentRecords, viewingReceipt) : [],
    [paymentRecords, viewingReceipt],
  );

  const viewingReceiptHistory = useMemo(() => {
    if (!viewingReceipt) return [] as any[];
    const bookingAny = viewingReceipt as any;
    const bookingReceipts: any[] = Array.isArray(bookingAny?.paymentReceipts)
      ? bookingAny.paymentReceipts
      : viewingReceipt.receipt
        ? [viewingReceipt.receipt]
        : [];
    const bookingRecords: PaymentRecordLike[] = viewingReceiptRecords;
    const storedReceipts = viewingStoredReceipts as any[];
    // Same receipt may be persisted both inside the booking doc
    // (paymentReceipts) and in the `receipts` collection — dedupe by
    // receiptNumber / timestamp so it never renders twice.
    const seenReceipts = new Set<string>();
    const allReceipts: any[] = [];
    for (const receipt of [...bookingReceipts, ...storedReceipts]) {
      const key = String(
        receipt.receiptNumber ||
          receipt.paymentSubmittedAt ||
          receipt.dateGenerated ||
          "",
      );
      if (!key || seenReceipts.has(key)) continue;
      seenReceipts.add(key);
      allReceipts.push(receipt);
    }

    // Build one entry PER PAYMENT. Firestore payment records are the
    // authoritative history (Payment 1..N); each record is matched to its
    // e-receipt by the pinned submission timestamp. Payment records without
    // a receipt (e.g. an incomplete payment) still appear in the history.
    const entries: any[] = [];
    const usedReceipts = new Set<any>();

    for (const record of bookingRecords) {
      let matched: any | undefined;
      // A receipt is matched ONLY when it explicitly belongs to this payment
      // record: primary rule is the exact paymentId tie written at generation
      // time; legacy receipts (created before paymentId existed) fall back to
      // the pinned exact paymentSubmittedAt. There is NO timestamp-window /
      // nearest-receipt fallback — a payment without its own receipt record
      // renders "No receipt record" and never inherits another payment's
      // receipt.
      for (const receipt of allReceipts) {
        if (usedReceipts.has(receipt)) continue;
        if (
          record.id &&
          String(receipt.paymentId || "") &&
          String(receipt.paymentId) === String(record.id)
        ) {
          matched = receipt;
          usedReceipts.add(receipt);
          break;
        }
        if (
          String(receipt.paymentSubmittedAt || "") &&
          String(receipt.paymentSubmittedAt) === String(record.submittedAt)
        ) {
          matched = receipt;
          usedReceipts.add(receipt);
          break;
        }
      }
      const amount = getReceiptPaymentAmount(record);
      entries.push({
        ...(matched || {}),
        paymentId: record.id,
        paymentNumber: getReceiptPaymentNumber(record, bookingRecords),
        term: record.term || matched?.paymentPurpose || matched?.paymentType,
        paymentMethod: record.paymentMethod || record.method || matched?.paymentMethod || "",
        method: record.method || record.paymentMethod || "",
        referenceNo: record.referenceNo || matched?.referenceNo || matched?.bankReferenceNumber || "",
        proofUrl: record.proofUrl || "",
        amount,
        amountPaid: matched ? matched.amountPaid : amount,
        paymentAmount: matched ? matched.paymentAmount : amount,
        amountReceived: record.amountReceived,
        adminNote: record.adminNote,
        rejectionReason: record.rejectionReason,
        verificationStatus: record.verificationStatus,
        submittedAt: record.submittedAt || record.updatedAt || "",
        status: record.status || record.verificationStatus || matched?.paymentStatus || "",
        dateGenerated: matched
          ? matched.dateGenerated
          : record.submittedAt || "",
        receipt: matched || null,
        source: "payment",
      });
    }

    for (const receipt of allReceipts) {
      if (usedReceipts.has(receipt)) continue;
      entries.push({
        ...receipt,
        paymentId: receipt.paymentId || "",
        paymentNumber: getReceiptPaymentNumber(receipt, bookingRecords),
        submittedAt:
          receipt.paymentSubmittedAt ||
          receipt.dateGenerated ||
          receipt.dateIssued ||
          "",
        status: receipt.paymentStatus || "",
        receipt,
        source: "receipt",
      });
    }

    const merged = entries.sort((a, b) => {
      const timeDifference = getReceiptPaymentTime(b) - getReceiptPaymentTime(a)
      if (timeDifference !== 0) return timeDifference
      return String(b.paymentNumber || b.receiptNumber || b.paymentId || "")
        .localeCompare(String(a.paymentNumber || a.receiptNumber || a.paymentId || ""))
    });

    return merged;
  }, [viewingReceipt, viewingReceiptRecords, viewingStoredReceipts]);

  const selectedViewingReceipt = useMemo(() => {
    if (viewingReceiptHistory.length === 0) return null;
    if (!viewingReceiptNo) return viewingReceiptHistory[0];
    return (
      viewingReceiptHistory.find(
        (r) =>
          r.paymentId === viewingReceiptNo ||
          r.receiptNumber === viewingReceiptNo,
      ) || viewingReceiptHistory[0]
    );
  }, [viewingReceiptHistory, viewingReceiptNo]);

  const selectedReceiptPresentation = useMemo<ReceiptPresentation | null>(() => {
    if (!viewingReceipt) return null
    return getReceiptPresentation(viewingReceipt, viewingReceiptRecords, selectedViewingReceipt)
  }, [selectedViewingReceipt, viewingReceipt, viewingReceiptRecords]);

  const handlePay = (booking: Booking) => {
    markByBookingId(booking.id, CLIENT_PAYMENT_TYPES);
    setSelectedBookingToPay(booking.id);
  };
  const handleSettle = (booking: Booking) => {
    markByBookingId(booking.id, CLIENT_PAYMENT_TYPES);
    setSelectedBookingToPay(booking.id);
  };
  const handleView = (booking: Booking) => {
    markByBookingId(booking.id, CLIENT_PAYMENT_TYPES);
    setIsPaymentHistoryOpen(false);
    setViewingReceiptNo(null);
    setViewingReceipt(booking);
  };

  useEffect(() => {
    if (urlBookingId) {
      markByBookingId(urlBookingId, CLIENT_PAYMENT_TYPES);
      setSelectedBookingToPay(urlBookingId);
    }
  }, [urlBookingId, markByBookingId, CLIENT_PAYMENT_TYPES]);

  useEffect(() => {
    if (urlViewId && localBookings.length > 0) {
      const found = localBookings.find((b) => b.id === urlViewId);
      if (found) {
        markByBookingId(found.id, CLIENT_PAYMENT_TYPES);
        setIsPaymentHistoryOpen(false);
        setViewingReceiptNo(null);
        setViewingReceipt(found);
      }
    }
  }, [urlViewId, localBookings, markByBookingId, CLIENT_PAYMENT_TYPES]);

  useEffect(() => {
    setLocalBookings(bookings || []);
    setIsHydrated(true);
  }, [bookings]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const latestPaymentActivityByBooking = useMemo(() => {
    const map = new Map<string, number>();
    for (const record of paymentRecords || []) {
      const time = new Date(
        String(record.submittedAt || record.updatedAt || ""),
      ).getTime();
      if (!Number.isFinite(time) || time <= 0) continue;
      for (const key of [record.bookingId, record.bookingCode]) {
        const normalizedKey = String(key || "").trim().toLowerCase();
        if (normalizedKey && time > (map.get(normalizedKey) || 0)) {
          map.set(normalizedKey, time);
        }
      }
    }
    return map;
  }, [paymentRecords]);

  const myTransactions = useMemo(() => {
    const list = (localBookings.filter((booking) => booking.userId === user?.id) || []);
    return list.sort((a, b) => {
      const getActivityTime = (booking: Booking) => {
        const fromPayment =
          latestPaymentActivityByBooking.get(String(booking.id).trim().toLowerCase()) ||
          latestPaymentActivityByBooking.get(String((booking as any).bookingCode || "").trim().toLowerCase());
        if (fromPayment) return fromPayment;
        const fallback = new Date(
          String(
            (booking as any).paymentSubmittedAt ||
              (booking as any).latestPaymentSubmittedAt ||
              booking.createdAt ||
              "",
          ),
        ).getTime();
        return Number.isFinite(fallback) ? fallback : 0;
      };
      return getActivityTime(b) - getActivityTime(a);
    });
  }, [localBookings, user?.id, latestPaymentActivityByBooking]);

  // Canonical payment state — every booking rendered on this page carries the
  // SAME values the Admin Payment Verification page computes from the booking's
  // complete payment history, so Client and Admin can never disagree:
  //   paymentStatus    = canonical overall status
  //   amountPaid       = total money actually received (verified payments +
  //                      received amounts of incomplete payments)
  //   remainingBalance = bookingTotal − money received
  const summarizedTransactions = useMemo(
    () =>
      myTransactions.map((booking) => {
        const records = getRecordsForBooking(paymentRecords, booking);
        const summary = calculatePaymentSummary(booking, records);
        // Canonical state is only authoritative once there is payment activity.
        // A fresh booking (ps "unpaid", nothing submitted, no records) keeps its
        // raw fields so the UI renders the booking-level "Pending" state and the
        // "unpaid" guards, exactly as before the canonicalization.
        const hasPaymentActivity =
          summary.moneyReceivedTotal > 0 ||
          records.length > 0 ||
          Number((booking as any).paymentAmount || 0) > 0 ||
          Boolean(
            (booking as any).proofUrl ||
              (booking as any).paymentProof ||
              (booking as any).proofOfPayment,
          );
        if (!hasPaymentActivity) return booking;
        return {
          ...booking,
          paymentStatus: summary.overallStatus,
          amountPaid: summary.moneyReceivedTotal,
          remainingBalance: summary.remainingBalance,
        } as Booking;
      }),
    [myTransactions, paymentRecords],
  );

  const transactionsWithPayment = useMemo(
    () => summarizedTransactions.filter(hasPaymentRecord),
    [summarizedTransactions],
  );

  useEffect(() => {
    if (!isHydrated) return;

    const expiredPendingBookings = summarizedTransactions.filter((booking) => {
      if (booking.status !== "pending") return false;
      if (["verified", "paid", "partial", "completed", "for_review"].includes(String(booking.paymentStatus || "").toLowerCase())) {
        return false;
      }
      return getRemainingMs(booking) <= 0;
    });

    if (expiredPendingBookings.length === 0) return;

    void Promise.all(expiredPendingBookings.map((booking) => cancelBooking(booking.id))).then((updated) => {
      const expiredIds = new Set(
        updated.filter((booking): booking is Booking => Boolean(booking)).map((booking) => booking.id),
      )
      if (expiredIds.size === 0) return

      setLocalBookings((prev) =>
        prev.map((booking) =>
          expiredIds.has(booking.id)
            ? { ...booking, status: "cancelled" }
            : booking,
        ),
      )

      if (selectedBookingToPay && expiredIds.has(selectedBookingToPay)) {
        setSelectedBookingToPay(null);
        router.replace("/portal/payments");
        toast({
          title: "Booking Automatically Cancelled",
          description:
            "The 24-hour payment window ended, so the pending booking was cancelled.",
          variant: "destructive",
        });
      }
    });
  }, [
    now,
    isHydrated,
    summarizedTransactions,
    selectedBookingToPay,
    cancelBooking,
    router,
    toast,
  ]);

  const searchMatch = (booking: Booking, query: string) => {
    if (!query) return true;
    const q = query.toLowerCase().trim();
    const bookingFields = [
      booking.id,
      booking.eventName,
      booking.eventType,
      booking.venue,
      booking.status,
      booking.paymentStatus,
      booking.paymentMethod,
    ];
    const paymentFields = getRecordsForBooking(paymentRecords, booking)
      .flatMap((r) => [
        r.id,
        String(r.referenceNo || ""),
        String(r.amount || r.amountPaid || ""),
        r.paymentMethod || r.method || "",
        r.status || "",
        r.verificationStatus || "",
      ]);
    return [...bookingFields, ...paymentFields].some((f) => f && String(f).toLowerCase().includes(q));
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
    [historyTransactions, filter, searchQuery, dateFrom, dateTo, paymentRecords],
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

  const [highlightedBookingId, setHighlightedBookingId] = useState<string | null>(null);
  const paymentHighlightHandledRef = useRef(false);
  const paymentHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const h = sessionStorage.getItem("client_payment_highlight");
    if (h) {
      setHighlightedBookingId(h);
      setSearchQuery("");
      setFilter("all");
      setDateFrom("");
      setDateTo("");
    }
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ bookingId: string }>;
      const bookingId = customEvent.detail?.bookingId;
      if (!bookingId) return;
      if (paymentHighlightTimeoutRef.current) {
        clearTimeout(paymentHighlightTimeoutRef.current);
        paymentHighlightTimeoutRef.current = null;
      }
      paymentHighlightHandledRef.current = false;
      if (highlightedBookingId === bookingId) {
        setHighlightedBookingId(null);
        requestAnimationFrame(() => {
          paymentHighlightHandledRef.current = false;
          setHighlightedBookingId(bookingId);
        });
      } else {
        setHighlightedBookingId(bookingId);
      }
      setSearchQuery("");
      setFilter("all");
      setDateFrom("");
      setDateTo("");
    };
    window.addEventListener("client-payment-highlight", handler);
    return () => {
      window.removeEventListener("client-payment-highlight", handler);
    };
  }, [highlightedBookingId]);

  useEffect(() => {
    if (!highlightedBookingId) return;
    if (paymentHighlightHandledRef.current) return;
    const target = myTransactions.find((b) => b.id === highlightedBookingId);
    if (!target) return;

    const inHistory = !isCurrentTransaction(target);

    if (inHistory && !showHistory) {
      setShowHistory(true);
      return;
    }
    if (!inHistory && showHistory) {
      setShowHistory(false);
      return;
    }

    if (inHistory) {
      const idx = filteredHistory.findIndex(
        (b) => b.id === highlightedBookingId,
      );
      if (idx === -1) return;
      const page = Math.floor(idx / PAGE_SIZE) + 1;
      if (page !== safeHistoryPage) {
        setHistoryPage(page);
        return;
      }
    } else {
      const isCurrent =
        currentTransaction &&
        currentTransaction.id === highlightedBookingId;
      if (!isCurrent) {
        const idx = otherActiveTransactions.findIndex(
          (b) => b.id === highlightedBookingId,
        );
        if (idx === -1) return;
        const page = Math.floor(idx / otherActivePageSize) + 1;
        if (page !== safeCurrentPage) {
          setCurrentPage(page);
          return;
        }
      }
    }

    paymentHighlightHandledRef.current = true;
    sessionStorage.removeItem("client_payment_highlight");
    paymentHighlightTimeoutRef.current = setTimeout(() => {
      setHighlightedBookingId(null);
      paymentHighlightTimeoutRef.current = null;
    }, 3000);
    return () => {
      if (paymentHighlightTimeoutRef.current) {
        clearTimeout(paymentHighlightTimeoutRef.current);
        paymentHighlightTimeoutRef.current = null;
      }
    };
  }, [
    highlightedBookingId,
    myTransactions,
    showHistory,
    filteredHistory,
    safeHistoryPage,
    otherActiveTransactions,
    safeCurrentPage,
    currentTransaction,
  ]);

  if (!isHydrated || bookingsLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
      </div>
    );
  }

  if (selectedBookingToPay) {
    // Prefer the canonical-summarized entry (paymentStatus / amountPaid /
    // remainingBalance are derived from the verified payment records) and
    // fall back to the raw booking for bookings without payment records.
    const booking =
      summarizedTransactions.find((item) => item.id === selectedBookingToPay) ||
      myTransactions.find((item) => item.id === selectedBookingToPay);

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
    const bs = String((booking as any).balanceStatus || "").toLowerCase();
    const paymentStage = String((booking as any).paymentStage || "").toLowerCase();
    // CANONICAL DOWNPAYMENT REMAINDER — derived from the booking's complete
    // payment history: every VERIFIED payment plus the money admin confirmed
    // was ACTUALLY RECEIVED on short (INCOMPLETE) payments is credited toward
    // the required downpayment. A client who submitted ₱5,500 of a ₱7,500
    // downpayment must be asked for ₱2,000 here — NEVER the full ₱7,500
    // again. The raw booking fields are only a fallback for bookings whose
    // payment type carries no canonical downpayment requirement.
    const payRecords = getRecordsForBooking(paymentRecords, booking);
    const paySummary = calculatePaymentSummary(booking, payRecords);
    const hasPaymentActivity =
      payRecords.length > 0 ||
      Number((booking as any).paymentAmount || 0) > 0 ||
      Boolean(
        (booking as any).proofUrl ||
          (booking as any).paymentProof ||
          (booking as any).proofOfPayment,
      );
    const isUnderReview = hasPaymentActivity
      ? paySummary.hasPendingSubmission || paySummary.overallStatus === "for_review"
      : ps === "for_review";
    const totalPrice = paySummary.bookingTotal;
    const selectedDP =
      paySummary.requiredDownpayment > 0
        ? paySummary.requiredDownpayment
        : Number((booking as any).selectedDownpaymentAmount || 0);
    const downpaymentRemaining =
      paySummary.requiredDownpayment > 0
        ? paySummary.remainingDownpayment
        : Number((booking as any).downpaymentRemaining || Math.max(selectedDP - Number((booking as any).downpaymentPaid || 0), 0));
    const isSettlingBalance =
      !isOfficeRental &&
      booking.status === "confirmed" &&
      booking.paymentType === "downpayment";
    const isRemainingPaymentFlow =
      !isOfficeRental &&
      (paySummary.overallStatus === "partial" || ps === "incomplete" || bs === "with remaining balance" ||
        paymentStage === "complete downpayment" || paymentStage === "settle remaining balance");

    const currentAmountPaid = paySummary.moneyReceivedTotal;
    // CANONICAL REMAINING BALANCE — single source of truth for what the
    // client still owes. Derived from the booking's complete payment-record
    // history (verified payments + received amounts of short incomplete
    // payments). The stored booking field is only a fallback for bookings
    // without any payment-record history.
    const remainingBalance = paySummary.remainingBalance;
    const isOfficeRemainingPayment =
      isOfficeRental && currentAmountPaid > 0 && remainingBalance > 0;
    const officeReservationFee = getOfficeReservationFee(booking) || totalPrice;
    const downpaymentAmount = Number((booking as any).downPaymentPercentage || 50) / 100 * totalPrice;
    // "Complete Your Downpayment" only while the canonical downpayment
    // remainder actually exists. Uses paySummary.remainingDownpayment
    // (derived from the complete payment-record history) — NEVER the
    // stored booking field which may be stale.
    const isCompletingDownpayment =
      paySummary.requiredDownpayment > 0 &&
      paySummary.remainingDownpayment > 0 &&
      !paySummary.downpaymentComplete;
    // CANONICAL AMOUNT TO PAY — the settlement/settle-balance/complete-dp
    // amount ALWAYS equals the canonical remainingBalance or
    // remainingDownpayment. Never derive from stored booking fields,
    // payment history amounts, or hardcoded values.
    const amountToPay = isOfficeRental
      ? (currentAmountPaid > 0 ? remainingBalance : officeReservationFee)
      : isCompletingDownpayment
        ? paySummary.remainingDownpayment
        : payRecords.length > 0
          ? remainingBalance
          : paymentType === "full"
            ? totalPrice
            : downpaymentAmount;

    const remainingMs = getRemainingMs(booking);
    const isExpired = booking.status === "pending" && remainingMs <= 0;

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!isSupportedProofImage(file)) {
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

      setSelectedProofFile(file);
    };

    const submitSelectedPayment = async () => {
      if (isSubmitting) return;
      if (String(booking.paymentStatus || "").toLowerCase() === "for_review") {
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

        await submitPayment(booking.id, {
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
        setSelectedProofFile(null);
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
      if (String(booking.paymentStatus || "").toLowerCase() === "for_review") {
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
                    <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-black">
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
                          <span className="text-xs font-black uppercase tracking-[0.2em] text-black">
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

        <PaymentProofPreview
          open={proofPreviewOpen}
          onOpenChange={setProofPreviewOpen}
          proofUrl={proofPreviewUrl}
          fileName={proofFile?.name}
        />

        <Button
          variant="ghost"
          onClick={() => {
            setSelectedBookingToPay(null);
            setSelectedProofFile(null);
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
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-black">
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
                          accept="image/jpeg,image/jpg,image/png,image/webp"
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
                      <PaymentProofRow
                        proofUrl={proofPreviewUrl || ""}
                        fileName={proofFile.name}
                        onPreview={() => setProofPreviewOpen(true)}
                        onRemove={() => setSelectedProofFile(null)}
                      />
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
        <div className="mb-4 flex items-center justify-end">
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

      {/* Current Transactions (hidden when viewing history) */}
      {!showHistory && (
        <>
          <section>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <SectionHeader
                title="Current Transaction"
                subtitle="Active payment"
                icon={<CreditCard className="h-4 w-4" />}
              />
              <div className="relative w-full sm:ml-auto sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search payments..."
                  className="h-10 w-full rounded-xl border-slate-200 pl-9 pr-9 text-sm focus-visible:ring-2 focus-visible:ring-orange-500"
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
            </div>
            {currentTransaction ? (
              <div className="mt-3">
                <NotificationTargetWrapper
                  transactionTarget={currentTransaction.id}
                  isHighlighted={highlightedBookingId === currentTransaction.id}
                  storageKey="client_payment_highlight"
                >
                  <CurrentTransactionCard
                    booking={currentTransaction}
                    onPay={handlePay}
                    onSettle={handleSettle}
                    onView={handleView}
                    records={getRecordsForBooking(paymentRecords, currentTransaction)}
                    paymentCount={getRecordsForBooking(paymentRecords, currentTransaction).length}
                    latestPaymentStatus={getLatestPaymentStatus(paymentRecords, currentTransaction)}
                  />
                </NotificationTargetWrapper>
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
                  const otherPaymentRecords = getRecordsForBooking(paymentRecords, booking);
                  const otherPaymentSummary = calculatePaymentSummary(booking, otherPaymentRecords);
                  const otherPaymentStatus = otherPaymentRecords.length > 0
                    ? otherPaymentSummary.overallStatus
                    : String(booking.paymentStatus || "").toLowerCase();
                  return (
                    <NotificationTargetWrapper
                      key={booking.id}
                      transactionTarget={booking.id}
                      isHighlighted={highlightedBookingId === booking.id}
                      storageKey="client_payment_highlight"
                    >
                      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-orange-200 sm:flex-row sm:items-center sm:gap-3">
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
                              getStatusBadgeClass(otherPaymentStatus, booking.status, (booking as any).paymentStage, otherPaymentSummary.remainingBalance, booking),
                            )}
                          >
                            {getStatusLabel(otherPaymentStatus, booking.status, (booking as any).paymentStage, otherPaymentSummary.remainingBalance, booking)}
                          </span>
                          <div className="flex flex-col items-stretch gap-2 w-full sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-2">
                            {hasPaymentRecord(booking) && otherPaymentStatus !== "unpaid" && (
                              <Button
                                variant="outline"
                                onClick={() => handleView(booking)}
                                className="h-9 w-full shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:w-auto"
                              >
                                View Details
                              </Button>
                            )}
                            <PaymentActionButtons
                              booking={booking}
                              onPay={handlePay}
                              onSettle={handleSettle}
                              compact
                              records={otherPaymentRecords}
                              paymentCount={otherPaymentRecords.length}
                              latestPaymentStatus={getLatestPaymentStatus(paymentRecords, booking)}
                            />
                          </div>
                        </div>
                      </div>
                    </NotificationTargetWrapper>
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
          className={cn(
            "w-[95vw] max-h-[90dvh] overflow-hidden rounded-3xl bg-white shadow-2xl",
            isPaymentHistoryOpen && viewingReceiptHistory.length > 0
              ? "sm:max-w-[720px]"
              : "sm:max-w-[560px]",
          )}>
          <div className="flex max-h-[90dvh] min-h-0 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-slate-100 px-5 py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <DialogTitle className="text-2xl font-black text-slate-900">
                    Transaction Details
                  </DialogTitle>
                  <p className="mt-1 break-words text-sm font-black text-slate-900">
                    {viewingReceipt?.id}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setViewingReceipt(null)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-900 transition hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {viewingReceipt && (
              <Collapsible
                open={isPaymentHistoryOpen}
                onOpenChange={setIsPaymentHistoryOpen}
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                {viewingReceiptHistory.length > 0 && (
                  <div className="shrink-0 border-b border-slate-100 px-5 py-3">
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="outline"
                        className="h-11 w-full justify-between rounded-xl border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-200 dark:bg-white dark:hover:bg-slate-50 [&[data-state=open]>svg]:rotate-180"
                      >
                        Payment History ({viewingReceiptHistory.length})
                        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500 transition-transform" />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto sm:flex sm:overflow-hidden">
                  {viewingReceiptHistory.length > 0 && (
                    <CollapsibleContent className="border-b border-slate-100 p-5 sm:min-h-0 sm:w-72 sm:shrink-0 sm:overflow-y-auto sm:border-b-0 sm:border-r">
                      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-black">
                        Payment Receipts
                      </p>
                      <div className="space-y-1.5">
                        {viewingReceiptHistory.map((receipt, idx) => {
                          const isSelected =
                            selectedViewingReceipt?.paymentId === receipt.paymentId ||
                            (!!receipt.receiptNumber &&
                              selectedViewingReceipt?.receiptNumber ===
                                receipt.receiptNumber);
                          return (
                            <button
                              key={
                                receipt.paymentId ||
                                receipt.receiptNumber ||
                                `payment-${idx}`
                              }
                              type="button"
                              onClick={() =>
                                setViewingReceiptNo(
                                  isSelected
                                    ? null
                                    : receipt.paymentId || receipt.receiptNumber,
                                )
                              }
                              className={cn(
                                "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                                isSelected
                                  ? "border-orange-200 bg-orange-50 shadow-sm ring-1 ring-orange-200"
                                  : "border-slate-200 bg-white hover:bg-slate-50",
                              )}
                            >
                              <span className="min-w-0">
                                <span className="block text-xs font-black text-slate-900">
                                  Payment {receipt.paymentNumber || getReceiptPaymentNumber(receipt, viewingReceiptRecords)} —{" "}
                                  {formatMoney(
                                    getReceiptPaymentAmount(receipt),
                                  )}
                                </span>
                                <span className="mt-0.5 block text-[10px] font-semibold text-slate-500">
                                  {receipt.receipt
                                    ? Number(receipt.remainingBalance ?? 0) > 0
                                      ? `Remaining balance: ${formatMoney(Number(receipt.remainingBalance))}`
                                      : "Balance fully settled"
                                    : receipt.status || "Awaiting verification"}
                                </span>
                                <span className="mt-1 block truncate text-[10px] font-black uppercase tracking-[0.12em] text-orange-600">
                                  {receipt.receiptNumber || "No receipt record"}
                                </span>
                              </span>
                              {isSelected && (
                                <Check className="h-4 w-4 shrink-0 text-orange-600" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  )}
                  <div className="min-w-0 p-5 sm:min-h-0 sm:flex-1 sm:overflow-y-auto">
                    <p className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-black">
                      Payment Receipt
                    </p>
                    <ReceiptDetails
                      booking={viewingReceipt}
                      receipt={selectedViewingReceipt?.receipt || null}
                      proofUrl={
                        selectedViewingReceipt?.source === "payment"
                          ? String(selectedViewingReceipt.proofUrl || "")
                          : viewingReceiptHistory.length === 1
                            ? String(
                                selectedViewingReceipt?.proofUrl ||
                                  (viewingReceipt as any).proofUrl ||
                                  (viewingReceipt as any).paymentProof ||
                                  (viewingReceipt as any).proofOfPayment ||
                                  "",
                              )
                            : ""
                      }
                      proofFileName={selectedViewingReceipt?.fileName || ""}
                      receiptPresentation={selectedReceiptPresentation}
                      reviewNote={selectedViewingReceipt?.adminNote || selectedViewingReceipt?.rejectionReason || ""}
                      isCancelled={
                        String(viewingReceipt.status).toLowerCase() === "cancelled" ||
                        String(viewingReceipt.status).toLowerCase() === "declined"
                      }
                    />
                  </div>
                </div>
              </Collapsible>
            )}
            <div className="shrink-0 border-t border-slate-100 px-5 py-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setViewingReceipt(null)}
              >
                Close Window
              </Button>
            </div>
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
                  <NotificationTargetWrapper
                    key={booking.id}
                    transactionTarget={booking.id}
                    isHighlighted={highlightedBookingId === booking.id}
                    storageKey="client_payment_highlight"
                  >
                    <HistoryRow
                      booking={booking}
                      expanded={expandedBookingId === booking.id}
                      onToggle={() =>
                        setExpandedBookingId(
                          expandedBookingId === booking.id ? null : booking.id,
                        )
                      }
                      onView={handleView}
                      onPay={handlePay}
                      records={paymentRecords}
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
        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
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
        <p className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-black">
          +{payments.length - 3} more check payment records
        </p>
      )}
    </div>
  );
}

function ReceiptDetails({
  booking,
  receipt,
  proofUrl,
  proofFileName,
  receiptPresentation,
  reviewNote,
  isCancelled,
}: {
  booking: Booking;
  receipt: any;
  proofUrl?: string;
  proofFileName?: string;
  receiptPresentation: ReceiptPresentation | null;
  reviewNote?: string;
  isCancelled: boolean;
}) {
  const isOfficeRental = isOfficeRentalBooking(booking);
  const [proofPreviewOpen, setProofPreviewOpen] = useState(false);
  const hasImageProof = isPaymentProofImage(proofUrl);
  const proofLabel = proofFileName || "Payment proof";
  const proofContent = proofUrl && hasImageProof ? (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
      <PaymentProofRow
        proofUrl={proofUrl}
        fileName={proofLabel}
        onPreview={() => setProofPreviewOpen(true)}
      />
    </div>
  ) : null;
  const proofPreview = (
    <PaymentProofPreview
      open={proofPreviewOpen}
      onOpenChange={setProofPreviewOpen}
      proofUrl={proofUrl}
      fileName={proofLabel}
    />
  );

  const fallbackReceiptRecord: PaymentRecordLike | null = receipt
    ? {
        id: receipt.paymentId,
        paymentId: receipt.paymentId,
        paymentNumber: receipt.paymentNumber,
        receiptNumber: receipt.receiptNumber,
        paymentPurpose: receipt.paymentPurpose || receipt.paymentType,
        paymentMethod: receipt.paymentMethod,
        amount: receipt.amountPaid ?? receipt.paymentAmount ?? receipt.amount,
        paymentStatus: receipt.paymentStatus,
        submittedAt: receipt.paymentSubmittedAt || receipt.dateGenerated || receipt.dateIssued,
      }
    : null;
  const presentation = receiptPresentation || getReceiptPresentation(booking, [], fallbackReceiptRecord);
  const transaction = presentation.transaction;
  const paymentSummary = presentation.summary;
  const amountLabel = transaction.statusLabel === "Incomplete Payment"
    ? "Amount Received"
    : transaction.isVerified
      ? "Amount Paid"
      : "Amount Submitted";
  const contractTerm =
    receipt?.contractTerm || (booking as any).contractTerm || (booking as any).rentalTerm;
  const paymentType = transaction.paymentTypeLabel || "Booking Payment";
  const paymentMethod = getReceiptPaymentMethodLabel(
    transaction.paymentMethod || receipt?.paymentMethod || booking.paymentMethod,
  );
  const paymentStatus = transaction.statusLabel;
  const dateGenerated =
    transaction.paymentDate || receipt?.dateGenerated || receipt?.dateIssued || new Date().toISOString();

  const paperData: ReceiptPaperData = {
    fullName: receipt?.fullName || booking.userInfo?.name || "Client",
    email: booking.userInfo?.email || null,
    contactNumber: booking.userInfo?.phone || null,
    receiptNo: receipt?.receiptNumber || receipt?.receiptNo || "No Receipt Record",
    generatedAt: dateGenerated,
    bookingId: receipt?.bookingId || booking.id,
    eventType: isOfficeRental
      ? "Office Space Rental"
      : receipt?.eventType || (booking as any).eventType || "Event Venue Rental",
    venue: receipt?.venueReserved || receipt?.venue || booking.venue || "N/A",
    eventDate: receipt?.startDate || booking.date || "Not set",
    reservationTime: isOfficeRental ? "" : getBookingTime(booking),
    paymentMethod: paymentMethod,
    bankReference: transaction.bankReference || receipt?.bankReferenceNumber || booking.bankReferenceNumber || null,
    paymentTypeLabel: paymentType,
    paymentNumber: transaction.paymentNumber,
    paymentDate: transaction.paymentDate || dateGenerated,
    totalAmount: paymentSummary.totalBookingAmount,
    amountPaid: transaction.amount,
    amountLabel,
    remainingBalanceLabel: transaction.paymentType === "downpayment" ? "Remaining DP" : "Remaining Balance",
    remainingBalance: paymentSummary.remainingBalance,
    paymentStatus,
    isVerified: transaction.isVerified,
    isOfficeRental,
    contractTerm: contractTerm || null,
    paymentSummary: {
      ...paymentSummary,
      isDownpayment: transaction.paymentType === "downpayment",
    },
  };

  return (
    <div className="space-y-4">
      {!receipt && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
          <p className="text-sm font-black text-slate-900">No receipt record.</p>
          <p className="mt-1 text-xs font-bold text-slate-600">Transaction information is shown from the selected payment record.</p>
        </div>
      )}
      <ReceiptPaper {...paperData} beforeNotice={proofContent} />
      {reviewNote && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">
            Admin Note
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-amber-950">
            {reviewNote}
          </p>
        </div>
      )}
      {proofPreview}
    </div>
  );
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
