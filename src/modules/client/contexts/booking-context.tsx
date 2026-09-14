"use client";

import React, { createContext, useContext, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useToast } from "@/src/modules/shared/hooks/use-toast";
import { useAuth } from "@/src/modules/shared/auth/auth-context";
import { perfListener, perfMark } from "@/src/modules/shared/lib/perf-trace";
import { db } from "@/lib/firebase"
import { createNotification } from "@/src/modules/shared/lib/notifications"
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  where,
  limit,
  onSnapshot,
  runTransaction,
  increment,
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
 * Individual payment submission record. The client writes one document per
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
  updateBookingStatus: (id: string, status: BookingStatus) => void;
  cancelBooking: (id: string) => void;
  deleteBooking: (id: string) => void;
  getUserBookings: (userId: string) => Booking[];
  getBookingById: (id: string) => Booking | undefined;
  modifyBooking: (id: string, updates: Partial<Booking>) => void;

  requestCancellation: (id: string, reason: string) => void;
  approveCancellation: (id: string) => void;
  declineCancellation: (id: string, reason: string) => void;
  rejectCancellation: (id: string, reason?: string) => void;
  requestModification: (id: string, changes: Record<string, unknown>, reason: string) => void;
  approveModification: (id: string) => void;
  declineModification: (id: string, reason: string) => void;
  markRefundReady: (id: string) => void;
  markRefundClaimed: (id: string) => void;
  requestRefund: (id: string) => void;
  markAsRefunded: (id: string) => void;

  markContractSigned: (id: string, signedBy?: string) => void;
  issueReceipt: (id: string) => void;

  verifyCashPayment: (id: string, paymentType?: "downpayment" | "full") => void;
  settleRemainingBalance: (id: string, method?: "cash" | "bank") => void;
  manualRecordOnsitePayment: (id: string, paymentData: {
    paymentType: "downpayment" | "remaining_balance" | "full_payment";
    amountReceived: number;
    adminNote?: string;
    adminName?: string;
  }) => Booking | null;
  verifyPayment: (id: string, reviewData?: { verifiedAmount?: number; adminNote?: string; adminName?: string; paymentRecordId?: string }) => void;
  rejectPayment: (id: string, reason?: string, adminName?: string, paymentRecordId?: string) => void;
  markIncompletePayment: (id: string, data: { verifiedAmount: number; adminNote: string; adminName?: string; paymentRecordId?: string }) => void;
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
  ) => void;

  verifyOfficeReservationPayment: (id: string) => void;
  addOfficeCheckPayment: (
    bookingId: string,
    paymentData: Omit<
      OfficeCheckPayment,
      "id" | "createdAt" | "updatedAt" | "paymentType"
    >,
  ) => void;
  updateOfficeCheckPayment: (
    bookingId: string,
    paymentId: string,
    paymentData: Partial<Omit<OfficeCheckPayment, "id" | "createdAt">>,
  ) => void;
  deleteOfficeCheckPayment: (bookingId: string, paymentId: string) => void;

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
const receiptsRef = collection(db, "receipts")
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

function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  if (booking.status === "cancelled" || booking.status === "completed") return false;
  if (booking.status === "cancellation_requested") return false;
  if (booking.cancellationStatus === "Under Review" || booking.cancellationStatus === "Pending" || booking.cancellationStatus === "Approved") return false;
  if (!canShowCancellationNotice(booking)) return false;
  const daysBefore = calculateDaysBeforeEvent(booking.date);
  return daysBefore > 0;
}

export function getRestoredStatus(booking: Booking): { status: BookingStatus; bookingStatus: BookingStatusLabel } {
  const prevStatus = booking.previousStatus || booking.modificationPreviousStatus
  const prevBookingStatus = booking.previousBookingStatus || booking.modificationPreviousBookingStatus
  const isUnpaidNotSecured = booking.paymentStatus === "unpaid" && !booking.isSlotSecured && !isBookingSlotSecured(booking)

  if (prevStatus && prevBookingStatus) {
    if (isUnpaidNotSecured) {
      return { status: "pending", bookingStatus: "Pending Verification" }
    }
    return { status: prevStatus as BookingStatus, bookingStatus: prevBookingStatus as BookingStatusLabel }
  }

  if (isUnpaidNotSecured) {
    return { status: "pending", bookingStatus: "Pending Verification" }
  }

  return { status: "confirmed", bookingStatus: "Confirmed" }
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


function getBookingEventDate(booking: Booking) {
  return booking.date;
}

function getDownpaymentAmount(booking: Booking) {
  const total = getSafePrice(booking.totalPrice);
  const pct = typeof booking.downPaymentPercentage === "number" && booking.downPaymentPercentage > 0
    ? booking.downPaymentPercentage
    : 50;
  return total * (pct / 100);
}

function getSelectedDownpaymentAmount(booking: Booking) {
  if (typeof booking.selectedDownpaymentAmount === "number" && booking.selectedDownpaymentAmount > 0) {
    return booking.selectedDownpaymentAmount;
  }
  return getDownpaymentAmount(booking);
}

function recalculatePaymentStage(booking: Booking): Booking {
  if (isOfficeBooking(booking)) {
    const total = getSafePrice(booking.totalPrice);
    const amountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;
    if (amountPaid >= total) {
      return {
        ...booking,
        paymentStage: "Fully Paid",
        paymentStatus: "paid" as PaymentStatus,
        balanceStatus: "Settled",
        remainingBalance: 0,
        remainingBalancePaid: true,
      };
    }
    return booking;
  }

  const total = getSafePrice(booking.totalPrice);
  const amountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;
  const downpaymentPaid = typeof booking.downpaymentPaid === "number" ? booking.downpaymentPaid : 0;
  const selectedDP = getSelectedDownpaymentAmount(booking);

  if (amountPaid >= total) {
    return {
      ...booking,
      paymentStage: "Fully Paid",
      paymentStatus: "paid" as PaymentStatus,
      balanceStatus: "Settled",
      downpaymentRemaining: 0,
      downpaymentPaid: downpaymentPaid,
      remainingBalance: 0,
      remainingBalancePaid: true,
    };
  }

  if (amountPaid > 0) {
    // Only downpayment bookings carry a required-downpayment stage. A
    // verified payment that has NOT yet reached the required downpayment
    // leaves the booking INCOMPLETE — the stored status must never read as
    // "partial" (settleable) until the downpayment is complete.
    const hasDownpaymentRequirement =
      String(booking.paymentType || "").toLowerCase() === "downpayment";
    const isDownpaymentComplete =
      !hasDownpaymentRequirement || downpaymentPaid >= selectedDP;
    return {
      ...booking,
      paymentStage: isDownpaymentComplete ? "Settle Remaining Balance" : "Complete Downpayment",
      paymentStatus: (isDownpaymentComplete ? "partial" : "incomplete") as PaymentStatus,
      balanceStatus: "With Remaining Balance",
      downpaymentRemaining:
        hasDownpaymentRequirement && !isDownpaymentComplete
          ? Math.max(selectedDP - downpaymentPaid, 0)
          : 0,
      downpaymentPaid: downpaymentPaid,
      remainingBalance: total - amountPaid,
    };
  }

  return booking;
}

function getCurrentAmountPaid(booking: Booking) {
  if (typeof booking.amountPaid === "number") return booking.amountPaid;

  return 0;
}

function hasRemainingBalance(booking: Booking) {
  const total = getSafePrice(booking.totalPrice);
  const paid = getCurrentAmountPaid(booking);

  return (
    booking.status === "confirmed" &&
    booking.paymentType === "downpayment" &&
    paid < total &&
    booking.paymentStatus !== "paid" &&
    booking.paymentStatus !== "verified" &&
    booking.remainingBalancePaid !== true
  );
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

function isUnresolvedPaymentRecord(record: PaymentRecord) {
  const status = String(record?.status || "").toLowerCase();
  const verificationStatus = String(record?.verificationStatus || "").toLowerCase();
  const isResolved =
    status === "verified" ||
    status === "rejected" ||
    status === "incomplete" ||
    verificationStatus === "verified" ||
    verificationStatus === "rejected" ||
    verificationStatus === "incomplete";
  return !isResolved;
}

function getOfficeReservationFee(booking: Partial<Booking>) {
  return getSafePrice(
    booking.officeReservationFee || booking.totalPrice || DEFAULT_TOTAL_PRICE,
  );
}

function createOfficePaymentId() {
  return createLocalId("CHECK");
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

async function loadReceipts(bookingId?: string): Promise<BookingReceipt[]> {
  try {
    const constraints: any[] = bookingId
      ? [where("bookingId", "==", bookingId)]
      : [];
    if (constraints.length === 0) constraints.push(orderBy("dateGenerated", "desc"));
    const snapshot = await getDocs(query(receiptsRef, ...constraints))
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
        contractTerm: d.contractTerm || "",
        paymentPurpose: d.paymentPurpose || "",
        paymentMethod: d.paymentMethod || "",
        amountPaid: d.amountPaid || 0,
        paymentAmount: d.paymentAmount || 0,
        remainingBalance: typeof d.remainingBalance === "number" ? d.remainingBalance : undefined,
        paymentStatus: d.paymentStatus || "",
        dateGenerated: d.dateGenerated || "",
        dateIssued: d.dateIssued || "",
        paymentSubmittedAt: d.paymentSubmittedAt || "",
      })
    })
    return result
  } catch {
    return []
  }
}

async function saveStoredReceipt(receipt: BookingReceipt) {
  await setDoc(doc(receiptsRef, receipt.receiptNumber), {
    receiptNumber: receipt.receiptNumber,
    bookingId: receipt.bookingId,
    paymentId: receipt.paymentId || "",
    fullName: receipt.fullName,
    bookingDate: receipt.bookingDate,
    startDate: receipt.startDate,
    endDate: receipt.endDate,
    rentalType: receipt.rentalType,
    bookingType: receipt.bookingType,
    contractTerm: receipt.contractTerm || "",
    paymentPurpose: receipt.paymentPurpose,
    paymentMethod: receipt.paymentMethod,
    amountPaid: receipt.amountPaid,
    paymentAmount: receipt.paymentAmount,
    remainingBalance: typeof receipt.remainingBalance === "number" ? receipt.remainingBalance : 0,
    paymentStatus: receipt.paymentStatus,
    dateGenerated: receipt.dateGenerated,
    dateIssued: receipt.dateIssued,
    paymentSubmittedAt: receipt.paymentSubmittedAt || "",
  })
}

async function getStoredReceiptByBookingId(bookingId: string): Promise<BookingReceipt | undefined> {
  try {
    const snapshot = await getDocs(
      query(receiptsRef, where("bookingId", "==", bookingId), limit(1)),
    )
    let found: BookingReceipt | undefined
    snapshot.forEach((docSnap) => {
      const d = docSnap.data()
      if (d.bookingId === bookingId) {
        found = {
          receiptNumber: d.receiptNumber || "",
          bookingId: d.bookingId || "",
          paymentId: d.paymentId || undefined,
          fullName: d.fullName || "",
          bookingDate: d.bookingDate || "",
          startDate: d.startDate || "",
          endDate: d.endDate || "",
          rentalType: d.rentalType || "",
          bookingType: d.bookingType || "",
          contractTerm: d.contractTerm || "",
          paymentPurpose: d.paymentPurpose || "",
          paymentMethod: d.paymentMethod || "",
          amountPaid: d.amountPaid || 0,
          paymentAmount: d.paymentAmount || 0,
          remainingBalance: typeof d.remainingBalance === "number" ? d.remainingBalance : undefined,
          paymentStatus: d.paymentStatus || "",
          dateGenerated: d.dateGenerated || "",
          dateIssued: d.dateIssued || "",
          paymentSubmittedAt: d.paymentSubmittedAt || "",
        }
      }
    })
    return found
  } catch {
    return undefined
  }
}

function formatOfficeContractTerm(term?: OfficeRentalTerm) {
  if (term === "6_months") return "6 Months";
  if (term === "1_year") return "1 Year";
  if (term === "2_years") return "2 Years";
  return undefined;
}

function addMonthsToDate(dateValue?: string, months = 0) {
  const start = parseLocalDate(dateValue);
  if (!start || months <= 0) return dateValue || "Not set";

  const end = new Date(start);
  end.setMonth(end.getMonth() + months);

  const y = end.getFullYear();
  const m = String(end.getMonth() + 1).padStart(2, "0");
  const d = String(end.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getOfficeTermMonths(term?: OfficeRentalTerm) {
  if (term === "6_months") return 6;
  if (term === "1_year") return 12;
  if (term === "2_years") return 24;
  return 0;
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

function getReceiptPaymentMethodLabel(method?: Booking["paymentMethod"]) {
  if (method === "cash") return "Pay at the Office";
  if (method === "bank") return "Bank Transfer";
  return "Not specified";
}

function getReceiptPaymentPurpose(booking: Booking) {
  if (isOfficeBooking(booking)) {
    return "Slot Reservation Only - not full payment, not monthly rental payment, and not cheque payment.";
  }

  if (booking.paymentType === "downpayment") return "Event Venue Down Payment";
  if (booking.paymentType === "full") return "Event Venue Full Payment";
  return "Event Venue Payment";
}

function getReceiptPaymentAmount(booking: Booking) {
  const lastPayment = Number(booking.lastPaymentAmount);
  if (Number.isFinite(lastPayment) && lastPayment > 0) return lastPayment;
  const verifiedAmount = Number((booking as any).paymentVerifiedAmount);
  if (Number.isFinite(verifiedAmount) && verifiedAmount > 0) return verifiedAmount;
  const submittedAmount = Number(booking.paymentAmount);
  if (Number.isFinite(submittedAmount) && submittedAmount > 0) return submittedAmount;
  const paid = Number(booking.amountPaid);
  if (Number.isFinite(paid) && paid > 0) {
    if (isOfficeBooking(booking)) return getOfficeReservationFee(booking);
    return paid;
  }
  return getSafePrice(booking.totalPrice);
}

function getReceiptRemainingBalance(booking: Booking, totalAmount: number) {
  if (
    typeof booking.remainingBalance === "number" &&
    Number.isFinite(booking.remainingBalance)
  ) {
    return Math.max(booking.remainingBalance, 0);
  }
  const paid = Number(booking.amountPaid ?? 0);
  return Math.max(totalAmount - paid, 0);
}

function generateUniqueReceiptNumber(existingReceipts?: BookingReceipt[]): string {
  const year = new Date().getFullYear();
  const used = new Set(
    (existingReceipts || [])
      .map((r) => r.receiptNumber)
      .filter((n): n is string => Boolean(n)),
  );
  let receiptNumber = "";
  do {
    const seq = Math.floor(100000 + Math.random() * 900000);
    receiptNumber = `ER-${year}-${seq}`;
  } while (used.has(receiptNumber));
  return receiptNumber;
}

function buildAutoReceipt(
  booking: Booking,
  generatedAt = new Date().toISOString(),
  existingReceipts?: BookingReceipt[],
  paymentId?: string,
) {
  const officeBooking = isOfficeBooking(booking);
  const officeTerm = officeBooking ? booking.officeRentalTerm || "6_months" : "";
  const contractTerm = officeBooking ? formatOfficeContractTerm(officeTerm as OfficeRentalTerm) : "";
  const totalAmount = getSafePrice(booking.totalPrice);
  const amountPaid = getReceiptPaymentAmount(booking);

  const receipt: BookingReceipt = {
    receiptNumber: generateUniqueReceiptNumber(existingReceipts),
    bookingId: booking.id,
    // Reliable per-payment reference — this receipt belongs to THIS verified
    // payment record only (payments collection doc id), never to the booking
    // as a whole and never to another payment.
    paymentId: paymentId || undefined,
    fullName: booking.userInfo?.name || "Client",
    bookingDate: booking.createdAt || generatedAt,
    startDate: booking.date || "Not set",
    endDate: officeBooking
      ? addMonthsToDate(booking.date, getOfficeTermMonths(officeTerm as OfficeRentalTerm))
      : booking.date || "Not set",
    rentalType: officeBooking ? "Office Space Rental" : "Event Venue Booking",
    bookingType: officeBooking ? "Office Space Rental" : booking.eventType || "Event Venue Booking",
    contractTerm: contractTerm || "",
    paymentPurpose: getReceiptPaymentPurpose(booking),
    paymentMethod: getReceiptPaymentMethodLabel(booking.paymentMethod),
    amountPaid,
    paymentAmount: amountPaid,
    remainingBalance: officeBooking ? 0 : getReceiptRemainingBalance(booking, totalAmount),
    paymentStatus: officeBooking ? "Reservation Secured" : booking.paymentStatus || "paid",
    dateGenerated: generatedAt,
    dateIssued: generatedAt,
    paymentSubmittedAt: booking.paymentSubmittedAt || generatedAt,
  };

  return receipt;
}

function getReceiptHistory(booking: Booking): BookingReceipt[] {
  if (Array.isArray(booking.paymentReceipts) && booking.paymentReceipts.length > 0) {
    return booking.paymentReceipts;
  }
  if (booking.receipt) return [booking.receipt];
  return [];
}

function attachAutoReceipt(booking: Booking, paymentId?: string) {
  const generatedAt = new Date().toISOString();
  const history = getReceiptHistory(booking);
  const receipt = buildAutoReceipt(booking, generatedAt, history, paymentId);

  const last = history[history.length - 1];
  const duplicated =
    last != null &&
    Number(last.paymentAmount) === Number(receipt.paymentAmount) &&
    Number(last.remainingBalance ?? -1) === Number(receipt.remainingBalance ?? -1) &&
    String(last.paymentMethod || "") === String(receipt.paymentMethod || "") &&
    Boolean(last.dateGenerated) &&
    Math.abs(new Date(generatedAt).getTime() - new Date(last.dateGenerated).getTime()) < 60000;

  if (duplicated) {
    return booking;
  }

  const nextHistory = [...history, receipt];

  saveStoredReceipt(receipt).catch(() => {});

  return {
    ...booking,
    paymentReceipts: nextHistory,
    receiptIssued: true,
    receiptNumber: receipt.receiptNumber,
    receiptIssuedAt: receipt.dateGenerated,
    receipt,
    adminLogs: booking.receiptIssued
      ? booking.adminLogs
      : makeAdminLog(
          booking,
          "AUTO_GENERATE_E_RECEIPT",
          `System automatically generated e-receipt ${receipt.receiptNumber} after admin payment verification.`,
        ),
  } as Booking;
}

/**
 * HISTORICAL RECEIPT REMAINING BALANCE
 * =====================================
 * For each individual payment receipt, the "Remaining Balance" means:
 *   THE BOOKING BALANCE IMMEDIATELY AFTER THAT SPECIFIC PAYMENT.
 *
 * It is a CUMULATIVE historical snapshot, NOT the current booking balance.
 * Once written, it must never change when future payments are made.
 *
 * Calculation:
 *   1. Sort all payment records for this booking chronologically (oldest first).
 *   2. Sum the "credited amount" of every record from #1 through the target.
 *   3. remainingBalance = max(0, bookingTotal - cumulativePaid)
 *
 * Credited amount per record status:
 *   - VERIFIED     → the full amount (accepted money).
 *   - INCOMPLETE   → amountReceived (actual received, not the submitted request).
 *   - REJECTED     → ₱0.
 *   - FOR REVIEW / PENDING / AWAITING → the submitted amount (it exists on the
 *     receipt as a real transaction even though admin hasn't decided yet).
 */
function computeReceiptRemaining(
  bookingTotal: number,
  allRecords: PaymentRecord[],
  targetRecordId: string | undefined,
  targetRecordOverrides?: {
    amount?: number;
    amountPaid?: number;
    amountReceived?: number;
    status?: string;
  },
  bookingId?: string,
): number {
  // Filter records belonging to this booking
  const matched = bookingId
    ? allRecords.filter((record) => {
        const target = String(bookingId || "").trim().toLowerCase()
        const byId = String(record.bookingId || "").trim().toLowerCase()
        const byCode = String(record.bookingCode || "").trim().toLowerCase()
        return byId === target || byCode === target
      })
    : allRecords

  // Sort chronologically — oldest first (ascending by submittedAt)
  const sorted = [...matched].sort((a, b) => {
    const aTime = new Date(a.submittedAt || a.updatedAt || 0).getTime()
    const bTime = new Date(b.submittedAt || b.updatedAt || 0).getTime()
    return aTime - bTime
  })

  // Apply overrides to the target record if present, then take records up to
  // and including the target to compute cumulative paid through that payment.
  let recordsUpToTarget: PaymentRecord[]

  const targetIndex = sorted.findIndex((r) => r.id === targetRecordId)
  if (targetIndex >= 0) {
    recordsUpToTarget = sorted.slice(0, targetIndex + 1).map((record, i) => {
      if (i !== targetIndex || !targetRecordOverrides) return record
      return {
        ...record,
        ...(typeof targetRecordOverrides.amount === "number"
          ? { amount: targetRecordOverrides.amount }
          : {}),
        ...(typeof targetRecordOverrides.amountPaid === "number"
          ? { amountPaid: targetRecordOverrides.amountPaid }
          : {}),
        ...(typeof targetRecordOverrides.amountReceived === "number"
          ? { amountReceived: targetRecordOverrides.amountReceived }
          : {}),
        ...(typeof targetRecordOverrides.status === "string"
          ? { status: targetRecordOverrides.status, verificationStatus: targetRecordOverrides.status }
          : {}),
      }
    })
  } else {
    // Target record not yet in the array (new payment at submission time).
    // Append a synthetic record with the overrides so it's included in the
    // cumulative sum.
    const synthetic: PaymentRecord = {
      id: targetRecordId || `_pending_${Date.now()}`,
      bookingId: bookingId || "",
      amount: targetRecordOverrides?.amount || 0,
      amountPaid: targetRecordOverrides?.amountPaid || 0,
      amountReceived: targetRecordOverrides?.amountReceived || 0,
      status: targetRecordOverrides?.status || "For Verification",
      verificationStatus: targetRecordOverrides?.status || "For Verification",
      submittedAt: new Date().toISOString(),
    } as PaymentRecord
    recordsUpToTarget = [...sorted, synthetic]
  }

  // Sum the credited amount of every record up to and including the target
  let cumulativePaid = 0
  for (const record of recordsUpToTarget) {
    cumulativePaid += receiptCreditedAmount(record)
  }

  return Math.max(0, bookingTotal - cumulativePaid)
}

/** Credited amount for a single receipt snapshot. */
function receiptCreditedAmount(record: PaymentRecord): number {
  const status = String(record?.status || record?.verificationStatus || "").toLowerCase()
  if (status === "verified") {
    return Number(record?.amount || record?.amountPaid || 0)
  }
  if (status === "incomplete") {
    const received = Number(record?.amountReceived || 0)
    // Incomplete always credits the ACTUAL money received.
    // Fall back to submitted amount when amountReceived was never set.
    return received > 0 ? received : Number(record?.amount || record?.amountPaid || 0)
  }
  if (status === "rejected") {
    return 0
  }
  // For Review / Pending / Awaiting — NOT yet accepted money. The receipt
  // remaining balance must reflect only verified/accepted payments, so
  // unresolved records credit ₱0 here.
  return 0
}

function getReceiptPaymentStatusLabel(status: string): string {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "verified") return "Verified";
  if (normalized === "rejected") return "Rejected";
  if (normalized === "incomplete") return "Incomplete";
  if (normalized === "awaiting onsite payment") return "Awaiting Onsite Payment";
  return "For Verification";
}

/**
 * TRANSACTION RECEIPT — created at PAYMENT SUBMISSION time for EVERY payment
 * attempt, regardless of outcome. A receipt is a transaction RECORD; it is
 * NOT proof of acceptance. Only admin VERIFICATION marks a payment accepted.
 * The receipt carries the exact paymentId so it can never be shared with or
 * inherited by another payment.
 */
function buildTransactionReceipt(
  booking: Booking,
  payment: {
    id: string;
    amount: number;
    methodLabel?: string;
    term?: string;
    status: string;
    submittedAt?: string;
    referenceNo?: string;
  },
  existingReceipts?: BookingReceipt[],
  remainingOverride?: number,
): BookingReceipt {
  const submittedAt = payment.submittedAt || new Date().toISOString();
  const officeBooking = isOfficeBooking(booking);
  const officeTerm = officeBooking ? booking.officeRentalTerm || "6_months" : "";
  const totalAmount = getSafePrice(booking.totalPrice);
  const amount = Number(payment.amount || 0);

  return {
    receiptNumber: generateUniqueReceiptNumber(existingReceipts),
    bookingId: booking.id,
    paymentId: payment.id,
    fullName: booking.userInfo?.name || "Client",
    bookingDate: booking.createdAt || submittedAt,
    startDate: booking.date || "Not set",
    endDate:
      officeBooking
        ? addMonthsToDate(booking.date, getOfficeTermMonths(officeTerm as OfficeRentalTerm))
        : booking.date || "Not set",
    rentalType: officeBooking ? "Office Space Rental" : "Event Venue Booking",
    bookingType: officeBooking ? "Office Space Rental" : booking.eventType || "Event Venue Booking",
    contractTerm: officeBooking ? formatOfficeContractTerm(officeTerm as OfficeRentalTerm) : "",
    paymentPurpose: payment.term || getReceiptPaymentPurpose(booking),
    paymentMethod: payment.methodLabel || getReceiptPaymentMethodLabel(booking.paymentMethod),
    amountPaid: amount,
    paymentAmount: amount,
    // Use the canonical remaining when provided; fall back to the legacy
    // total − stored-amountPaid calculation for backward compatibility.
    remainingBalance:
      typeof remainingOverride === "number"
        ? remainingOverride
        : Math.max(totalAmount - getSafePrice(booking.amountPaid), 0),
    // Transaction state at submission — NEVER implies acceptance.
    paymentStatus: getReceiptPaymentStatusLabel(payment.status),
    dateGenerated: submittedAt,
    dateIssued: submittedAt,
    paymentSubmittedAt: submittedAt,
  };
}

/** Appends the transaction receipt to the booking doc's receipt history. */
function attachTransactionReceipt(booking: Booking, receipt: BookingReceipt): Booking {
  const history = getReceiptHistory(booking);
  return {
    ...booking,
    paymentReceipts: [...history, receipt],
    receiptIssued: true,
    receiptNumber: receipt.receiptNumber,
    receiptIssuedAt: receipt.dateGenerated,
  } as Booking;
}

/** Finds THIS payment's own transaction receipt in the booking's history. */
function findPaymentReceipt(
  booking: Booking,
  paymentId?: string,
  submittedAt?: string,
): { receipt: BookingReceipt; index: number; history: BookingReceipt[] } | null {
  const history = getReceiptHistory(booking);
  if (paymentId) {
    const index = history.findIndex(
      (receiptEntry) =>
        String(receiptEntry.paymentId || "") &&
        String(receiptEntry.paymentId) === String(paymentId),
    );
    if (index >= 0) return { receipt: history[index], index, history };
  }
  // Legacy fallback ONLY: receipts created before paymentId existed are tied
  // by the pinned exact submission timestamp — never nearest/latest.
  if (submittedAt) {
    const index = history.findIndex(
      (receiptEntry) =>
        String(receiptEntry.paymentSubmittedAt || "") &&
        !receiptEntry.paymentId &&
        String(receiptEntry.paymentSubmittedAt) === String(submittedAt),
    );
    if (index >= 0) return { receipt: history[index], index, history };
  }
  return null;
}

/**
 * ADMIN VERIFY — updates THIS payment's existing transaction receipt IN PLACE
 * (same paymentId, same receipt number). Creates a receipt only when the
 * payment genuinely has none (legacy submissions from before transaction
 * receipts existed). Verification is what marks the receipt ACCEPTED.
 */
function upsertVerifiedReceipt(
  booking: Booking,
  paymentId: string | undefined,
  verified: { amountPaid: number; remainingBalance: number },
): Booking {
  const existing = findPaymentReceipt(booking, paymentId, booking.paymentSubmittedAt);

  if (existing) {
    const nextHistory = [...existing.history];
    nextHistory[existing.index] = {
      ...existing.receipt,
      amountPaid: verified.amountPaid,
      paymentAmount: verified.amountPaid,
      remainingBalance: verified.remainingBalance,
      paymentStatus: "Verified",
    };
    saveStoredReceipt(nextHistory[existing.index]).catch(() => {});
    return {
      ...booking,
      paymentReceipts: nextHistory,
      receipt: nextHistory[nextHistory.length - 1],
      receiptNumber: nextHistory[existing.index].receiptNumber,
    } as Booking;
  }

  // Legacy fallback: no transaction receipt was ever created for this payment
  // (submissions from before transaction receipts existed) — create one now,
  // tied to THIS payment only.
  return attachAutoReceipt({ ...booking }, paymentId);
}

/**
 * ADMIN REJECT / INCOMPLETE — updates THIS payment's transaction receipt
 * status in place (same paymentId). The receipt stays visible with its own
 * transaction state and never implies acceptance.
 */
function patchPaymentReceiptStatus(
  booking: Booking,
  paymentId: string | undefined,
  status: "Rejected" | "Incomplete",
  extras?: { remainingBalance?: number; amountPaid?: number },
): Booking {
  const existing = findPaymentReceipt(booking, paymentId, booking.paymentSubmittedAt);
  if (!existing) return booking;
  const nextHistory = [...existing.history];
  nextHistory[existing.index] = {
    ...existing.receipt,
    // The receipt amount must reflect the ACTUAL money of THIS payment —
    // e.g. ₱5,500 received on a ₱7,500 requested downpayment marked
    // INCOMPLETE. Only the calling action provides it; other actions leave
    // the payment's own amount untouched.
    ...(extras && typeof extras.amountPaid === "number" && extras.amountPaid > 0
      ? { amountPaid: extras.amountPaid, paymentAmount: extras.amountPaid }
      : {}),
    ...(extras && typeof extras.remainingBalance === "number"
      ? { remainingBalance: extras.remainingBalance }
      : {}),
    paymentStatus: status,
  };
  saveStoredReceipt(nextHistory[existing.index]).catch(() => {});
  return {
    ...booking,
    paymentReceipts: nextHistory,
    receipt: nextHistory[nextHistory.length - 1],
  } as Booking;
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
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [officeRentals, setOfficeRentals] = useState<OfficeRental[]>([]);
  const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceRecord[]>([]);
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const dataNeedCounts = useRef<Record<BookingDataKey, number>>({ bookings: 0, officeRentals: 0, maintenance: 0, payments: 0 });
  const [, forceDataNeedRender] = useReducer((count: number) => count + 1, 0);

  const registerDataNeed = useCallback((key: BookingDataKey, now: boolean) => {
    // NOTE: Always applied (no early-return on same value) because React
    // StrictMode double-invokes effects in dev: mount → cleanup → mount.
    // A `now === before` guard would let the cleanup's decrement win, dropping
    // the need count to 0 and permanently preventing listeners from starting.
    dataNeedCounts.current[key] = Math.max(0, dataNeedCounts.current[key] + (now ? 1 : -1));
    forceDataNeedRender();
  }, []);

  const activeNeeds = useMemo(() => {
    const c = dataNeedCounts.current;
    return {
      bookings: c.bookings > 0,
      officeRentals: c.officeRentals > 0,
      maintenance: c.maintenance > 0,
      payments: c.payments > 0,
    };
  }, [dataNeedCounts.current.bookings, dataNeedCounts.current.officeRentals, dataNeedCounts.current.maintenance, dataNeedCounts.current.payments]);
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
    if (typeof window === "undefined" || !user) {
      console.log(
        "[DEBUG][BOOKING PROVIDER] effect early-return — window:",
        typeof window,
        "user:",
        user ? `uid=${user.id} role=${user.role}` : "null",
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

    const uid = user.id;
    const isAdminScope = user.role === "admin" || user.role === "staff";
    console.log(
      `[DEBUG][BOOKING PROVIDER] effect running — uid=${uid} role=${user.role} adminScope=${isAdminScope} activeKey=${activeKey} needs=${JSON.stringify(activeNeeds)}`,
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
      console.log("[Firestore Listener START] Bookings", isAdminScope ? "(admin scope)" : `(client: ${uid})`)
      console.log(
        `[DEBUG][Bookings] query — collection: bookings, where: ${isAdminScope ? "NONE (admin sees ALL)" : "userId == uid"}, orderBy: createdAt ${isAdminScope ? "asc" : "desc"}, limit: NONE`,
      )
      const unsubBookings = startListener(
        "Bookings",
        bookingsRef,
        () => (isAdminScope ? [orderBy("createdAt", "asc")] : [where("userId", "==", uid), orderBy("createdAt", "desc")]),
        () => (isAdminScope ? null : [where("userId", "==", uid)]),
        (docSnap) => normalizeBookingForNewFields({ ...(docSnap.data() as Booking), id: docSnap.id }),
        setBookings,
        "bookings",
      );
      unsubs.push(unsubBookings);
    }

    // Real-time subscription for office rentals (client-scoped for Clients).
    if (activeNeeds.officeRentals) {
      console.log("[Firestore Listener START] OfficeRentals", isAdminScope ? "(admin scope)" : `(client: ${uid})`)
      const unsubOffice = startListener(
        "OfficeRentals",
        officeRentalsRef,
        () => (isAdminScope ? [orderBy("createdAt", "asc")] : [where("userId", "==", uid), orderBy("createdAt", "desc")]),
        () => (isAdminScope ? null : [where("userId", "==", uid)]),
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
      console.log("[Firestore Listener START] Payments", isAdminScope ? "(admin scope)" : `(client: ${uid})`)
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
          amount: typeof d.amount === "number" ? d.amount : Number(d.amount || 0),
          amountPaid: typeof d.amountPaid === "number" ? d.amountPaid : Number(d.amountPaid || 0),
          referenceNo: d.referenceNo || "",
          proofUrl: d.proofUrl || "",
          status: d.status || "",
          verificationStatus: d.verificationStatus || "",
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
        isAdminScope
          ? query(paymentsRef)
          : query(paymentsRef, where("customerId", "==", uid)),
      )
        .then((snapshot) => {
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
      () => (isAdminScope ? [orderBy("submittedAt", "desc")] : [where("customerId", "==", uid), orderBy("submittedAt", "desc")]),
      () => (isAdminScope ? null : [where("customerId", "==", uid)]),
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
  }, [user?.id, user?.role, activeKey]);

  const saveBookings = async (newBookings: Booking[]) => {
    const normalizedBookings = newBookings.map(normalizeBookingForNewFields);
    const prevMap = new Map(bookings.map(b => [b.id, b]))
    const nextMap = new Map(normalizedBookings.map(b => [b.id, b]))

    const batch = writeBatch(db)
    let writeCount = 0
    let deleteCount = 0

    function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
      const cleaned: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        if (value === undefined) {
          console.error("[stripUndefined] Removed undefined field:", key)
          continue
        }
        if (value && typeof value === "object" && !Array.isArray(value)) {
          cleaned[key] = stripUndefined(value as Record<string, unknown>)
        } else {
          cleaned[key] = value
        }
      }
      return cleaned
    }

    try {
      for (const [id, next] of nextMap) {
        const prev = prevMap.get(id)
        if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
          const { id: _id, ...data } = next
          const sanitized = stripUndefined(data as Record<string, unknown>)
          const docRef = doc(bookingsRef, id)
          writeCount++
          batch.set(docRef, { ...sanitized, updatedAt: new Date().toISOString() }, { merge: true })
        }
      }
      for (const id of prevMap.keys()) {
        if (!nextMap.has(id)) {
          const docRef = doc(bookingsRef, id)
          deleteCount++
          batch.delete(docRef)
        }
      }

      await batch.commit()

      setBookings(normalizedBookings);
    } catch (err: any) {
      console.error("[Booking:saveBookings] Firestore write FAILED:", err?.code || err?.message || err)
      throw err
    }
  };

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
    const newId = await getNextBookingNumber();

    const newBooking: Booking = {
      ...bookingData,
      id: newId,
      endDate: bookingData.endDate || (isOfficeBooking(bookingData as Booking) ? calculateOfficeEndDate(bookingData.date, (bookingData as Booking).officeRentalTerm) : ""),
      status: bookingData.status || "pending",
      bookingStatus: bookingData.bookingStatus || "Pending Verification",
      isSlotSecured: bookingData.isSlotSecured || false,
      cancellationRequested: bookingData.cancellationRequested || false,
      cancellationStatus: bookingData.cancellationStatus || "None",
      refundStatus: bookingData.refundStatus || "Not Applicable",
      paymentStatus: bookingData.paymentStatus || "unpaid",
      amountPaid: bookingData.amountPaid || 0,
      downPaymentPercentage: bookingData.downPaymentPercentage ?? 50,
      downPaymentAmount: bookingData.downPaymentAmount ?? getSafePrice(bookingData.totalPrice) * ((bookingData.downPaymentPercentage ?? 50) / 100),
      selectedDownpaymentAmount: bookingData.selectedDownpaymentAmount ?? bookingData.downPaymentAmount ?? getSafePrice(bookingData.totalPrice) * ((bookingData.downPaymentPercentage ?? 50) / 100),
      downpaymentPaid: 0,
      downpaymentRemaining: 0,
      paymentStage: "Initial Payment",
      remainingBalance:
        bookingData.remainingBalance || getSafePrice(bookingData.totalPrice),
      remainingBalancePaid: bookingData.remainingBalancePaid || false,
      contractSigningRequired: true,
      contractSigned: bookingData.contractSigned || false,
      contractStatus: "Not Available" as ContractStatus,
      receiptIssued: bookingData.receiptIssued || false,
      refundEligible: false,
      adminLogs: [
        ...(bookingData.adminLogs || []),
        {
          action: "CONTRACT_SIGNING_REQUIRED",
          message:
            "Please visit One Estela Place office after booking to sign the contract and finalize your reservation.",
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Booking;

    await saveBookings([...bookings, newBooking])
    const clientName = newBooking.userInfo?.name || newBooking.eventName || "A client"
    const isOffice = isOfficeBooking(newBooking)
    const venueName = isOffice ? (newBooking.venue || "an office") : (newBooking.venue || newBooking.eventName || "a venue")
    createNotification({
      type: "booking_submitted",
      title: isOffice ? "New Office Rental" : "New Booking",
      message: isOffice
        ? `A new rental has been submitted for ${venueName}.`
        : `A new booking has been submitted for ${venueName}.`,
      bookingId: newId,
      userId: "admin",
      relatedUserId: newBooking.userId,
      relatedUserName: clientName,
      link: `/dashboard/bookings?highlight=${newId}`,
    })
    return newId;
  };

  const updateBookingStatus = (id: string, status: BookingStatus) => {
    const targetBooking = bookings.find((booking) => booking.id === id);

    if (
      status === "completed" &&
      targetBooking &&
      hasRemainingBalance(targetBooking)
    ) {
      toast({
        title: "Remaining Balance Required",
        description: "This booking still has an unpaid remaining balance.",
        variant: "destructive",
      });
      return;
    }

    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      if (isOfficeBooking(booking) && status === "reservation_secured") {
        const reservationFee = getOfficeReservationFee(booking);

        return attachAutoReceipt({
          ...booking,
          status: "contract_signing_required" as BookingStatus,
          bookingStatus: "Contract Signing Required",
          isSlotSecured: true,
          paymentStatus: "slot_verified" as PaymentStatus,
          paymentType: "slot_reservation" as const,
          amountPaid: reservationFee,
          remainingBalance: 0,
          remainingBalancePaid: true,
          contractSigningRequired: true,
          officeReservationStatus:
            "reservation_secured" as OfficeReservationStatus,
          officeContractSigningRequired: true,
          officePaymentInstructions:
            "Reservation slot is secured. Please visit One Estela Place to sign the contract. Succeeding office rental payments are settled onsite via check and recorded by admin.",
          verifiedByAdmin: true,
          verifiedAt: new Date().toISOString(),
          paymentVerifiedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
  
          adminLogs: makeAdminLog(
            booking,
            "OFFICE_SLOT_SECURED",
            "Admin verified office reservation payment. Slot is now secured. Contract signing required. Future payments will be tracked manually via onsite checks.",
          ),
        });
      }

      const shouldVerifyPayment =
        status === "confirmed" &&
        (booking.status === "verifying" ||
          booking.paymentStatus === "for_review");

      const total = getSafePrice(booking.totalPrice);
      const downpayment = getDownpaymentAmount(booking);
      const isDownpayment = booking.paymentType === "downpayment";

      let verifiedBooking = {
        ...booking,
        status,
        bookingStatus: status === "confirmed" ? "Confirmed" : getDisplayBookingStatus({ ...booking, status }),
        isSlotSecured: shouldVerifyPayment || booking.isSlotSecured || status === "confirmed" || status === "reservation_secured",
        verifiedByAdmin: shouldVerifyPayment ? true : booking.verifiedByAdmin,
        verifiedAt: shouldVerifyPayment
          ? new Date().toISOString()
          : booking.verifiedAt,
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as Booking;

      if (shouldVerifyPayment) {
        if (isDownpayment) {
          const currentDownpaymentPaid = typeof booking.downpaymentPaid === "number" ? booking.downpaymentPaid : 0;
          const paymentAmount = typeof booking.paymentAmount === "number" ? booking.paymentAmount : downpayment;
          const newDownpaymentPaid = currentDownpaymentPaid + paymentAmount;
          const newAmountPaid = (typeof booking.amountPaid === "number" ? booking.amountPaid : 0) + paymentAmount;
          const selectedDP = typeof booking.selectedDownpaymentAmount === "number" && booking.selectedDownpaymentAmount > 0
            ? booking.selectedDownpaymentAmount
            : downpayment;

          verifiedBooking = {
            ...verifiedBooking,
            amountPaid: newAmountPaid,
            downpaymentPaid: newDownpaymentPaid,
            selectedDownpaymentAmount: selectedDP,
          };

          verifiedBooking = recalculatePaymentStage(verifiedBooking);
          const dpComplete = newDownpaymentPaid >= selectedDP;
          verifiedBooking = {
            ...verifiedBooking,
            status: (dpComplete ? "confirmed" : "verifying") as BookingStatus,
            bookingStatus: dpComplete ? "Confirmed" : "Pending Verification",
            isSlotSecured: dpComplete,
            adminLogs: makeAdminLog(
              booking,
              "VERIFY_PAYMENT",
              newDownpaymentPaid < selectedDP
                ? `Admin verified downpayment of ₱${paymentAmount.toLocaleString()}. Downpayment remaining: ₱${(selectedDP - newDownpaymentPaid).toLocaleString()}.`
                : newAmountPaid < total
                  ? `Admin verified payment of ₱${paymentAmount.toLocaleString()}. Remaining balance: ₱${(total - newAmountPaid).toLocaleString()}.`
                  : "Admin verified full payment and confirmed booking.",
            ),
          };
        } else {
          const paymentAmount = typeof booking.paymentAmount === "number" ? booking.paymentAmount : total;
          const newAmountPaid = (typeof booking.amountPaid === "number" ? booking.amountPaid : 0) + paymentAmount;

          verifiedBooking = {
            ...verifiedBooking,
            paymentStatus: "paid" as PaymentStatus,
            amountPaid: newAmountPaid,
            downpaymentPaid: 0,
            downpaymentRemaining: 0,
            remainingBalance: Math.max(total - newAmountPaid, 0),
            remainingBalancePaid: newAmountPaid >= total,
            adminLogs: makeAdminLog(
              booking,
              "VERIFY_PAYMENT",
              newAmountPaid >= total
                ? "Admin verified full payment and confirmed booking."
                : `Admin verified payment of ₱${paymentAmount.toLocaleString()}.`,
            ),
          };
        }
      }

      return shouldVerifyPayment ? attachAutoReceipt(verifiedBooking) : verifiedBooking;
    });

    saveBookings(updatedBookings);
  };

  const cancelBooking = (id: string) => {
    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      const eventDate = getBookingEventDate(booking);
      const daysBefore = calculateDaysBeforeEvent(eventDate);
      const eligible = daysBefore >= REFUND_ELIGIBLE_DAYS;
      const paidStatuses = ["verified", "paid", "partial"];
      const hasVerifiedPayment = paidStatuses.includes(booking.paymentStatus || "");
      const isEligible = eligible && hasVerifiedPayment;

      return {
        ...booking,
        status: "cancelled" as BookingStatus,
        bookingStatus: "Cancelled",
        cancellationStatus: "Approved" as const,
        cancellationReviewedAt: new Date().toISOString(),
        cancellationStatusLabel: "Cancellation Approved",
        paymentStatus:
          booking.paymentStatus === "for_review" ||
          booking.paymentStatus === "verified" ||
          booking.paymentStatus === "paid" ||
          booking.paymentStatus === "partial"
            ? booking.paymentStatus
            : "cancelled",
        refundEligible: isEligible,
        refundStatus: isEligible ? ("eligible" as RefundStatus) : ("not_eligible" as RefundStatus),
        refundAmount: isEligible ? getSafePrice(booking.totalPrice) : 0,
        daysBeforeEventAtCancellation: daysBefore,

        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });

    saveBookings(updatedBookings as Booking[]);
  };

  function getRoomKey(booking: Partial<Booking>): string {
    if (!isOfficeBooking(booking)) return "";
    const venue = String(booking.venue || "");
    const roomMatch = venue.match(/Room\s+(\d+)/i);
    return roomMatch ? `${booking.venueId || ""}|${roomMatch[1]}` : "";
  }

  function isActiveCompetingBooking(booking: Partial<Booking>): boolean {
    if (!isOfficeBooking(booking)) return false;
    const s = String(booking.status || "").toLowerCase();
    return !["cancelled", "declined", "completed", "rental_expired"].includes(s);
  }

  function cancelCompetingBookings(
    bookingsList: Booking[],
    winningId: string,
    roomKey: string,
  ): Booking[] {
    if (!roomKey) return bookingsList;
    return bookingsList.map((b) => {
      if (b.id === winningId) return b;
      if (!isActiveCompetingBooking(b)) return b;
      if (getRoomKey(b) !== roomKey) return b;

      return {
        ...b,
        status: "cancelled" as BookingStatus,
        bookingStatus: "Cancelled",
        cancellationStatus: "Approved" as const,
        cancellationReviewedAt: new Date().toISOString(),
        cancellationStatusLabel: "Cancellation Approved",
        adminCancelDecision: "Auto-cancelled",
        adminCancelReason:
          "Another customer completed payment for this office room before your payment was verified. Please choose another available room.",
        cancellationReason:
          "Another customer completed payment for this office room before your payment was verified.",
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          b,
          "AUTO_CANCELLED_COMPETING_BOOKING",
          "This booking was automatically cancelled because another customer's payment for the same office room was verified first.",
        ),
      } as Booking;
    });
  }

  const deleteBooking = (id: string) => {
    saveBookings(bookings.filter((booking) => booking.id !== id));
  };

  const requestRefund = (id: string) => {
    const booking = bookings.find((b) => b.id === id);
    if (!booking) return;

    if (booking.refundStatus !== "eligible") {
      toast({
        title: "Not Eligible",
        description: "This booking is not eligible for a refund.",
        variant: "destructive",
      });
      return;
    }

    const updatedBookings = bookings.map((b) => {
      if (b.id !== id) return b;
      return {
        ...b,
        refundStatus: "requested" as RefundStatus,
        refundRequestedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          b,
          "REFUND_REQUESTED",
          "Customer requested refund. Please visit the office with valid ID and payment receipt within 7 days.",
        ),
      };
    });

    saveBookings(updatedBookings as Booking[]);
    toast({
      title: "Refund Requested",
      description: "Please visit the One Estela Place Management Office within 7 days with your Official Receipt and Valid Government-issued ID to claim your refund.",
    });
  };

  const markAsRefunded = (id: string) => {
    const booking = bookings.find((b) => b.id === id);
    if (!booking) return;

    if (booking.refundStatus !== "requested") {
      toast({
        title: "Invalid Status",
        description: "This booking's refund has not been requested yet.",
        variant: "destructive",
      });
      return;
    }

    const updatedBookings = bookings.map((b) => {
      if (b.id !== id) return b;
      return {
        ...b,
        refundStatus: "refunded" as RefundStatus,
        refundedAt: new Date().toISOString(),

        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          b,
          "REFUND_COMPLETED",
          "Admin marked refund as completed. Cash refund has been claimed by the customer.",
        ),
      };
    });

    saveBookings(updatedBookings as Booking[]);
    const refundedBooking = bookings.find((b) => b.id === id);
    if (refundedBooking) {
      createNotification({
        type: "refund_completed",
        title: "Refund Completed",
        message: `Your refund for Booking ${refundedBooking.id} has been completed.`,
        bookingId: refundedBooking.id,
        userId: refundedBooking.userId,
        link: `/portal/payments?highlight=${refundedBooking.id}`,
      })
    }
    toast({
      title: "Refund Completed",
      description: `Booking ${id} has been marked as refunded.`,
    });
  };

  const getUserBookings = useCallback((userId: string) => {
    return bookings.filter((booking) => booking.userId === userId);
  }, [bookings]);

  const getBookingById = useCallback((id: string) => {
    return bookings.find((booking) => booking.id === id);
  }, [bookings]);

  const modifyBooking = (id: string, updates: Partial<Booking>) => {
    saveBookings(
      bookings.map((booking) => (booking.id === id ? { ...booking, ...updates, lastActivityAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : booking))
    );
  };

  const requestCancellation = (id: string, reason: string) => {
    const targetBooking = bookings.find((booking) => booking.id === id);

    if (!targetBooking) return;

    const isSlotSecured = isBookingSlotSecured(targetBooking);
    const eventDate = getBookingEventDate(targetBooking);
    const daysBefore = calculateDaysBeforeEvent(eventDate);
    const eligibilityNote = isSlotSecured ? getRefundEligibilityNote(eventDate) : "";
    const likelyEligible = isSlotSecured ? daysBefore >= REFUND_ELIGIBLE_DAYS : false;
    const now = new Date().toISOString();

    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      return {
        ...booking,
        previousStatus: booking.status,
        previousBookingStatus: booking.status,
        previousPaymentStatus: booking.paymentStatus || "unpaid",
        status: "cancellation_requested" as BookingStatus,
        bookingStatus: "Cancellation Under Review",
        cancellationRequested: true,
        cancellationRequestedAt: now,
        cancellationStatus: "Pending" as CancellationStatus,
        cancellationStatusLabel: "Pending",
        cancellationReason: reason,
        cancelRequestStatus: "Pending",
        cancellationUnderReview: true,
        cancelReason: reason,
        cancelRequestedAt: now,
        adminCancelDecision: null,
        adminCancelReason: "",
        refundEligible: likelyEligible,
        refundMethod: isSlotSecured && likelyEligible ? "Cash" : null,
        refundMode: isSlotSecured && likelyEligible ? "Cash" : null,
        refundStatus: "Pending Review" as RefundStatus,
        refundEligibilityNote: eligibilityNote,
        refundClaimNote: isSlotSecured
          ? likelyEligible
            ? "If approved by admin, refund may be claimed onsite in cash within the allowed processing period."
            : "No refund will be processed if admin confirms the request is non-refundable based on policy."
          : "No payment has been made, so no refund is applicable.",
        daysBeforeEventAtCancellation: isSlotSecured ? daysBefore : null,
        lastActivityAt: now,
        updatedAt: now,
        adminLogs: makeAdminLog(
          booking,
          "REQUEST_CANCELLATION",
          isSlotSecured
            ? `Client requested cancellation. Refund eligibility note: ${eligibilityNote}. Days before event: ${daysBefore}.`
            : `Client requested cancellation. No payment has been made yet.`,
        ),
      };
    });

    saveBookings(updatedBookings as Booking[]);
    const clientName = targetBooking.userInfo?.name || targetBooking.eventName || "A client"
    const cancelVenue = targetBooking.venue || targetBooking.eventName || "a venue"
    createNotification({
      type: "cancellation_requested",
      title: "Cancellation Requested",
      message: `A cancellation has been requested for ${cancelVenue}.`,
      bookingId: targetBooking.id,
      userId: "admin",
      relatedUserId: targetBooking.userId,
      relatedUserName: clientName,
      link: `/dashboard/bookings?highlight=${targetBooking.id}`,
    })
  };

  const approveCancellation = (id: string) => {
    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      const eventDate = getBookingEventDate(booking);
      const daysBefore = booking.daysBeforeEventAtCancellation ?? calculateDaysBeforeEvent(eventDate);
      const eligible = daysBefore >= REFUND_ELIGIBLE_DAYS;
      const approvedAt = new Date();
      const readyDate = addDays(approvedAt, 7).toISOString();

      return {
        ...booking,
        status: "cancelled" as BookingStatus,
        bookingStatus: "Cancelled",
        cancellationRequested: false,
        cancellationStatus: "Approved" as const,
        cancellationStatusLabel: "Approved",
        cancellationReviewedAt: approvedAt.toISOString(),
        cancelRequestStatus: null,
        cancellationUnderReview: false,
        adminCancelDecision: "approved",
        adminCancelReason: "",
        refundEligible: eligible,
        refundMethod: eligible ? ("Cash" as const) : null,
        refundMode: eligible ? ("Cash" as const) : null,
        refundStatus: eligible ? ("eligible" as RefundStatus) : ("not_eligible" as RefundStatus),
        refundAmount: eligible ? getSafePrice(booking.totalPrice) : 0,
        refundReadyDate: eligible ? readyDate : null,
        refundEligibilityNote: eligible
          ? "May be eligible for refund"
          : "Non-refundable based on policy",
        refundClaimNote: eligible
          ? "Refund may be claimed onsite in cash within the allowed processing period."
          : "No refund will be processed based on the venue cancellation policy.",
        refundInstructions: eligible
          ? "Refund may be claimed onsite in cash within the allowed processing period."
          : "No refund will be processed based on the venue cancellation policy.",
        daysBeforeEventAtCancellation: daysBefore,

        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          booking,
          "APPROVE_CANCELLATION",
          eligible
            ? "Admin approved cancellation. Refund is eligible and can be claimed onsite in cash."
            : "Admin approved cancellation. Booking is non-refundable based on policy.",
        ),
      };
    });

    saveBookings(updatedBookings as Booking[]);
    const approvedBooking = updatedBookings.find((b) => b.id === id);
    if (approvedBooking) {
      createNotification({
        type: "cancellation_approved",
        title: "Cancellation Approved",
        message: `Your cancellation request for Booking ${approvedBooking.id} has been approved.`,
        bookingId: approvedBooking.id,
        userId: approvedBooking.userId,
        link: `/portal/bookings?highlight=${approvedBooking.id}`,
      })
    }
  };

  const declineCancellation = (id: string, reason: string) => {
    if (!reason.trim()) {
      toast({
        title: "Decline Reason Required",
        description:
          "Please provide a reason before declining the cancellation request.",
        variant: "destructive",
      });
      return;
    }

    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      const restored = getRestoredStatus(booking);

      const restoredPaymentStatus =
        booking.previousPaymentStatus || booking.paymentStatus || "paid";

      const restoredBooking = {
        ...booking,
        status: restored.status,
        bookingStatus: restored.bookingStatus,
        paymentStatus: restoredPaymentStatus,
        isSlotSecured: isBookingSlotSecured({ ...booking, status: restored.status, paymentStatus: restoredPaymentStatus }),
        cancellationRequested: false,
        cancellationStatus: "Declined" as const,
        cancellationStatusLabel: "Declined",
        cancelRequestStatus: null,
        cancellationReviewedAt: new Date().toISOString(),
        cancellationDeclinedAt: new Date().toISOString(),
        cancellationCooldownUntil: addDays(new Date(), 0).getTime() ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null,
        cancellationDeclineReason: reason.trim(),
        refundStatus: "Not Applicable" as RefundStatus,
        refundEligibilityNote: null,
        refundClaimNote: null,
        previousStatus: null,
        previousBookingStatus: null,

        previousPaymentStatus: null,
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          booking,
          "DECLINE_CANCELLATION_REQUEST",
          `Cancellation request declined. Reason: ${reason.trim()}`,
        ),
      } as unknown as Booking;

      return restoredBooking;
    });

    saveBookings(updatedBookings);
    const declinedBooking = updatedBookings.find((b: any) => b.id === id);
    if (declinedBooking) {
      createNotification({
        type: "cancellation_declined",
        title: "Cancellation Declined",
        message: `Your cancellation request for Booking ${declinedBooking.id} has been declined.`,
        bookingId: declinedBooking.id,
        userId: declinedBooking.userId,
        link: `/portal/bookings?highlight=${declinedBooking.id}`,
      })
    }
  };

  const rejectCancellation = (id: string, reason?: string) => {
    declineCancellation(id, reason || "");
  };

  const requestModification = (id: string, changes: Record<string, unknown>, reason: string) => {
    const targetBooking = bookings.find((booking) => booking.id === id);
    if (!targetBooking) return;

    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      return {
        ...booking,
        modificationPreviousStatus: booking.status,
        modificationPreviousBookingStatus: booking.bookingStatus,
        status: "modification_under_review" as BookingStatus,
        bookingStatus: "Modification Under Review",
        modificationRequested: true,
        modificationUnderReview: true,
        modifyRequestStatus: "Pending",
        modificationStatus: "Under Review" as ModificationStatus,
        modificationReason: reason.trim(),
        modificationRequestedAt: new Date().toISOString(),
        requestedChanges: changes,
        originalBookingSnapshot: {
          eventName: booking.eventName,
          eventType: booking.eventType,
          guestCount: booking.guestCount,
          date: booking.date,
          startTime: booking.startTime,
          endTime: booking.endTime,
          time: booking.time,
          venue: booking.venue,
          venueId: booking.venueId,
          specialRequests: booking.specialRequests,
        },
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          booking,
          "REQUEST_MODIFICATION",
          `Client requested modification. Reason: ${reason.trim()}. Changes requested: ${JSON.stringify(changes)}`,
        ),
      };
    });

    saveBookings(updatedBookings as Booking[]);
    const clientName = targetBooking.userInfo?.name || targetBooking.eventName || "A client"
    const modVenue = targetBooking.venue || targetBooking.eventName || "a venue"
    createNotification({
      type: "modification_requested",
      title: "Modification Requested",
      message: `A modification has been requested for ${modVenue}.`,
      bookingId: targetBooking.id,
      userId: "admin",
      relatedUserId: targetBooking.userId,
      relatedUserName: clientName,
      link: `/dashboard/bookings?highlight=${targetBooking.id}`,
    })
  };

  const approveModification = (id: string) => {
    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      const changes = booking.requestedChanges as Record<string, unknown> | undefined;
      if (!changes) return booking;

      const restored = getRestoredStatus(booking);

      const merged = {
        ...booking,
        ...changes,
      };

      if (isOfficeBooking(merged)) {
        const officeTerm =
          (merged as any).officeRentalTerm ||
          (merged as any).rentalTerm ||
          (merged as any).contractTerm;
        const startDate = merged.date;
        if (officeTerm && startDate && ((changes as any).officeRentalTerm || changes.date)) {
          merged.endDate = calculateOfficeEndDate(startDate, officeTerm as OfficeRentalTerm);
        }
      }

      return {
        ...merged,
        status: restored.status,
        bookingStatus: restored.bookingStatus,
        modificationRequested: false,
        modificationStatus: "Approved" as ModificationStatus,
        modificationReviewedAt: new Date().toISOString(),
        modificationPreviousStatus: null,
        modificationPreviousBookingStatus: null,
        requestedChanges: null,
        originalBookingSnapshot: null,
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),

        adminLogs: makeAdminLog(
          booking,
          "APPROVE_MODIFICATION",
          "Admin approved modification request. Changes have been applied.",
        ),
      };
    });

    saveBookings(updatedBookings as Booking[]);
    const approvedMod = updatedBookings.find((b) => b.id === id);
    if (approvedMod) {
      createNotification({
        type: "modification_approved",
        title: "Modification Approved",
        message: `Your modification request for Booking ${approvedMod.id} has been approved.`,
        bookingId: approvedMod.id,
        userId: approvedMod.userId,
        link: `/portal/bookings?highlight=${approvedMod.id}`,
      })
    }
  };

  const declineModification = (id: string, reason: string) => {
    if (!reason.trim()) {
      toast({
        title: "Decline Reason Required",
        description: "Please provide a reason before declining the modification request.",
        variant: "destructive",
      });
      return;
    }

    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      const restored = getRestoredStatus(booking);

      return {
        ...booking,
        status: restored.status,
        bookingStatus: restored.bookingStatus,
        modificationRequested: false,
        modificationStatus: "Declined" as ModificationStatus,
        modificationDeclineReason: reason.trim(),
        modificationReviewedAt: new Date().toISOString(),
        modificationPreviousStatus: null,
        modificationPreviousBookingStatus: null,
        requestedChanges: null,
        originalBookingSnapshot: null,
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),

        adminLogs: makeAdminLog(
          booking,
          "DECLINE_MODIFICATION_REQUEST",
          `Modification request declined. Reason: ${reason.trim()}`,
        ),
      };
    });

    saveBookings(updatedBookings as Booking[]);
    const declinedMod = updatedBookings.find((b) => b.id === id);
    if (declinedMod) {
      createNotification({
        type: "modification_declined",
        title: "Modification Declined",
        message: `Your modification request for Booking ${declinedMod.id} has been declined.`,
        bookingId: declinedMod.id,
        userId: declinedMod.userId,
        link: `/portal/bookings?highlight=${declinedMod.id}`,
      })
    }
  };

  const markRefundReady = (id: string) => {
    const targetBooking = bookings.find((booking) => booking.id === id);

    if (!targetBooking || targetBooking.refundStatus !== "Refund Pending") {
      toast({
        title: "Refund Not Pending",
        description:
          "Only pending refunds can be marked as ready for claiming.",
        variant: "destructive",
      });
      return;
    }

    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      return {
        ...booking,
        refundStatus: "Refund Ready for Claiming" as RefundStatus,
        refundReadyDate: booking.refundReadyDate || new Date().toISOString(),
        refundInstructions:
          "Your cash refund is ready. Please claim it at the One Estela Place office.",

        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          booking,
          "MARK_REFUND_READY",
          "Admin marked cash refund as ready for claiming.",
        ),
      };
    });

    saveBookings(updatedBookings);
  };

  const markRefundClaimed = (id: string) => {
    const targetBooking = bookings.find((booking) => booking.id === id);

    if (
      !targetBooking ||
      targetBooking.refundStatus !== "Refund Ready for Claiming"
    ) {
      toast({
        title: "Refund Not Ready",
        description:
          "Refund can only be marked as claimed when it is ready for claiming.",
        variant: "destructive",
      });
      return;
    }

    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      return {
        ...booking,
        refundStatus: "Refund Claimed" as RefundStatus,
        refundClaimedDate: new Date().toISOString(),

        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          booking,
          "MARK_REFUND_CLAIMED",
          "Admin marked cash refund as claimed at the office.",
        ),
      };
    });

    saveBookings(updatedBookings);
  };

  const markContractSigned = (id: string, signedBy?: string) => {
    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      const newStatus = isOfficeBooking(booking)
        ? ("active_rental" as BookingStatus)
        : booking.status;

      return {
        ...booking,
        contractSigningRequired: true,
        contractSigned: true,
        contractSignedAt: new Date().toISOString(),
        contractSignedDate: new Date().toISOString(),
        contractSignedBy: signedBy || "Administrator",
        contractSigningMethod: "Face-to-face",
        contractStatus: "Signed" as ContractStatus,
        status: newStatus,
        bookingStatus: getDisplayBookingStatus({
          ...booking,
          status: newStatus,
        }),

        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          booking,
          "MARK_CONTRACT_SIGNED",
          isOfficeBooking(booking)
            ? `Admin marked office rental contract as signed. Rental is now active. Signed by: ${signedBy || "Administrator"}.`
            : `Admin marked contract as signed at One Estela Place office. Signed by: ${signedBy || "Administrator"}. Method: Face-to-face.`,
        ),
      };
    });

    saveBookings(updatedBookings);
    const signedBooking = bookings.find((b) => b.id === id);
    if (signedBooking) {
      createNotification({
        type: "booking_approved",
        title: "Contract Signed",
        message: `Your contract for Booking ${signedBooking.id} has been signed.`,
        bookingId: signedBooking.id,
        userId: signedBooking.userId,
        link: `/portal/bookings?highlight=${signedBooking.id}`,
      })
    }
  };

  const issueReceipt = (id: string) => {
    const targetBooking = bookings.find((booking) => booking.id === id);

    if (!targetBooking) return;

    const hasPayment =
      targetBooking.paymentStatus === "paid" ||
      targetBooking.paymentStatus === "verified" ||
      targetBooking.paymentStatus === "partial" ||
      targetBooking.paymentStatus === "slot_verified" ||
      getCurrentAmountPaid(targetBooking) > 0 ||
      isOfficeBooking(targetBooking);

    if (!hasPayment) {
      toast({
        title: "No Verified Payment Found",
        description: "The system can only generate an e-receipt after admin payment verification.",
        variant: "destructive",
      });
      return;
    }

    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;
      if (booking.receiptIssued || getReceiptHistory(booking).length > 0) return booking;
      return attachAutoReceipt(booking);
    });

    saveBookings(updatedBookings);
  };

  const verifyCashPayment = (
    id: string,
    paymentType: "downpayment" | "full" = "full",
  ) => {
    const winningBooking = bookings.find((b) => b.id === id && isOfficeBooking(b));
    const winningRoomKey = winningBooking ? getRoomKey(winningBooking) : "";

    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) {
        if (winningRoomKey && isActiveCompetingBooking(booking) && getRoomKey(booking) === winningRoomKey) {
          return {
            ...booking,
            status: "cancelled" as BookingStatus,
            bookingStatus: "Cancelled",
            cancellationStatus: "Approved" as const,
            cancellationReviewedAt: new Date().toISOString(),
            cancellationStatusLabel: "Cancellation Approved",
            adminCancelDecision: "Auto-cancelled",
            adminCancelReason:
              "Another customer completed payment for this office room before your payment was verified. Please choose another available room.",
            cancellationReason:
              "Another customer completed payment for this office room before your payment was verified.",
            lastActivityAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            adminLogs: makeAdminLog(
              booking,
              "AUTO_CANCELLED_COMPETING_BOOKING",
              "This booking was automatically cancelled because another customer's payment for the same office room was verified first.",
            ),
          } as Booking;
        }
        return booking;
      }

      if (isOfficeBooking(booking)) {
        const total = getSafePrice(booking.totalPrice);
        const currentAmountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;
        const paidAmount = total - currentAmountPaid;
        const newAmountPaid = currentAmountPaid + paidAmount;
        const isFullyPaid = newAmountPaid >= total;

        return attachAutoReceipt({
          ...booking,
          status: isFullyPaid ? "reservation_secured" : ("verifying" as BookingStatus),
          bookingStatus: isFullyPaid ? "Slot Secured" : "Pending Verification",
          isSlotSecured: isFullyPaid,
          paymentStatus: isFullyPaid ? ("paid" as PaymentStatus) : ("partial" as PaymentStatus),
          paymentType: isFullyPaid ? "slot_reservation" as const : booking.paymentType,
          paymentMethod: "cash" as const,
          amountPaid: newAmountPaid,
          remainingBalance: Math.max(total - newAmountPaid, 0),
          remainingBalancePaid: isFullyPaid,
          contractSigningRequired: isFullyPaid,
          officeReservationStatus: isFullyPaid
            ? "reservation_secured" as OfficeReservationStatus
            : booking.officeReservationStatus || "pending_verification" as OfficeReservationStatus,
          officeContractSigningRequired: isFullyPaid,
          verifiedByAdmin: true,
          verifiedAt: new Date().toISOString(),
          paymentVerifiedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          adminLogs: makeAdminLog(
            booking,
            "VERIFY_OFFICE_CASH_PAYMENT",
            isFullyPaid
              ? "Admin verified full office cash payment. Reservation secured. Contract signing required. Future payments are onsite check payments tracked by admin."
              : `Admin verified office cash payment of ₱${paidAmount.toLocaleString()}. Remaining reservation fee: ₱${Math.max(total - newAmountPaid, 0).toLocaleString()}.`,
          ),
        });
      }

      const total = getSafePrice(booking.totalPrice);
      const downpayment = getDownpaymentAmount(booking);
      const isDownpayment = paymentType === "downpayment";

      const currentDownpaymentPaid = typeof booking.downpaymentPaid === "number" ? booking.downpaymentPaid : 0;
      const currentAmountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;

      if (isDownpayment) {
        const selectedDP = typeof booking.selectedDownpaymentAmount === "number" && booking.selectedDownpaymentAmount > 0
          ? booking.selectedDownpaymentAmount
          : downpayment;
        const remainingDP = selectedDP - currentDownpaymentPaid;
        const paidAmount = Math.min(remainingDP, total);
        const newDownpaymentPaid = currentDownpaymentPaid + paidAmount;
        const newAmountPaid = currentAmountPaid + paidAmount;

        const updated = recalculatePaymentStage({
          ...booking,
          paymentType: "downpayment",
          paymentMethod: "cash" as const,
          amountPaid: newAmountPaid,
          lastPaymentAmount: paidAmount,
          downpaymentPaid: newDownpaymentPaid,
          selectedDownpaymentAmount: selectedDP,
          downpaymentRemaining: Math.max(selectedDP - newDownpaymentPaid, 0),
          verifiedByAdmin: true,
          verifiedAt: new Date().toISOString(),
          contractSigningRequired: true,
          contractSigned: booking.contractSigned || false,
          contractStatus: booking.contractSigned ? "Signed" : "Pending Signature",
          lastActivityAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        const dpComplete = newDownpaymentPaid >= selectedDP;
        return attachAutoReceipt({
          ...updated,
          status: (dpComplete ? "confirmed" : "verifying") as BookingStatus,
          bookingStatus: dpComplete ? "Confirmed" : "Pending Verification",
          isSlotSecured: dpComplete,
          paymentMethod: "cash" as const,
          verifiedByAdmin: true,
          verifiedAt: new Date().toISOString(),
          contractSigningRequired: true,
          contractSigned: booking.contractSigned || false,
          contractStatus: booking.contractSigned ? "Signed" : "Pending Signature",
          lastActivityAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          adminLogs: makeAdminLog(
            booking,
            "VERIFY_CASH_DOWNPAYMENT",
            newDownpaymentPaid < selectedDP
              ? `Admin manually verified cash downpayment of ₱${paidAmount.toLocaleString()}. Downpayment remaining: ₱${(selectedDP - newDownpaymentPaid).toLocaleString()}.`
              : `Admin manually verified cash downpayment of ₱${paidAmount.toLocaleString()}. Downpayment complete. Remaining balance: ₱${Math.max(total - newAmountPaid, 0).toLocaleString()}.`,
          ),
        });
      }

      const paidAmount = total - currentAmountPaid;
      const newAmountPaid = currentAmountPaid + paidAmount;

      return attachAutoReceipt({
        ...booking,
        status: "confirmed" as BookingStatus,
        bookingStatus: "Confirmed",
        isSlotSecured: true,
        paymentStatus: "paid" as PaymentStatus,
        paymentType,
        paymentMethod: "cash" as const,
        amountPaid: newAmountPaid,
        lastPaymentAmount: paidAmount,
        downpaymentPaid: currentDownpaymentPaid,
        downpaymentRemaining: 0,
        remainingBalance: Math.max(total - newAmountPaid, 0),
        remainingBalancePaid: newAmountPaid >= total,
        verifiedByAdmin: true,
        verifiedAt: new Date().toISOString(),
        contractSigningRequired: true,
        contractSigned: booking.contractSigned || false,
        contractStatus: booking.contractSigned ? "Signed" : "Pending Signature",
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          booking,
          "VERIFY_CASH_PAYMENT",
          newAmountPaid >= total
            ? "Admin manually verified full cash payment. Contract signing is still required."
            : `Admin manually verified cash payment of ₱${paidAmount.toLocaleString()}.`,
        ),
      });
    });

    saveBookings(updatedBookings);
    const cashVerifiedBooking = bookings.find((b) => b.id === id);
    if (cashVerifiedBooking) {
      createNotification({
        type: "payment_approved",
        title: "Payment Approved",
        message: `Your cash payment for Booking ${cashVerifiedBooking.id} has been approved.`,
        bookingId: cashVerifiedBooking.id,
        userId: cashVerifiedBooking.userId,
        link: `/portal/payments?highlight=${cashVerifiedBooking.id}`,
      })
    }
  };

  const manualRecordOnsitePayment = (
    id: string,
    paymentData: {
      paymentType: "downpayment" | "remaining_balance" | "full_payment";
      amountReceived: number;
      adminNote?: string;
      adminName?: string;
    },
  ): Booking | null => {
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
        const onsitePaymentRecord = {
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

        setDoc(doc(paymentsRef, onsitePaymentId), onsitePaymentRecord).catch(console.error);
        saveStoredReceipt(onsiteReceipt).catch(console.error);
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
    saveBookings(updatedBookings);
    return resultBooking;
  };

  const settleRemainingBalance = (
    id: string,
    method: "cash" | "bank" = "cash",
  ) => {
    // The settlement receipt belongs to the payment record being settled —
    // same resolution rule markPaymentRecordReviewed applies below.
    const receiptPaymentId = resolveReceiptPaymentId(id, undefined)
    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      const total = getSafePrice(booking.totalPrice);
      const currentAmountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;
      const balance = Math.max(total - currentAmountPaid, 0);
      const newAmountPaid = currentAmountPaid + balance;

      const updated = recalculatePaymentStage({
        ...booking,
        amountPaid: newAmountPaid,
        lastPaymentAmount: balance,
        paymentMethod: method,
        remainingBalance: 0,
        remainingBalancePaid: true,
        verifiedByAdmin: true,
        verifiedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const settledUpdated: Booking = {
        ...updated,
        status: "confirmed" as BookingStatus,
        bookingStatus: "Confirmed",
        isSlotSecured: true,
        paymentMethod: method,
        verifiedByAdmin: true,
        verifiedAt: new Date().toISOString(),

        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          booking,
          "SETTLE_REMAINING_BALANCE",
          `Admin marked remaining balance of ₱${balance.toLocaleString()} as paid.`,
        ),
      };
      // Settling verifies THIS payment's own transaction receipt in place.
      return upsertVerifiedReceipt(settledUpdated, receiptPaymentId, {
        amountPaid: balance,
        remainingBalance: 0,
      });
    });

    saveBookings(updatedBookings);
    // The settled balance corresponds to the most recent pending submission.
    markPaymentRecordReviewed(id, undefined, {
      verificationStatus: "Verified",
      status: "Verified",
      reviewedBy: "Administrator",
      reviewedAt: new Date().toISOString(),
      adminNote: "Remaining balance settled by admin.",
    });
    const settledBooking = bookings.find((b) => b.id === id);
    if (settledBooking) {
      createNotification({
        type: "remaining_balance_approved",
        title: "Remaining Balance Settled",
        message: `Your remaining balance for Booking ${settledBooking.id} has been settled.`,
        bookingId: settledBooking.id,
        userId: settledBooking.userId,
        link: `/portal/payments?highlight=${settledBooking.id}`,
      })
    }
  };

  /**
   * Updates the status of an individual payment submission record in the
   * `payments` collection after an admin review action. Falls back to the
   * most recent unresolved submission when no record id is provided.
   */
  const markPaymentRecordReviewed = (
    bookingId: string,
    recordId: string | undefined,
    patch: Partial<PaymentRecord>,
  ) => {
    try {
      let target = recordId
        ? paymentRecords.find((record) => record.id === recordId)
        : undefined
      if (!target) {
        target = paymentRecords
          .filter((record) => record.bookingId === bookingId)
          .sort((a, b) => {
            const aT = a.submittedAt ? new Date(a.submittedAt).getTime() : 0
            const bT = b.submittedAt ? new Date(b.submittedAt).getTime() : 0
            return bT - aT
          })
          .find((record) => isUnresolvedPaymentRecord(record))
      }
      if (!target) return
      const { id: _id, ...data } = { ...target, ...patch }
      const previousStatus = String(target.status || target.verificationStatus || "").trim() || "for_review"
      const nextStatus = String(data.status || data.verificationStatus || "").trim() || previousStatus
      if (previousStatus !== nextStatus) {
        console.log("[PAYMENT] UNEXPECTED STATUS CHANGE", {
          paymentId: target.id,
          bookingId,
          previousStatus,
          newStatus: nextStatus,
          source: "markPaymentRecordReviewed",
        })
      }
      // The received-amount figure may be corrected even when the status is
      // unchanged (admin re-marks an INCOMPLETE payment with the actual
      // amount received), so only skip the write when NOTHING changed.
      const amountReceivedChanged =
        typeof data.amountReceived === "number" &&
        Number(data.amountReceived) !== Number((target as any).amountReceived ?? Number.NaN)
      // The record already has the desired status — there is nothing to
      // normalize. Skipping the write avoids a redundant Firestore update
      // that would trigger another snapshot and re-process this unchanged
      // payment (and would otherwise loop: write → snapshot → normalize).
      if (previousStatus === nextStatus && !amountReceivedChanged) return
      void updateDoc(doc(paymentsRef, target.id), data).catch((error) => {
        console.error("[Booking:markPaymentRecordReviewed] update failed:", error?.code || error?.message || error)
      })
    } catch (error) {
      console.error("[Booking:markPaymentRecordReviewed] error:", error)
    }
  }

  /**
   * Resolves the payment record a receipt should belong to. Uses the explicit
   * record id from the admin review action when present, otherwise falls back
   * to the booking's most recent unresolved submission — the same resolution
   * rule markPaymentRecordReviewed applies. This is what ties each generated
   * e-receipt to EXACTLY ONE verified payment.
   */
  const resolveReceiptPaymentId = (
    bookingId: string,
    recordId?: string,
  ): string | undefined => {
    if (recordId) return recordId
    return paymentRecords
      .filter((record) => record.bookingId === bookingId)
      .sort((a, b) => {
        const aT = a.submittedAt ? new Date(a.submittedAt).getTime() : 0
        const bT = b.submittedAt ? new Date(b.submittedAt).getTime() : 0
        return bT - aT
      })
      .find((record) => isUnresolvedPaymentRecord(record))?.id
  }

  const verifyPayment = (id: string, reviewData?: { verifiedAmount?: number; adminNote?: string; adminName?: string; paymentRecordId?: string }) => {
    const winningBooking = bookings.find((b) => b.id === id && isOfficeBooking(b));
    const winningRoomKey = winningBooking ? getRoomKey(winningBooking) : "";
    // The receipt generated below must reference THIS verified payment only.
    const receiptPaymentId = resolveReceiptPaymentId(id, reviewData?.paymentRecordId)

    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) {
        if (winningRoomKey && isActiveCompetingBooking(booking) && getRoomKey(booking) === winningRoomKey) {
          return {
            ...booking,
            status: "cancelled" as BookingStatus,
            bookingStatus: "Cancelled",
            cancellationStatus: "Approved" as const,
            cancellationReviewedAt: new Date().toISOString(),
            cancellationStatusLabel: "Cancellation Approved",
            adminCancelDecision: "Auto-cancelled",
            adminCancelReason:
              "Another customer completed payment for this office room before your payment was verified. Please choose another available room.",
            cancellationReason:
              "Another customer completed payment for this office room before your payment was verified.",
            lastActivityAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            adminLogs: makeAdminLog(
              booking,
              "AUTO_CANCELLED_COMPETING_BOOKING",
              "This booking was automatically cancelled because another customer's payment for the same office room was verified first.",
            ),
          } as Booking;
        }
        return booking;
      }

      if (isOfficeBooking(booking)) {
        const total = getSafePrice(booking.totalPrice);
        const currentAmountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;
        const verifiedAmount = reviewData?.verifiedAmount || (typeof booking.paymentAmount === "number" ? booking.paymentAmount : total);
        const newAmountPaid = currentAmountPaid + verifiedAmount;
        const isFullyPaid = newAmountPaid >= total;

        const officeUpdated: Booking = {
          ...booking,
          status: isFullyPaid ? "reservation_secured" : ("verifying" as BookingStatus),
          bookingStatus: isFullyPaid ? "Slot Secured" : "Pending Verification",
          isSlotSecured: isFullyPaid,
          paymentStatus: isFullyPaid ? ("paid" as PaymentStatus) : ("partial" as PaymentStatus),
          paymentType: isFullyPaid ? "slot_reservation" as const : booking.paymentType,
          amountPaid: newAmountPaid,
          lastPaymentAmount: verifiedAmount,
          remainingBalance: Math.max(total - newAmountPaid, 0),
          remainingBalancePaid: isFullyPaid,
          hasActivePaymentSubmission: false,
          paymentVerifiedAt: new Date().toISOString(),
          paymentVerifiedBy: reviewData?.adminName || "Administrator",
          paymentVerifiedAmount: verifiedAmount,
          contractSigningRequired: isFullyPaid,
          officeReservationStatus: isFullyPaid
            ? "reservation_secured" as OfficeReservationStatus
            : booking.officeReservationStatus || "pending_verification" as OfficeReservationStatus,
          officeContractSigningRequired: isFullyPaid,
          verifiedByAdmin: true,
          verifiedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          adminLogs: makeAdminLog(
            booking,
            "VERIFY_OFFICE_PAYMENT",
            isFullyPaid
              ? `Admin verified full office payment of ₱${verifiedAmount.toLocaleString()}. Reservation secured. Contract signing required.${reviewData?.adminNote ? ` Note: ${reviewData.adminNote}` : ""}`
              : `Admin verified office payment of ₱${verifiedAmount.toLocaleString()}. Total paid: ₱${newAmountPaid.toLocaleString()}. Remaining reservation fee: ₱${Math.max(total - newAmountPaid, 0).toLocaleString()}.${reviewData?.adminNote ? ` Note: ${reviewData.adminNote}` : ""}`,
          ),
        };
        // Verification updates THIS payment's own transaction receipt in place;
        // a receipt is created here only if the submission pre-dates receipts.
        // The receipt remainingBalance must reflect the canonical booking
        // remaining AFTER this payment is verified — accounting for any money
        // already credited from other payments (e.g. incomplete amounts).
        const officeReceiptRemaining = computeReceiptRemaining(
          getSafePrice(booking.totalPrice),
          paymentRecords,
          receiptPaymentId,
          { amount: verifiedAmount, amountPaid: verifiedAmount, status: "Verified" },
          booking.id,
        );
        return upsertVerifiedReceipt(officeUpdated, receiptPaymentId, {
          amountPaid: verifiedAmount,
          remainingBalance: officeReceiptRemaining,
        });
      }

      const total = getSafePrice(booking.totalPrice);
      const downpayment = getDownpaymentAmount(booking);
      const isDownpayment = booking.paymentType === "downpayment";

      const currentDownpaymentPaid = typeof booking.downpaymentPaid === "number" ? booking.downpaymentPaid : 0;
      const currentAmountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;

      if (isDownpayment) {
        const paymentAmount = reviewData?.verifiedAmount || (typeof booking.paymentAmount === "number" ? booking.paymentAmount : downpayment);
        const selectedDP = typeof booking.selectedDownpaymentAmount === "number" && booking.selectedDownpaymentAmount > 0
          ? booking.selectedDownpaymentAmount
          : downpayment;
        const newDownpaymentPaid = currentDownpaymentPaid + paymentAmount;
        const newAmountPaid = currentAmountPaid + paymentAmount;

        const updated = recalculatePaymentStage({
          ...booking,
          amountPaid: newAmountPaid,
          lastPaymentAmount: paymentAmount,
          downpaymentPaid: newDownpaymentPaid,
          selectedDownpaymentAmount: selectedDP,
          downpaymentRemaining: Math.max(selectedDP - newDownpaymentPaid, 0),
          hasActivePaymentSubmission: false,
          paymentVerifiedAt: new Date().toISOString(),
          paymentVerifiedBy: reviewData?.adminName || "Administrator",
          paymentVerifiedAmount: paymentAmount,
        verifiedByAdmin: true,
        verifiedAt: new Date().toISOString(),
        contractSigningRequired: true,
        contractSigned: booking.contractSigned || false,
        contractStatus: booking.contractSigned ? "Signed" : "Pending Signature",
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const dpComplete = newDownpaymentPaid >= selectedDP;
      const dpVerified: Booking = {
        ...updated,
        status: (dpComplete ? "confirmed" : "verifying") as BookingStatus,
        bookingStatus: dpComplete ? "Confirmed" : "Pending Verification",
        isSlotSecured: dpComplete,
        verifiedByAdmin: true,
        verifiedAt: new Date().toISOString(),
        contractSigningRequired: true,
        contractSigned: booking.contractSigned || false,
        contractStatus: booking.contractSigned ? "Signed" : "Pending Signature",
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
          adminLogs: makeAdminLog(
            booking,
            "VERIFY_PAYMENT",
            `${newDownpaymentPaid < selectedDP
              ? `Admin verified downpayment of ₱${paymentAmount.toLocaleString()}. Downpayment remaining: ₱${(selectedDP - newDownpaymentPaid).toLocaleString()}.`
              : newAmountPaid < total
                ? `Admin verified payment of ₱${paymentAmount.toLocaleString()}. Remaining balance: ₱${(total - newAmountPaid).toLocaleString()}.`
                : "Admin verified full payment and confirmed booking."}${reviewData?.adminNote ? ` Note: ${reviewData.adminNote}` : ""} Contract signing is still required.`,
          ),
        };
        // Verification updates THIS payment's own transaction receipt in place;
        // a receipt is created here only if the submission pre-dates receipts.
        // The receipt remainingBalance must reflect the canonical booking
        // remaining AFTER this payment is verified — accounting for any money
        // already credited from other payments (e.g. incomplete amounts).
        const dpReceiptRemaining = computeReceiptRemaining(
          getSafePrice(booking.totalPrice),
          paymentRecords,
          receiptPaymentId,
          { amount: paymentAmount, amountPaid: paymentAmount, status: "Verified" },
          booking.id,
        );
        return upsertVerifiedReceipt(dpVerified, receiptPaymentId, {
          amountPaid: paymentAmount,
          remainingBalance: dpReceiptRemaining,
        });
      }

      const paymentAmount = reviewData?.verifiedAmount || (typeof booking.paymentAmount === "number" ? booking.paymentAmount : total);
      const newAmountPaid = currentAmountPaid + paymentAmount;

      const fullVerified: Booking = {
        ...booking,
        status: "confirmed" as BookingStatus,
        bookingStatus: "Confirmed",
        isSlotSecured: true,
        paymentStatus: newAmountPaid >= total ? ("paid" as PaymentStatus) : ("partial" as PaymentStatus),
        amountPaid: newAmountPaid,
        lastPaymentAmount: paymentAmount,
        downpaymentPaid: 0,
        downpaymentRemaining: 0,
        remainingBalance: Math.max(total - newAmountPaid, 0),
        remainingBalancePaid: newAmountPaid >= total,
        hasActivePaymentSubmission: false,
        paymentVerifiedAt: new Date().toISOString(),
        paymentVerifiedBy: reviewData?.adminName || "Administrator",
        paymentVerifiedAmount: paymentAmount,
        verifiedByAdmin: true,
        verifiedAt: new Date().toISOString(),
        contractSigningRequired: true,
        contractSigned: booking.contractSigned || false,
        contractStatus: booking.contractSigned ? "Signed" : "Pending Signature",
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          booking,
          "VERIFY_PAYMENT",
          `${newAmountPaid >= total
            ? "Admin verified full payment and confirmed booking."
            : `Admin verified payment of ₱${paymentAmount.toLocaleString()}.`}${reviewData?.adminNote ? ` Note: ${reviewData.adminNote}` : ""} Contract signing is still required.`,
        ),
      };
      // Verification updates THIS payment's own transaction receipt in place.
      // The receipt remainingBalance must reflect the canonical booking
      // remaining AFTER this payment is verified — accounting for any money
      // already credited from other payments (e.g. incomplete amounts).
      const fullReceiptRemaining = computeReceiptRemaining(
        getSafePrice(booking.totalPrice),
        paymentRecords,
        receiptPaymentId,
        { amount: paymentAmount, amountPaid: paymentAmount, status: "Verified" },
        booking.id,
      );
      return upsertVerifiedReceipt(fullVerified, receiptPaymentId, {
        amountPaid: paymentAmount,
        remainingBalance: fullReceiptRemaining,
      });
    });

    saveBookings(updatedBookings);
    // Keep the individual payment submission record in sync so the admin
    // payment history shows this submission as VERIFIED.
    markPaymentRecordReviewed(id, reviewData?.paymentRecordId, {
      verificationStatus: "Verified",
      status: "Verified",
      reviewedBy: reviewData?.adminName || "Administrator",
      reviewedAt: new Date().toISOString(),
      adminNote: reviewData?.adminNote || "",
    });
    const verifiedRecord = reviewData?.paymentRecordId
      ? paymentRecords.find((record) => record.id === reviewData?.paymentRecordId)
      : undefined;
    console.log("[PAYMENT] ADMIN VERIFIED PAYMENT", {
      paymentId: verifiedRecord?.id ?? reviewData?.paymentRecordId ?? id,
      bookingId: id,
      amount: reviewData?.verifiedAmount ?? verifiedRecord?.amount ?? verifiedRecord?.amountPaid,
      previousStatus: verifiedRecord
        ? (verifiedRecord.status || verifiedRecord.verificationStatus || "unknown")
        : "unknown",
      newStatus: "Verified",
    });
    const verifiedBooking = bookings.find((b) => b.id === id);
    if (verifiedBooking) {
      createNotification({
        type: "payment_approved",
        title: "Payment Approved",
        message: `Your payment for Booking ${verifiedBooking.id} has been approved.`,
        bookingId: verifiedBooking.id,
        userId: verifiedBooking.userId,
        link: `/portal/payments?highlight=${verifiedBooking.id}`,
      })
    }
  };

  const rejectPayment = (id: string, reason?: string, adminName?: string, paymentRecordId?: string) => {
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

    saveBookings(updatedBookings as Booking[]);
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
  };

  const markIncompletePayment = (id: string, data: { verifiedAmount: number; adminNote: string; adminName?: string; paymentRecordId?: string }) => {
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
        .filter((record) => record.bookingId === id)
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
      // amountPaid / downpaymentPaid (verifyPayment / settleRemainingBalance),
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

    saveBookings(updatedBookings);
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

  const submitPayment = (
    id: string,
    paymentData: {
      type: "full" | "downpayment" | "slot_reservation";
      method: "bank" | "cash";
      proof?: string;
      bankReferenceNumber?: string;
      amount?: number;
    },
  ) => {
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
              getSafePrice(originalBooking.totalPrice),
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
        setDoc(doc(paymentsRef, paymentId), paymentRecord).catch(console.error)
        saveStoredReceipt(transactionReceipt).catch(console.error)
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
    saveBookings(bookingsToSave);
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

  const verifyOfficeReservationPayment = (id: string) => {
    updateBookingStatus(id, "reservation_secured" as BookingStatus);
  };

  const addOfficeCheckPayment = (
    bookingId: string,
    paymentData: Omit<
      OfficeCheckPayment,
      "id" | "createdAt" | "updatedAt" | "paymentType"
    >,
  ) => {
    const now = new Date().toISOString();

    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== bookingId) return booking;

      const tracker = booking.officePaymentTracker || [];
      const newPayment: OfficeCheckPayment = {
        ...paymentData,
        id: createOfficePaymentId(),
        paymentType: "Check",
        amountPaid: Number(paymentData.amountPaid || 0),
        createdAt: now,
        updatedAt: now,
      };

      return {
        ...booking,
        officePaymentTracker: [...tracker, newPayment],
        lastActivityAt: now,
        updatedAt: now,
        adminLogs: makeAdminLog(
          booking,
          "ADD_OFFICE_CHECK_PAYMENT",
          `Admin added check payment record for ${paymentData.billingPeriod}.`,
        ),
      };
    });

    saveBookings(updatedBookings);
  };

  const updateOfficeCheckPayment = (
    bookingId: string,
    paymentId: string,
    paymentData: Partial<Omit<OfficeCheckPayment, "id" | "createdAt">>,
  ) => {
    const now = new Date().toISOString();

    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== bookingId) return booking;

      return {
        ...booking,
        officePaymentTracker: (booking.officePaymentTracker || []).map(
          (payment) =>
            payment.id === paymentId
              ? {
                  ...payment,
                  ...paymentData,
                  amountPaid:
                    typeof paymentData.amountPaid === "number"
                      ? paymentData.amountPaid
                      : payment.amountPaid,
                  paymentType: "Check" as const,
                  updatedAt: now,
                }
              : payment,
        ),
        lastActivityAt: now,
        updatedAt: now,
        adminLogs: makeAdminLog(
          booking,
          "UPDATE_OFFICE_CHECK_PAYMENT",
          "Admin updated an office check payment record.",
        ),
      };
    });

    saveBookings(updatedBookings);
  };

  const deleteOfficeCheckPayment = (bookingId: string, paymentId: string) => {
    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== bookingId) return booking;

      return {
        ...booking,
        officePaymentTracker: (booking.officePaymentTracker || []).filter(
          (payment) => payment.id !== paymentId,
        ),
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          booking,
          "DELETE_OFFICE_CHECK_PAYMENT",
          "Admin removed an office check payment record.",
        ),
      };
    });

    saveBookings(updatedBookings);
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
        deleteBooking,
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
        markRefundReady,
        markRefundClaimed,
        requestRefund,
        markAsRefunded,
        markContractSigned,
        issueReceipt,
        verifyCashPayment,
        settleRemainingBalance,
        manualRecordOnsitePayment,
        verifyPayment,
        rejectPayment,
        markIncompletePayment,
        toggleMaintenanceDate,
        addMaintenanceRecord,
        removeMaintenanceRecord,
        submitPayment,
        verifyOfficeReservationPayment,
        addOfficeCheckPayment,
        updateOfficeCheckPayment,
        deleteOfficeCheckPayment,
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