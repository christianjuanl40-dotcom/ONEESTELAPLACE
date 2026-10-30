import type { PaymentRecordLike } from "./payment-calculations"
import {
  calculatePaymentSummary,
  getRecordsForBooking,
  isPendingPaymentRecord,
  isUnresolvedPaymentRecord,
} from "./payment-calculations"
import {
  getBookingLifecycleStatus,
  hasActiveCancellationRequest,
  isApprovedOrConfirmed,
  isForVerificationStatus,
  isPencilBooking,
  normalizeStatus,
} from "./booking-helpers"
import { isOfficeResourceBooking } from "./resource-identity"

export const CHAT_SUGGESTION_COOLDOWN_MS = 24 * 60 * 60 * 1000

export const CHAT_SUGGESTION_CONFIG_COLLECTION = "chatSuggestionQuestions"
export const CHAT_SUGGESTION_CONFIG_DOCUMENT = "config"
export const CHAT_SUGGESTION_PUBLISHED_DOCUMENT = "published"
export const CHAT_SUGGESTION_VERSION_DOCUMENT = "publishedVersion"
export const CHAT_SUGGESTION_MAX_QUESTIONS = 100
export const CHAT_SUGGESTION_MAX_QUESTION_LENGTH = 500
export const CHAT_SUGGESTION_MAX_ANSWER_LENGTH = 5000

export interface ChatSuggestion {
  id: string
  text: string
  statusGroup?: ChatSuggestionKind
  priority?: number
}

export type ChatSuggestionKind =
  | "no_booking"
  | "pending_booking"
  | "awaiting_payment"
  | "payment_review"
  | "partially_paid"
  | "confirmed_event"
  | "active_office"
  | "cancelled_or_refund"

export interface ChatSuggestionContext {
  kind: ChatSuggestionKind
  contextKey: string
  bookingId?: string
  bookingLabel?: string
  questions: ChatSuggestion[]
}

export interface PersistedChatSuggestionState {
  lastShownAt?: unknown
  contextKey?: string
}

export interface ChatSuggestionQuestion {
  questionId: string
  question: string
  answer: string
  statusGroup: ChatSuggestionKind
  enabled: boolean
  autoReplyEnabled: boolean
  priority: number
  isPublished: boolean
  createdAt: string
  updatedAt?: string
  updatedBy?: string
  isArchived?: boolean
  archivedAt?: string
}

export interface PublishedChatSuggestionQuestion {
  questionId: string
  question: string
  statusGroup: ChatSuggestionKind
  priority: number
}

export const CHAT_SUGGESTION_STATUS_GROUPS: Array<{ value: ChatSuggestionKind; label: string }> = [
  { value: "no_booking", label: "No Booking" },
  { value: "pending_booking", label: "Pending Booking" },
  { value: "awaiting_payment", label: "Awaiting Payment" },
  { value: "payment_review", label: "Payment For Review" },
  { value: "partially_paid", label: "Partially Paid" },
  { value: "confirmed_event", label: "Confirmed Event" },
  { value: "active_office", label: "Active Office Reservation" },
  { value: "cancelled_or_refund", label: "Cancellation / Refund" },
]

const STATUS_GROUP_VALUES = new Set(CHAT_SUGGESTION_STATUS_GROUPS.map((group) => group.value))

type DefaultQuestion = Omit<ChatSuggestionQuestion, "createdAt" | "updatedAt" | "updatedBy"> & {
  createdAt?: string
}

const DEFAULT_QUESTION_COPY: DefaultQuestion[] = [
  { questionId: "book-venue", question: "How do I book a venue?", answer: "You can start a booking request from My Bookings. Review the available spaces and schedule there, then submit the request. Please check your booking status in My Bookings after submitting.", statusGroup: "no_booking", enabled: true, autoReplyEnabled: true, priority: 10, isPublished: false },
  { questionId: "available-spaces", question: "What spaces are available?", answer: "Please review the current venue and office listings on the website or in the booking flow. Availability is confirmed for the dates and space you select in My Bookings.", statusGroup: "no_booking", enabled: true, autoReplyEnabled: true, priority: 20, isPublished: false },
  { questionId: "payment-methods", question: "What payment methods are accepted?", answer: "Current payment instructions and available methods are shown in My Transactions and the payment step. For account-specific amounts, open My Transactions.", statusGroup: "no_booking", enabled: true, autoReplyEnabled: true, priority: 30, isPublished: false },
  { questionId: "booking-status", question: "How can I check my booking status?", answer: "Open My Bookings to view the current status of your reservation. Support can help if the displayed status needs clarification.", statusGroup: "pending_booking", enabled: true, autoReplyEnabled: true, priority: 10, isPublished: false },
  { questionId: "booking-approval", question: "How long does booking approval take?", answer: "Booking requests are reviewed by the support team. Check My Bookings for the latest status; timing can vary.", statusGroup: "pending_booking", enabled: true, autoReplyEnabled: true, priority: 20, isPublished: false },
  { questionId: "modify-pending-booking", question: "Can I modify my pending booking?", answer: "You can request a change from the booking actions when available. Please send the booking details to support if the option is not shown.", statusGroup: "pending_booking", enabled: true, autoReplyEnabled: true, priority: 30, isPublished: false },
  { questionId: "submit-payment", question: "How can I submit my payment?", answer: "Open My Transactions or My Bookings and use the payment action shown for your reservation. Follow the current instructions there.", statusGroup: "awaiting_payment", enabled: true, autoReplyEnabled: true, priority: 10, isPublished: false },
  { questionId: "payment-methods-awaiting", question: "What payment methods are accepted?", answer: "The available payment methods and current instructions are shown in the payment step for your booking. Open My Transactions for the account-specific details.", statusGroup: "awaiting_payment", enabled: true, autoReplyEnabled: true, priority: 20, isPublished: false },
  { questionId: "payment-details", question: "Where can I see my payment amount and due information?", answer: "Open My Transactions or the booking details page to review the amount recorded and the current balance shown for your reservation.", statusGroup: "awaiting_payment", enabled: true, autoReplyEnabled: true, priority: 30, isPublished: false },
  { questionId: "verification-time", question: "How long does payment verification take?", answer: "Payment submissions are reviewed by the support team. Check My Transactions for the latest saved status; support can clarify a submission that remains under review.", statusGroup: "payment_review", enabled: true, autoReplyEnabled: true, priority: 10, isPublished: false },
  { questionId: "verification-status", question: "How will I know if my payment is verified?", answer: "The saved payment status is shown in My Transactions and in the related booking details. Please rely on those authenticated pages for the current result.", statusGroup: "payment_review", enabled: true, autoReplyEnabled: true, priority: 20, isPublished: false },
  { questionId: "resubmit-proof", question: "Can I resubmit my proof of payment?", answer: "Please review the payment action and status in My Transactions. If the available action does not allow another submission, contact support with the affected booking details.", statusGroup: "payment_review", enabled: true, autoReplyEnabled: true, priority: 30, isPublished: false },
  { questionId: "remaining-balance", question: "How much is my remaining balance?", answer: "Open My Transactions or the booking details page to view the current balance recorded for your reservation. Support can help explain the displayed ledger.", statusGroup: "partially_paid", enabled: true, autoReplyEnabled: true, priority: 10, isPublished: false },
  { questionId: "settle-balance", question: "How can I settle my remaining balance?", answer: "Use the payment action shown in My Transactions or My Bookings and follow the current instructions for your reservation.", statusGroup: "partially_paid", enabled: true, autoReplyEnabled: true, priority: 20, isPublished: false },
  { questionId: "complete-payment", question: "When should I complete my payment?", answer: "Please use the current balance and payment information shown in My Transactions. If the timing for your reservation is unclear, contact support before submitting payment.", statusGroup: "partially_paid", enabled: true, autoReplyEnabled: true, priority: 30, isPublished: false },
  { questionId: "modify-confirmed-booking", question: "Can I modify my booking?", answer: "Use the booking actions in My Bookings when a modification request is available. Support can review the request after it is submitted.", statusGroup: "confirmed_event", enabled: true, autoReplyEnabled: true, priority: 10, isPublished: false },
  { questionId: "venue-access-time", question: "What time can I access the venue?", answer: "Please refer to the confirmed schedule shown in My Bookings and your booking details. Contact support if the saved schedule needs clarification.", statusGroup: "confirmed_event", enabled: true, autoReplyEnabled: true, priority: 20, isPublished: false },
  { questionId: "event-preparation", question: "What should I prepare before my event?", answer: "Review the booking details and current venue guidance in the authenticated portal. Support can help with questions about the arrangements recorded for your event.", statusGroup: "confirmed_event", enabled: true, autoReplyEnabled: true, priority: 30, isPublished: false },
  { questionId: "contact-administration", question: "How can I contact the administration?", answer: "Continue this chat to reach One Estela Place support. Include the relevant booking details when you need account-specific help.", statusGroup: "active_office", enabled: true, autoReplyEnabled: true, priority: 10, isPublished: false },
  { questionId: "modify-office-reservation", question: "Can I request changes to my reservation?", answer: "Use the change or modification action shown in My Bookings when available. Support can review the request and the saved reservation details.", statusGroup: "active_office", enabled: true, autoReplyEnabled: true, priority: 20, isPublished: false },
  { questionId: "office-rental-terms", question: "How can I view my office rental terms?", answer: "Open My Bookings and the related contract or booking details to review the terms saved for your office reservation.", statusGroup: "active_office", enabled: true, autoReplyEnabled: true, priority: 30, isPublished: false },
  { questionId: "cancellation-status", question: "How can I check my cancellation status?", answer: "Open My Bookings to review the saved cancellation status for your reservation. Support can clarify the workflow shown there.", statusGroup: "cancelled_or_refund", enabled: true, autoReplyEnabled: true, priority: 10, isPublished: false },
  { questionId: "refund-status", question: "What is the status of my refund?", answer: "Review the booking and transaction details in the authenticated portal for the latest saved refund status. Please continue this chat if you need help interpreting it.", statusGroup: "cancelled_or_refund", enabled: true, autoReplyEnabled: true, priority: 20, isPublished: false },
  { questionId: "booking-support", question: "How can I contact support about my booking?", answer: "Continue this chat and include the booking details you want support to review. The team can respond with account-specific information after checking the saved record.", statusGroup: "cancelled_or_refund", enabled: true, autoReplyEnabled: true, priority: 30, isPublished: false },
]

export const DEFAULT_CHAT_SUGGESTION_QUESTIONS: ChatSuggestionQuestion[] = DEFAULT_QUESTION_COPY.map((question, index) => ({
  ...question,
  createdAt: question.createdAt || new Date(Date.now() - (DEFAULT_QUESTION_COPY.length - index) * 86400000).toISOString(),
}))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeQuestionId(value: unknown): string {
  return String(value || "").trim()
}

function normalizeQuestionText(value: unknown): string {
  return String(value || "").trim()
}

function normalizeStatusGroup(value: unknown): ChatSuggestionKind | null {
  const normalizedValue = String(value || "").trim() as ChatSuggestionKind
  return STATUS_GROUP_VALUES.has(normalizedValue) ? normalizedValue : null
}

export function isChatSuggestionKind(value: unknown): value is ChatSuggestionKind {
  return normalizeStatusGroup(value) !== null
}

function normalizePriority(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value || ""))
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(9999, Math.round(parsed)))
}

function normalizeIso(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate()
    if (date instanceof Date && Number.isFinite(date.getTime())) return date.toISOString()
  }
  return fallback
}

export function normalizeChatSuggestionQuestions(value: unknown): ChatSuggestionQuestion[] {
  if (!Array.isArray(value)) return []
  const now = new Date().toISOString()
  return value.filter(isRecord).map((raw) => {
    const statusGroup = normalizeStatusGroup(raw.statusGroup) || "no_booking"
    const questionId = normalizeQuestionId(raw.questionId || raw.id)
    const normalized: ChatSuggestionQuestion = {
      questionId,
      question: normalizeQuestionText(raw.question || raw.text),
      answer: String(raw.answer || "").trim(),
      statusGroup,
      enabled: raw.enabled !== false,
      autoReplyEnabled: raw.autoReplyEnabled !== false,
      priority: normalizePriority(raw.priority),
      isPublished: raw.isPublished === true || raw.published === true,
      createdAt: normalizeIso(raw.createdAt, now),
    }
    const updatedAt = normalizeIso(raw.updatedAt, "")
    const updatedBy = typeof raw.updatedBy === "string" ? raw.updatedBy.trim() : ""
    const archivedAt = normalizeIso(raw.archivedAt, "")
    if (updatedAt) normalized.updatedAt = updatedAt
    if (updatedBy) normalized.updatedBy = updatedBy
    if (raw.isArchived === true) normalized.isArchived = true
    if (archivedAt) normalized.archivedAt = archivedAt
    return normalized
  })
}

function normalizedQuestionKey(question: string): string {
  return question.trim().toLocaleLowerCase().replace(/\s+/g, " ")
}

export function validateChatSuggestionQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) return ["Questions must be an array."]
  if (value.length > CHAT_SUGGESTION_MAX_QUESTIONS) return [`You can manage up to ${CHAT_SUGGESTION_MAX_QUESTIONS} questions.`]
  const errors: string[] = []
  const ids = new Set<string>()
  const activeQuestions = new Set<string>()

  value.forEach((raw, index) => {
    const item = isRecord(raw) ? raw : {}
    const prefix = `Question ${index + 1}`
    const questionId = normalizeQuestionId(item.questionId || item.id)
    const question = normalizeQuestionText(item.question || item.text)
    const answer = String(item.answer || "").trim()
    const statusGroup = normalizeStatusGroup(item.statusGroup)
    const rawPriority = typeof item.priority === "number" ? item.priority : Number(String(item.priority ?? ""))
    const priority = normalizePriority(item.priority)
    const isArchived = item.isArchived === true
    const enabled = item.enabled !== false

    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(questionId)) errors.push(`${prefix} has an invalid stable ID.`)
    if (ids.has(questionId)) errors.push(`${prefix} repeats a stable ID.`)
    ids.add(questionId)
    if (!question || question.length > CHAT_SUGGESTION_MAX_QUESTION_LENGTH) errors.push(`${prefix} must contain 1–${CHAT_SUGGESTION_MAX_QUESTION_LENGTH} characters.`)
    if (!statusGroup) errors.push(`${prefix} uses an unsupported status group.`)
    if (answer.length > CHAT_SUGGESTION_MAX_ANSWER_LENGTH) errors.push(`${prefix} answer is too long.`)
    if (item.autoReplyEnabled !== false && !answer) errors.push(`${prefix} needs an answer when automatic replies are enabled.`)
    if (!Number.isInteger(rawPriority) || rawPriority < 0 || rawPriority > 9999) errors.push(`${prefix} priority must be an integer between 0 and 9999.`)
    if (!isArchived && enabled && statusGroup && question) {
      const key = `${statusGroup}|${normalizedQuestionKey(question)}`
      if (activeQuestions.has(key)) errors.push(`${prefix} duplicates an active question in the same status group.`)
      activeQuestions.add(key)
    }
  })

  return errors
}

export function toPublishedChatSuggestionQuestions(
  questions: ReadonlyArray<ChatSuggestionQuestion>,
): PublishedChatSuggestionQuestion[] {
  return questions
    .filter((question) => question.enabled && question.isPublished && !question.isArchived && question.question.trim())
    .sort((left, right) => left.statusGroup.localeCompare(right.statusGroup) || left.priority - right.priority || left.questionId.localeCompare(right.questionId))
    .map(({ questionId, question, statusGroup, priority }) => ({ questionId, question, statusGroup, priority }))
}

export function normalizePublishedChatSuggestionQuestions(value: unknown): PublishedChatSuggestionQuestion[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((raw) => {
    const statusGroup = normalizeStatusGroup(raw.statusGroup)
    const questionId = normalizeQuestionId(raw.questionId || raw.id)
    const question = normalizeQuestionText(raw.question || raw.text)
    return {
      questionId,
      question,
      statusGroup: statusGroup || "no_booking",
      priority: normalizePriority(raw.priority),
    }
  }).filter((question) => Boolean(question.questionId && question.question && STATUS_GROUP_VALUES.has(question.statusGroup)))
}

const PAYMENT_REVIEW_STATUSES = new Set([
  "for_review",
  "for review",
  "for_verification",
  "for verification",
  "pending_verification",
  "pending verification",
  "awaiting onsite payment",
  "cash_pending",
  "slot_pending",
])

const PAYMENT_WAITING_STATUSES = new Set([
  "unpaid",
  "pending_payment",
  "pending payment",
  "awaiting_payment",
  "awaiting payment",
  "cash_pending",
  "slot_pending",
])

const PAID_STATUSES = new Set([
  "paid",
  "completed",
  "fully_paid",
  "fully paid",
  "verified",
  "slot_verified",
  "reservation_secured",
  "reservation secured",
])

const REFUND_RELATED_STATUSES = new Set([
  "pending review",
  "refund eligible",
  "refund pending",
  "refund ready for claiming",
  "refund claimed",
  "eligible",
  "requested",
  "refunded",
  "not eligible",
  "not_eligible",
])

function valueText(value: unknown) {
  return String(value || "").trim()
}

function normalized(value: unknown) {
  return normalizeStatus(value).replace(/\s+/g, " ")
}

function hasStatus(statuses: Set<string>, value: string) {
  return statuses.has(value) || statuses.has(value.replace(/\s+/g, "_"))
}

export function getTimestampMs(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) {
    const millis = value.getTime()
    return Number.isFinite(millis) ? millis : 0
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "object" && value !== null && "toMillis" in value && typeof value.toMillis === "function") {
    const millis = (value as { toMillis: () => number }).toMillis()
    return Number.isFinite(millis) ? millis : 0
  }
  if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
    return getTimestampMs((value as { toDate: () => Date }).toDate())
  }
  const parsed = new Date(String(value)).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

export function isChatSuggestionDisplayDue(
  state: PersistedChatSuggestionState | null | undefined,
  contextKey: string,
  nowMs: number,
  cooldownMs = CHAT_SUGGESTION_COOLDOWN_MS,
) {
  if (!state?.contextKey || state.contextKey !== contextKey) return true
  const lastShownMs = getTimestampMs(state.lastShownAt)
  if (!lastShownMs) return true
  return nowMs - lastShownMs >= cooldownMs
}

function bookingActivityMs(booking: Record<string, unknown>) {
  return Math.max(
    getTimestampMs(booking.updatedAt),
    getTimestampMs(booking.lastActivityAt),
    getTimestampMs(booking.createdAt),
    getTimestampMs(booking.date),
  )
}

function hasCancellationOrRefundState(booking: Record<string, unknown>, lifecycle: string) {
  const cancellationStatus = normalized(booking.cancellationStatus || booking.cancellationStatusLabel)
  const refundStatus = normalized(booking.refundStatus)
  const rawStatus = normalized(booking.status)
  return lifecycle === "cancelled"
    || hasActiveCancellationRequest(booking)
    || rawStatus === "cancellation_requested"
    || rawStatus === "cancellation_under_review"
    || cancellationStatus === "pending"
    || cancellationStatus === "under review"
    || cancellationStatus === "approved"
    || cancellationStatus === "cancellation requested"
    || cancellationStatus === "cancellation approved"
    || booking.refundEligible === true
    || Boolean(booking.refundRequestedAt || booking.refundedAt || booking.refundClaimedDate)
    || REFUND_RELATED_STATUSES.has(refundStatus)
}

function getBookingLabel(booking: Record<string, unknown>, bookingId: string) {
  const eventName = valueText(booking.eventName)
  const businessName = valueText(booking.companyName || booking.natureOfBusiness)
  if (eventName && businessName && eventName !== businessName) return `${eventName} · ${businessName}`
  return eventName || businessName || `Booking ${bookingId}`
}

function getStatusContext(booking: Record<string, unknown>, records: PaymentRecordLike[]) {
  const lifecycle = getBookingLifecycleStatus(booking)
  const rawPaymentStatus = normalized(booking.paymentStatus)
  const summary = calculatePaymentSummary(booking, records)
  const hasPendingRecord = records.some((record) => isPendingPaymentRecord(record) && isUnresolvedPaymentRecord(record))
  const hasPaymentSubmission = records.length > 0
    || booking.hasActivePaymentSubmission === true
    || Boolean(booking.paymentSubmittedAt)
  const hasNoPaymentRecords = records.length === 0
  const paymentReview = hasPendingRecord
    || (hasNoPaymentRecords && isForVerificationStatus(booking))
    || (hasNoPaymentRecords && hasStatus(PAYMENT_REVIEW_STATUSES, rawPaymentStatus))
    || (hasPaymentSubmission && summary.overallStatus === "for_review")
  const paid = summary.fullyPaid || (hasNoPaymentRecords && hasStatus(PAID_STATUSES, rawPaymentStatus))
  const partial = !paid && !paymentReview && (
    summary.overallStatus === "partial"
    || (summary.moneyReceivedTotal > 0 && summary.remainingBalance > 0)
  )
  const confirmedLike = isApprovedOrConfirmed(booking) || lifecycle === "confirmed" || lifecycle === "completed"
  const explicitAwaitingStatus = ["pending payment", "awaiting payment"].includes(rawPaymentStatus)
    || ["pending_payment", "awaiting_payment"].includes(rawPaymentStatus.replace(/\s+/g, "_"))
  const awaitingPayment = !paid && !paymentReview && (
    hasNoPaymentRecords && (
      (explicitAwaitingStatus || (hasStatus(PAYMENT_WAITING_STATUSES, rawPaymentStatus) && confirmedLike))
      || (confirmedLike && booking.hasActivePaymentSubmission === true)
    )
  )

  if (hasCancellationOrRefundState(booking, lifecycle)) {
    return { kind: "cancelled_or_refund" as const, lifecycle, summary, rawPaymentStatus }
  }
  if (paymentReview) return { kind: "payment_review" as const, lifecycle, summary, rawPaymentStatus }
  if (awaitingPayment) return { kind: "awaiting_payment" as const, lifecycle, summary, rawPaymentStatus }
  if (partial) return { kind: "partially_paid" as const, lifecycle, summary, rawPaymentStatus }
  const normalizedBookingStatus = normalized(booking.status || booking.bookingStatus).replace(/[\s-]+/g, "_")
  if (isOfficeResourceBooking(booking) && ["active_rental", "active_lease"].includes(normalizedBookingStatus)) {
    return { kind: "active_office" as const, lifecycle, summary, rawPaymentStatus }
  }
  if (lifecycle === "pending" && isPencilBooking(booking)) {
    return { kind: "pending_booking" as const, lifecycle, summary, rawPaymentStatus }
  }
  return { kind: "confirmed_event" as const, lifecycle, summary, rawPaymentStatus }
}

function contextKeyFor(
  booking: Record<string, unknown>,
  bookingId: string,
  statusContext: ReturnType<typeof getStatusContext>,
  questionSetKey: string,
) {
  return [
    bookingId,
    statusContext.kind,
    statusContext.lifecycle,
    statusContext.summary.overallStatus,
    normalized(statusContext.rawPaymentStatus).replace(/[\s-]+/g, "_"),
    String(booking.modificationRequested === true),
    String(booking.modificationUnderReview === true),
    normalized(booking.modificationStatus || booking.modifyRequestStatus || booking.modificationUnderReview),
    String(booking.cancellationRequested === true),
    normalized(booking.cancellationStatus || booking.cancellationStatusLabel),
    String(booking.refundEligible === true),
    normalized(booking.refundStatus),
    questionSetKey,
  ].join("|")
}

function getDefaultQuestionCandidates(): ChatSuggestion[] {
  return DEFAULT_CHAT_SUGGESTION_QUESTIONS.map(({ questionId, question, statusGroup, priority }) => ({
    id: questionId,
    text: question,
    statusGroup,
    priority,
  }))
}

function toQuestionCandidate(question: ChatSuggestion | PublishedChatSuggestionQuestion | ChatSuggestionQuestion): ChatSuggestion | null {
  const id = String("questionId" in question ? question.questionId : question.id || "").trim()
  const text = String("question" in question ? question.question : question.text || "").trim()
  const statusGroup = normalizeStatusGroup("statusGroup" in question ? question.statusGroup : undefined)
  if (!id || !text || !statusGroup) return null
  if ("enabled" in question && question.enabled === false) return null
  if ("isArchived" in question && question.isArchived === true) return null
  if ("isPublished" in question && question.isPublished !== true) return null
  return {
    id,
    text,
    statusGroup,
    priority: normalizePriority("priority" in question ? question.priority : undefined),
  }
}

function selectQuestionsForKind(
  kind: ChatSuggestionKind,
  configuredQuestions: ReadonlyArray<ChatSuggestion | PublishedChatSuggestionQuestion | ChatSuggestionQuestion>,
): ChatSuggestion[] {
  return configuredQuestions
    .map(toQuestionCandidate)
    .filter((question): question is ChatSuggestion => Boolean(question && question.statusGroup === kind))
    .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0) || left.id.localeCompare(right.id))
    .slice(0, 3)
}

function questionSetKey(questions: ReadonlyArray<ChatSuggestion>, version?: string | number): string {
  if (version !== undefined && version !== null && String(version)) return String(version)
  return questions.map((question) => `${question.id}:${question.priority ?? 0}:${question.text}`).join(";") || "empty"
}

export function getChatSuggestionContext(
  bookings: ReadonlyArray<Record<string, unknown>>,
  paymentRecords: ReadonlyArray<PaymentRecordLike>,
  configuredQuestions?: ReadonlyArray<ChatSuggestion | PublishedChatSuggestionQuestion | ChatSuggestionQuestion>,
  questionSetVersion?: string | number,
): ChatSuggestionContext {
  const sourceQuestions = configuredQuestions === undefined ? getDefaultQuestionCandidates() : configuredQuestions
  if (bookings.length === 0) {
    const questions = selectQuestionsForKind("no_booking", sourceQuestions)
    return {
      kind: "no_booking",
      contextKey: `none|no_booking|${questionSetKey(questions, questionSetVersion)}`,
      questions,
    }
  }

  const candidates = bookings.map((booking) => {
    const bookingId = valueText(booking.id || booking.bookingCode)
    const records = getRecordsForBooking(paymentRecords, booking)
    const statusContext = getStatusContext(booking, records)
    const priority = {
      cancelled_or_refund: 80,
      payment_review: 70,
      awaiting_payment: 60,
      partially_paid: 55,
      pending_booking: 50,
      active_office: 45,
      confirmed_event: 30,
    }[statusContext.kind]
    return {
      booking,
      bookingId,
      statusContext,
      priority,
      activityMs: bookingActivityMs(booking),
    }
  })

  candidates.sort((a, b) => b.priority - a.priority || b.activityMs - a.activityMs || a.bookingId.localeCompare(b.bookingId))
  const selected = candidates[0]
  const questions = selectQuestionsForKind(selected.statusContext.kind, sourceQuestions)
  const contextKey = contextKeyFor(
    selected.booking,
    selected.bookingId,
    selected.statusContext,
    questionSetKey(questions, questionSetVersion),
  )
  return {
    kind: selected.statusContext.kind,
    contextKey,
    bookingId: selected.bookingId || undefined,
    bookingLabel: getBookingLabel(selected.booking, selected.bookingId),
    questions,
  }
}

export function getChatSuggestionQuestionSet(kind: ChatSuggestionKind) {
  return getDefaultQuestionCandidates().filter((question) => question.statusGroup === kind)
}
