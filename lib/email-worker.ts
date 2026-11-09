import "server-only"

import type { Auth } from "firebase-admin/auth"
import type { Firestore } from "firebase-admin/firestore"
import type { Transporter } from "nodemailer"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin"
import { getEmailConfig, isAllowedEmailRecipient, isValidEmailAddress } from "@/lib/email-config"
import { getEmailTransport } from "@/lib/email-transport"
import { getEmailRetryDelayMs, EMAIL_OUTBOX_COLLECTION, type EmailOutboxJob } from "@/lib/email-outbox"
import { renderEmailTemplate } from "@/lib/email-templates"

type DataRecord = Record<string, unknown>

export type EmailWorkerDependencies = {
  firestore?: Firestore
  auth?: Auth
  transport?: Pick<Transporter, "sendMail" | "verify">
  now?: () => Date
  verifyTransport?: boolean
}

export type EmailWorkerResult = {
  status: "disabled" | "not_ready" | "processed"
  processed: number
  sent: number
  retried: number
  failed: number
  blocked: number
  errorCode?: string
}

function asData(value: unknown): DataRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as DataRecord : {}
}

function timestampMs(value: unknown): number {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate()
    return date instanceof Date ? date.getTime() : Number.NaN
  }
  if (value instanceof Date) return value.getTime()
  const parsed = new Date(String(value || "")).getTime()
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function safeErrorCode(error: unknown): string {
  const record = asData(error)
  const responseCode = Number(record.responseCode)
  if (Number.isInteger(responseCode) && responseCode > 0) return `smtp_${responseCode}`
  const code = typeof record.code === "string" ? record.code.toUpperCase() : "EMAIL_SEND_FAILED"
  if (/^[A-Z0-9_-]{1,64}$/.test(code)) return code.toLowerCase()
  return "email_send_failed"
}

function isTransientError(error: unknown): boolean {
  const record = asData(error)
  const responseCode = Number(record.responseCode)
  if (Number.isInteger(responseCode)) return responseCode >= 400 && responseCode < 500
  const code = typeof record.code === "string" ? record.code.toUpperCase() : ""
  return ["ETIMEDOUT", "ESOCKET", "ECONNECTION", "ECONNRESET", "EPIPE", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "SMTP_CONNECTION"].includes(code)
}

function toJob(id: string, value: unknown): EmailOutboxJob | null {
  const data = asData(value)
  const eventType = typeof data.eventType === "string" ? data.eventType : ""
  const status = typeof data.status === "string" ? data.status : ""
  if (!eventType || !status || !data.recipientUid || !data.bookingId || !data.payload) return null
  return {
    id,
    eventType: eventType as EmailOutboxJob["eventType"],
    eventId: String(data.eventId || id),
    bookingId: String(data.bookingId),
    recipientUid: String(data.recipientUid),
    templateVersion: String(data.templateVersion || "v1"),
    status: status as EmailOutboxJob["status"],
    attempts: Number.isFinite(Number(data.attempts)) ? Number(data.attempts) : 0,
    createdAt: data.createdAt,
    nextAttemptAt: data.nextAttemptAt,
    claimedAt: data.claimedAt,
    claimExpiresAt: data.claimExpiresAt,
    sentAt: data.sentAt,
    lastErrorCode: typeof data.lastErrorCode === "string" ? data.lastErrorCode : null,
    payload: data.payload as EmailOutboxJob["payload"],
  }
}

function due(job: EmailOutboxJob, now: Date): boolean {
  const next = timestampMs(job.nextAttemptAt)
  return !Number.isFinite(next) || next <= now.getTime()
}

async function recoverExpiredClaims(firestore: Firestore, now: Date): Promise<void> {
  const snapshot = await firestore.collection(EMAIL_OUTBOX_COLLECTION).where("status", "==", "processing").get()
  for (const document of snapshot.docs) {
    const data = asData(document.data())
    const expires = timestampMs(data.claimExpiresAt)
    if (Number.isFinite(expires) && expires > now.getTime()) continue
    const ref = firestore.collection(EMAIL_OUTBOX_COLLECTION).doc(document.id)
    await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(ref)
      if (!current.exists) return
      const currentData = asData(current.data())
      if (currentData.status !== "processing") return
      const currentExpiry = timestampMs(currentData.claimExpiresAt)
      if (Number.isFinite(currentExpiry) && currentExpiry > now.getTime()) return
      transaction.update(ref, {
        status: "retry",
        nextAttemptAt: now,
        claimedAt: null,
        claimExpiresAt: null,
        lastErrorCode: "claim_expired",
      })
    })
  }
}

async function findCandidates(firestore: Firestore, now: Date): Promise<EmailOutboxJob[]> {
  const [pending, retry] = await Promise.all([
    firestore.collection(EMAIL_OUTBOX_COLLECTION).where("status", "==", "pending").get(),
    firestore.collection(EMAIL_OUTBOX_COLLECTION).where("status", "==", "retry").get(),
  ])
  const jobs = [...pending.docs, ...retry.docs]
    .map((document) => toJob(document.id, document.data()))
    .filter((job): job is EmailOutboxJob => Boolean(job && due(job, now)))
  return jobs.sort((first, second) => timestampMs(first.nextAttemptAt) - timestampMs(second.nextAttemptAt))
}

async function claimNext(firestore: Firestore, now: Date): Promise<EmailOutboxJob | null> {
  const candidates = await findCandidates(firestore, now)
  for (const candidate of candidates) {
    const ref = firestore.collection(EMAIL_OUTBOX_COLLECTION).doc(candidate.id)
    const claimed = await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(ref)
      if (!current.exists) return null
      const job = toJob(candidate.id, current.data())
      if (!job || (job.status !== "pending" && job.status !== "retry") || !due(job, now)) return null
      const attempts = job.attempts + 1
      const claimedAt = now
      const claimExpiresAt = new Date(now.getTime() + 5 * 60 * 1000)
      transaction.update(ref, { status: "processing", attempts, claimedAt, claimExpiresAt })
      return { ...job, status: "processing" as const, attempts, claimedAt, claimExpiresAt }
    })
    if (claimed) return claimed
  }
  return null
}

async function updateClaimedJob(
  firestore: Firestore,
  job: EmailOutboxJob,
  fields: DataRecord,
): Promise<void> {
  const ref = firestore.collection(EMAIL_OUTBOX_COLLECTION).doc(job.id)
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(ref)
    if (!current.exists) return
    const data = asData(current.data())
    if (data.status !== "processing" || Number(data.attempts || 0) !== job.attempts) return
    transaction.update(ref, fields as any)
  })
}

async function resolveRecipient(auth: Auth, uid: string): Promise<string> {
  const record = await auth.getUser(uid)
  const email = String(record.email || "").trim().toLowerCase()
  if (!isValidEmailAddress(email)) throw Object.assign(new Error("Recipient has no valid Firebase Auth email."), { code: "recipient_invalid" })
  return email
}

async function handleJob(
  firestore: Firestore,
  auth: Auth,
  transport: Pick<Transporter, "sendMail" | "verify">,
  job: EmailOutboxJob,
  config: ReturnType<typeof getEmailConfig>,
  now: Date,
): Promise<"sent" | "retry" | "failed" | "blocked"> {
  let email = ""
  try {
    email = await resolveRecipient(auth, job.recipientUid)
  } catch (error) {
    await updateClaimedJob(firestore, job, { status: "failed", claimedAt: null, claimExpiresAt: null, lastErrorCode: safeErrorCode(error) })
    return "failed"
  }

  if (!isAllowedEmailRecipient(email, config)) {
    await updateClaimedJob(firestore, job, { status: "blocked", claimedAt: null, claimExpiresAt: null, lastErrorCode: "test_recipient_not_allowed" })
    return "blocked"
  }

  try {
    const rendered = renderEmailTemplate(job.eventType, job.payload)
    const info = await transport.sendMail({
      from: config.from,
      to: email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    })
    await updateClaimedJob(firestore, job, {
      status: "sent",
      sentAt: now,
      claimedAt: null,
      claimExpiresAt: null,
      lastErrorCode: null,
      ...(info && typeof info.messageId === "string" ? { messageId: info.messageId.slice(0, 200) } : {}),
    })
    return "sent"
  } catch (error) {
    const transient = isTransientError(error)
    const exhausted = job.attempts >= config.maxAttempts
    const status = transient && !exhausted ? "retry" : "failed"
    const fields: DataRecord = {
      status,
      claimedAt: null,
      claimExpiresAt: null,
      lastErrorCode: safeErrorCode(error),
      ...(status === "retry" ? { nextAttemptAt: new Date(now.getTime() + getEmailRetryDelayMs(job.attempts)) } : {}),
    }
    await updateClaimedJob(firestore, job, fields)
    return status
  }
}

export async function processEmailOutbox(limit = 10, dependencies: EmailWorkerDependencies = {}): Promise<EmailWorkerResult> {
  const config = getEmailConfig()
  if (!config.enabled) return { status: "disabled", processed: 0, sent: 0, retried: 0, failed: 0, blocked: 0 }
  if (!config.ready) return { status: "not_ready", processed: 0, sent: 0, retried: 0, failed: 0, blocked: 0, errorCode: "email_configuration_incomplete" }

  const firestore = dependencies.firestore || getAdminFirestore()
  const auth = dependencies.auth || getAdminAuth()
  const transport = dependencies.transport || getEmailTransport(config)
  const nowProvider = dependencies.now || (() => new Date())
  const verifyTransport = dependencies.verifyTransport !== false
  if (verifyTransport && typeof transport.verify === "function") {
    try {
      await transport.verify()
    } catch (error) {
      return { status: "not_ready", processed: 0, sent: 0, retried: 0, failed: 0, blocked: 0, errorCode: safeErrorCode(error) }
    }
  }

  const now = nowProvider()
  await recoverExpiredClaims(firestore, now)
  const counts = { processed: 0, sent: 0, retried: 0, failed: 0, blocked: 0 }
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit) || 10, 25))
  for (let index = 0; index < boundedLimit; index++) {
    const job = await claimNext(firestore, nowProvider())
    if (!job) break
    const result = await handleJob(firestore, auth, transport, job, config, nowProvider())
    counts.processed++
    if (result === "retry") counts.retried++
    else counts[result]++
  }
  return { status: "processed", ...counts }
}
