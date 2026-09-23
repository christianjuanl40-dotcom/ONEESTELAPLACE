"use client";

import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/src/modules/shared/hooks/use-toast";
import { useAuth } from "@/src/modules/shared/auth/auth-context";
import { perfListener, perfMark } from "@/src/modules/shared/lib/perf-trace";
import { db } from "@/lib/firebase"
import { createNotification } from "@/src/modules/shared/lib/notifications"
import { getAuthHeaders } from "@/src/modules/shared/lib/auth-token"
import { evaluateCancellationEligibility } from "@/src/modules/shared/lib/cancellation"
import {
  collection,
  doc,
  getDocs,
  writeBatch,
  query,
  orderBy,
  where,
  limit,
  onSnapshot,
  runTransaction,
} from "firebase/firestore"

export type BookingStatus =
  | "pending"
  | "verifying"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "declined"
  | "cancellation_requested"
  | "reservation_secured"
  | "modification_under_review"
  | "contract_signing_required"
  | "active_rental"
  | "rental_expired";

export type ModificationStatus =
  | "None"
  | "Under Review"
  | "Approved"
  | "Declined";

export type PaymentStatus =
  | "unpaid"
  | "cash_pending"
  | "for_review"
  | "partial"
  | "verified"
  | "paid"
  | "rejected"
  | "slot_pending"
  | "slot_verified"
  | "incomplete"
  | "fully paid"
  | "cancelled";

export type CancellationStatus =
  | "None"
  | "Pending"
  | "Under Review"
  | "Approved"
  | "Declined"
  | "requested"
  | "approved"
  | "declined"
  | "Cancellation Requested"
  | "Cancellation Approved"
  | "Cancellation Declined";

export type RefundStatus =
  | "Not Applicable"
  | "Pending Review"
  | "Refund Eligible"
  | "Non-Refundable"
  | "Refund Pending"
  | "Refund Ready for Claiming"
  | "Refund Claimed"
  | "Not Eligible for Refund"
  | "eligible"
  | "requested"
  | "refunded"
  | "not_eligible";

export type ContractStatus =
  | "Not Available"
  | "Pending Signature"
  | "Signed"
  | "Pending";

export type BookingStatusLabel =
  | "Pending Verification"
  | "Confirmed"
  | "Slot Secured"
  | "Cancellation Under Review"
  | "Modification Under Review"
  | "Cancelled"
  | "Completed"
  | "Contract Signing Required"
  | "Active Rental"
  | "Rental Expired";

export type OfficeRentalTerm = "6_months" | "1_year" | "2_years";

export type OfficeReservationStatus =
  | "unpaid"
  | "pending_verification"
  | "reservation_secured"
  | "rejected";

export type OfficeCheckPaymentStatus =
  | "Pending"
  | "Paid"
  | "Overdue"
  | "Verified";

export interface OfficeCheckPayment {
  id: string;
  billingPeriod: string;
  amountPaid: number;
  paymentType: "Check";
  checkNumber: string;
  dueDate: string;
  datePaid?: string;
  paymentStatus: OfficeCheckPaymentStatus;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export type OfficeLeaseStatus =
  | "Pending Review"
  | "Approved for Contract Signing"
  | "Contract Pending"
  | "Contract Signed"
  | "Advance/Deposit Paid"
  | "Cheques Submitted"
  | "Active Lease"
  | "Declined"
  | "Cancelled"
  | "Completed";

export interface AdminLog {
  action: string;
  message: string;
  createdAt: string;
}

export interface BookingReceipt {
  receiptNumber: string;
  bookingId: string;
  // Exact payment record this receipt belongs to (payments collection doc id).
  // One receipt per VERIFIED payment — never shared between payments.
  paymentId?: string;
  fullName: string;
  bookingDate: string;
  startDate: string;
  endDate: string;
  rentalType: string;
  bookingType: string;
  contractTerm?: string;
  paymentPurpose: string;
  paymentMethod: string;
  amountPaid: number;
  paymentAmount: number;
  remainingBalance?: number;
  paymentStatus: string;
  dateGenerated: string;
  dateIssued: string;
  paymentSubmittedAt?: string;
}

/**
 * Individual payment submission record. The server writes one document per
 * submission into the Firestore `payments` collection, so a single booking
 * can have multiple PaymentRecords (Payment 1, Payment 2, ...).
 */
export interface PaymentRecord {
  id: string;
  bookingId: string;
  bookingCode?: string;
  customerId?: string;
  customerName?: string;
  eventName?: string;
  venueName?: string;
  method?: string;
  paymentMethod?: string;
  term?: string;
  amount?: number;
  amountPaid?: number;
  // Original REQUESTED amount (e.g. the ₱7,500 downpayment target) preserved
  // when admin rewrites this record to the ACTUAL money received (₱5,500)
  // via Mark as Incomplete. Purely informational for history/UI.
  requestedAmount?: number;
  // Money the admin confirmed was ACTUALLY RECEIVED when marking this
  // payment INCOMPLETE (short payment). Never ACCEPTED money, but it is
  // credited toward completing the required downpayment so the client is
  // only asked for the true remainder.
  amountReceived?: number;
  referenceNo?: string;
  proofUrl?: string;
  status?: string;
  verificationStatus?: string;
  // receiptNumber of THIS payment's transaction receipt (created at
  // submission, updated in place by admin actions) — bidirectional link:
  // receipt.paymentId === payment.id && payment.receiptNumber === receipt.receiptNumber
  receiptNumber?: string;
  isRemainingDownPayment?: boolean;
  submittedAt?: string;
  updatedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  adminNote?: string;
  rejectionReason?: string;
}

export interface Booking {
  id: string;
  userId: string;
  venueId?: string;
  officeId?: string;
  spaceId?: string;
  venue?: string;
  eventName: string;
  eventType: string;
  guestCount: number;
  date: string;
  endDate?: string;
  time?: string;
  startTime: string;
  endTime: string;
  specialRequests?: string;
  status: BookingStatus;
  bookingStatus?: BookingStatusLabel;
  isSlotSecured?: boolean;
  createdAt: string;
  lastActivityAt?: string;
  updatedAt?: string;
  userInfo?: {
    name: string;
    email: string;
    phone: string;
  };

  cancellationRequested?: boolean;
  cancellationRequestedAt?: string;
  cancellationReviewedAt?: string;
  cancellationStatus?: CancellationStatus;
  cancellationStatusLabel?: string;
  cancellationReason?: string;
  cancellationDeclineReason?: string;
  cancellationDeclinedAt?: string;
  cancellationCooldownUntil?: string;
  previousStatus?: BookingStatus;
  previousBookingStatus?: BookingStatus;
  previousPaymentStatus?: PaymentStatus;

  modificationRequested?: boolean;
  modificationStatus?: ModificationStatus;
  modificationUnderReview?: boolean;
  modifyRequestStatus?: string;
  modificationReason?: string;
  modificationRequestedAt?: string;
  modificationReviewedAt?: string;
  modificationDeclineReason?: string;
  modificationReviewedBy?: string;
  requestedChanges?: Record<string, unknown>;
  originalBookingSnapshot?: Record<string, unknown>;
  modificationPreviousStatus?: BookingStatus;
  modificationPreviousBookingStatus?: BookingStatusLabel;

  refundEligible?: boolean;
  refundMethod?: "Cash";
  refundMode?: "Cash";
  refundStatus?: RefundStatus;
  refundEligibilityNote?: string;
  refundClaimNote?: string;
  daysBeforeEventAtCancellation?: number;
  refundReadyDate?: string;
  refundClaimedDate?: string;
  refundInstructions?: string;
  refundAmount?: number;
  refundRequestedAt?: string;
  refundedAt?: string;

  contractSigningRequired?: boolean;
  contractSigned?: boolean;
  contractSignedAt?: string;
  contractSignedDate?: string;
  contractSignedBy?: string;
  contractSigningMethod?: string;
  contractStatus?: ContractStatus;

  receiptIssued?: boolean;
  receiptNumber?: string;
  receiptIssuedAt?: string;
  receipt?: BookingReceipt;
  paymentReceipts?: BookingReceipt[];

  totalPrice: number;
  downPaymentPercentage?: number;
  downPaymentAmount?: number;
  bookingCategory?: "venue" | "office";
  isOfficeRental?: boolean;
  officeRentalTerm?: OfficeRentalTerm;
  monthlyRent?: number;
  officeReservationFee?: number;
  officeReservationStatus?: OfficeReservationStatus;
  officeContractSigningRequired?: boolean;
  officePaymentInstructions?: string;
  officePaymentTracker?: OfficeCheckPayment[];
  paymentType?: "full" | "downpayment" | "slot_reservation";
  paymentMethod?: "bank" | "cash";
  actualPaymentMethod?: string;
  hasActivePaymentSubmission?: boolean;
  paymentSubmissionType?: "bank_transfer" | "onsite";
  proofUrl?: string;
  bankReferenceNumber?: string;
  paymentReference?: string;
  paymentAmount?: number;
  pendingPaymentAmount?: number;
  paymentSubmittedAt?: string;
  paymentVerifiedAt?: string;
  paymentRejectedAt?: string;
  paymentRejectedReason?: string;
  paymentRejectionReason?: string;
  incompletePaymentNote?: string;
  incompletePaymentReason?: string;
  paymentStatus?: PaymentStatus;
  balanceStatus?: string;
  amountPaid?: number;
  lastPaymentAmount?: number;
  remainingBalance?: number;
  remainingBalancePaid?: boolean;
  verifiedByAdmin?: boolean;
  verifiedAt?: string;
  paymentReviewedAt?: string;
  paymentReviewedBy?: string;
  paymentVerifiedBy?: string;
  paymentVerifiedAmount?: number;
  manualPaymentMarked?: boolean;
  manualPaymentMarkedAt?: string;
  manualPaymentMarkedBy?: string;
  manualPaymentNote?: string;
  balanceReminderSent?: boolean;
  balanceReminderSentAt?: string;
  balanceReminderSentBy?: string;
  selectedDownpaymentAmount?: number;
  downpaymentPaid?: number;
  downpaymentRemaining?: number;
  paymentStage?: "Initial Payment" | "Complete Downpayment" | "Settle Remaining Balance" | "Fully Paid";
  adminLogs?: AdminLog[];
}

export interface OfficeRental {
  id: string;
  userId: string;
  clientName: string;
  contactInfo: {
    email?: string;
    phone?: string;
  };
  officeSpaceId: string;
  officeSpaceName: string;
  monthlyRent: number;
  rentalTerm: OfficeRentalTerm;
  advanceMonths: 1;
  depositMonths: 2;
  advanceAmount: number;
  depositAmount: number;
  totalInitialPayment: number;
  contractStatus: ContractStatus;
  contractSigned: boolean;
  contractSignedDate?: string;
  advanceDepositPaid: boolean;
  advanceDepositPaidDate?: string;
  paymentMethodInitial: "Cash";
  monthlyPaymentMethod: "Cheque";
  chequeSubmissionMethod: "Face-to-face only";
  requiredChequeCount: number;
  submittedChequeCount: number;
  chequesSubmitted: boolean;
  chequeSubmittedDate?: string;
  chequeReceivedByAdmin?: string;
  chequeNotes?: string;
  chequeStatus: "Pending" | "Partial" | "Complete";
  leaseStatus: OfficeLeaseStatus;
  declineReason?: string;
  adminLogs?: AdminLog[];
  createdAt: string;
  updatedAt?: string;
}

export interface MaintenanceRecord {
  id: string;
  type: "venue" | "office";
  spaceId: string;
  spaceName: string;
  date: string;
  startDate?: string;
  endDate?: string;
  reason?: string;
  status: "Active";
  createdAt: string;
  updatedAt: string;
}

interface BookingContextType {
  bookings: Booking[];
  officeRentals: OfficeRental[];
  maintenanceDates: string[];
  maintenanceRecords: MaintenanceRecord[];
  paymentRecords: PaymentRecord[];
  isLoading: boolean;
  _registerDataNeed: (key: BookingDataKey, now: boolean) => void;

  addBooking: (booking: Omit<Booking, "id" | "createdAt">) => Promise<string>;
  updateBookingStatus: (id: string, status: BookingStatus) => Promise<Booking | null>;
  cancelBooking: (id: string) => Promise<Booking | null>;
  getUserBookings: (userId: string) => Booking[];
  getBookingById: (id: string) => Booking | undefined;
  modifyBooking: (id: string, updates: Partial<Booking>) => Promise<Booking>;

  requestCancellation: (id: string, reason: string) => Promise<Booking>;
  approveCancellation: (id: string) => Promise<Booking>;
  declineCancellation: (id: string, reason: string) => Promise<Booking>;
  rejectCancellation: (id: string, reason?: string) => Promise<Booking>;
  requestModification: (id: string, changes: Record<string, unknown>, reason: string) => Promise<Booking>;
  approveModification: (id: string) => Promise<Booking>;
  declineModification: (id: string, reason: string) => Promise<Booking>;
  requestRefund: (id: string) => Promise<void>;
  markAsRefunded: (id: string) => Promise<void>;

  markContractSigned: (id: string, signedBy?: string) => Promise<Booking>;
  issueReceipt: (id: string) => Promise<Booking>;
  sendBalanceReminder: (id: string) => Promise<Booking>;

  manualRecordOnsitePayment: (id: string, paymentData: {
    paymentType: "downpayment" | "remaining_balance" | "full_payment";
    amountReceived: number;
    adminNote?: string;
    adminName?: string;
  }) => Promise<Booking | null>;
  reviewPayment: (id: string, reviewData?: { verifiedAmount?: number; adminNote?: string; adminName?: string; paymentRecordId?: string }) => Promise<{ booking: Booking; payment: PaymentRecord }>;
  rejectPayment: (id: string, reason?: string, adminName?: string, paymentRecordId?: string) => Promise<{ booking: Booking; payment: PaymentRecord }>;
  markIncompletePayment: (id: string, data: { verifiedAmount: number; adminNote: string; adminName?: string; paymentRecordId?: string }) => Promise<{ booking: Booking; payment: PaymentRecord }>;
  toggleMaintenanceDate: (date: string, venueId: string) => void;
  addMaintenanceRecord: (record: Omit<MaintenanceRecord, "id" | "createdAt" | "updatedAt">) => void;
  removeMaintenanceRecord: (id: string) => void;
  submitPayment: (
    id: string,
    paymentData: {
      type: "full" | "downpayment" | "slot_reservation";
      method: "bank" | "cash";
      proof?: string;
      bankReferenceNumber?: string;
      amount?: number;
    },
  ) => Promise<void>;

  addOfficeRentalRequest: (
    rentalData: Omit<
      OfficeRental,
      | "id"
      | "createdAt"
      | "updatedAt"
      | "advanceMonths"
      | "depositMonths"
      | "advanceAmount"
      | "depositAmount"
      | "totalInitialPayment"
      | "contractStatus"
      | "contractSigned"
      | "advanceDepositPaid"
      | "paymentMethodInitial"
      | "monthlyPaymentMethod"
      | "chequeSubmissionMethod"
      | "requiredChequeCount"
      | "submittedChequeCount"
      | "chequesSubmitted"
      | "chequeStatus"
      | "leaseStatus"
    >,
  ) => Promise<string>;
  getUserOfficeRentals: (userId: string) => OfficeRental[];
  approveOfficeRentalForContractSigning: (id: string) => void;
  declineOfficeRental: (id: string, reason: string) => void;
  markOfficeContractSigned: (id: string) => void;
  markOfficeAdvanceDepositPaid: (id: string) => void;
  updateOfficeChequeSubmission: (
    id: string,
    submittedChequeCount: number,
    notes?: string,
    receivedByAdmin?: string,
  ) => void;
  activateOfficeLease: (id: string) => void;
  cancelOfficeRental: (id: string) => void;
  completeOfficeRental: (id: string) => void;
}

const BookingContext = createContext<BookingContextType | undefined>(undefined);

// Page-scoped data opt-in keys. Listeners only start while at least one
// mounted component needs the dataset (minimal global Firestore work).
export type BookingDataKey = "bookings" | "officeRentals" | "maintenance" | "payments";
export type BookingDataNeeds = Partial<Record<BookingDataKey, boolean>>;
const DATA_KEYS: BookingDataKey[] = ["bookings", "officeRentals", "maintenance", "payments"];

const DEFAULT_TOTAL_PRICE = 15000;
const REFUND_ELIGIBLE_DAYS = 14;
const CANCELLATION_CLOSED_DAYS = 7;

const bookingsRef = collection(db, "bookings")
const officeRentalsRef = collection(db, "officeRentals")
const maintenanceRecordsRef = collection(db, "maintenanceRecords")
const paymentsRef = collection(db, "payments")
const cmsDocRef = doc(db, "cms", "data")

function formatBookingNumber(num: number): string {
  return num < 10 ? `BK0${num}` : `BK${num}`
}

async function getNextBookingNumber(): Promise<string> {
  const nextNum = await runTransaction(db, async (transaction) => {
    const counterDoc = await transaction.get(cmsDocRef)
    const raw = counterDoc.exists() ? counterDoc.data().bookingCounter : undefined
    const current = typeof raw === "number" && Number.isFinite(raw) ? raw : 0
    const next = current + 1
    transaction.set(cmsDocRef, { bookingCounter: next }, { merge: true })
    return next
  })
  return formatBookingNumber(nextNum)
}

function stripHeavyBookingFields(booking: any) {
  const {
    proofUrl,
    proofImage,
    proofDataUrl,
    paymentProof,
    proofOfPayment,
    receiptImage,
    uploadedProof,
    bankProof,
    imageData,
    base64,
    file,
    fileData,
    payment,
    ...safeBooking
  } = booking
  return safeBooking as any
}

function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefinedDeep);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      result[key] = stripUndefinedDeep(entry);
    }
    return result;
  }
  return value;
}

function getSafePrice(value: unknown) {
  if (typeof value === "number") return value;

  const cleanedValue = String(value || DEFAULT_TOTAL_PRICE).replace(
    /[^\d.]/g,
    "",
  );
  return Number(cleanedValue) || DEFAULT_TOTAL_PRICE;
}

function parseLocalDate(dateValue?: string) {
  if (!dateValue) return null;

  const normalized = String(dateValue).trim();
  const directDate = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? new Date(`${normalized}T00:00:00`)
    : new Date(normalized);

  if (Number.isNaN(directDate.getTime())) return null;

  directDate.setHours(0, 0, 0, 0);
  return directDate;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function calculateDaysBeforeEvent(eventDate?: string) {
  const selected = parseLocalDate(eventDate);
  if (!selected) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diff = selected.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function isCancellationAllowed(eventDate?: string) {
  return calculateDaysBeforeEvent(eventDate) > CANCELLATION_CLOSED_DAYS;
}

export function isRefundEligible(eventDate?: string) {
  return calculateDaysBeforeEvent(eventDate) >= REFUND_ELIGIBLE_DAYS;
}

export function getCancellationMessage(eventDate?: string) {
  const daysBefore = calculateDaysBeforeEvent(eventDate);

  if (daysBefore <= CANCELLATION_CLOSED_DAYS) {
    return "Cancellation is no longer available because your event is within 7 days.";
  }

  if (daysBefore >= REFUND_ELIGIBLE_DAYS) {
    return "Your booking is eligible for cash refund. Refund can be claimed at One Estela Place office after 1 week.";
  }

  return "Cancellation is available, but this booking is not eligible for refund.";
}

export function getRefundStatusLabel(status?: RefundStatus) {
  if (!status) return "No Refund Status";
  return status;
}

export function canShowCancellationNotice(booking: Partial<Booking>): boolean {
  if (!booking) return false;
  if (booking.status === "cancelled" || booking.status === "completed") return false;
  if (
    booking.cancellationRequested === true ||
    ["under review", "pending", "requested"].includes(
      String(booking.cancellationStatus || "").trim().toLowerCase(),
    ) ||
    String((booking as any).cancelRequestStatus || "").trim().toLowerCase() === "pending"
  ) return false;
  const paymentStatus = String(booking.paymentStatus || "").toLowerCase();
  const isPaymentPending = paymentStatus === "unpaid" || paymentStatus === "pending" || !paymentStatus;
  const isForVerification = paymentStatus === "for_review" || paymentStatus === "cash_pending" || paymentStatus === "slot_pending" || paymentStatus === "pending_verification";
  const isRejected = paymentStatus === "rejected";
  if (isPaymentPending || isForVerification || isRejected) return false;
  if (!booking.isSlotSecured && !booking.verifiedByAdmin) return false;
  return true;
}

export function canRequestCancellation(booking: Partial<Booking>): boolean {
  if (!booking) return false;
  return evaluateCancellationEligibility(booking as Record<string, unknown>).allowed;
}

function getDisplayBookingStatus(booking: Partial<Booking>): BookingStatusLabel {
  if (booking.status === "completed") return "Completed"
  if (booking.status === "cancelled") return "Cancelled"
  if (booking.status === "cancellation_requested") return "Cancellation Under Review"
  if (booking.status === "modification_under_review") return "Modification Under Review"
  if (booking.status === "reservation_secured") return "Slot Secured"
  if (booking.status === "confirmed") return isOfficeBooking(booking as Booking) ? "Slot Secured" : "Confirmed"
  if (booking.status === "contract_signing_required") return "Contract Signing Required"
  if (booking.status === "active_rental") return "Active Rental"
  if (booking.status === "rental_expired") return "Rental Expired"
  return "Pending Verification"
}

function isBookingSlotSecured(booking: Partial<Booking>) {
  return Boolean(
    booking.isSlotSecured ||
      booking.verifiedByAdmin ||
      booking.status === "confirmed" ||
      booking.status === "completed" ||
      booking.status === "reservation_secured" ||
      booking.paymentStatus === "paid" ||
      booking.paymentStatus === "verified" ||
      booking.paymentStatus === "partial" ||
      booking.paymentStatus === "slot_verified",
  )
}

export function getRefundEligibilityNote(eventDate?: string) {
  const daysBefore = calculateDaysBeforeEvent(eventDate)
  if (daysBefore >= REFUND_ELIGIBLE_DAYS) return "May be eligible for refund"
  if (daysBefore <= CANCELLATION_CLOSED_DAYS) return "Non-refundable based on policy"
  return "Admin review required based on cancellation policy"
}


function makeAdminLog(
  booking: { adminLogs?: AdminLog[] },
  action: string,
  message: string,
) {
  return [
    ...(booking.adminLogs || []),
    {
      action,
      message,
      createdAt: new Date().toISOString(),
    },
  ];
}

function isOfficeBooking(booking: Partial<Booking>) {
  return (
    booking.isOfficeRental === true ||
    booking.bookingCategory === "office" ||
    String(booking.venue || "")
      .toLowerCase()
      .includes("office")
  );
}

function getRequiredChequeCount(term: OfficeRentalTerm) {
  if (term === "6_months") return 6;
  if (term === "1_year") return 12;
  return 24;
}

function getRentalTermLabel(term: OfficeRentalTerm) {
  if (term === "6_months") return "6 months";
  if (term === "1_year") return "1 year";
  return "2 years";
}

export function calculateOfficeEndDate(startDate: string, term?: OfficeRentalTerm) {
  if (!startDate || !term) return "";
  const date = new Date(startDate + "T00:00:00");
  if (Number.isNaN(date.getTime())) return "";

  if (term === "6_months") {
    date.setMonth(date.getMonth() + 6);
  } else if (term === "1_year") {
    date.setFullYear(date.getFullYear() + 1);
  } else if (term === "2_years") {
    date.setFullYear(date.getFullYear() + 2);
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeBookingForNewFields(booking: Booking): Booking {
  const officeBooking = isOfficeBooking(booking);
  const savedReceipt = booking.receipt;
  const paymentReceipts =
    (
      Array.isArray((booking as any).paymentReceipts) && (booking as any).paymentReceipts.length > 0
        ? ((booking as any).paymentReceipts as BookingReceipt[])
        : savedReceipt
          ? [savedReceipt]
          : []
    ).map((receiptEntry) => stripUndefinedDeep(receiptEntry) as BookingReceipt);
  const latestReceipt = paymentReceipts[paymentReceipts.length - 1] || savedReceipt || null;
  const computedEndDate = officeBooking
    ? calculateOfficeEndDate(booking.date, booking.officeRentalTerm)
    : "";

  const normalized: Booking = {
    ...booking,
    endDate: booking.endDate || computedEndDate,
    selectedDownpaymentAmount: booking.selectedDownpaymentAmount ?? 0,
    downpaymentPaid: booking.downpaymentPaid ?? 0,
    downpaymentRemaining: booking.downpaymentRemaining ?? 0,
    paymentStage: booking.paymentStage ?? "Initial Payment",
    receipt: (latestReceipt || null) as unknown as BookingReceipt | undefined,
    paymentReceipts,
    receiptIssued: booking.receiptIssued ?? Boolean(latestReceipt),
    receiptNumber: booking.receiptNumber || latestReceipt?.receiptNumber,
    receiptIssuedAt: booking.receiptIssuedAt || latestReceipt?.dateGenerated || latestReceipt?.dateIssued,
    contractSigningRequired: booking.contractSigningRequired ?? true,
    contractSigned: booking.contractSigned ?? false,
    contractSignedAt: booking.contractSignedAt,
    contractStatus: (() => {
      if (booking.contractStatus === "Signed" || booking.contractSigned) return "Signed" as ContractStatus;
      if (booking.contractStatus === "Pending Signature") return "Pending Signature" as ContractStatus;
      if (booking.contractStatus === "Pending") {
        const ps = String(booking.paymentStatus || "").toLowerCase();
        const isVerified =
          ps === "verified" || ps === "paid" || ps === "slot_verified" || ps === "partial" ||
          booking.isSlotSecured === true || booking.verifiedByAdmin === true;
        return isVerified ? ("Pending Signature" as ContractStatus) : ("Not Available" as ContractStatus);
      }
      const ps = String(booking.paymentStatus || "").toLowerCase();
      const isVerified =
        ps === "verified" || ps === "paid" || ps === "slot_verified" || ps === "partial" ||
        booking.isSlotSecured === true || booking.verifiedByAdmin === true;
      return isVerified ? ("Pending Signature" as ContractStatus) : ("Not Available" as ContractStatus);
    })(),
    refundEligible: booking.refundEligible ?? false,
    refundAmount: booking.refundAmount,
    refundRequestedAt: booking.refundRequestedAt,
    refundedAt: booking.refundedAt,
    bookingCategory:
      booking.bookingCategory || (officeBooking ? "office" : "venue"),
    isOfficeRental: booking.isOfficeRental ?? officeBooking,
    officeRentalTerm:
      (booking.officeRentalTerm || (officeBooking ? "6_months" : "")) as OfficeRentalTerm,
    monthlyRent:
      booking.monthlyRent ||
      (officeBooking ? getSafePrice(booking.totalPrice) : 0),
    officeReservationFee:
      booking.officeReservationFee ||
      (officeBooking ? getSafePrice(booking.totalPrice) : 0),
    officeReservationStatus:
      (booking.officeReservationStatus ||
      (officeBooking
        ? booking.status === "reservation_secured"
          ? "reservation_secured"
          : booking.status === "verifying" ||
              booking.paymentStatus === "for_review" ||
              booking.paymentStatus === "cash_pending"
            ? "pending_verification"
            : "unpaid"
        : "")) as OfficeReservationStatus,
    officeContractSigningRequired:
      booking.officeContractSigningRequired ?? officeBooking,
    officePaymentInstructions:
      booking.officePaymentInstructions ||
      (officeBooking
        ? "After the reservation slot is secured, succeeding office rental payments are settled onsite via check and recorded by admin."
        : ""),
    officePaymentTracker: booking.officePaymentTracker || [],
    bookingStatus: booking.bookingStatus || getDisplayBookingStatus(booking),
    isSlotSecured: booking.isSlotSecured ?? isBookingSlotSecured(booking),
    cancellationStatus: booking.cancellationStatus || "None",
    modificationRequested: booking.modificationRequested ?? false,
    modificationStatus: booking.modificationStatus || "None",
    refundStatus: booking.refundStatus || "Not Applicable",
    refundEligibilityNote:
      booking.refundEligibilityNote ||
      (booking.cancellationRequested ? getRefundEligibilityNote(booking.date) : ""),
    refundMode: booking.refundMode || booking.refundMethod,
    refundClaimNote: booking.refundClaimNote || booking.refundInstructions,
  };

  if (
    normalized.status === "confirmed" &&
    normalized.paymentStatus === "unpaid" &&
    !normalized.isSlotSecured
  ) {
    normalized.status = "pending";
    normalized.bookingStatus = getDisplayBookingStatus(normalized);
  }

  if (isOfficeBooking(normalized)) {
    if (
      normalized.status === "reservation_secured" &&
      !normalized.contractSigned
    ) {
      normalized.status = "contract_signing_required";
      normalized.contractSigningRequired = true;
      normalized.bookingStatus = getDisplayBookingStatus(normalized);
    }

    if (
      normalized.status === "active_rental" &&
      normalized.endDate &&
      new Date() > new Date(normalized.endDate + "T23:59:59")
    ) {
      normalized.status = "rental_expired";
      normalized.bookingStatus = getDisplayBookingStatus(normalized);
    }
  }

  for (const key of Object.keys(normalized)) {
    if ((normalized as any)[key] === undefined) {
      (normalized as any)[key] = null;
    }
  }
  return normalized;
}

export function BookingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const currentUserRole = user?.role;
  const hasCurrentUser = Boolean(user);
  const canViewDashboard = user?.permissions?.dashboard === true;
  const canManageBookings = user?.permissions?.bookings === true;
  const canViewReports = user?.permissions?.reports === true;
  const canManagePayments = user?.permissions?.payments === true;
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [officeRentals, setOfficeRentals] = useState<OfficeRental[]>([]);
  const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceRecord[]>([]);
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataNeedCounts, setDataNeedCounts] = useState<Record<BookingDataKey, number>>({
    bookings: 0,
    officeRentals: 0,
    maintenance: 0,
    payments: 0,
  });

  const registerDataNeed = useCallback((key: BookingDataKey, now: boolean) => {
    // NOTE: Always applied (no early-return on same value) because React
    // StrictMode double-invokes effects in dev: mount → cleanup → mount.
    // A `now === before` guard would let the cleanup's decrement win, dropping
    // the need count to 0 and permanently preventing listeners from starting.
    setDataNeedCounts((current) => ({
      ...current,
      [key]: Math.max(0, current[key] + (now ? 1 : -1)),
    }));
  }, []);

  const activeNeeds = useMemo(() => {
    return {
      bookings: dataNeedCounts.bookings > 0,
      officeRentals: dataNeedCounts.officeRentals > 0,
      maintenance: dataNeedCounts.maintenance > 0,
      payments: dataNeedCounts.payments > 0,
    };
  }, [dataNeedCounts]);
  const activeKey = `${activeNeeds.bookings ? 1 : 0}${activeNeeds.officeRentals ? 1 : 0}${activeNeeds.maintenance ? 1 : 0}${activeNeeds.payments ? 1 : 0}`;
  function formatLocalDate(d: Date): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
  }

  const maintenanceDates = useMemo(() => {
    const result: string[] = []
    const today = formatLocalDate(new Date())
    for (const r of maintenanceRecords) {
      if (r.date && r.date >= today) result.push(`${r.spaceId}|${r.date}`)
      if (r.startDate && r.endDate) {
        const start = new Date(r.startDate + "T00:00:00")
        const end = new Date(r.endDate + "T00:00:00")
        const current = new Date(start)
        while (current <= end) {
          const dateStr = formatLocalDate(current)
          if (dateStr >= today) result.push(`${r.spaceId}|${dateStr}`)
          current.setDate(current.getDate() + 1)
        }
      }
    }
    return result
  }, [maintenanceRecords]);
  const { toast } = useToast();

  useEffect(() => {
    setBookings([]);
    setOfficeRentals([]);
    setMaintenanceRecords([]);
    setPaymentRecords([]);
    setIsLoading(hasCurrentUser);
  }, [
    currentUserId,
    currentUserRole,
    hasCurrentUser,
    canViewDashboard,
    canManageBookings,
    canViewReports,
    canManagePayments,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasCurrentUser) {
      console.log(
        "[DEBUG][BOOKING PROVIDER] effect early-return — window:",
        typeof window,
        "user:",
        currentUserId ? `uid=${currentUserId} role=${currentUserRole}` : "null",
      )
      setIsLoading(false);
      return;
    }
    // Only start listeners for datasets that mounted components actually need
    // (page-scoped data requests). Nothing registered = zero Firestore work.
    if (activeKey === "0000") {
      console.log("[DEBUG][BOOKING PROVIDER] activeKey=0000 — NO listeners started (no page requested data)")
      setIsLoading(false);
      return;
    }

    if (!currentUserId || !currentUserRole) return;
    const uid = currentUserId;
    const bookingAdminScope = currentUserRole === "admin" || (
      currentUserRole === "staff" &&
      (
        canViewDashboard
        || canManageBookings
        || canManagePayments
        || canViewReports
      )
    );
    const paymentAdminScope = currentUserRole === "admin" || (
      currentUserRole === "staff" && (
        canManagePayments
        || canViewReports
      )
    );
    const isAdminScope = bookingAdminScope || paymentAdminScope;
    console.log(
      `[DEBUG][BOOKING PROVIDER] effect running — uid=${uid} role=${currentUserRole} adminScope=${isAdminScope} activeKey=${activeKey} needs=${JSON.stringify(activeNeeds)}`,
    )

    let destroyed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubs: (() => void)[] = [];
    const loadedFlags = {
      bookings: !activeNeeds.bookings,
      office: !activeNeeds.officeRentals,
      maint: !activeNeeds.maintenance,
      payments: !activeNeeds.payments,
    };

    setIsLoading(true);

    function markLoaded(key: keyof typeof loadedFlags) {
      if (destroyed) return;
      loadedFlags[key] = true;
      if (loadedFlags.bookings && loadedFlags.office && loadedFlags.maint && loadedFlags.payments) {
        setIsLoading(false);
      }
    }

    // Generic real-time subscription factory with an automatic fallback for
    // missing composite indexes (failed-precondition), mirroring the
    // notification-context pattern. Keeps the real-time listeners while
    // scoping CLIENT queries to the signed-in user only.
    function startListener<T>(
      label: string,
      ref: any,
      buildConstraints: () => any[],
      buildFallbackConstraints: (() => any[] | null) | null,
      mapDoc: (docSnap: any) => T,
      setter: (items: T[]) => void,
      loadedKey: keyof typeof loadedFlags,
      // Optional extra docs (keyed by id) that Firestore ordered queries
      // exclude (e.g. records missing the orderBy field). They are merged
      // into EVERY snapshot so they can never silently disappear again.
      recoveredDocs?: Map<string, T>,
    ): () => void {
      const applyRecovered = (loaded: T[]): T[] => {
        if (!recoveredDocs || recoveredDocs.size === 0) return loaded
        const ids = new Set((loaded as any[]).map((item) => String((item as any).id)))
        const extras = [...recoveredDocs.values()].filter(
          (item) => !ids.has(String((item as any).id)),
        )
        return extras.length > 0 ? [...loaded, ...extras] : loaded
      }
      const start = (constraints: any[]) => {
        perfListener(label, "START")
        console.log(`[DEBUG][${label}] listener starting — collection: ${ref.path}, constraints: ${constraints.length}`)
        let firstSnapshot = true;
        return onSnapshot(
          query(ref, ...constraints),
          (snapshot) => {
            const loaded: T[] = [];
            snapshot.forEach((docSnap) => {
              try {
                loaded.push(mapDoc(docSnap));
              } catch (e) {
                console.error(`[DEBUG][${label}] TRANSFORM ERROR for doc ${docSnap.id}:`, e);
              }
            });
            console.log(
              `[DEBUG][${label}] snapshot received — firestore docs: ${snapshot.size}, transformed records: ${loaded.length}`,
              `doc IDs: ${snapshot.docs.slice(0, 5).map((d) => d.id).join(", ")}${snapshot.size > 5 ? ", …" : ""}`,
            )
            if (firstSnapshot) {
              firstSnapshot = false;
              perfListener(label, "FIRST_SNAPSHOT", loaded.length);
              // TEMP DEBUG: confirms the INDEXED query (not the fallback) succeeded.
              if (label === "Bookings") {
                console.log("[DEBUG][Bookings] INDEXED QUERY SUCCESS", { count: loaded.length });
              }
              if (label === "Payments") {
                console.log("[DEBUG][Payments] INDEXED QUERY SUCCESS", { count: loaded.length });
              }
            } else {
              perfListener(label, "SNAPSHOT", loaded.length);
            }
            if (label === "Bookings" || label === "Payments") {
              console.log(`[DEBUG][Client ${label}] SNAPSHOT UPDATE`, {
                scope: isAdminScope ? "admin" : "client",
                count: snapshot.size,
                changed: snapshot.docChanges().map((change) => ({
                  type: change.type,
                  id: change.doc.id,
                  data: change.doc.data(),
                })),
              });
            }
            setter(applyRecovered(loaded));
            markLoaded(loadedKey);
          },
          (error: any) => {
            perfListener(label, "ERROR");
            console.error(`[DEBUG][${label}] FIRESTORE ERROR — code: ${error?.code ?? "unknown"}, message: ${error?.message ?? "unknown"}`);
            if (error?.code === "failed-precondition") {
              console.error(`[DEBUG][${label}] QUERY REQUIRES INDEX (failed-precondition). Create the index from the link above.`);
            }
            if (error?.code === "permission-denied") {
              console.error(`[DEBUG][${label}] PERMISSION-DENIED — Firestore rules are blocking this read (${ref.path}). Check rules in Firebase Console.`);
            }
            // ALWAYS resolve this dataset's loading on error — a Firestore
            // failure must never leave the page on an infinite spinner.
            // If a fallback succeeds later, its snapshot updates state normally.
            markLoaded(loadedKey);
            if (!destroyed && error?.code === "failed-precondition" && buildFallbackConstraints) {
              const fallbackConstraints = buildFallbackConstraints();
              if (fallbackConstraints) {
                console.warn(`[${label}] Composite index missing — using fallback query (no orderBy).`, error.message);
                const fallbackUnsub = start(fallbackConstraints);
                unsubs.push(fallbackUnsub);
                if (retryTimer) clearTimeout(retryTimer);
                retryTimer = setTimeout(() => {
                  if (destroyed) return;
                  const index = unsubs.indexOf(fallbackUnsub);
                  if (index !== -1) unsubs.splice(index, 1);
                  fallbackUnsub();
                  unsubs.push(start(buildConstraints()));
                }, 60_000);
              }
            }
          },
        );
      };
      return start(buildConstraints());
    }

    // Real-time subscription for bookings.
    // Admin/Staff need system-wide data; Clients get only their own bookings.
    if (activeNeeds.bookings) {
      console.log("[Firestore Listener START] Bookings", bookingAdminScope ? "(admin scope)" : `(client: ${uid})`)
      console.log(
        `[DEBUG][Bookings] query — collection: bookings, where: ${bookingAdminScope ? "NONE (admin sees ALL)" : "userId == uid"}, orderBy: createdAt ${bookingAdminScope ? "asc" : "desc"}, limit: NONE`,
      )
      const unsubBookings = startListener(
        "Bookings",
        bookingsRef,
        () => (bookingAdminScope ? [orderBy("createdAt", "asc")] : [where("userId", "==", uid), orderBy("createdAt", "desc")]),
        () => (bookingAdminScope ? null : [where("userId", "==", uid)]),
        (docSnap) => normalizeBookingForNewFields({ ...(docSnap.data() as Booking), id: docSnap.id }),
        setBookings,
        "bookings",
      );
      unsubs.push(unsubBookings);
    }

    // Real-time subscription for office rentals (client-scoped for Clients).
    if (activeNeeds.officeRentals) {
      console.log("[Firestore Listener START] OfficeRentals", bookingAdminScope ? "(admin scope)" : `(client: ${uid})`)
      const unsubOffice = startListener(
        "OfficeRentals",
        officeRentalsRef,
        () => (bookingAdminScope ? [orderBy("createdAt", "asc")] : [where("userId", "==", uid), orderBy("createdAt", "desc")]),
        () => (bookingAdminScope ? null : [where("userId", "==", uid)]),
        (docSnap) => ({ ...(docSnap.data() as OfficeRental), id: docSnap.id }),
        setOfficeRentals,
        "office",
      );
      unsubs.push(unsubOffice);
    }

    // Real-time subscription for maintenance records (app-wide availability data).
    // Page-scoped: only pages that register the need subscribe. A high ceiling
    // (500) bounds the initial snapshot for this admin-created collection while
    // keeping all real availability data for the calendar/booking forms.
    if (activeNeeds.maintenance) {
      console.log("[Firestore Listener START] MaintenanceRecords")
      const unsubMaint = startListener(
        "MaintenanceRecords",
        maintenanceRecordsRef,
        () => [orderBy("createdAt", "asc"), limit(500)],
        null,
        (docSnap) => ({ ...(docSnap.data() as MaintenanceRecord), id: docSnap.id }),
        setMaintenanceRecords,
        "maint",
      );
      unsubs.push(unsubMaint);
    }

    // Real-time subscription for individual payment submissions (payments collection).
    // Each client submission is its own document, so Payment 1, Payment 2, ...
    // are preserved as separate records instead of overwriting each other.
    // Clients only receive their own submissions; Admin/Staff receive all.
    if (activeNeeds.payments) {
      console.log("[Firestore Listener START] Payments", paymentAdminScope ? "(admin scope)" : `(client: ${uid})`)
      // Ordered payment queries (orderBy submittedAt) silently EXCLUDE any
      // record whose doc lacks the submittedAt field — older payment records
      // written before that field existed vanish from BOTH admin and client
      // history, which then undercounts the accepted/verified total. One
      // unordered recovery read per scope re-includes those docs in every
      // snapshot; membership is still decided solely by bookingId/bookingCode.
      const recoveredPayments = new Map<string, PaymentRecord>()
      let lastLoadedPayments: PaymentRecord[] = []
      const setPaymentRecordsTracked = (items: PaymentRecord[]) => {
        lastLoadedPayments = items
        setPaymentRecords(items)
      }
      const mapPaymentDoc = (docSnap: any): PaymentRecord => {
        const d = docSnap.data();
        const submittedAt = d.submittedAt?.toDate?.()?.toISOString() || d.submittedAt || "";
        const updatedAt = d.updatedAt?.toDate?.()?.toISOString() || d.updatedAt || "";
        return {
          id: docSnap.id,
          bookingId: d.bookingId || "",
          bookingCode: d.bookingCode || "",
          customerId: d.customerId || "",
          customerName: d.customerName || "",
          eventName: d.eventName || "",
          venueName: d.venueName || "",
          method: d.method || "",
          paymentMethod: d.paymentMethod || "",
          term: d.term || "",
          amount:
            d.amount == null
              ? undefined
              : typeof d.amount === "number"
                ? d.amount
                : Number(d.amount || 0),
          amountPaid:
            d.amountPaid == null
              ? undefined
              : typeof d.amountPaid === "number"
                ? d.amountPaid
                : Number(d.amountPaid || 0),
          requestedAmount:
            d.requestedAmount == null
              ? undefined
              : typeof d.requestedAmount === "number"
                ? d.requestedAmount
                : Number(d.requestedAmount || 0),
          amountReceived:
            d.amountReceived == null
              ? undefined
              : typeof d.amountReceived === "number"
                ? d.amountReceived
                : Number(d.amountReceived || 0),
          referenceNo: d.referenceNo || "",
          proofUrl: d.proofUrl || "",
          status: d.status || "",
          verificationStatus: d.verificationStatus || "",
          receiptNumber: d.receiptNumber || "",
          isRemainingDownPayment: Boolean(d.isRemainingDownPayment),
          submittedAt,
          updatedAt,
          reviewedAt: d.reviewedAt?.toDate?.()?.toISOString() || d.reviewedAt || "",
          reviewedBy: d.reviewedBy || "",
          adminNote: d.adminNote || "",
          rejectionReason: d.rejectionReason || "",
        } as PaymentRecord;
      };
      getDocs(
        paymentAdminScope
          ? query(paymentsRef)
          : query(paymentsRef, where("customerId", "==", uid)),
      )
        .then((snapshot) => {
          if (destroyed) return
          snapshot.forEach((docSnap) => {
            try {
              const record = mapPaymentDoc(docSnap)
              recoveredPayments.set(record.id, record)
            } catch (e) {
              console.error("[DEBUG][Payments] RECOVERY TRANSFORM ERROR for doc:", e);
            }
          })
          if (recoveredPayments.size > 0) {
            console.log(
              `[DEBUG][Payments] recovery read — ${recoveredPayments.size} record(s) available for merge (ordered queries exclude docs without submittedAt)`,
            )
            // The first snapshot may already have arrived before this read
            // resolved — re-apply the merge immediately so recovered records
            // never wait for an unrelated write to become visible.
            const ids = new Set(lastLoadedPayments.map((record) => record.id))
            const extras = [...recoveredPayments.values()].filter(
              (record) => !ids.has(record.id),
            )
            if (extras.length > 0) {
              setPaymentRecords([...lastLoadedPayments, ...extras])
            }
          }
        })
        .catch((error) => {
          console.error("[DEBUG][Payments] recovery read failed:", error?.code || error?.message || error)
        })
      const unsubPayments = startListener(
      "Payments",
      paymentsRef,
      () => (paymentAdminScope ? [orderBy("submittedAt", "desc")] : [where("customerId", "==", uid), orderBy("submittedAt", "desc")]),
      () => (paymentAdminScope ? null : [where("customerId", "==", uid)]),
      mapPaymentDoc,
      setPaymentRecordsTracked,
      "payments",
      recoveredPayments,
    );
      unsubs.push(unsubPayments);
    }

    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (activeNeeds.bookings) perfListener("Bookings", "STOP")
      if (activeNeeds.officeRentals) perfListener("OfficeRentals", "STOP")
      if (activeNeeds.maintenance) perfListener("MaintenanceRecords", "STOP")
      if (activeNeeds.payments) perfListener("Payments", "STOP")
      unsubs.forEach((unsub) => unsub());
    }
  }, [
    currentUserId,
    currentUserRole,
    hasCurrentUser,
    canViewDashboard,
    canManageBookings,
    canViewReports,
    canManagePayments,
    activeNeeds,
    activeKey,
  ]);

  const saveOfficeRentals = (newOfficeRentals: OfficeRental[]) => {
    const prevMap = new Map(officeRentals.map(r => [r.id, r]))
    const nextMap = new Map(newOfficeRentals.map(r => [r.id, r]))

    setOfficeRentals(newOfficeRentals);

    const batch = writeBatch(db)
    for (const [id, next] of nextMap) {
      const prev = prevMap.get(id)
      if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
        const { id: _id, ...data } = next
        const sanitized = Object.fromEntries(
          Object.entries(data).filter(([, v]) => v !== undefined)
        )
        batch.set(doc(officeRentalsRef, id), { ...sanitized, updatedAt: new Date().toISOString() }, { merge: true })
      }
    }
    for (const id of prevMap.keys()) {
      if (!nextMap.has(id)) {
        batch.delete(doc(officeRentalsRef, id))
      }
    }
    batch.commit().catch(console.error)
  };

  const saveMaintenanceRecords = (newRecords: MaintenanceRecord[]) => {
    const prevMap = new Map(maintenanceRecords.map(r => [r.id, r]))
    const nextMap = new Map(newRecords.map(r => [r.id, r]))

    setMaintenanceRecords(newRecords);

    const batch = writeBatch(db)
    for (const [id, next] of nextMap) {
      const prev = prevMap.get(id)
      if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
        const { id: _id, ...data } = next
        const sanitized = Object.fromEntries(
          Object.entries(data).filter(([, v]) => v !== undefined)
        )
        batch.set(doc(maintenanceRecordsRef, id), { ...sanitized, updatedAt: new Date().toISOString() }, { merge: true })
      }
    }
    for (const id of prevMap.keys()) {
      if (!nextMap.has(id)) {
        batch.delete(doc(maintenanceRecordsRef, id))
      }
    }
    batch.commit().catch(console.error)
  };

  const addBooking = async (bookingData: Omit<Booking, "id" | "createdAt">) => {
    if (!user || user.role !== "client") {
      throw new Error("Only signed-in clients can create bookings.")
    }

    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: await getAuthHeaders(true),
      body: JSON.stringify(bookingData),
    })
    const responseBody = await response.json().catch(() => null) as {
      id?: unknown
      booking?: unknown
      error?: unknown
    } | null
    if (!response.ok) {
      throw new Error(
        responseBody && typeof responseBody.error === "string"
          ? responseBody.error
          : "Unable to create the booking.",
      )
    }

    const newId = typeof responseBody?.id === "string" ? responseBody.id : ""
    const newBooking = responseBody?.booking as Booking | undefined
    if (!newId || !newBooking) throw new Error("The booking server returned an invalid response.")

    setBookings((current) => (
      current.some((booking) => booking.id === newId) ? current : [...current, newBooking]
    ))
    return newId;
  };

  const callLifecycleApi = async (
    id: string,
    action: "complete" | "status" | "contract_signed" | "balance_reminder" | "issue_receipt" | "expire",
    extra: Record<string, string> = {},
  ): Promise<Booking> => {
    const response = await fetch("/api/bookings/lifecycle", {
      method: "POST",
      headers: await getAuthHeaders(true),
      body: JSON.stringify({ bookingId: id, action, ...extra }),
    })
    const responseBody = await response.json().catch(() => null) as {
      error?: unknown
      booking?: unknown
    } | null
    if (!response.ok) {
      throw new Error(
        responseBody && typeof responseBody.error === "string"
          ? responseBody.error
          : "Unable to update the booking.",
      )
    }
    const currentBooking = bookings.find((booking) => booking.id === id)
    const serverBooking = responseBody?.booking as Partial<Booking> | undefined
    if (!currentBooking || !serverBooking) {
      throw new Error("The booking server returned an invalid lifecycle response.")
    }
    const updatedBooking = normalizeBookingForNewFields({
      ...currentBooking,
      ...serverBooking,
      id,
    })
    setBookings((current) => current.map((booking) => (
      booking.id === id ? updatedBooking : booking
    )))
    return updatedBooking
  }

  const updateBookingStatus = async (id: string, status: BookingStatus): Promise<Booking | null> => {
    if (!(status === "completed" || status === "confirmed" || status === "reservation_secured")) {
      throw new Error("This booking status must be updated through its dedicated workflow.")
    }
    try {
      return await callLifecycleApi(
        id,
        status === "completed" ? "complete" : "status",
        status === "completed" ? {} : { status },
      )
    } catch (error) {
      toast({
        title: "Booking Status Update Failed",
        description: error instanceof Error ? error.message : "Unable to update the booking status.",
        variant: "destructive",
      })
      return null
    }
  }

  const cancelBooking = async (id: string): Promise<Booking | null> => {
    try {
      return await callLifecycleApi(id, "expire")
    } catch (error) {
      console.error("[Booking:cancelBooking] automatic expiry failed:", error)
      return null
    }
  }

  const applyRefundResponse = (id: string, responseBody: unknown): Booking => {
    const targetBooking = bookings.find((booking) => booking.id === id)
    if (!targetBooking) throw new Error("Booking not found.")
    const serverBooking = (
      responseBody &&
      typeof responseBody === "object" &&
      "booking" in responseBody &&
      responseBody.booking &&
      typeof responseBody.booking === "object"
        ? responseBody.booking
        : null
    ) as Partial<Booking> | null
    if (!serverBooking) throw new Error("The refund server returned an invalid response.")

    const updatedBooking = normalizeBookingForNewFields({
      ...targetBooking,
      ...serverBooking,
      id,
    })
    setBookings((current) => current.map((booking) => (
      booking.id === id ? updatedBooking : booking
    )))
    return updatedBooking
  }

  const callRefundApi = async (id: string, action: "request" | "complete"): Promise<Booking> => {
    const response = await fetch("/api/bookings/refund", {
      method: "POST",
      headers: await getAuthHeaders(true),
      body: JSON.stringify({ bookingId: id, action }),
    })
    const responseBody = await response.json().catch(() => null) as {
      error?: unknown
      booking?: unknown
    } | null
    if (!response.ok) {
      throw new Error(
        responseBody && typeof responseBody.error === "string"
          ? responseBody.error
          : "Unable to update the refund.",
      )
    }
    return applyRefundResponse(id, responseBody)
  }

  const requestRefund = async (id: string): Promise<void> => {
    try {
      await callRefundApi(id, "request")
      toast({
        title: "Refund Requested",
        description: "Please visit the One Estela Place Management Office within 7 days with your Official Receipt and Valid Government-issued ID to claim your refund.",
      })
    } catch (error) {
      toast({
        title: "Refund Request Failed",
        description: error instanceof Error ? error.message : "Unable to request the refund.",
        variant: "destructive",
      })
    }
  }

  const markAsRefunded = async (id: string): Promise<void> => {
    try {
      await callRefundApi(id, "complete")
      toast({
        title: "Refund Completed",
        description: `Booking ${id} has been marked as refunded.`,
      })
    } catch (error) {
      toast({
        title: "Refund Completion Failed",
        description: error instanceof Error ? error.message : "Unable to complete the refund.",
        variant: "destructive",
      })
    }
  }

  const getUserBookings = useCallback((userId: string) => {
    return bookings.filter((booking) => booking.userId === userId);
  }, [bookings]);

  const getBookingById = useCallback((id: string) => {
    return bookings.find((booking) => booking.id === id);
  }, [bookings]);

  const applyCancellationResponse = (id: string, responseBody: unknown): Booking => {
    const targetBooking = bookings.find((booking) => booking.id === id)
    if (!targetBooking) throw new Error("Booking not found.")

    const serverBooking = (
      responseBody &&
      typeof responseBody === "object" &&
      "booking" in responseBody &&
      responseBody.booking &&
      typeof responseBody.booking === "object"
        ? responseBody.booking
        : null
    ) as Partial<Booking> | null
    if (!serverBooking) throw new Error("The cancellation server returned an invalid response.")

    const updatedBooking = normalizeBookingForNewFields({
      ...targetBooking,
      ...serverBooking,
      id,
    })
    setBookings((current) => current.map((booking) => (booking.id === id ? updatedBooking : booking)))
    return updatedBooking
  }

  const callCancellationApi = async (
    id: string,
    body: Record<string, string>,
  ): Promise<Booking> => {
    const response = await fetch("/api/bookings/cancellation", {
      method: body.action ? "PATCH" : "POST",
      headers: await getAuthHeaders(true),
      body: JSON.stringify({ bookingId: id, ...body }),
    })
    const responseBody = await response.json().catch(() => null) as {
      error?: unknown
      booking?: unknown
    } | null
    if (!response.ok) {
      throw new Error(
        responseBody && typeof responseBody.error === "string"
          ? responseBody.error
          : "Unable to update the cancellation request.",
      )
    }
    return applyCancellationResponse(id, responseBody)
  }

  const requestCancellation = async (id: string, reason: string): Promise<Booking> => {
    if (!user || user.role !== "client") throw new Error("Only signed-in clients can request cancellation.")
    return callCancellationApi(id, { reason })
  }

  const approveCancellation = async (id: string): Promise<Booking> => {
    return callCancellationApi(id, { action: "approve" })
  }

  const declineCancellation = async (id: string, reason: string): Promise<Booking> => {
    if (!reason.trim()) {
      toast({
        title: "Decline Reason Required",
        description: "Please provide a reason before declining the cancellation request.",
        variant: "destructive",
      })
      throw new Error("A decline reason is required.")
    }
    return callCancellationApi(id, { action: "decline", reason: reason.trim() })
  }

  const rejectCancellation = async (id: string, reason?: string): Promise<Booking> => {
    return declineCancellation(id, reason || "")
  }

  const applyModificationResponse = (id: string, responseBody: unknown): Booking => {
    const targetBooking = bookings.find((booking) => booking.id === id)
    if (!targetBooking) throw new Error("Booking not found.")
    const serverBooking = (
      responseBody &&
      typeof responseBody === "object" &&
      "booking" in responseBody &&
      responseBody.booking &&
      typeof responseBody.booking === "object"
        ? responseBody.booking
        : null
    ) as Partial<Booking> | null
    if (!serverBooking) throw new Error("The modification server returned an invalid response.")
    const updatedBooking = normalizeBookingForNewFields({
      ...targetBooking,
      ...serverBooking,
      id,
    })
    setBookings((current) => current.map((booking) => (
      booking.id === id ? updatedBooking : booking
    )))
    return updatedBooking
  }

  const callModificationApi = async (
    id: string,
    action: "request" | "approve" | "decline" | "admin_update",
    changes?: Record<string, unknown>,
    reason?: string,
  ): Promise<Booking> => {
    const response = await fetch("/api/bookings/modification", {
      method: "POST",
      headers: await getAuthHeaders(true),
      body: JSON.stringify({ bookingId: id, action, changes, reason }),
    })
    const responseBody = await response.json().catch(() => null) as {
      error?: unknown
      booking?: unknown
    } | null
    if (!response.ok) {
      throw new Error(
        responseBody && typeof responseBody.error === "string"
          ? responseBody.error
          : "Unable to update the modification request.",
      )
    }
    return applyModificationResponse(id, responseBody)
  }

  const requestModification = async (
    id: string,
    changes: Record<string, unknown>,
    reason: string,
  ): Promise<Booking> => callModificationApi(id, "request", changes, reason)

  const modifyBooking = async (id: string, updates: Partial<Booking>): Promise<Booking> => {
    const updateRecord = updates as Record<string, unknown>
    const allowedKeys = [
      "date",
      "eventName",
      "eventType",
      "guestCount",
      "specialRequests",
      "time",
      "startTime",
      "endTime",
      "companyName",
      "natureOfBusiness",
      "bookingType",
      "bookingCategory",
      "isOfficeRental",
      "rentalTerm",
      "contractTerm",
      "officeRentalTerm",
    ] as const
    const changes = Object.fromEntries(
      allowedKeys
        .filter((key) => updateRecord[key] !== undefined)
        .map((key) => [key, updateRecord[key]]),
    )
    return callModificationApi(id, "admin_update", changes, "Admin updated the booking.")
  }

  const approveModification = async (id: string): Promise<Booking> => callModificationApi(id, "approve")

  const declineModification = async (id: string, reason: string): Promise<Booking> => {
    if (!reason.trim()) {
      toast({
        title: "Decline Reason Required",
        description: "Please provide a reason before declining the modification request.",
        variant: "destructive",
      })
      throw new Error("A decline reason is required.")
    }
    return callModificationApi(id, "decline", undefined, reason.trim())
  }

  const markContractSigned = async (id: string, signedBy?: string): Promise<Booking> => (
    callLifecycleApi(id, "contract_signed", signedBy ? { signedBy } : {})
  )

  const issueReceipt = async (id: string): Promise<Booking> => {
    return callLifecycleApi(id, "issue_receipt")
  }

  const sendBalanceReminder = async (id: string): Promise<Booking> => (
    callLifecycleApi(id, "balance_reminder")
  )

  const manualRecordOnsitePayment = async (
    id: string,
    paymentData: {
      paymentType: "downpayment" | "remaining_balance" | "full_payment";
      amountReceived: number;
      adminNote?: string;
      adminName?: string;
    },
  ): Promise<Booking | null> => {
    const response = await fetch("/api/payments/onsite", {
      method: "POST",
      headers: await getAuthHeaders(true),
      body: JSON.stringify({
        bookingId: id,
        paymentType: paymentData.paymentType,
        amountReceived: paymentData.amountReceived,
        adminNote: paymentData.adminNote || "",
        adminName: paymentData.adminName || "",
      }),
    })
    const responseBody = await response.json().catch(() => null) as {
      error?: unknown
      booking?: unknown
      payment?: unknown
    } | null
    if (!response.ok) {
      throw new Error(
        responseBody && typeof responseBody.error === "string"
          ? responseBody.error
          : "Unable to record the onsite payment.",
      )
    }
    const serverBooking = responseBody?.booking as Partial<Booking> | undefined
    const paymentRecord = responseBody?.payment as PaymentRecord | undefined
    const currentBooking = bookings.find((booking) => booking.id === id)
    if (!serverBooking || !paymentRecord || !currentBooking) {
      throw new Error("The onsite payment server returned an invalid response.")
    }
    const updatedBooking = normalizeBookingForNewFields({
      ...currentBooking,
      ...serverBooking,
      id,
    })
    setBookings((current) => current.map((booking) => (
      booking.id === id ? updatedBooking : booking
    )))
    setPaymentRecords((current) => (
      current.some((payment) => payment.id === paymentRecord.id)
        ? current.map((payment) => payment.id === paymentRecord.id ? paymentRecord : payment)
        : [...current, paymentRecord]
    ))
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("oneestela_payments_updated"))
    }
    return updatedBooking

    /*
    let resultBooking: Booking | null = null;
    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      const total = getSafePrice(booking.totalPrice);
      const currentAmountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;
      const amountReceived = paymentData.amountReceived;

      let newAmountPaid: number;
      let newDownpaymentPaid: number;
      let newRemainingBalance: number;
      let newPaymentStatus: PaymentStatus;
      let newBalanceStatus: string;
      let newPaymentStage: "Initial Payment" | "Complete Downpayment" | "Settle Remaining Balance" | "Fully Paid";

      if (paymentData.paymentType === "full_payment") {
        newAmountPaid = total;
        newDownpaymentPaid = total;
        newRemainingBalance = 0;
        newPaymentStatus = "paid" as PaymentStatus;
        newBalanceStatus = "Settled";
        newPaymentStage = "Fully Paid";
      } else if (paymentData.paymentType === "remaining_balance") {
        newAmountPaid = currentAmountPaid + amountReceived;
        newDownpaymentPaid = typeof booking.downpaymentPaid === "number" ? booking.downpaymentPaid : 0;
        newRemainingBalance = Math.max(total - newAmountPaid, 0);
        if (newRemainingBalance === 0) {
          newPaymentStatus = "paid" as PaymentStatus;
          newBalanceStatus = "Settled";
          newPaymentStage = "Fully Paid";
        } else {
          newPaymentStatus = "partial" as PaymentStatus;
          newBalanceStatus = "With Remaining Balance";
          newPaymentStage = "Settle Remaining Balance";
        }
      } else {
        const downpaymentTarget = typeof booking.selectedDownpaymentAmount === "number" && booking.selectedDownpaymentAmount > 0
          ? booking.selectedDownpaymentAmount
          : getDownpaymentAmount(booking);
        const currentDownpaymentPaid = typeof booking.downpaymentPaid === "number" ? booking.downpaymentPaid : 0;
        newDownpaymentPaid = currentDownpaymentPaid + amountReceived;
        newAmountPaid = currentAmountPaid + amountReceived;

        if (newDownpaymentPaid >= downpaymentTarget) {
          if (newAmountPaid >= total) {
            newRemainingBalance = 0;
            newPaymentStatus = "paid" as PaymentStatus;
            newBalanceStatus = "Settled";
            newPaymentStage = "Fully Paid";
          } else {
            newRemainingBalance = total - newAmountPaid;
            newPaymentStatus = "partial" as PaymentStatus;
            newBalanceStatus = "With Remaining Balance";
            newPaymentStage = "Settle Remaining Balance";
          }
        } else {
          newRemainingBalance = total - newAmountPaid;
          newPaymentStatus = "partial" as PaymentStatus;
          newBalanceStatus = "With Remaining Balance";
          newPaymentStage = "Complete Downpayment";
        }
      }

      const onsiteUpdated: Booking = {
        ...booking,
        amountPaid: newAmountPaid,
        lastPaymentAmount: amountReceived,
        downpaymentPaid: newDownpaymentPaid,
        downpaymentRemaining: Math.max(
          (typeof booking.selectedDownpaymentAmount === "number" && booking.selectedDownpaymentAmount > 0
            ? booking.selectedDownpaymentAmount
            : getDownpaymentAmount(booking)) - newDownpaymentPaid,
          0,
        ),
        remainingBalance: newRemainingBalance,
        remainingBalancePaid: newRemainingBalance === 0,
        paymentStatus: newPaymentStatus,
        balanceStatus: newBalanceStatus,
        paymentStage: newPaymentStage,
        paymentMethod: "cash" as const,
        actualPaymentMethod: "Cash / Onsite",
        paymentType: paymentData.paymentType === "full_payment" ? "full" as const : paymentData.paymentType === "downpayment" ? "downpayment" as const : booking.paymentType,
        manualPaymentMarked: true,
        manualPaymentMarkedAt: new Date().toISOString(),
        manualPaymentMarkedBy: paymentData.adminName || "Administrator",
        manualPaymentNote: paymentData.adminNote || "",
        paymentVerifiedAt: new Date().toISOString(),
        paymentVerifiedBy: paymentData.adminName || "Administrator",
        verifiedByAdmin: true,
        verifiedAt: new Date().toISOString(),
        status: isOfficeBooking(booking)
          ? (newRemainingBalance === 0 ? "reservation_secured" as BookingStatus : "verifying" as BookingStatus)
          : (newRemainingBalance === 0 ? "confirmed" as BookingStatus : "confirmed" as BookingStatus),
        bookingStatus: isOfficeBooking(booking)
          ? (newRemainingBalance === 0 ? "Slot Secured" : "Pending Verification")
          : "Confirmed",
        isSlotSecured: isOfficeBooking(booking)
          ? newRemainingBalance === 0
          : true,
        contractSigningRequired: isOfficeBooking(booking)
          ? newRemainingBalance === 0
          : true,
        contractSigned: booking.contractSigned || false,
        contractStatus: booking.contractSigned ? "Signed" as ContractStatus : "Pending Signature" as ContractStatus,
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          booking,
          "RECORD_ONSITE_PAYMENT",
          `Admin recorded onsite payment of ₱${amountReceived.toLocaleString()}. Payment stage: ${newPaymentStage}. Remaining balance: ₱${newRemainingBalance.toLocaleString()}. ${paymentData.adminNote ? `Note: ${paymentData.adminNote}` : ""}`,
        ),
      };

      // Build a proper transaction receipt for this onsite payment.
      // Use onsiteUpdated (the booking with correct amountPaid/remainingBalance)
      // — NOT the stale closure booking — so the payment record, receipt, and
      // notification all reflect the true post-payment state.
      const onsitePaymentId = `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const onsiteSubmittedAt = new Date().toISOString();
      const onsiteTermLabel = paymentData.paymentType === "downpayment"
        ? "Down Payment"
        : paymentData.paymentType === "full_payment"
          ? "Full Payment"
          : "Balance Payment";
      const onsiteMethodLabel = "Cash / Onsite";
      const onsiteHistory = getReceiptHistory(onsiteUpdated);
      const onsiteReceipt = buildTransactionReceipt(
        onsiteUpdated,
        {
          id: onsitePaymentId,
          amount: amountReceived,
          methodLabel: onsiteMethodLabel,
          term: onsiteTermLabel,
          status: "Verified",
          submittedAt: onsiteSubmittedAt,
        },
        onsiteHistory,
        newRemainingBalance,
      );
      const bookingWithReceipt = attachTransactionReceipt(onsiteUpdated, onsiteReceipt);

      // Create a VERIFIED payment record in the payments collection so that
      // calculatePaymentSummary() includes this money in moneyReceivedTotal.
      // Use the UPDATED booking values (from onsiteUpdated) — NOT the stale
      // closure bookings.find() — to ensure the payment record, receipt, and
      // notification all reflect the correct post-payment state.
      try {
        const onsitePaymentRecord: PaymentRecord = {
          id: onsitePaymentId,
          bookingId: id,
          bookingCode: (onsiteUpdated as any).bookingCode ?? id,
          customerId: onsiteUpdated.userId ?? "",
          customerName: onsiteUpdated.userInfo?.name ?? onsiteUpdated.eventName ?? "",
          eventName: onsiteUpdated.eventName ?? "",
          venueName: onsiteUpdated.venue ?? "",
          method: onsiteMethodLabel,
          paymentMethod: "cash",
          term: onsiteTermLabel,
          amount: paymentData.amountReceived,
          amountPaid: paymentData.amountReceived,
          referenceNo: "",
          proofUrl: "",
          status: "Verified",
          verificationStatus: "Verified",
          receiptNumber: onsiteReceipt.receiptNumber,
          isRemainingDownPayment: false,
          submittedAt: onsiteSubmittedAt,
          updatedAt: onsiteSubmittedAt,
          reviewedAt: onsiteSubmittedAt,
          reviewedBy: paymentData.adminName || "Administrator",
          adminNote: paymentData.adminNote || "",
        };

        setPaymentRecords((current) => (
          current.some((payment) => payment.id === onsitePaymentRecord.id)
            ? current.map((payment) => payment.id === onsitePaymentRecord.id
              ? { ...payment, ...onsitePaymentRecord }
              : payment)
            : [...current, onsitePaymentRecord]
        ));
        void onsitePaymentRecord;
        window.dispatchEvent(new Event("oneestela_payments_updated"));

        console.log("[PAYMENT] ONSITE PAYMENT RECORDED", {
          paymentId: onsitePaymentId,
          bookingId: id,
          amount: paymentData.amountReceived,
          status: "Verified",
          receiptNumber: onsiteReceipt.receiptNumber,
          newRemainingBalance: newRemainingBalance,
        });

        createNotification({
          type: "payment_approved",
          title: "Payment Recorded",
          message: `An onsite payment of ₱${paymentData.amountReceived.toLocaleString()} has been recorded for Booking ${id}.`,
          bookingId: id,
          userId: onsiteUpdated.userId,
          link: `/portal/payments?highlight=${id}`,
        });
      } catch (error) {
        console.error("[Booking:manualRecordOnsitePayment] Failed to create payment record:", error);
      }

      return bookingWithReceipt;
    });

    const matched = updatedBookings.find((b) => b.id === id) ?? null;
    resultBooking = matched;
    void updatedBookings;
    return resultBooking;
    */
  };

  const reviewPayment = async (
    id: string,
    reviewData?: { verifiedAmount?: number; adminNote?: string; adminName?: string; paymentRecordId?: string },
  ): Promise<{ booking: Booking; payment: PaymentRecord }> => {
    const response = await fetch("/api/payments/review", {
      method: "POST",
      headers: await getAuthHeaders(true),
      body: JSON.stringify({
        action: "verify",
        bookingId: id,
        paymentRecordId: reviewData?.paymentRecordId,
        verifiedAmount: reviewData?.verifiedAmount,
        adminNote: reviewData?.adminNote || "",
      }),
    })
    const responseBody = await response.json().catch(() => null) as {
      error?: unknown
      booking?: unknown
      payment?: unknown
    } | null
    if (!response.ok) {
      throw new Error(
        responseBody && typeof responseBody.error === "string"
          ? responseBody.error
          : "Unable to verify the payment.",
      )
    }

    const updatedBooking = responseBody?.booking as Booking | undefined
    const paymentRecord = responseBody?.payment as PaymentRecord | undefined
    if (!updatedBooking || !paymentRecord) {
      throw new Error("The payment server returned an invalid verification response.")
    }

    setBookings((current) => current.map((booking) => (
      booking.id === id ? updatedBooking : booking
    )))
    setPaymentRecords((current) => (
      current.some((payment) => payment.id === paymentRecord.id)
        ? current.map((payment) => payment.id === paymentRecord.id ? paymentRecord : payment)
        : [...current, paymentRecord]
    ))
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("oneestela_payments_updated"))
    }
    return { booking: updatedBooking, payment: paymentRecord }
  }

  const reviewPaymentDecision = async (
    id: string,
    action: "reject" | "incomplete",
    data: { verifiedAmount?: number; adminNote: string; adminName?: string; paymentRecordId?: string },
  ): Promise<{ booking: Booking; payment: PaymentRecord }> => {
    const response = await fetch("/api/payments/review", {
      method: "POST",
      headers: await getAuthHeaders(true),
      body: JSON.stringify({
        action,
        bookingId: id,
        paymentRecordId: data.paymentRecordId,
        verifiedAmount: data.verifiedAmount,
        adminNote: data.adminNote,
      }),
    })
    const responseBody = await response.json().catch(() => null) as {
      error?: unknown
      booking?: unknown
      payment?: unknown
    } | null
    if (!response.ok) {
      throw new Error(
        responseBody && typeof responseBody.error === "string"
          ? responseBody.error
          : "Unable to review the payment.",
      )
    }

    const serverBooking = responseBody?.booking as Partial<Booking> | undefined
    const paymentRecord = responseBody?.payment as PaymentRecord | undefined
    const currentBooking = bookings.find((booking) => booking.id === id)
    if (!serverBooking || !paymentRecord || !currentBooking) {
      throw new Error("The payment server returned an invalid review response.")
    }
    const updatedBooking = normalizeBookingForNewFields({
      ...currentBooking,
      ...serverBooking,
      id,
    })
    setBookings((current) => current.map((booking) => (
      booking.id === id ? updatedBooking : booking
    )))
    setPaymentRecords((current) => (
      current.some((payment) => payment.id === paymentRecord.id)
        ? current.map((payment) => payment.id === paymentRecord.id ? paymentRecord : payment)
        : [...current, paymentRecord]
    ))
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("oneestela_payments_updated"))
    }
    return { booking: updatedBooking, payment: paymentRecord }
  }

  const rejectPayment = async (id: string, reason?: string, adminName?: string, paymentRecordId?: string) => {
    return reviewPaymentDecision(id, "reject", {
      adminNote: reason || "Payment rejected by admin.",
      adminName,
      paymentRecordId,
    })
    /*
     * Historical client-only implementation below is unreachable after the
     * server-authoritative return above.
    // Same record resolution as markPaymentRecordReviewed below.
    const rejectedReceiptPaymentId = resolveReceiptPaymentId(id, paymentRecordId)
    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;
      const rejectionReason = reason || booking.paymentRejectedReason || "Payment rejected by admin.";
      const hasApprovedDownpayment = typeof booking.downpaymentPaid === "number" && booking.downpaymentPaid > 0;

      if (hasApprovedDownpayment) {
        const total = getSafePrice(booking.totalPrice);
        const amountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;
        const dpPaid = typeof booking.downpaymentPaid === "number" ? booking.downpaymentPaid : 0;
        const selectedDP = typeof booking.selectedDownpaymentAmount === "number" && booking.selectedDownpaymentAmount > 0
          ? booking.selectedDownpaymentAmount
          : getDownpaymentAmount(booking);

        const restored = recalculatePaymentStage({
          ...booking,
          paymentRejectedReason: rejectionReason,
          paymentRejectionReason: rejectionReason,
          paymentRejectedAt: new Date().toISOString(),
          paymentReviewedBy: adminName || "Administrator",
          hasActivePaymentSubmission: false,
          proofUrl: undefined,
          bankReferenceNumber: undefined,
          paymentReference: undefined,
          paymentAmount: 0,
          pendingPaymentAmount: 0,
          paymentSubmittedAt: undefined,
          lastActivityAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        const dpRejected: Booking = {
          ...restored,
          status: "confirmed" as BookingStatus,
          bookingStatus: "Confirmed",
          paymentStatus: "partial" as PaymentStatus,
          isSlotSecured: true,
          downpaymentPaid: dpPaid,
          downpaymentRemaining: Math.max(selectedDP - dpPaid, 0),
          adminLogs: makeAdminLog(
            booking,
            "REMAINING_BALANCE_REJECTED",
            `Admin rejected remaining balance payment. Reason: ${rejectionReason}. Approved down payment of ₱${dpPaid.toLocaleString()} is preserved. Remaining balance: ₱${(total - amountPaid).toLocaleString()}.`,
          ),
        };
        // THIS payment's transaction receipt becomes REJECTED in place.
        // Pass the canonical remaining so the receipt reflects the true booking
        // balance after rejection (rejected contributes ₱0).
        const dpRejectReceiptRemaining = computeReceiptRemaining(
          getSafePrice(booking.totalPrice),
          paymentRecords,
          rejectedReceiptPaymentId,
          { status: "Rejected" },
          booking.id,
        );
        return patchPaymentReceiptStatus(dpRejected, rejectedReceiptPaymentId, "Rejected", {
          remainingBalance: dpRejectReceiptRemaining,
        });
      }

      const amountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;
      const total = getSafePrice(booking.totalPrice);

      const restored = recalculatePaymentStage({
        ...booking,
        paymentRejectedReason: rejectionReason,
        paymentRejectionReason: rejectionReason,
        paymentRejectedAt: new Date().toISOString(),
        paymentReviewedBy: adminName || "Administrator",
        hasActivePaymentSubmission: false,
        proofUrl: undefined,
        bankReferenceNumber: undefined,
        paymentReference: undefined,
        paymentAmount: 0,
        pendingPaymentAmount: 0,
        paymentSubmittedAt: undefined,
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const paymentRejected: Booking = {
        ...restored,
        status: "verifying" as BookingStatus,
        bookingStatus: "Pending Verification",
        paymentStatus: "rejected" as PaymentStatus,
        isSlotSecured: false,
        adminLogs: makeAdminLog(
          booking,
          "REJECT_PAYMENT",
          `Admin rejected payment proof. Reason: ${rejectionReason}. Previously approved payment of ₱${amountPaid.toLocaleString()} is preserved. Remaining: ₱${(total - amountPaid).toLocaleString()}.`,
        ),
      };
      // THIS payment's transaction receipt becomes REJECTED in place.
      // Pass the canonical remaining so the receipt reflects the true booking
      // balance after rejection (rejected contributes ₱0).
      const rejectReceiptRemaining = computeReceiptRemaining(
        getSafePrice(booking.totalPrice),
        paymentRecords,
        rejectedReceiptPaymentId,
        { status: "Rejected" },
        booking.id,
      );
      return patchPaymentReceiptStatus(paymentRejected, rejectedReceiptPaymentId, "Rejected", {
        remainingBalance: rejectReceiptRemaining,
      });
    });

     void updatedBookings;
    // Keep the individual payment submission record in sync so the admin
    // payment history shows this submission as REJECTED.
    markPaymentRecordReviewed(id, paymentRecordId, {
      verificationStatus: "Rejected",
      status: "Rejected",
      reviewedBy: adminName || "Administrator",
      reviewedAt: new Date().toISOString(),
      rejectionReason: reason || "",
      adminNote: reason || "",
    });
    const rejectedBooking = bookings.find((b) => b.id === id);
    if (rejectedBooking) {
      const hasApprovedDownpayment = typeof rejectedBooking.downpaymentPaid === "number" && rejectedBooking.downpaymentPaid > 0;
      createNotification({
        type: hasApprovedDownpayment ? "remaining_balance_rejected" : "payment_rejected",
        title: hasApprovedDownpayment ? "Remaining Balance Rejected" : "Payment Rejected",
        message: hasApprovedDownpayment
          ? `Your remaining balance payment for Booking ${rejectedBooking.id} has been rejected. Your approved down payment is still valid.`
          : `Your payment for Booking ${rejectedBooking.id} has been rejected.`,
        bookingId: rejectedBooking.id,
        userId: rejectedBooking.userId,
        link: `/portal/payments?highlight=${rejectedBooking.id}`,
      })
    }
    */
  };

  const markIncompletePayment = async (id: string, data: { verifiedAmount: number; adminNote: string; adminName?: string; paymentRecordId?: string }) => {
    return reviewPaymentDecision(id, "incomplete", data)
    /*
     * Historical client-only implementation below is unreachable after the
     * server-authoritative return above.
    // Same record resolution as markPaymentRecordReviewed below, so the
    // receipt patched here belongs to EXACTLY the payment being marked.
    const incompleteReceiptPaymentId = resolveReceiptPaymentId(id, data.paymentRecordId)
    // Resolve THIS payment's own record so the ORIGINAL requested amount can
    // be preserved when the record's amount fields are rewritten below.
    const incompleteTargetRecord = (() => {
      if (data.paymentRecordId) {
        return paymentRecords.find((record) => record.id === data.paymentRecordId)
      }
      return [...paymentRecords]
        .filter((record) => isPaymentRecordForBooking(record, id))
        .sort((a, b) => {
          const aT = a.submittedAt ? new Date(a.submittedAt).getTime() : 0
          const bT = b.submittedAt ? new Date(b.submittedAt).getTime() : 0
          return bT - aT
        })
        .find((record) => isUnresolvedPaymentRecord(record))
    })()
    const requestedAmount = getSafePrice(
      incompleteTargetRecord?.amount || incompleteTargetRecord?.amountPaid || 0,
    )
    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      const total = getSafePrice(booking.totalPrice);
      // An INCOMPLETE payment is NOT accepted money: it contributes ₱0 to the
      // booking ledger. Only admin-VERIFIED payments are banked into
      // amountPaid / downpaymentPaid (reviewPayment / settleRemainingBalance),
      // so those fields are left untouched here — banking the "amount received"
      // figure would inflate the accepted total and could push the overall
      // status to PARTIAL/FULLY PAID on money admin never verified.
      const currentAmountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;
      const newRemainingBalance = Math.max(total - currentAmountPaid, 0);
      const isDownpayment = booking.paymentType === "downpayment";
      const currentDownpaymentPaid = typeof booking.downpaymentPaid === "number" ? booking.downpaymentPaid : 0;
      const selectedDP = typeof booking.selectedDownpaymentAmount === "number" && booking.selectedDownpaymentAmount > 0
        ? booking.selectedDownpaymentAmount
        : getDownpaymentAmount(booking);
      const dpRemaining = isDownpayment ? Math.max(selectedDP - currentDownpaymentPaid, 0) : 0;
      const isFullyPaidAfter = total > 0 && currentAmountPaid >= total;
      const hasPriorVerifiedPayment = currentAmountPaid > 0;
      const officeBooking = isOfficeBooking(booking);

      const incompleteUpdated: Booking = {
        ...booking,
        // When the booking already has a verified payment (e.g. an approved
        // downpayment), marking a NEW payment "incomplete" must NOT demote the
        // booking back to "verifying" / "Pending Verification". The booking
        // stays in its verified state; only the payment is incomplete.
        status: (officeBooking
          ? (isFullyPaidAfter ? "reservation_secured" : (hasPriorVerifiedPayment ? booking.status : "verifying"))
          : (isFullyPaidAfter ? "confirmed" : (hasPriorVerifiedPayment ? "confirmed" : "verifying"))) as BookingStatus,
        bookingStatus: (officeBooking
          ? (isFullyPaidAfter ? "Slot Secured" : (hasPriorVerifiedPayment ? booking.bookingStatus : "Pending Verification"))
          : (isFullyPaidAfter ? "Confirmed" : (hasPriorVerifiedPayment ? booking.bookingStatus : "Pending Verification"))) as BookingStatusLabel,
        isSlotSecured: isFullyPaidAfter || (hasPriorVerifiedPayment ? booking.isSlotSecured === true : false),
        amountPaid: currentAmountPaid,
        lastPaymentAmount: data.verifiedAmount,
        downpaymentPaid: typeof booking.downpaymentPaid === "number" ? booking.downpaymentPaid : 0,
        downpaymentRemaining: dpRemaining,
        selectedDownpaymentAmount: isDownpayment ? selectedDP : 0,
        paymentStatus: (isFullyPaidAfter ? ("paid" as PaymentStatus) : ("incomplete" as PaymentStatus)),
        // remainingBalance is always the true booking balance (total − paid),
        // never the downpayment remainder — the DP remainder lives in
        // downpaymentRemaining. This keeps "Settle Remaining Balance" visible
        // on the client with the correct amount.
        remainingBalance: newRemainingBalance,
        balanceStatus: isFullyPaidAfter ? "Settled" : "With Remaining Balance",
        paymentStage: isFullyPaidAfter
          ? "Fully Paid"
          : (isDownpayment && dpRemaining > 0 ? "Complete Downpayment" : "Settle Remaining Balance"),
        hasActivePaymentSubmission: false,
        incompletePaymentNote: data.adminNote,
        incompletePaymentReason: data.adminNote,
        paymentVerifiedAt: new Date().toISOString(),
        paymentReviewedAt: new Date().toISOString(),
        paymentVerifiedBy: data.adminName || "Administrator",
        // Informational only (admin UI "Amount Received") — never banked.
        paymentVerifiedAmount: data.verifiedAmount,
        verifiedByAdmin: true,
        verifiedAt: new Date().toISOString(),
        contractSigningRequired: true,
        contractSigned: booking.contractSigned || false,
        contractStatus: booking.contractSigned ? "Signed" as ContractStatus : "Pending Signature" as ContractStatus,
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          booking,
          "INCOMPLETE_PAYMENT_RECORDED",
          `Admin recorded incomplete payment. Amount received (NOT accepted): ₱${data.verifiedAmount.toLocaleString()}. Total accepted: ₱${currentAmountPaid.toLocaleString()}.${isDownpayment ? ` Downpayment remaining: ₱${dpRemaining.toLocaleString()}.` : ` Remaining: ₱${newRemainingBalance.toLocaleString()}.`}${isFullyPaidAfter ? "" : " Slot is NOT secured — payment incomplete."} Note: ${data.adminNote}`,
        ),
      } as Booking;

      // THIS payment's transaction receipt is updated in place to INCOMPLETE
      // (same paymentId) — it stays visible and never implies acceptance.
      // The receipt amount becomes the ACTUAL money received (₱5,500 of a
      // ₱7,500 request), never the requested figure.
      //
      // The receipt remainingBalance must reflect the canonical booking
      // remaining AFTER this incomplete payment's received money is credited
      // — not just total − stored amountPaid (which excludes incomplete money).
      const incompleteReceiptRemaining = computeReceiptRemaining(
        getSafePrice(booking.totalPrice),
        paymentRecords,
        incompleteReceiptPaymentId,
        {
          amountReceived: data.verifiedAmount,
          amount: data.verifiedAmount,
          amountPaid: data.verifiedAmount,
          status: "Incomplete",
        },
        booking.id,
      );
      return patchPaymentReceiptStatus(
        incompleteUpdated,
        incompleteReceiptPaymentId,
        "Incomplete",
        { remainingBalance: incompleteReceiptRemaining, amountPaid: data.verifiedAmount },
      );
    });

     void updatedBookings;
    // Keep the individual payment submission record in sync so the admin
    // payment history shows this submission as INCOMPLETE. The record's
    // amount fields now carry the ACTUAL money received (₱5,500 of a
    // ₱7,500 request); the original requested amount is preserved in
    // requestedAmount for history/UI. amountReceived stays credited toward
    // the downpayment remainder — never toward the accepted total.
    markPaymentRecordReviewed(id, data.paymentRecordId, {
      verificationStatus: "Incomplete",
      status: "Incomplete",
      amount: data.verifiedAmount,
      amountPaid: data.verifiedAmount,
      ...(requestedAmount > 0 && requestedAmount !== data.verifiedAmount
        ? { requestedAmount }
        : {}),
      amountReceived: data.verifiedAmount,
      reviewedBy: data.adminName || "Administrator",
      reviewedAt: new Date().toISOString(),
      adminNote: data.adminNote || "",
    });
    const incompleteBooking = bookings.find((b) => b.id === id);
    const updatedIncompleteBooking = updatedBookings.find((b) => b.id === id) as any;
    if (updatedIncompleteBooking) {
      console.log("[DEBUG][Incomplete Payment] UPDATE", {
        bookingId: id,
        paymentId: data.paymentRecordId ?? undefined,
        updates: {
          status: updatedIncompleteBooking.status,
          bookingStatus: updatedIncompleteBooking.bookingStatus,
          paymentStatus: updatedIncompleteBooking.paymentStatus,
          paymentStage: updatedIncompleteBooking.paymentStage,
          balanceStatus: updatedIncompleteBooking.balanceStatus,
          amountPaid: updatedIncompleteBooking.amountPaid,
          lastPaymentAmount: updatedIncompleteBooking.lastPaymentAmount,
          remainingBalance: updatedIncompleteBooking.remainingBalance,
          downpaymentRemaining: updatedIncompleteBooking.downpaymentRemaining,
          hasActivePaymentSubmission: updatedIncompleteBooking.hasActivePaymentSubmission,
          isSlotSecured: updatedIncompleteBooking.isSlotSecured,
          incompletePaymentNote: updatedIncompleteBooking.incompletePaymentNote,
        },
      });
    }
    if (incompleteBooking) {
      createNotification({
        type: "payment_incomplete",
        title: "Payment Requires Correction",
        message: `Your payment for Booking ${incompleteBooking.id} needs correction or additional information before it can be verified.`,
        bookingId: incompleteBooking.id,
        userId: incompleteBooking.userId,
        link: `/portal/payments?highlight=${incompleteBooking.id}`,
      })
    }
    */
  };

  const addMaintenanceRecord = (record: Omit<MaintenanceRecord, "id" | "createdAt" | "updatedAt">) => {
    const now = new Date().toISOString();
    const newRecord: MaintenanceRecord = {
      ...record,
      id: `maint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    };
    saveMaintenanceRecords([...maintenanceRecords, newRecord]);
    toast({
      title: "Maintenance Added",
      description: `${record.spaceName} is now blocked on ${record.date}.`,
      className: "bg-slate-900 text-white",
    });
  };

  const removeMaintenanceRecord = (id: string) => {
    const target = maintenanceRecords.find(r => r.id === id);
    saveMaintenanceRecords(maintenanceRecords.filter(r => r.id !== id));
    if (target) {
      toast({
        title: "Maintenance Removed",
        description: `${target.spaceName} is now available on ${target.date}.`,
      });
    }
  };

  const toggleMaintenanceDate = (date: string, venueId: string) => {
    const existing = maintenanceRecords.find(
      r => r.spaceId === venueId && r.date === date
    );
    if (existing) {
      removeMaintenanceRecord(existing.id);
      toast({
        title: "Maintenance Removed",
        description: `Venue is now available on ${date}.`,
      });
      return;
    }
    addMaintenanceRecord({
      type: venueId.startsWith("o") ? "office" : "venue",
      spaceId: venueId,
      spaceName: venueId,
      date,
      status: "Active",
    });
  };

  const submitPayment = async (
    id: string,
    paymentData: {
      type: "full" | "downpayment" | "slot_reservation";
      method: "bank" | "cash";
      proof?: string;
      bankReferenceNumber?: string;
      amount?: number;
    },
  ) => {
    if (user?.role === "client") {
      const response = await fetch("/api/payments/submit", {
        method: "POST",
        headers: await getAuthHeaders(true),
        body: JSON.stringify({
          bookingId: id,
          type: paymentData.type,
          method: paymentData.method,
          proof: paymentData.proof || "",
          bankReferenceNumber: paymentData.bankReferenceNumber || "",
          amount: paymentData.amount,
        }),
      })
      const responseBody = await response.json().catch(() => null) as {
        error?: unknown
        booking?: unknown
        payment?: unknown
      } | null
      if (!response.ok) {
        throw new Error(
          responseBody && typeof responseBody.error === "string"
            ? responseBody.error
            : "Unable to submit the payment.",
        )
      }

      const updatedBooking = responseBody?.booking as Booking | undefined
      const paymentRecord = responseBody?.payment as PaymentRecord | undefined
      if (!updatedBooking) throw new Error("The payment server returned an invalid booking.")

      setBookings((current) => current.map((booking) => (
        booking.id === id ? updatedBooking : booking
      )))
      if (paymentRecord) {
        setPaymentRecords((current) => (
          current.some((payment) => payment.id === paymentRecord.id)
            ? current
            : [...current, paymentRecord]
        ))
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("oneestela_payments_updated"))
      }
      return
    }

    throw new Error("Only client accounts can submit payments.")

    /*
    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      const total = getSafePrice(booking.totalPrice);
      const currentPaid = getCurrentAmountPaid(booking);
      const isCash = paymentData.method === "cash";

      if (isOfficeBooking(booking)) {
        const reservationFee = getOfficeReservationFee(booking);

        if (isCash) {
          return {
            ...booking,
            status: "verifying" as BookingStatus,
            bookingStatus: "Pending Verification",
            isSlotSecured: false,
            paymentStatus: "for_review" as PaymentStatus,
            paymentMethod: "cash" as const,
            actualPaymentMethod: "Cash / Onsite",
            paymentSubmissionType: "onsite" as const,
            paymentType: "slot_reservation" as const,
            proofUrl: undefined,
            bankReferenceNumber: undefined,
            paymentAmount: 0,
            paymentSubmittedAt: new Date().toISOString(),
            amountPaid: currentPaid,
            remainingBalance: Math.max(total - currentPaid, 0),
            remainingBalancePaid: false,
            officeReservationFee: reservationFee,
            officeReservationStatus: "pending_verification" as OfficeReservationStatus,
            officeContractSigningRequired: true,
            officePaymentInstructions: "Customer selected Pay at the Office for office slot reservation. Awaiting admin onsite payment verification.",
            verifiedByAdmin: false,
            hasActivePaymentSubmission: true,
            lastActivityAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            adminLogs: makeAdminLog(
              booking,
              "PAY_AT_OFFICE_SELECTED",
              "Client selected Pay at the Office for office slot reservation. Payment submitted for admin verification.",
            ),
          };
        }

        return {
          ...booking,
          status: "verifying" as BookingStatus,
          bookingStatus: "Pending Verification",
          isSlotSecured: false,
          paymentStatus: "for_review" as PaymentStatus,
          paymentType: "slot_reservation" as const,
          paymentSubmissionType: "bank_transfer" as const,
          paymentMethod: paymentData.method,
          bankReferenceNumber: paymentData.bankReferenceNumber?.trim(),
          paymentReference: paymentData.bankReferenceNumber?.trim(),
          proofUrl: paymentData.proof,
          paymentAmount: Number(paymentData.amount || reservationFee),
          pendingPaymentAmount: Number(paymentData.amount || reservationFee),
          paymentSubmittedAt: new Date().toISOString(),
          amountPaid: currentPaid,
          remainingBalance: Math.max(total - currentPaid, 0),
          remainingBalancePaid: false,
          officeReservationFee: reservationFee,
          officeReservationStatus:
            "pending_verification" as OfficeReservationStatus,
          officeContractSigningRequired: true,
          officePaymentInstructions:
            "This payment secures your office reservation slot only. After admin verification, succeeding rental payments are settled onsite via check and recorded by admin.",
          verifiedByAdmin: false,
          hasActivePaymentSubmission: true,

          lastActivityAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          adminLogs: makeAdminLog(
            booking,
            "OFFICE_SLOT_PAYMENT_SUBMITTED",
            "Client submitted proof for office slot reservation payment.",
          ),
        };
      }

      const isSettlingBalance =
        booking.status === "confirmed" &&
        booking.paymentType === "downpayment" &&
        currentPaid < total;

      const isRemainingPaymentFlow =
        !isOfficeBooking(booking) &&
        !isSettlingBalance &&
        (String(booking.paymentStatus || "").toLowerCase() === "partial" ||
         String(booking.paymentStatus || "").toLowerCase() === "incomplete" ||
         String(booking.balanceStatus || "").toLowerCase() === "with remaining balance") &&
        currentPaid > 0 &&
        currentPaid < total;

      if (paymentData.type === "downpayment") {
        const dpAmount = paymentData.amount || getDownpaymentAmount(booking);
        const targetDP = typeof booking.selectedDownpaymentAmount === "number" && booking.selectedDownpaymentAmount > 0
          ? booking.selectedDownpaymentAmount
          : getDownpaymentAmount(booking);
        const existingDownpaymentPaid = typeof booking.downpaymentPaid === "number" ? booking.downpaymentPaid : 0;
        const isRemainingDPSubmission = existingDownpaymentPaid > 0;
        if (isCash) {
          return {
            ...booking,
            status: "verifying" as BookingStatus,
            bookingStatus: "Pending Verification",
            isSlotSecured: false,
            paymentStatus: "for_review" as PaymentStatus,
            paymentType: "downpayment",
            paymentSubmissionType: "onsite" as const,
            paymentMethod: "cash" as const,
            actualPaymentMethod: "Cash / Onsite",
            proofUrl: undefined,
            bankReferenceNumber: undefined,
            paymentAmount: Number(dpAmount),
            pendingPaymentAmount: Number(dpAmount),
            paymentSubmittedAt: new Date().toISOString(),
            selectedDownpaymentAmount: targetDP,
            amountPaid: isRemainingDPSubmission ? (typeof booking.amountPaid === "number" ? booking.amountPaid : 0) : 0,
            remainingBalance: isRemainingDPSubmission ? (typeof booking.remainingBalance === "number" ? booking.remainingBalance : total) : total,
            remainingBalancePaid: false,
            verifiedByAdmin: false,
            hasActivePaymentSubmission: true,
            lastActivityAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            adminLogs: makeAdminLog(
              booking,
              "PAY_AT_OFFICE_SELECTED",
              "Client selected Pay at the Office. Payment submitted for admin verification.",
            ),
          };
        }
        return {
          ...booking,
          status: "verifying" as BookingStatus,
          bookingStatus: "Pending Verification",
          isSlotSecured: false,
          paymentStatus: "for_review" as PaymentStatus,
          paymentType: "downpayment",
          paymentSubmissionType: "bank_transfer" as const,
          paymentMethod: paymentData.method,
          bankReferenceNumber: paymentData.bankReferenceNumber?.trim(),
          paymentReference: paymentData.bankReferenceNumber?.trim(),
          proofUrl: paymentData.proof,
          paymentAmount: Number(dpAmount),
          pendingPaymentAmount: Number(dpAmount),
          paymentSubmittedAt: new Date().toISOString(),
          selectedDownpaymentAmount: targetDP,
          amountPaid: isRemainingDPSubmission ? (typeof booking.amountPaid === "number" ? booking.amountPaid : 0) : 0,
          remainingBalance: isRemainingDPSubmission ? (typeof booking.remainingBalance === "number" ? booking.remainingBalance : total) : total,
          remainingBalancePaid: false,
          verifiedByAdmin: false,
          hasActivePaymentSubmission: true,

          lastActivityAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      if (isSettlingBalance || isRemainingPaymentFlow) {
        const paymentAmount = Number(paymentData.amount || Math.max(total - currentPaid, 0));
        const isDownpaymentStage = booking.paymentType === "downpayment" &&
          (typeof booking.downpaymentPaid === "number" ? booking.downpaymentPaid : 0) <
          (typeof booking.selectedDownpaymentAmount === "number" && booking.selectedDownpaymentAmount > 0
            ? booking.selectedDownpaymentAmount
            : getDownpaymentAmount(booking));

        if (isCash) {
          return {
            ...booking,
            status: "verifying" as BookingStatus,
            bookingStatus: "Pending Verification",
            isSlotSecured: false,
            paymentStatus: "for_review" as PaymentStatus,
            paymentSubmissionType: "onsite" as const,
            paymentMethod: "cash" as const,
            actualPaymentMethod: "Cash / Onsite",
            proofUrl: undefined,
            bankReferenceNumber: undefined,
            paymentAmount: paymentAmount,
            pendingPaymentAmount: paymentAmount,
            paymentSubmittedAt: new Date().toISOString(),
            verifiedByAdmin: false,
            hasActivePaymentSubmission: true,
            lastActivityAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            adminLogs: makeAdminLog(
              booking,
              "PAY_AT_OFFICE_SELECTED",
              "Client selected Pay at the Office for remaining balance. Payment submitted for admin verification.",
            ),
          };
        }

        return {
          ...booking,
          status: "verifying" as BookingStatus,
          bookingStatus: "Pending Verification",
          isSlotSecured: false,
          paymentStatus: "for_review" as PaymentStatus,
          paymentSubmissionType: "bank_transfer" as const,
          paymentMethod: paymentData.method,
          bankReferenceNumber: paymentData.bankReferenceNumber?.trim(),
          paymentReference: paymentData.bankReferenceNumber?.trim(),
          proofUrl: paymentData.proof,
          paymentAmount: paymentAmount,
          pendingPaymentAmount: paymentAmount,
          paymentSubmittedAt: new Date().toISOString(),
          remainingBalance: Math.max(total - currentPaid, 0),
          remainingBalancePaid: false,
          verifiedByAdmin: false,
          hasActivePaymentSubmission: true,

          lastActivityAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      if (isCash) {
        return {
          ...booking,
          status: "verifying" as BookingStatus,
          bookingStatus: "Pending Verification",
          isSlotSecured: false,
          paymentStatus: "for_review" as PaymentStatus,
          paymentType: paymentData.type,
          paymentSubmissionType: "onsite" as const,
          paymentMethod: "cash" as const,
          actualPaymentMethod: "Cash / Onsite",
          proofUrl: undefined,
          bankReferenceNumber: undefined,
          paymentAmount: Number(paymentData.amount || total),
          pendingPaymentAmount: Number(paymentData.amount || total),
          paymentSubmittedAt: new Date().toISOString(),
          amountPaid: 0,
          remainingBalance: total,
          remainingBalancePaid: false,
          verifiedByAdmin: false,
          hasActivePaymentSubmission: true,
          lastActivityAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
            adminLogs: makeAdminLog(
              booking,
              "PAY_AT_OFFICE_SELECTED",
              "Client selected Pay at the Office. Payment submitted for admin verification.",
            ),
          };
        }

        return {
          ...booking,
          status: "verifying" as BookingStatus,
          bookingStatus: "Pending Verification",
          isSlotSecured: false,
          paymentStatus: "for_review" as PaymentStatus,
          paymentType: paymentData.type,
          paymentSubmissionType: "bank_transfer" as const,
          paymentMethod: paymentData.method,
          bankReferenceNumber: paymentData.bankReferenceNumber?.trim(),
          paymentReference: paymentData.bankReferenceNumber?.trim(),
          proofUrl: paymentData.proof,
          paymentAmount: Number(paymentData.amount || total),
          pendingPaymentAmount: Number(paymentData.amount || total),
          paymentSubmittedAt: new Date().toISOString(),
          amountPaid: 0,
          remainingBalance: total,
          remainingBalancePaid: false,
          verifiedByAdmin: false,
          hasActivePaymentSubmission: true,

          lastActivityAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
    });

    // Transaction receipt for THIS submission — created below when the payment
    // record is written, then persisted on the booking doc in the same save.
    let submissionReceipt: BookingReceipt | undefined
    const updatedBooking = updatedBookings.find(b => b.id === id) as any
    if (updatedBooking) {
      try {
        const methodLabel = paymentData.method === "cash" ? "Pay at the Office" : "Bank Transfer"
        const isRemainingDP = paymentData.type === "downpayment" && (typeof updatedBooking.downpaymentPaid === "number" ? updatedBooking.downpaymentPaid : 0) > 0
        const paymentId = `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        // submittedAt is pinned to the booking's paymentSubmittedAt so the
        // transaction receipt carries the exact same timestamp and links to
        // THIS payment submission only.
        const submittedAt = updatedBooking.paymentSubmittedAt ?? new Date().toISOString()
        const termLabel = paymentData.type === "downpayment" ? "Down Payment" : paymentData.type === "full" ? "Full Payment" : "Slot Reservation"
        const recordStatus = paymentData.method === "cash" ? "Awaiting Onsite Payment" : "For Verification"
        const paymentRecord = {
          id: paymentId,
          bookingId: id,
          bookingCode: updatedBooking.bookingCode ?? id,
          customerId: updatedBooking.userId ?? "",
          customerName: updatedBooking.fullName ?? updatedBooking.eventName ?? "",
          eventName: updatedBooking.eventName ?? "",
          venueName: updatedBooking.venue ?? "",
          method: methodLabel,
          paymentMethod: paymentData.method,
          term: termLabel,
          amount: Number(paymentData.amount || getSafePrice(updatedBooking.totalPrice)),
          amountPaid: Number(paymentData.amount || 0),
          referenceNo: paymentData.bankReferenceNumber?.trim() ?? "",
          proofUrl: paymentData.proof ?? "",
          status: recordStatus,
          verificationStatus: paymentData.method === "cash" ? "Pending Onsite Verification" : "Pending",
          receiptNumber: undefined as string | undefined,
          isRemainingDownPayment: isRemainingDP,
          submittedAt,
          updatedAt: submittedAt,
        }
        // TRANSACTION RECEIPT — created immediately for EVERY payment attempt
        // (for_review / awaiting onsite). It records THIS transaction with its
        // exact paymentId; it does NOT imply acceptance. Admin actions later
        // update this same receipt in place (Verified / Incomplete / Rejected).
        //
        // The receipt remainingBalance must reflect the canonical booking
        // remaining BEFORE this new payment is submitted — accounting for any
        // money already credited from other payments (e.g. incomplete amounts).
        const originalBooking = bookings.find(b => b.id === id)
        const submissionReceiptRemaining = originalBooking
          ? computeReceiptRemaining(
               getSafePrice(originalBooking!.totalPrice),
              paymentRecords,
              paymentId,
              { amount: Number(paymentRecord.amount), amountPaid: Number(paymentRecord.amountPaid || 0), status: recordStatus },
              id,
            )
          : Math.max(getSafePrice(updatedBooking.totalPrice) - getSafePrice(updatedBooking.amountPaid), 0)
        const transactionReceipt = buildTransactionReceipt(
          updatedBooking as Booking,
          {
            id: paymentId,
            amount: Number(paymentRecord.amount),
            methodLabel,
            term: termLabel,
            status: recordStatus,
            submittedAt,
            referenceNo: paymentRecord.referenceNo,
          },
          getReceiptHistory(updatedBooking as Booking),
          submissionReceiptRemaining,
        )
        paymentRecord.receiptNumber = transactionReceipt.receiptNumber
        submissionReceipt = transactionReceipt
        void paymentRecord
        console.log("[PAYMENT] NEW PAYMENT CREATED", {
          paymentId,
          bookingId: id,
          amount: paymentRecord.amount,
          status: paymentRecord.status,
          verificationStatus: paymentRecord.verificationStatus,
          receiptNumber: transactionReceipt.receiptNumber,
        })
      } catch (error) {
        console.error("Failed to save payment record:", error)
      }
    }

    // Persist booking updates WITH this payment's transaction receipt in a
    // single write so the receipt is visible to both listeners immediately.
    let bookingsToSave = updatedBookings as Booking[]
    if (updatedBooking && submissionReceipt) {
      bookingsToSave = bookingsToSave.map((booking) =>
        booking.id === id
          ? attachTransactionReceipt(booking, submissionReceipt as BookingReceipt)
          : booking,
      )
    }
    void bookingsToSave;
    if (updatedBooking) {
      window.dispatchEvent(new Event("oneestela_payments_updated"))
      const payName = updatedBooking.userInfo?.name || updatedBooking.eventName || "A client"
      const payVenue = updatedBooking.venue || updatedBooking.eventName || "a venue"
      createNotification({
        type: "payment_submitted",
        title: "Payment for Review",
        message: `A new payment for ${payVenue} is waiting for verification.`,
        bookingId: updatedBooking.id,
        userId: "admin",
        relatedUserId: updatedBooking.userId,
        relatedUserName: payName,
        link: `/dashboard/payments?highlight=${updatedBooking.id}`,
      })
    }
    */
  };

  const addOfficeRentalRequest = async (
    rentalData: Omit<
      OfficeRental,
      | "id"
      | "createdAt"
      | "updatedAt"
      | "advanceMonths"
      | "depositMonths"
      | "advanceAmount"
      | "depositAmount"
      | "totalInitialPayment"
      | "contractStatus"
      | "contractSigned"
      | "advanceDepositPaid"
      | "paymentMethodInitial"
      | "monthlyPaymentMethod"
      | "chequeSubmissionMethod"
      | "requiredChequeCount"
      | "submittedChequeCount"
      | "chequesSubmitted"
      | "chequeStatus"
      | "leaseStatus"
    >,
  ) => {
    const requiredChequeCount = getRequiredChequeCount(rentalData.rentalTerm);
    const monthlyRent = getSafePrice(rentalData.monthlyRent);
    const advanceAmount = monthlyRent;
    const depositAmount = monthlyRent * 2;

    const newId = await getNextBookingNumber();

    const newOfficeRental: OfficeRental = {
      ...rentalData,
      id: newId,
      monthlyRent,
      advanceMonths: 1,
      depositMonths: 2,
      advanceAmount,
      depositAmount,
      totalInitialPayment: advanceAmount + depositAmount,
      contractStatus: "Pending",
      contractSigned: false,
      advanceDepositPaid: false,
      paymentMethodInitial: "Cash",
      monthlyPaymentMethod: "Cheque",
      chequeSubmissionMethod: "Face-to-face only",
      requiredChequeCount,
      submittedChequeCount: 0,
      chequesSubmitted: false,
      chequeStatus: "Pending",
      leaseStatus: "Pending Review",
      adminLogs: [
        {
          action: "OFFICE_RENTAL_REQUEST_CREATED",
          message: `Office rental request submitted for ${getRentalTermLabel(
            rentalData.rentalTerm,
          )}. Cheque payments are face-to-face only.`,
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveOfficeRentals([...officeRentals, newOfficeRental]);
    return newOfficeRental.id;
  };

  const getUserOfficeRentals = (userId: string) => {
    return officeRentals.filter((rental) => rental.userId === userId);
  };

  const approveOfficeRentalForContractSigning = (id: string) => {
    const updatedRentals = officeRentals.map((rental) => {
      if (rental.id !== id) return rental;

      return {
        ...rental,
        leaseStatus: "Approved for Contract Signing" as OfficeLeaseStatus,
        contractStatus: "Pending" as ContractStatus,
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          rental,
          "APPROVED_FOR_CONTRACT_SIGNING",
          "Admin approved office rental request for face-to-face contract signing.",
        ),
      };
    });

    saveOfficeRentals(updatedRentals as OfficeRental[]);
  };

  const declineOfficeRental = (id: string, reason: string) => {
    if (!reason.trim()) {
      toast({
        title: "Decline Reason Required",
        description:
          "Please provide a reason before declining this office rental request.",
        variant: "destructive",
      });
      return;
    }

    const updatedRentals = officeRentals.map((rental) => {
      if (rental.id !== id) return rental;

      return {
        ...rental,
        leaseStatus: "Declined" as OfficeLeaseStatus,
        declineReason: reason.trim(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          rental,
          "OFFICE_RENTAL_DECLINED",
          `Office rental request declined. Reason: ${reason.trim()}`,
        ),
      };
    });

    saveOfficeRentals(updatedRentals);
  };

  const markOfficeContractSigned = (id: string) => {
    const updatedRentals = officeRentals.map((rental) => {
      if (rental.id !== id) return rental;

      return {
        ...rental,
        contractSigned: true,
        contractSignedDate: new Date().toISOString(),
        contractStatus: "Signed" as ContractStatus,
        leaseStatus: "Contract Signed" as OfficeLeaseStatus,
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          rental,
          "OFFICE_CONTRACT_SIGNED",
          "Admin marked office rental contract as signed at the office.",
        ),
      };
    });

    saveOfficeRentals(updatedRentals);
  };

  const markOfficeAdvanceDepositPaid = (id: string) => {
    const target = officeRentals.find((rental) => rental.id === id);

    if (!target?.contractSigned) {
      toast({
        title: "Contract Not Signed",
        description:
          "Contract must be signed before marking advance/deposit as paid.",
        variant: "destructive",
      });
      return;
    }

    const updatedRentals = officeRentals.map((rental) => {
      if (rental.id !== id) return rental;

      return {
        ...rental,
        advanceDepositPaid: true,
        advanceDepositPaidDate: new Date().toISOString(),
        leaseStatus: "Advance/Deposit Paid" as OfficeLeaseStatus,
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          rental,
          "ADVANCE_DEPOSIT_PAID",
          "Admin confirmed 1 month advance and 2 months deposit paid in cash at the office.",
        ),
      };
    });

    saveOfficeRentals(updatedRentals);
  };

  const updateOfficeChequeSubmission = (
    id: string,
    submittedChequeCount: number,
    notes?: string,
    receivedByAdmin?: string,
  ) => {
    const updatedRentals = officeRentals.map((rental) => {
      if (rental.id !== id) return rental;

      const safeCount = Math.max(
        0,
        Math.min(Number(submittedChequeCount || 0), rental.requiredChequeCount),
      );

      const isComplete = safeCount >= rental.requiredChequeCount;

      return {
        ...rental,
        submittedChequeCount: safeCount,
        chequesSubmitted: isComplete,
        chequeSubmittedDate: isComplete
          ? new Date().toISOString()
          : rental.chequeSubmittedDate,
        chequeReceivedByAdmin: receivedByAdmin || rental.chequeReceivedByAdmin,
        chequeNotes: notes ?? rental.chequeNotes,
        chequeStatus: isComplete
          ? "Complete"
          : safeCount > 0
            ? "Partial"
            : "Pending",
        leaseStatus: isComplete
          ? ("Cheques Submitted" as OfficeLeaseStatus)
          : rental.leaseStatus,
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          rental,
          "PHYSICAL_CHEQUES_UPDATED",
          `Admin updated physical cheque submission count to ${safeCount}/${rental.requiredChequeCount}.`,
        ),
      };
    });

    saveOfficeRentals(updatedRentals as OfficeRental[]);
  };

  const activateOfficeLease = (id: string) => {
    const target = officeRentals.find((rental) => rental.id === id);

    if (!target) return;

    if (!target.contractSigned) {
      toast({
        title: "Cannot Activate Lease",
        description: "Contract must be signed first.",
        variant: "destructive",
      });
      return;
    }

    if (!target.advanceDepositPaid) {
      toast({
        title: "Cannot Activate Lease",
        description: "Advance and deposit payment must be confirmed first.",
        variant: "destructive",
      });
      return;
    }

    if (
      !target.chequesSubmitted ||
      target.submittedChequeCount < target.requiredChequeCount
    ) {
      toast({
        title: "Cannot Activate Lease",
        description:
          "Required physical cheques must be submitted face-to-face before activating the lease.",
        variant: "destructive",
      });
      return;
    }

    const updatedRentals = officeRentals.map((rental) => {
      if (rental.id !== id) return rental;

      return {
        ...rental,
        leaseStatus: "Active Lease" as OfficeLeaseStatus,
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          rental,
          "OFFICE_LEASE_ACTIVATED",
          "Admin activated office lease after contract signing, cash advance/deposit payment, and physical cheque submission.",
        ),
      };
    });

    saveOfficeRentals(updatedRentals);
  };

  const cancelOfficeRental = (id: string) => {
    const updatedRentals = officeRentals.map((rental) => {
      if (rental.id !== id) return rental;

      return {
        ...rental,
        leaseStatus: "Cancelled" as OfficeLeaseStatus,
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          rental,
          "OFFICE_RENTAL_CANCELLED",
          "Office rental request was cancelled.",
        ),
      };
    });

    saveOfficeRentals(updatedRentals);
  };

  const completeOfficeRental = (id: string) => {
    const updatedRentals = officeRentals.map((rental) => {
      if (rental.id !== id) return rental;

      return {
        ...rental,
        leaseStatus: "Completed" as OfficeLeaseStatus,
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          rental,
          "OFFICE_RENTAL_COMPLETED",
          "Office rental lease was marked as completed.",
        ),
      };
    });

    saveOfficeRentals(updatedRentals);
  };

  return (
    <BookingContext.Provider
      value={{
        bookings,
        officeRentals,
        maintenanceDates,
        maintenanceRecords,
        paymentRecords,
        isLoading,
        _registerDataNeed: registerDataNeed,
        addBooking,
        updateBookingStatus,
        cancelBooking,
        getUserBookings,
        getBookingById,
        modifyBooking,
        requestCancellation,
        approveCancellation,
        declineCancellation,
        rejectCancellation,
        requestModification,
        approveModification,
        declineModification,
        requestRefund,
        markAsRefunded,
        markContractSigned,
        issueReceipt,
        sendBalanceReminder,
        manualRecordOnsitePayment,
        reviewPayment,
        rejectPayment,
        markIncompletePayment,
        toggleMaintenanceDate,
        addMaintenanceRecord,
        removeMaintenanceRecord,
        submitPayment,
        addOfficeRentalRequest,
        getUserOfficeRentals,
        approveOfficeRentalForContractSigning,
        declineOfficeRental,
        markOfficeContractSigned,
        markOfficeAdvanceDepositPaid,
        updateOfficeChequeSubmission,
        activateOfficeLease,
        cancelOfficeRental,
        completeOfficeRental,
      }}
    >
      {children}
    </BookingContext.Provider>
  );
}

export function useBookings() {
  const context = useContext(BookingContext);

  if (context === undefined) {
    throw new Error("useBookings must be used within a BookingProvider");
  }

  return context;
}

// Page-scoped data opt-in. Calling this registers the datasets this component
// (and everything it renders) needs. Firestore listeners for a dataset only run
// while at least one mounted component needs it, and stop when the page
// navigates away — so the global provider stays lightweight.
//
// IMPORTANT: a caller only ever registers (increments) the keys it needs, and
// its cleanup only unregisters (decrements) exactly those keys. It must never
// decrement keys requested by other mounted components — otherwise a sibling
// component (e.g. a dialog) could cancel the page's registration and no
// listener would start.
export function useBookingData(needs: BookingDataNeeds) {
  const context = useContext(BookingContext);

  if (context === undefined) {
    throw new Error("useBookingData must be used within a BookingProvider");
  }

  const register = context._registerDataNeed;
  const registeredRef = useRef<Set<BookingDataKey>>(new Set());

  useEffect(() => {
    const registered = new Set<BookingDataKey>();
    for (const key of DATA_KEYS) {
      if (needs[key] === true) {
        register(key, true);
        registered.add(key);
      }
    }
    registeredRef.current = registered;
    return () => {
      for (const key of registered) {
        register(key, false);
      }
      registeredRef.current = new Set();
    };
  }, [needs.bookings, needs.officeRentals, needs.maintenance, needs.payments, register]);

  return context;
}
