import "server-only"

import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto"
import type { Auth } from "firebase-admin/auth"
import type { Firestore, Transaction } from "firebase-admin/firestore"
import type { Transporter } from "nodemailer"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin"
import {
  getEmailConfig,
  getEmailOtpSecret,
  getEmailRuntimeDiagnostics,
  isAllowedEmailRecipient,
  isEmailOtpSendingEnabled,
  isValidEmailAddress,
} from "@/lib/email-config"
import { createGmailTransport } from "@/lib/email-transport"

export const EMAIL_OTP_COLLECTION = "emailOtpChallenges"
export const EMAIL_OTP_RATE_LIMIT_COLLECTION = "emailOtpRateLimits"
export const EMAIL_OTP_LENGTH = 6
export const EMAIL_OTP_MAX_ATTEMPTS = 5

const ACCOUNT_RATE_LIMIT = { max: 5, windowSeconds: 15 * 60 }
const EMAIL_RATE_LIMIT = { max: 10, windowSeconds: 60 * 60 }
const IP_RATE_LIMIT = { max: 20, windowSeconds: 60 * 60 }
const CLAIM_SECONDS = 2 * 60

type OtpErrorStatus = 400 | 403 | 409 | 429 | 503

export class EmailOtpError extends Error {
  readonly status: OtpErrorStatus
  readonly code: string
  readonly retryAfterSeconds?: number

  constructor(status: OtpErrorStatus, code: string, message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = "EmailOtpError"
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export type EmailOtpDependencies = {
  firestore?: Firestore
  auth?: Pick<Auth, "getUser" | "updateUser">
  transport?: Pick<Transporter, "sendMail">
  now?: () => Date
  /** Test-only deterministic code source; production uses crypto.randomInt. */
  generateCode?: () => string
  /** Test-only injection; production always reads the server environment. */
  secret?: string
}

export type EmailOtpIssueResult =
  | { status: "sent"; retryAfterSeconds: number }
  | { status: "already_verified" }

export type EmailOtpVerifyResult = {
  status: "verified"
  alreadyVerified: boolean
}

type DataRecord = Record<string, unknown>

function asRecord(value: unknown): DataRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as DataRecord : {}
}

export function normalizeOtpEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

/**
 * Generates six digits from Node's cryptographically secure randomInt. The
 * explicit upper bound keeps leading zeroes possible after padding.
 */
export function generateEmailOtpCode(random = randomInt): string {
  return random(0, 1_000_000).toString().padStart(EMAIL_OTP_LENGTH, "0")
}

function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex")
}

export function createEmailOtpDigest(
  uid: string,
  email: string,
  code: string,
  challengeId: string,
  secret: string,
): string {
  return hmac(secret, ["otp-v1", uid, normalizeOtpEmail(email), code, challengeId].join("\u0000"))
}

function createEmailBindingDigest(uid: string, email: string, secret: string): string {
  return hmac(secret, ["email-v1", uid, normalizeOtpEmail(email)].join("\u0000"))
}

function createScopeDocumentId(scope: string, value: string, secret: string): string {
  return `${scope}_${hmac(secret, `${scope}\u0000${value}`).slice(0, 48)}`
}

function safeEqual(left: string, right: string): boolean {
  const first = Buffer.from(left, "utf8")
  const second = Buffer.from(right, "utf8")
  return first.length === second.length && timingSafeEqual(first, second)
}

function timestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate()
    return date instanceof Date ? date.getTime() : Number.NaN
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN
  const parsed = new Date(String(value || "")).getTime()
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function secondsUntil(value: unknown, now: Date): number {
  const milliseconds = timestampMs(value) - now.getTime()
  return milliseconds > 0 ? Math.ceil(milliseconds / 1000) : 0
}

function getSecret(dependencies: EmailOtpDependencies): string {
  const supplied = String(dependencies.secret || "").trim()
  if (supplied) return supplied
  try {
    return getEmailOtpSecret()
  } catch {
    throw new EmailOtpError(503, "otp_not_ready", "Email verification is temporarily unavailable. Please try again later.")
  }
}

function getFirestore(dependencies: EmailOtpDependencies): Firestore {
  return dependencies.firestore || getAdminFirestore()
}

function getAuth(dependencies: EmailOtpDependencies): Pick<Auth, "getUser" | "updateUser"> {
  return dependencies.auth || getAdminAuth()
}

function getNow(dependencies: EmailOtpDependencies): Date {
  const now = dependencies.now ? dependencies.now() : new Date()
  return now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date()
}

async function readAuthUser(auth: Pick<Auth, "getUser" | "updateUser">, uid: string) {
  try {
    return await auth.getUser(uid)
  } catch {
    throw new EmailOtpError(503, "auth_unavailable", "Verification service is temporarily unavailable. Please try again.")
  }
}

function assertSixDigitCode(code: string): string {
  const normalized = String(code || "").trim()
  if (!/^\d{6}$/.test(normalized)) {
    throw new EmailOtpError(400, "invalid_code_format", "Enter the 6-digit verification code.")
  }
  return normalized
}

function getClientEmail(authUser: { email?: string | null }): string {
  const email = normalizeOtpEmail(authUser.email)
  if (!isValidEmailAddress(email)) {
    throw new EmailOtpError(400, "email_unavailable", "This account does not have a valid email address.")
  }
  return email
}

function assertEmailPasswordProvider(authUser: { providerData?: Array<{ providerId?: string }> }): void {
  const providers = Array.isArray(authUser.providerData)
    ? authUser.providerData.map((provider) => String(provider?.providerId || "").trim().toLowerCase()).filter(Boolean)
    : []
  // Firebase UserRecord always includes providerData. The empty case keeps
  // lightweight unit fixtures compatible without weakening known-provider
  // handling for Google, phone, or other federated accounts.
  if (providers.length > 0 && !providers.includes("password")) {
    throw new EmailOtpError(403, "otp_provider_not_supported", "Only email and password accounts can use email verification codes.")
  }
}

function assertOtpSendingReady(secret: string) {
  const config = getEmailConfig()
  if (!isEmailOtpSendingEnabled()) {
    console.warn("[EMAIL_OTP] delivery gate is closed", getEmailRuntimeDiagnostics(config))
    throw new EmailOtpError(503, "otp_disabled", "Email verification code sending is currently disabled.")
  }
  if (!config.smtpConfigured || !secret) {
    console.warn("[EMAIL_OTP] delivery is not ready", getEmailRuntimeDiagnostics(config))
    throw new EmailOtpError(503, "otp_not_ready", "Email verification is temporarily unavailable. Please try again later.")
  }
  return config
}

type RatePolicy = { max: number; windowSeconds: number }

function rateState(snapshot: { exists: boolean; data: () => unknown }, now: Date, policy: RatePolicy) {
  const data = asRecord(snapshot.exists ? snapshot.data() : null)
  const startedAt = timestampMs(data.windowStartedAt)
  const isNewWindow = !Number.isFinite(startedAt) || now.getTime() - startedAt >= policy.windowSeconds * 1000
  const count = isNewWindow ? 0 : Math.max(0, Math.floor(Number(data.count) || 0))
  const windowStartedAt = isNewWindow ? now : new Date(startedAt)
  return {
    count,
    windowStartedAt,
    retryAfterSeconds: Math.max(0, Math.ceil((windowStartedAt.getTime() + policy.windowSeconds * 1000 - now.getTime()) / 1000)),
  }
}

function getRateLimitError(retryAfterSeconds: number): EmailOtpError {
  return new EmailOtpError(
    429,
    "otp_rate_limited",
    "Too many verification-code requests. Please try again later.",
    Math.max(1, retryAfterSeconds),
  )
}

function getIpScope(ipAddress: string | undefined): string {
  const value = String(ipAddress || "").trim()
  return value.length >= 1 && value.length <= 200 ? value : ""
}

function markDeliveryFailure(
  firestore: Firestore,
  uid: string,
  challengeId: string,
  now: Date,
): Promise<void> {
  const challengeRef = firestore.collection(EMAIL_OTP_COLLECTION).doc(uid)
  return firestore.runTransaction(async (transaction: Transaction) => {
    const current = await transaction.get(challengeRef)
    const data = asRecord(current.exists ? current.data() : null)
    if (!current.exists || data.challengeId !== challengeId || data.status !== "active") return
    transaction.update(challengeRef, {
      status: "delivery_failed",
      deliveryFailedAt: now,
      deliveryErrorCode: "smtp_send_failed",
    })
  })
}

async function markDeliverySent(
  firestore: Firestore,
  uid: string,
  challengeId: string,
  now: Date,
): Promise<void> {
  const challengeRef = firestore.collection(EMAIL_OTP_COLLECTION).doc(uid)
  try {
    await firestore.runTransaction(async (transaction: Transaction) => {
      const current = await transaction.get(challengeRef)
      const data = asRecord(current.exists ? current.data() : null)
      if (!current.exists || data.challengeId !== challengeId || data.status !== "active") return
      transaction.update(challengeRef, { deliveryStatus: "sent", deliveredAt: now })
    })
  } catch {
    // Gmail accepted the message. A metadata cleanup failure must not make the
    // client resend or expose a false delivery error; the challenge remains
    // usable and the next issuance overwrites it.
  }
}

export function renderOtpHtml(code: string, expiryMinutes: number): string {
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif;"><div style="padding:24px 12px;"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;"><div style="background:#ea580c;padding:24px 28px;color:#fff;"><div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:.9;">One Estela Place</div><h1 style="margin:10px 0 0;font-size:25px;line-height:1.2;">Verify Your Email</h1></div><div style="padding:28px;"><p style="margin:0 0 18px;color:#475569;font-size:15px;line-height:1.6;">Use the verification code below to finish creating your One Estela Place account.</p><div style="margin:0 auto 20px;padding:18px;border:1px solid #fed7aa;border-radius:12px;background:#fff7ed;text-align:center;"><div style="color:#c2410c;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Verification code</div><div style="margin-top:8px;color:#0f172a;font-size:34px;font-weight:800;letter-spacing:10px;">${code}</div></div><p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">This code expires in ${expiryMinutes} minutes. If you did not create an account, you can ignore this email.</p></div><div style="padding:16px 28px;background:#f8fafc;color:#64748b;font-size:12px;">One Estela Place · Automated verification message</div></div></div></body></html>`
}

export async function issueEmailOtp(
  uid: string,
  ipAddress = "",
  dependencies: EmailOtpDependencies = {},
): Promise<EmailOtpIssueResult> {
  const secret = getSecret(dependencies)
  const config = assertOtpSendingReady(secret)
  const firestore = getFirestore(dependencies)
  const auth = getAuth(dependencies)
  const authUser = await readAuthUser(auth, uid)
  assertEmailPasswordProvider(authUser)
  const email = getClientEmail(authUser)

  if (authUser.emailVerified === true) return { status: "already_verified" }
  if (!isAllowedEmailRecipient(email, config)) {
    throw new EmailOtpError(403, "otp_recipient_not_allowed", "This verification recipient is not enabled for the current environment.")
  }

  const now = getNow(dependencies)
  const challengeRef = firestore.collection(EMAIL_OTP_COLLECTION).doc(uid)
  const rateRefs = [
    {
      ref: firestore.collection(EMAIL_OTP_RATE_LIMIT_COLLECTION).doc(createScopeDocumentId("account", uid, secret)),
      policy: ACCOUNT_RATE_LIMIT,
    },
    {
      ref: firestore.collection(EMAIL_OTP_RATE_LIMIT_COLLECTION).doc(createScopeDocumentId("email", email, secret)),
      policy: EMAIL_RATE_LIMIT,
    },
  ]
  const ipScope = getIpScope(ipAddress)
  if (ipScope) {
    rateRefs.push({
      ref: firestore.collection(EMAIL_OTP_RATE_LIMIT_COLLECTION).doc(createScopeDocumentId("ip", ipScope, secret)),
      policy: IP_RATE_LIMIT,
    })
  }

  const challengeId = randomUUID()
  const emailDigest = createEmailBindingDigest(uid, email, secret)
  let code = ""

  await firestore.runTransaction(async (transaction: Transaction) => {
    const challengeSnapshot = await transaction.get(challengeRef)
    const rateSnapshots = []
    for (const entry of rateRefs) rateSnapshots.push({ entry, snapshot: await transaction.get(entry.ref) })

    const challenge = asRecord(challengeSnapshot.exists ? challengeSnapshot.data() : null)
    const cooldown = config.otpResendCooldownSeconds
    const previousSentAt = challenge.lastSentAt || challenge.createdAt
    const cooldownRemaining = secondsUntil(new Date(timestampMs(previousSentAt) + cooldown * 1000), now)
    if (cooldownRemaining > 0) throw getRateLimitError(cooldownRemaining)

    const states = rateSnapshots.map(({ entry, snapshot }) => ({
      entry,
      state: rateState(snapshot, now, entry.policy),
    }))
    const limited = states.find(({ state, entry }) => state.count >= entry.policy.max)
    if (limited) throw getRateLimitError(limited.state.retryAfterSeconds)

    // Generate only after the cooldown and all scope limits pass. This avoids
    // consuming a code for a rejected resend and keeps the persisted digest,
    // message, and challenge transactionally paired.
    code = dependencies.generateCode ? assertSixDigitCode(dependencies.generateCode()) : generateEmailOtpCode()
    const codeDigest = createEmailOtpDigest(uid, email, code, challengeId, secret)
    const challengeExpiresAt = new Date(now.getTime() + config.otpExpirySeconds * 1000)
    transaction.set(challengeRef, {
      uid,
      emailDigest,
      codeDigest,
      challengeId,
      status: "active",
      attempts: 0,
      createdAt: now,
      expiresAt: challengeExpiresAt,
      lastSentAt: now,
      deliveryStatus: "pending",
      deliveryFailedAt: null,
      deliveryErrorCode: null,
      claimId: null,
      claimExpiresAt: null,
      verifiedAt: null,
    })

    for (const { entry, state } of states) {
      transaction.set(entry.ref, {
        count: state.count + 1,
        windowStartedAt: state.windowStartedAt,
        updatedAt: now,
      }, { merge: true })
    }
  })

  const transport = dependencies.transport || createGmailTransport(config)
  try {
    await transport.sendMail({
      from: config.from,
      to: email,
      subject: "One Estela Place — Your Verification Code",
      text: [
        "One Estela Place — Verify Your Email",
        "",
        `Your verification code is: ${code}`,
        "",
        `This code expires in ${Math.ceil(config.otpExpirySeconds / 60)} minutes. If you did not create an account, you can ignore this email.`,
        "",
        "One Estela Place",
      ].join("\n"),
      html: renderOtpHtml(code, Math.ceil(config.otpExpirySeconds / 60)),
    })
  } catch {
    try {
      await markDeliveryFailure(firestore, uid, challengeId, getNow(dependencies))
    } catch {
      // Do not expose SMTP or Firestore diagnostics. A later request can still
      // replace the challenge after the server cooldown.
    }
    throw new EmailOtpError(503, "otp_delivery_failed", "We could not send the verification code. Please try again later.")
  }

  await markDeliverySent(firestore, uid, challengeId, getNow(dependencies))
  return { status: "sent", retryAfterSeconds: config.otpResendCooldownSeconds }
}

type ClaimResult =
  | { kind: "claimed"; claimId: string }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "locked" }
  | { kind: "email_changed" }
  | { kind: "in_progress" }

async function claimOtp(
  firestore: Firestore,
  uid: string,
  email: string,
  code: string,
  secret: string,
  now: Date,
): Promise<ClaimResult> {
  const challengeRef = firestore.collection(EMAIL_OTP_COLLECTION).doc(uid)
  const claimId = randomUUID()
  return firestore.runTransaction(async (transaction: Transaction) => {
    const snapshot = await transaction.get(challengeRef)
    if (!snapshot.exists) return { kind: "invalid" }
    const data = asRecord(snapshot.data())
    if (data.uid !== uid) return { kind: "invalid" }

    const emailDigest = createEmailBindingDigest(uid, email, secret)
    if (!safeEqual(String(data.emailDigest || ""), emailDigest)) {
      transaction.update(challengeRef, {
        status: "invalidated",
        invalidatedAt: now,
        invalidationReason: "email_changed",
        claimId: null,
        claimExpiresAt: null,
      })
      return { kind: "email_changed" }
    }

    const status = String(data.status || "")
    if (status === "verified" || status === "expired" || status === "locked" || status === "delivery_failed" || status === "invalidated") {
      return status === "expired" ? { kind: "expired" } : status === "locked" ? { kind: "locked" } : { kind: "invalid" }
    }
    if (status === "verifying" && secondsUntil(data.claimExpiresAt, now) > 0) return { kind: "in_progress" }

    if (secondsUntil(data.expiresAt, now) <= 0) {
      transaction.update(challengeRef, { status: "expired", expiredAt: now, claimId: null, claimExpiresAt: null })
      return { kind: "expired" }
    }

    const attempts = Math.max(0, Math.floor(Number(data.attempts) || 0))
    if (attempts >= EMAIL_OTP_MAX_ATTEMPTS) {
      transaction.update(challengeRef, { status: "locked", lockedAt: now, claimId: null, claimExpiresAt: null })
      return { kind: "locked" }
    }

    const expectedDigest = createEmailOtpDigest(uid, email, code, String(data.challengeId || ""), secret)
    if (!safeEqual(String(data.codeDigest || ""), expectedDigest)) {
      const nextAttempts = attempts + 1
      transaction.update(challengeRef, {
        attempts: nextAttempts,
        lastAttemptAt: now,
        ...(nextAttempts >= EMAIL_OTP_MAX_ATTEMPTS
          ? { status: "locked", lockedAt: now }
          : {}),
      })
      return nextAttempts >= EMAIL_OTP_MAX_ATTEMPTS ? { kind: "locked" } : { kind: "invalid" }
    }

    transaction.update(challengeRef, {
      status: "verifying",
      claimId,
      claimExpiresAt: new Date(now.getTime() + CLAIM_SECONDS * 1000),
      verificationStartedAt: now,
    })
    return { kind: "claimed", claimId }
  })
}

async function releaseClaim(firestore: Firestore, uid: string, claimId: string, now: Date): Promise<void> {
  const challengeRef = firestore.collection(EMAIL_OTP_COLLECTION).doc(uid)
  try {
    await firestore.runTransaction(async (transaction: Transaction) => {
      const snapshot = await transaction.get(challengeRef)
      const data = asRecord(snapshot.exists ? snapshot.data() : null)
      if (!snapshot.exists || data.status !== "verifying" || data.claimId !== claimId) return
      if (secondsUntil(data.expiresAt, now) <= 0) {
        transaction.update(challengeRef, { status: "expired", expiredAt: now, claimId: null, claimExpiresAt: null })
      } else {
        transaction.update(challengeRef, { status: "active", claimId: null, claimExpiresAt: null })
      }
    })
  } catch {
    // A still-valid claim is safer than releasing a code after an ambiguous
    // Firebase Auth operation. It can be recovered after its short lease.
  }
}

async function invalidateClaim(firestore: Firestore, uid: string, claimId: string, now: Date): Promise<void> {
  const challengeRef = firestore.collection(EMAIL_OTP_COLLECTION).doc(uid)
  try {
    await firestore.runTransaction(async (transaction: Transaction) => {
      const snapshot = await transaction.get(challengeRef)
      const data = asRecord(snapshot.exists ? snapshot.data() : null)
      if (!snapshot.exists || data.status !== "verifying" || data.claimId !== claimId) return
      transaction.update(challengeRef, {
        status: "invalidated",
        invalidatedAt: now,
        invalidationReason: "email_changed",
        claimId: null,
        claimExpiresAt: null,
      })
    })
  } catch {
    // The Firebase Auth email check remains authoritative and prevents a
    // different account from inheriting this challenge.
  }
}

async function finalizeClaim(firestore: Firestore, uid: string, claimId: string, now: Date): Promise<void> {
  const challengeRef = firestore.collection(EMAIL_OTP_COLLECTION).doc(uid)
  await firestore.runTransaction(async (transaction: Transaction) => {
    const snapshot = await transaction.get(challengeRef)
    const data = asRecord(snapshot.exists ? snapshot.data() : null)
    if (!snapshot.exists || data.status !== "verifying" || data.claimId !== claimId) return
    transaction.update(challengeRef, {
      status: "verified",
      verifiedAt: now,
      claimId: null,
      claimExpiresAt: null,
      codeDigest: null,
    })
  })
}

function emailChangedError(): EmailOtpError {
  return new EmailOtpError(409, "email_changed", "This code was issued before your email address changed. Request a new code.")
}

export async function verifyEmailOtp(
  uid: string,
  rawCode: string,
  dependencies: EmailOtpDependencies = {},
): Promise<EmailOtpVerifyResult> {
  const code = assertSixDigitCode(rawCode)
  const secret = getSecret(dependencies)
  const firestore = getFirestore(dependencies)
  const auth = getAuth(dependencies)
  const initialAuthUser = await readAuthUser(auth, uid)
  assertEmailPasswordProvider(initialAuthUser)
  const initialEmail = getClientEmail(initialAuthUser)

  if (initialAuthUser.emailVerified === true) return { status: "verified", alreadyVerified: true }

  const now = getNow(dependencies)
  const claim = await claimOtp(firestore, uid, initialEmail, code, secret, now)
  if (claim.kind === "invalid") throw new EmailOtpError(400, "invalid_code", "The verification code is invalid or has expired.")
  if (claim.kind === "expired") throw new EmailOtpError(400, "expired_code", "That verification code has expired. Request a new code.")
  if (claim.kind === "locked") throw new EmailOtpError(429, "attempt_limit", "Too many incorrect attempts. Request a new verification code.")
  if (claim.kind === "email_changed") throw emailChangedError()
  if (claim.kind === "in_progress") throw new EmailOtpError(409, "verification_in_progress", "Verification is already in progress. Please wait and refresh your status.")

  const { claimId } = claim
  let currentAuthUser = await readAuthUser(auth, uid)
  let currentEmail = getClientEmail(currentAuthUser)
  if (currentEmail !== initialEmail) {
    await invalidateClaim(firestore, uid, claimId, getNow(dependencies))
    throw emailChangedError()
  }
  if (currentAuthUser.emailVerified === true) {
    try { await finalizeClaim(firestore, uid, claimId, getNow(dependencies)) } catch { /* Auth is already authoritative. */ }
    return { status: "verified", alreadyVerified: true }
  }

  try {
    await auth.updateUser(uid, { emailVerified: true })
  } catch {
    // An Admin SDK response can be ambiguous. Re-read Firebase Auth before
    // releasing the claim so a successful update cannot be replayed.
    let recoveryReadSucceeded = false
    try {
      currentAuthUser = await auth.getUser(uid)
      recoveryReadSucceeded = true
      currentEmail = getClientEmail(currentAuthUser)
      if (currentEmail !== initialEmail) {
        await invalidateClaim(firestore, uid, claimId, getNow(dependencies))
        throw emailChangedError()
      }
      if (currentAuthUser.emailVerified === true) {
        try { await finalizeClaim(firestore, uid, claimId, getNow(dependencies)) } catch { /* Safe idempotent recovery on next request. */ }
        return { status: "verified", alreadyVerified: false }
      }
    } catch (recoveryError) {
      if (recoveryError instanceof EmailOtpError && recoveryError.code === "email_changed") throw recoveryError
      if (!recoveryReadSucceeded) {
        // Keep the short claim lease when Auth cannot be read. Releasing it
        // here could cause a second Admin update after an ambiguous success.
        throw new EmailOtpError(503, "auth_update_unconfirmed", "Email verification could not be confirmed. Please refresh and try again.")
      }
    }
    await releaseClaim(firestore, uid, claimId, getNow(dependencies))
    throw new EmailOtpError(503, "auth_update_failed", "We could not complete email verification. Please try again.")
  }

  try {
    currentAuthUser = await auth.getUser(uid)
    currentEmail = getClientEmail(currentAuthUser)
  } catch {
    // Leave the short-lived claim in place. The next request can inspect the
    // authoritative Firebase state instead of risking a duplicate update.
    throw new EmailOtpError(503, "auth_refresh_failed", "Email verification was submitted, but its status could not be confirmed. Please refresh and try again.")
  }

  if (currentEmail !== initialEmail) {
    try { await auth.updateUser(uid, { emailVerified: false }) } catch { /* Fail closed if compensation is unavailable. */ }
    await invalidateClaim(firestore, uid, claimId, getNow(dependencies))
    throw emailChangedError()
  }
  if (currentAuthUser.emailVerified !== true) {
    await releaseClaim(firestore, uid, claimId, getNow(dependencies))
    throw new EmailOtpError(503, "auth_update_unconfirmed", "Email verification could not be confirmed. Please try again.")
  }

  try {
    await finalizeClaim(firestore, uid, claimId, getNow(dependencies))
  } catch {
    // Firebase Auth is authoritative and the verifying claim already blocks
    // replay. A later request observes emailVerified=true and completes the
    // challenge cleanup idempotently.
  }
  return { status: "verified", alreadyVerified: false }
}
