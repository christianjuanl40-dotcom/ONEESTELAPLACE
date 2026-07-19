"use client";

import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/src/modules/shared/hooks/use-toast";
import { useAuth } from "@/src/modules/shared/auth/auth-context";
import { db } from "@/lib/firebase"
import { createNotification } from "@/src/modules/shared/lib/notifications"
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  onSnapshot,
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
  | "Not Eligible for Refund";

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
  paymentStatus: string;
  dateGenerated: string;
  dateIssued: string;
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

  totalPrice: number;
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

  markContractSigned: (id: string, signedBy?: string) => void;
  issueReceipt: (id: string) => void;

  verifyCashPayment: (id: string, paymentType?: "downpayment" | "full") => void;
  settleRemainingBalance: (id: string, method?: "cash" | "bank") => void;
  manualRecordOnsitePayment: (id: string, paymentData: {
    paymentType: "downpayment" | "remaining_balance" | "full_payment";
    amountReceived: number;
    adminNote?: string;
    adminName?: string;
  }) => void;
  verifyPayment: (id: string, reviewData?: { verifiedAmount?: number; adminNote?: string; adminName?: string }) => void;
  rejectPayment: (id: string, reason?: string, adminName?: string) => void;
  markIncompletePayment: (id: string, data: { verifiedAmount: number; adminNote: string; adminName?: string }) => void;
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

const DEFAULT_TOTAL_PRICE = 15000;
const REFUND_ELIGIBLE_DAYS = 14;
const CANCELLATION_CLOSED_DAYS = 7;

const bookingsRef = collection(db, "bookings")
const officeRentalsRef = collection(db, "officeRentals")
const maintenanceRecordsRef = collection(db, "maintenanceRecords")
const paymentsRef = collection(db, "payments")
const receiptsRef = collection(db, "receipts")

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
  return getSafePrice(booking.totalPrice) * 0.5;
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
    const isDownpaymentComplete = downpaymentPaid >= selectedDP;
    return {
      ...booking,
      paymentStage: isDownpaymentComplete ? "Settle Remaining Balance" : "Complete Downpayment",
      paymentStatus: "partial" as PaymentStatus,
      balanceStatus: "With Remaining Balance",
      downpaymentRemaining: isDownpaymentComplete ? 0 : Math.max(selectedDP - downpaymentPaid, 0),
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

async function loadReceipts(): Promise<BookingReceipt[]> {
  try {
    const snapshot = await getDocs(query(receiptsRef, orderBy("dateGenerated", "desc")))
    const result: BookingReceipt[] = []
    snapshot.forEach((docSnap) => {
      const d = docSnap.data()
      result.push({
        receiptNumber: d.receiptNumber || "",
        bookingId: d.bookingId || "",
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
        paymentStatus: d.paymentStatus || "",
        dateGenerated: d.dateGenerated || "",
        dateIssued: d.dateIssued || "",
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
    paymentStatus: receipt.paymentStatus,
    dateGenerated: receipt.dateGenerated,
    dateIssued: receipt.dateIssued,
  })
}

async function getStoredReceiptByBookingId(bookingId: string): Promise<BookingReceipt | undefined> {
  try {
    const snapshot = await getDocs(query(receiptsRef, orderBy("dateGenerated", "desc")))
    let found: BookingReceipt | undefined
    snapshot.forEach((docSnap) => {
      const d = docSnap.data()
      if (d.bookingId === bookingId) {
        found = {
          receiptNumber: d.receiptNumber || "",
          bookingId: d.bookingId || "",
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
          paymentStatus: d.paymentStatus || "",
          dateGenerated: d.dateGenerated || "",
          dateIssued: d.dateIssued || "",
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

function getReceiptAmount(booking: Booking) {
  if (isOfficeBooking(booking)) return getOfficeReservationFee(booking);
  if (typeof booking.amountPaid === "number" && booking.amountPaid > 0) return booking.amountPaid;
  return getSafePrice(booking.totalPrice);
}

function buildAutoReceipt(booking: Booking, generatedAt = new Date().toISOString()) {
  const existingReceipt = booking.receipt;
  const officeBooking = isOfficeBooking(booking);
  const officeTerm = officeBooking ? booking.officeRentalTerm || "6_months" : "";
  const contractTerm = officeBooking ? formatOfficeContractTerm(officeTerm as OfficeRentalTerm) : "";
  const receiptNumber =
    existingReceipt?.receiptNumber ||
    `ER-${new Date(generatedAt).getFullYear()}-${String(Date.now()).slice(-6)}`;

  const receipt: BookingReceipt = {
    receiptNumber,
    bookingId: booking.id,
    fullName: booking.userInfo?.name || "Client",
    bookingDate: booking.createdAt || generatedAt,
    startDate: booking.date || "Not set",
    endDate: officeBooking
      ? addMonthsToDate(booking.date, getOfficeTermMonths(officeTerm as OfficeRentalTerm))
      : booking.date || "Not set",
    rentalType: officeBooking ? "Office Space Rental" : "Event Venue Booking",
    bookingType: officeBooking ? "Office Space Rental" : booking.eventType || "Event Venue Booking",
    contractTerm,
    paymentPurpose: getReceiptPaymentPurpose(booking),
    paymentMethod: getReceiptPaymentMethodLabel(booking.paymentMethod),
    amountPaid: getReceiptAmount(booking),
    paymentAmount: getReceiptAmount(booking),
    paymentStatus: officeBooking ? "Reservation Secured" : booking.paymentStatus || "paid",
    dateGenerated: existingReceipt?.dateGenerated || generatedAt,
    dateIssued: existingReceipt?.dateIssued || generatedAt,
  };

  return receipt;
}

function attachAutoReceipt(booking: Booking) {
  const generatedAt = new Date().toISOString();
  const receipt = buildAutoReceipt(booking, generatedAt);

  saveStoredReceipt(receipt).catch(() => {});

  return {
    ...booking,
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

function normalizeBookingForNewFields(booking: Booking): Booking {
  const officeBooking = isOfficeBooking(booking);
  const savedReceipt = booking.receipt;
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
    receipt: booking.receipt || savedReceipt || (null as unknown as BookingReceipt | undefined),
    receiptIssued: booking.receiptIssued ?? Boolean(savedReceipt),
    receiptNumber: booking.receiptNumber || savedReceipt?.receiptNumber,
    receiptIssuedAt: booking.receiptIssuedAt || savedReceipt?.dateGenerated || savedReceipt?.dateIssued,
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
    if (typeof window === "undefined" || !user) return;

    // Real-time subscription for bookings
    const bookingsQuery = query(bookingsRef, orderBy("createdAt", "asc"))
    const unsubBookings = onSnapshot(bookingsQuery, (snapshot) => {
      const loaded: Booking[] = []
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as Booking
        loaded.push(normalizeBookingForNewFields({ ...d, id: docSnap.id }))
      })
      setBookings(loaded)
    }, (error: any) => {
      if (error.code !== 'permission-denied') {
        console.error("[BookingContext] Bookings snapshot error:", error)
      }
    })

    // Real-time subscription for office rentals
    const officeRentalsQuery = query(officeRentalsRef, orderBy("createdAt", "asc"))
    const unsubOffice = onSnapshot(officeRentalsQuery, (snapshot) => {
      const loaded: OfficeRental[] = []
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as OfficeRental
        loaded.push({ ...d, id: docSnap.id })
      })
      setOfficeRentals(loaded)
    }, (error: any) => {
      if (error.code !== 'permission-denied') {
        console.error("[BookingContext] Office rentals snapshot error:", error)
      }
    })

    // Real-time subscription for maintenance records
    const maintQuery = query(maintenanceRecordsRef, orderBy("createdAt", "asc"))
    const unsubMaint = onSnapshot(maintQuery, (snapshot) => {
      const loaded: MaintenanceRecord[] = []
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as MaintenanceRecord
        loaded.push({ ...d, id: docSnap.id })
      })
      setMaintenanceRecords(loaded)
    }, (error: any) => {
      if (error.code !== 'permission-denied') {
        console.error("[BookingContext] Maintenance records snapshot error:", error)
      }
    })

    return () => {
      unsubBookings()
      unsubOffice()
      unsubMaint()
    }
  }, [user]);

  const saveBookings = async (newBookings: Booking[]) => {
    const normalizedBookings = newBookings.map(normalizeBookingForNewFields);
    const prevMap = new Map(bookings.map(b => [b.id, b]))
    const nextMap = new Map(normalizedBookings.map(b => [b.id, b]))

    const batch = writeBatch(db)
    let writeCount = 0
    let deleteCount = 0

    function findUndefined(obj: Record<string, unknown>, path = "") {
      for (const [key, value] of Object.entries(obj)) {
        const current = path ? `${path}.${key}` : key;
        if (value === undefined) {
          console.error("[Undefined Field]", current);
        }
        if (value && typeof value === "object" && !Array.isArray(value)) {
          findUndefined(value as Record<string, unknown>, current);
        }
      }
    }

    try {
      for (const [id, next] of nextMap) {
        const prev = prevMap.get(id)
        if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
          const { id: _id, ...data } = next
          findUndefined(data as Record<string, unknown>);
          const docRef = doc(bookingsRef, id)
          writeCount++
          batch.set(docRef, { ...data, updatedAt: new Date().toISOString() }, { merge: true })
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
        batch.set(doc(officeRentalsRef, id), { ...data, updatedAt: new Date().toISOString() }, { merge: true })
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
    const newId =
      "BK" +
      Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, "0");

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
      selectedDownpaymentAmount: 0,
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
    createNotification({
      type: "booking_submitted",
      title: "New Booking",
      message: `${clientName} submitted a new booking.`,
      bookingId: newId,
      userId: "admin",
      relatedUserId: newBooking.userId,
      relatedUserName: clientName,
      link: "/dashboard/bookings",
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
          verifiedBooking = {
            ...verifiedBooking,
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
    createNotification({
      type: "cancellation_requested",
      title: "Cancellation Requested",
      message: `${clientName} requested cancellation for Booking ${targetBooking.id}.`,
      bookingId: targetBooking.id,
      userId: "admin",
      relatedUserId: targetBooking.userId,
      relatedUserName: clientName,
      link: "/dashboard/bookings",
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
        refundStatus: eligible ? ("Refund Eligible" as RefundStatus) : ("Non-Refundable" as RefundStatus),
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
        link: "/portal/bookings",
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
        link: "/portal/bookings",
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
    createNotification({
      type: "modification_requested",
      title: "Modification Requested",
      message: `${clientName} requested to modify Booking ${targetBooking.id}.`,
      bookingId: targetBooking.id,
      userId: "admin",
      relatedUserId: targetBooking.userId,
      relatedUserName: clientName,
      link: "/dashboard/bookings",
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
        link: "/portal/bookings",
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
        link: "/portal/bookings",
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
        const reservationFee = getOfficeReservationFee(booking);
        const currentAmountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;

        return attachAutoReceipt({
          ...booking,
          status: "contract_signing_required" as BookingStatus,
          bookingStatus: "Contract Signing Required",
          isSlotSecured: true,
          paymentStatus: "slot_verified" as PaymentStatus,
          paymentType: "slot_reservation" as const,
          paymentMethod: "cash" as const,
          amountPaid: currentAmountPaid + reservationFee,
          remainingBalance: 0,
          remainingBalancePaid: true,
          contractSigningRequired: true,
          officeReservationStatus:
            "reservation_secured" as OfficeReservationStatus,
          officeContractSigningRequired: true,
          verifiedByAdmin: true,
          verifiedAt: new Date().toISOString(),
          paymentVerifiedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          adminLogs: makeAdminLog(
            booking,
            "VERIFY_OFFICE_SLOT_CASH_PAYMENT",
            "Admin verified office slot reservation payment paid at the office. Contract signing required. Future payments are onsite check payments tracked by admin.",
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

        return attachAutoReceipt({
          ...updated,
          status: "confirmed" as BookingStatus,
          bookingStatus: "Confirmed",
          isSlotSecured: true,
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
  };

  const manualRecordOnsitePayment = (
    id: string,
    paymentData: {
      paymentType: "downpayment" | "remaining_balance" | "full_payment";
      amountReceived: number;
      adminNote?: string;
      adminName?: string;
    },
  ) => {
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
          : total * 0.5;
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

      return {
        ...booking,
        amountPaid: newAmountPaid,
        lastPaymentAmount: amountReceived,
        downpaymentPaid: newDownpaymentPaid,
        downpaymentRemaining: Math.max(
          (typeof booking.selectedDownpaymentAmount === "number" && booking.selectedDownpaymentAmount > 0
            ? booking.selectedDownpaymentAmount
            : total * 0.5) - newDownpaymentPaid,
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
        status: newRemainingBalance === 0 ? "confirmed" as BookingStatus : "confirmed" as BookingStatus,
        bookingStatus: "Confirmed",
        isSlotSecured: true,
        contractSigningRequired: true,
        contractSigned: booking.contractSigned || false,
        contractStatus: booking.contractSigned ? "Signed" as ContractStatus : "Pending Signature" as ContractStatus,
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          booking,
          "RECORD_ONSITE_PAYMENT",
          `Admin recorded onsite payment of ₱${amountReceived.toLocaleString()}. Payment stage: ${newPaymentStage}. Remaining balance: ₱${newRemainingBalance.toLocaleString()}. ${paymentData.adminNote ? `Note: ${paymentData.adminNote}` : ""}`,
        ),
      } as Booking;
    });

    saveBookings(updatedBookings);
  };

  const settleRemainingBalance = (
    id: string,
    method: "cash" | "bank" = "cash",
  ) => {
    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      const total = getSafePrice(booking.totalPrice);
      const currentAmountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;
      const balance = Math.max(total - currentAmountPaid, 0);
      const newAmountPaid = currentAmountPaid + balance;

      const updated = recalculatePaymentStage({
        ...booking,
        amountPaid: newAmountPaid,
        paymentMethod: method,
        remainingBalance: 0,
        remainingBalancePaid: true,
        verifiedByAdmin: true,
        verifiedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      return attachAutoReceipt({
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
      });
    });

    saveBookings(updatedBookings);
  };

  const verifyPayment = (id: string, reviewData?: { verifiedAmount?: number; adminNote?: string; adminName?: string }) => {
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
        const reservationFee = getOfficeReservationFee(booking);
        const currentAmountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;
        const verifiedAmount = reviewData?.verifiedAmount || reservationFee;

        return attachAutoReceipt({
          ...booking,
          status: "contract_signing_required" as BookingStatus,
          bookingStatus: "Contract Signing Required",
          isSlotSecured: true,
          paymentStatus: "slot_verified" as PaymentStatus,
          paymentType: "slot_reservation" as const,
          amountPaid: currentAmountPaid + verifiedAmount,
          lastPaymentAmount: verifiedAmount,
          remainingBalance: 0,
          remainingBalancePaid: true,
          hasActivePaymentSubmission: false,
          paymentVerifiedAt: new Date().toISOString(),
          paymentVerifiedBy: reviewData?.adminName || "Administrator",
          paymentVerifiedAmount: verifiedAmount,
          contractSigningRequired: true,
          officeReservationStatus:
            "reservation_secured" as OfficeReservationStatus,
          officeContractSigningRequired: true,
          verifiedByAdmin: true,
          verifiedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          adminLogs: makeAdminLog(
            booking,
            "VERIFY_OFFICE_SLOT_PAYMENT",
            `Admin verified office slot reservation payment. Reservation is secured. Contract signing required.${reviewData?.adminNote ? ` Note: ${reviewData.adminNote}` : ""}`,
          ),
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

      return attachAutoReceipt({
        ...updated,
        status: "confirmed" as BookingStatus,
        bookingStatus: "Confirmed",
        isSlotSecured: true,
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
        });
      }

      const paymentAmount = reviewData?.verifiedAmount || (typeof booking.paymentAmount === "number" ? booking.paymentAmount : total);
      const newAmountPaid = currentAmountPaid + paymentAmount;

      return attachAutoReceipt({
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
      });
    });

    saveBookings(updatedBookings);
    const verifiedBooking = bookings.find((b) => b.id === id);
    if (verifiedBooking) {
      createNotification({
        type: "payment_approved",
        title: "Payment Approved",
        message: `Your payment for Booking ${verifiedBooking.id} has been approved.`,
        bookingId: verifiedBooking.id,
        userId: verifiedBooking.userId,
        link: "/portal/payments",
      })
    }
  };

  const rejectPayment = (id: string, reason?: string, adminName?: string) => {
    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;
      const rejectionReason = reason || booking.paymentRejectedReason || "Payment rejected by admin.";
      const hasApprovedDownpayment = typeof booking.downpaymentPaid === "number" && booking.downpaymentPaid > 0;

      if (hasApprovedDownpayment) {
        const total = getSafePrice(booking.totalPrice);
        const amountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;

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

        return {
          ...restored,
          status: "confirmed" as BookingStatus,
          bookingStatus: "Confirmed",
          isSlotSecured: true,
          adminLogs: makeAdminLog(
            booking,
            "REMAINING_BALANCE_REJECTED",
            `Admin rejected remaining balance payment. Reason: ${rejectionReason}. Approved down payment of ₱${amountPaid.toLocaleString()} is preserved. Remaining balance: ₱${(total - amountPaid).toLocaleString()}.`,
          ),
        };
      }

      return {
        ...booking,
        status: "pending" as BookingStatus,
        bookingStatus: "Pending Verification",
        isSlotSecured: false,
        paymentStatus: "rejected" as PaymentStatus,
        paymentRejectedReason: rejectionReason,
        paymentRejectionReason: rejectionReason,
        paymentRejectedAt: new Date().toISOString(),
        paymentReviewedBy: adminName || "Administrator",
        amountPaid: 0,
        hasActivePaymentSubmission: false,
        remainingBalance: getSafePrice(booking.totalPrice),
        remainingBalancePaid: false,
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adminLogs: makeAdminLog(
          booking,
          "REJECT_PAYMENT",
          `Admin rejected payment proof. Reason: ${rejectionReason}. Booking returned to Pencil Booking.`,
        ),
      };
    });

    saveBookings(updatedBookings as Booking[]);
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
        link: "/portal/payments",
      })
    }
  };

  const markIncompletePayment = (id: string, data: { verifiedAmount: number; adminNote: string; adminName?: string }) => {
    const updatedBookings = bookings.map((booking) => {
      if (booking.id !== id) return booking;

      const total = getSafePrice(booking.totalPrice);
      const currentAmountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0;
      const newAmountPaid = currentAmountPaid + data.verifiedAmount;
      const newRemainingBalance = Math.max(total - newAmountPaid, 0);
      const isDownpayment = booking.paymentType === "downpayment";
      const currentDownpaymentPaid = typeof booking.downpaymentPaid === "number" ? booking.downpaymentPaid : 0;
      const newDownpaymentPaid = isDownpayment ? currentDownpaymentPaid + data.verifiedAmount : currentDownpaymentPaid;
      const selectedDP = typeof booking.selectedDownpaymentAmount === "number" && booking.selectedDownpaymentAmount > 0
        ? booking.selectedDownpaymentAmount
        : total * 0.5;
      const newDPRemaining = isDownpayment ? Math.max(selectedDP - newDownpaymentPaid, 0) : 0;
      const isFullyPaidAfter = newAmountPaid >= total;
      const paymentStage = isDownpayment ? "Complete Downpayment" : (isFullyPaidAfter ? "Fully Paid" : "Settle Remaining Balance");
      const dpRemaining = isDownpayment ? Math.max(selectedDP - newDownpaymentPaid, 0) : 0;

      return {
        ...booking,
        status: (isFullyPaidAfter ? "confirmed" : "verifying") as BookingStatus,
        bookingStatus: (isFullyPaidAfter ? "Confirmed" : "Pending Verification") as BookingStatusLabel,
        isSlotSecured: isFullyPaidAfter,
        amountPaid: newAmountPaid,
        lastPaymentAmount: data.verifiedAmount,
        downpaymentPaid: isDownpayment ? newDownpaymentPaid : 0,
        downpaymentRemaining: dpRemaining,
        selectedDownpaymentAmount: isDownpayment ? selectedDP : 0,
        paymentStatus: (isFullyPaidAfter ? ("paid" as PaymentStatus) : ("incomplete" as PaymentStatus)),
        remainingBalance: isDownpayment ? dpRemaining : newRemainingBalance,
        balanceStatus: isFullyPaidAfter ? "Settled" : "With Remaining Balance",
        paymentStage,
        hasActivePaymentSubmission: false,
        incompletePaymentNote: data.adminNote,
        incompletePaymentReason: data.adminNote,
        paymentVerifiedAt: new Date().toISOString(),
        paymentVerifiedBy: data.adminName || "Administrator",
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
          `Admin recorded incomplete payment. Amount received: ₱${data.verifiedAmount.toLocaleString()}. Total paid: ₱${newAmountPaid.toLocaleString()}.${isDownpayment ? ` Downpayment remaining: ₱${dpRemaining.toLocaleString()}.` : ` Remaining: ₱${newRemainingBalance.toLocaleString()}.`}${isFullyPaidAfter ? "" : " Slot is NOT secured — payment incomplete."} Note: ${data.adminNote}`,
        ),
      } as Booking;
    });

    saveBookings(updatedBookings);
    const incompleteBooking = bookings.find((b) => b.id === id);
    if (incompleteBooking) {
      createNotification({
        type: "payment_incomplete",
        title: "Payment Requires Correction",
        message: `Your payment for Booking ${incompleteBooking.id} needs correction or additional information before it can be verified.`,
        bookingId: incompleteBooking.id,
        userId: incompleteBooking.userId,
        link: "/portal/payments",
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

    const updatedBooking = updatedBookings.find(b => b.id === id) as any
    if (updatedBooking) {
      try {
        const methodLabel = paymentData.method === "cash" ? "Pay at the Office" : "Bank Transfer"
        const isRemainingDP = paymentData.type === "downpayment" && (typeof updatedBooking.downpaymentPaid === "number" ? updatedBooking.downpaymentPaid : 0) > 0
        const paymentId = `PAY-${Date.now()}`
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
          term: paymentData.type === "downpayment" ? "Down Payment" : paymentData.type === "full" ? "Full Payment" : "Slot Reservation",
          amount: Number(paymentData.amount || getSafePrice(updatedBooking.totalPrice)),
          amountPaid: Number(paymentData.amount || 0),
          referenceNo: paymentData.bankReferenceNumber?.trim() ?? "",
          proofUrl: paymentData.proof ?? "",
          status: paymentData.method === "cash" ? "Awaiting Onsite Payment" : "For Verification",
          verificationStatus: paymentData.method === "cash" ? "Pending Onsite Verification" : "Pending",
          isRemainingDownPayment: isRemainingDP,
          submittedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        setDoc(doc(paymentsRef, paymentId), paymentRecord).catch(console.error)
      } catch (error) {
        console.error("Failed to save payment record:", error)
      }
    }

    saveBookings(updatedBookings as Booking[]);
    if (updatedBooking) {
      window.dispatchEvent(new Event("oneestela_payments_updated"))
      const payName = updatedBooking.userInfo?.name || updatedBooking.eventName || "A client"
      createNotification({
        type: "payment_submitted",
        title: "Payment Submitted",
        message: `Payment submitted for Booking ${updatedBooking.id}.`,
        bookingId: updatedBooking.id,
        userId: "admin",
        relatedUserId: updatedBooking.userId,
        relatedUserName: payName,
        link: "/dashboard/payments",
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

    const newOfficeRental: OfficeRental = {
      ...rentalData,
      id: createLocalId("OFFICE"),
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