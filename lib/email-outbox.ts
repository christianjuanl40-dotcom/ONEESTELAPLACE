import "server-only"

import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore"
import { createHash } from "node:crypto"
import { getEmailConfig, isEmailSendingEnabled, type EmailEventType } from "@/lib/email-config"
import type { BookingEmailPayload, EmailPaymentSnapshot } from "@/lib/email-templates"

export const EMAIL_OUTBOX_COLLECTION = "emailOutbox"
export const EMAIL_TEMPLATE_VERSION = "v1"

export type EmailOutboxStatus = "pending" | "processing" | "retry" | "sent" | "failed" | "blocked"

export type EmailOutboxJob = {
  id: string
  eventType: EmailEventType
  eventId: string
  bookingId: string
  recipientUid: string
  templateVersion: string
  status: EmailOutboxStatus
  attempts: number
  createdAt?: unknown
  nextAttemptAt?: unknown
  claimedAt?: unknown
  claimExpiresAt?: unknown
  sentAt?: unknown
  lastErrorCode?: string | null
  payload: BookingEmailPayload
}

export type EmailOutboxEvent = {
  eventType: EmailEventType
  eventId: string
  bookingId: string
  recipientUid: string
  payload: BookingEmailPayload
}

type PreparedEmailJob = {
  ref: DocumentReference
  data: Record<string, unknown>
  indexes: number[]
  shouldCreate: boolean
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined)
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return value
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) result[key] = stripUndefined(entry)
    }
    return result
  }
  return value
}

function safeDocumentId(eventId: string): string {
  const normalized = eventId.trim().replace(/[^A-Za-z0-9_-]/g, "_")
  if (normalized === eventId && normalized.length >= 1 && normalized.length <= 140) return normalized
  const digest = createHash("sha256").update(eventId).digest("hex").slice(0, 32)
  return `evt_${normalized.slice(0, 100)}_${digest}`
}

function safeText(value: unknown, maxLength: number, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) || fallback : fallback
}

function safeSchedule(value: unknown): BookingEmailPayload["schedule"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const date = safeText(record.date, 32)
  if (!date) return null
  return {
    date,
    ...(safeText(record.endDate, 32) ? { endDate: safeText(record.endDate, 32) } : {}),
    ...(safeText(record.startTime, 32) ? { startTime: safeText(record.startTime, 32) } : {}),
    ...(safeText(record.endTime, 32) ? { endTime: safeText(record.endTime, 32) } : {}),
    ...(safeText(record.time, 64) ? { time: safeText(record.time, 64) } : {}),
  }
}

function safePayment(value: unknown): EmailPaymentSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const amount = Number(record.amount)
  return {
    method: safeText(record.method, 120, "Payment"),
    amount: Number.isFinite(amount) ? amount : 0,
    status: safeText(record.status, 120, "Not provided"),
    ...(safeText(record.reference, 160) ? { reference: safeText(record.reference, 160) } : {}),
    ...(safeText(record.paymentNumber, 64) ? { paymentNumber: safeText(record.paymentNumber, 64) } : {}),
    ...(safeText(record.note, 1000) ? { note: safeText(record.note, 1000) } : {}),
  }
}

/** Keeps only the fields that the templates are designed to disclose. */
function sanitizePayload(payload: BookingEmailPayload): BookingEmailPayload {
  const remainingBalance = Number(payload.remainingBalance)
  return {
    bookingReference: safeText(payload.bookingReference, 128, "Booking"),
    eventName: safeText(payload.eventName, 160, "Booking"),
    venue: safeText(payload.venue, 200, "Reserved space"),
    customerName: safeText(payload.customerName, 160, "Client"),
    schedule: safeSchedule(payload.schedule),
    ...(safeText(payload.decisionReason, 1000) ? { decisionReason: safeText(payload.decisionReason, 1000) } : {}),
    ...(safeSchedule(payload.originalSchedule) ? { originalSchedule: safeSchedule(payload.originalSchedule) } : {}),
    ...(safeSchedule(payload.previousSchedule) ? { previousSchedule: safeSchedule(payload.previousSchedule) } : {}),
    ...(safeSchedule(payload.effectiveSchedule) ? { effectiveSchedule: safeSchedule(payload.effectiveSchedule) } : {}),
    ...(safePayment(payload.payment) ? { payment: safePayment(payload.payment) } : {}),
    ...(Number.isFinite(remainingBalance) ? { remainingBalance } : {}),
  }
}

/**
 * Queues deterministic jobs in the same Firestore transaction as the business
 * transition. All outbox reads happen before any outbox write so a payment
 * transition can queue its payment and booking-confirmation jobs atomically.
 */
export async function enqueueEmailEvents(
  transaction: Transaction,
  firestore: Firestore,
  events: EmailOutboxEvent[],
): Promise<boolean[]> {
  const created = events.map(() => false)
  if (!isEmailSendingEnabled()) return created

  const jobs = new Map<string, PreparedEmailJob>()
  const now = new Date()
  events.forEach((event, index) => {
    if (!event.eventId.trim() || !event.recipientUid.trim() || !event.bookingId.trim()) return

    const eventId = event.eventId.trim()
    const ref = firestore.collection(EMAIL_OUTBOX_COLLECTION).doc(safeDocumentId(eventId))
    const existing = jobs.get(ref.path)
    if (existing) {
      existing.indexes.push(index)
      return
    }

    jobs.set(ref.path, {
      ref,
      indexes: [index],
      shouldCreate: false,
      data: {
        eventType: event.eventType,
        eventId,
        bookingId: event.bookingId,
        recipientUid: event.recipientUid.trim(),
        templateVersion: EMAIL_TEMPLATE_VERSION,
        status: "pending",
        attempts: 0,
        createdAt: now,
        nextAttemptAt: now,
        claimedAt: null,
        claimExpiresAt: null,
        sentAt: null,
        lastErrorCode: null,
        payload: sanitizePayload(stripUndefined(event.payload) as BookingEmailPayload),
      },
    })
  })

  // Firestore transactions require all reads to happen before any write.
  for (const job of jobs.values()) {
    const existing = await transaction.get(job.ref)
    job.shouldCreate = !existing.exists
  }
  for (const job of jobs.values()) {
    if (!job.shouldCreate) continue
    transaction.create(job.ref, job.data)
    created[job.indexes[0]] = true
  }
  return created
}

export async function enqueueEmailEvent(
  transaction: Transaction,
  firestore: Firestore,
  event: EmailOutboxEvent,
): Promise<boolean> {
  const [created] = await enqueueEmailEvents(transaction, firestore, [event])
  return created
}

export function getEmailRetryDelayMs(attempt: number): number {
  const bounded = Math.max(1, Math.min(attempt, 5))
  return Math.min(30 * 60 * 1000, 30 * 1000 * (2 ** (bounded - 1)))
}

export function getEmailMaxAttempts(): number {
  return getEmailConfig().maxAttempts
}
