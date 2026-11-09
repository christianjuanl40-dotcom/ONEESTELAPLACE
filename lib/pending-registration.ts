import "server-only"

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import type { Auth } from "firebase-admin/auth"
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore"
import type { Transporter } from "nodemailer"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin"
import {
  getEmailConfig,
  getEmailOtpSecret,
  isAllowedEmailRecipient,
  isEmailOtpSendingEnabled,
  isValidEmailAddress,
} from "@/lib/email-config"
import { createGmailTransport } from "@/lib/email-transport"
import {
  EMAIL_OTP_RATE_LIMIT_COLLECTION,
  generateEmailOtpCode,
  renderOtpHtml,
  normalizeOtpEmail,
} from "@/lib/email-otp"
import { formatDisplayName } from "@/src/modules/shared/lib/name-utils"

export const PENDING_REGISTRATION_COLLECTION = "pendingEmailRegistrations"
export const PENDING_REGISTRATION_INDEX_COLLECTION = "pendingEmailRegistrationIndex"
export const PENDING_REGISTRATION_COOKIE = "oe_pending_registration"
export const PENDING_REGISTRATION_AUTH_COOKIE = "oe_registration_authorization"
export const PENDING_REGISTRATION_AUTH_TTL_SECONDS = 10 * 60

const REGISTRATION_RATE_LIMIT = { max: 5, windowSeconds: 15 * 60 }
const REGISTRATION_IP_RATE_LIMIT = { max: 20, windowSeconds: 60 * 60 }
const EMAIL_OTP_MAX_ATTEMPTS = 5

type PendingRegistrationErrorStatus = 400 | 403 | 404 | 409 | 429 | 503

export class PendingRegistrationError extends Error {
  readonly status: PendingRegistrationErrorStatus
  readonly code: string
  readonly retryAfterSeconds?: number

  constructor(status: PendingRegistrationErrorStatus, code: string, message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = "PendingRegistrationError"
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

type PendingRegistrationAuth = Pick<Auth, "getUserByEmail" | "getUser" | "updateUser">

export type PendingRegistrationDependencies = {
  firestore?: Firestore
  auth?: PendingRegistrationAuth
  transport?: Pick<Transporter, "sendMail">
  now?: () => Date
  /** Test-only deterministic code source; production uses crypto.randomInt. */
  generateCode?: () => string
  /** Test-only deterministic identifiers; production uses crypto.randomUUID. */
  generateId?: () => string
  /** Test-only injection; production reads the server-only environment. */
  secret?: string
}

export type PendingRegistrationInput = {
  firstName: string
  middleName?: string
  lastName: string
  email: string
  phone?: string
}

export type PendingRegistrationIssueResult = {
  status: "sent"
  registrationId: string
  email: string
  retryAfterSeconds: number
  expiresInSeconds: number
}

export type PendingRegistrationVerifyResult = {
  status: "verified"
  email: string
  /** Server routes place this short-lived value in an HttpOnly cookie. */
  authorizationToken: string
  authorizationExpiresInSeconds: number
}

export type PendingRegistrationStatusResult = {
  status: "active" | "delivery_failed" | "expired" | "locked" | "verified" | "finalized"
  email: string
  expiresInSeconds: number
}

export type PendingRegistrationFinalizeResult = {
  status: "finalized"
  uid: string
  email: string
}

type DataRecord = Record<string, unknown>

function asRecord(value: unknown): DataRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as DataRecord : {}
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

function asDate(value: unknown): Date | null {
  const milliseconds = timestampMs(value)
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null
}

function secondsUntil(value: unknown, now: Date): number {
  const milliseconds = timestampMs(value) - now.getTime()
  return milliseconds > 0 ? Math.ceil(milliseconds / 1000) : 0
}

function safeEqual(left: string, right: string): boolean {
  const first = Buffer.from(left, "utf8")
  const second = Buffer.from(right, "utf8")
  return first.length === second.length && timingSafeEqual(first, second)
}

function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex")
}

function getSecret(dependencies: PendingRegistrationDependencies): string {
  const supplied = String(dependencies.secret || "").trim()
  if (supplied) return supplied
  try {
    return getEmailOtpSecret()
  } catch {
    throw new PendingRegistrationError(503, "otp_not_ready", "Email verification is temporarily unavailable. Please try again later.")
  }
}

function getFirestore(dependencies: PendingRegistrationDependencies): Firestore {
  return dependencies.firestore || getAdminFirestore()
}

function getAuth(dependencies: PendingRegistrationDependencies): PendingRegistrationAuth {
  return dependencies.auth || getAdminAuth()
}

function getNow(dependencies: PendingRegistrationDependencies): Date {
  const now = dependencies.now ? dependencies.now() : new Date()
  return now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date()
}

function getId(dependencies: PendingRegistrationDependencies): string {
  return dependencies.generateId ? String(dependencies.generateId()) : randomUUID()
}

function normalizeText(value: unknown, field: string, required: boolean, maxLength: number): string {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  if (required && !normalized) throw new PendingRegistrationError(400, `invalid_${field}`, `Enter your ${field}.`)
  if (normalized.length > maxLength) throw new PendingRegistrationError(400, `invalid_${field}`, `Your ${field} is too long.`)
  return normalized
}

function normalizeInput(input: PendingRegistrationInput): PendingRegistrationInput & { email: string; firstName: string; middleName: string; lastName: string; phone: string } {
  const email = normalizeOtpEmail(input.email)
  if (!isValidEmailAddress(email)) throw new PendingRegistrationError(400, "invalid_email", "Enter a valid email address.")
  return {
    firstName: normalizeText(input.firstName, "first name", true, 100),
    middleName: normalizeText(input.middleName, "middle name", false, 100),
    lastName: normalizeText(input.lastName, "last name", true, 100),
    email,
    phone: normalizeText(input.phone, "phone number", false, 40),
  }
}

function assertRegistrationId(value: unknown): string {
  const registrationId = typeof value === "string" ? value.trim() : ""
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(registrationId)) {
    throw new PendingRegistrationError(400, "invalid_registration", "This signup session is invalid. Start signup again.")
  }
  return registrationId
}

function assertSixDigitCode(value: unknown): string {
  const code = typeof value === "string" ? value.trim() : ""
  if (!/^\d{6}$/.test(code)) {
    throw new PendingRegistrationError(400, "invalid_code_format", "Enter the 6-digit verification code.")
  }
  return code
}

function createScopeDocumentId(scope: string, value: string, secret: string): string {
  return `${scope}_${hmac(secret, `${scope}\u0000${value}`).slice(0, 48)}`
}

function createEmailDigest(email: string, secret: string): string {
  return hmac(secret, ["registration-email-v1", normalizeOtpEmail(email)].join("\u0000"))
}

export function createPendingRegistrationOtpDigest(email: string, code: string, registrationId: string, secret: string): string {
  return hmac(secret, ["registration-otp-v1", normalizeOtpEmail(email), code, registrationId].join("\u0000"))
}

export function createPendingRegistrationAuthorization(
  email: string,
  registrationId: string,
  nonce: string,
  expiresAt: Date,
  secret: string,
): string {
  return hmac(secret, [
    "registration-auth-v1",
    registrationId,
    normalizeOtpEmail(email),
    nonce,
    String(expiresAt.getTime()),
  ].join("\u0000"))
}

function getRateState(snapshot: { exists: boolean; data: () => unknown }, now: Date, policy: { max: number; windowSeconds: number }) {
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

function getRateLimitError(retryAfterSeconds: number): PendingRegistrationError {
  return new PendingRegistrationError(
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

function getChallengeRef(firestore: Firestore, registrationId: string) {
  return firestore.collection(PENDING_REGISTRATION_COLLECTION).doc(registrationId)
}

function getIndexRef(firestore: Firestore, email: string, secret: string) {
  return firestore.collection(PENDING_REGISTRATION_INDEX_COLLECTION).doc(createScopeDocumentId("email", email, secret))
}

function getRateRefs(firestore: Firestore, email: string, ipAddress: string, secret: string) {
  const refs: Array<{ ref: DocumentReference; policy: { max: number; windowSeconds: number } }> = [
    {
      ref: firestore.collection(EMAIL_OTP_RATE_LIMIT_COLLECTION).doc(createScopeDocumentId("registration_email", email, secret)),
      policy: REGISTRATION_RATE_LIMIT,
    },
  ]
  const ipScope = getIpScope(ipAddress)
  if (ipScope) {
    refs.push({
      ref: firestore.collection(EMAIL_OTP_RATE_LIMIT_COLLECTION).doc(createScopeDocumentId("registration_ip", ipScope, secret)),
      policy: REGISTRATION_IP_RATE_LIMIT,
    })
  }
  return refs
}

function assertDeliveryReady(secret: string) {
  const config = getEmailConfig()
  if (!isEmailOtpSendingEnabled()) {
    throw new PendingRegistrationError(503, "otp_disabled", "Email verification code sending is currently disabled.")
  }
  if (!config.smtpConfigured || !secret) {
    throw new PendingRegistrationError(503, "otp_not_ready", "Email verification is temporarily unavailable. Please try again later.")
  }
  return config
}

async function assertEmailAvailable(auth: PendingRegistrationAuth, email: string): Promise<void> {
  try {
    await auth.getUserByEmail(email)
    throw new PendingRegistrationError(409, "email_already_registered", "An account with this email already exists. Please log in instead.")
  } catch (error) {
    if (error instanceof PendingRegistrationError) throw error
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code || "") : ""
    if (code === "auth/user-not-found") return
    throw new PendingRegistrationError(503, "auth_unavailable", "Signup is temporarily unavailable. Please try again later.")
  }
}

function buildChallenge(input: PendingRegistrationInput & { email: string; firstName: string; middleName: string; lastName: string; phone: string }, registrationId: string, emailDigest: string, codeDigest: string, now: Date, expiresAt: Date) {
  return {
    registrationId,
    email: input.email,
    emailDigest,
    codeDigest,
    firstName: input.firstName,
    middleName: input.middleName,
    lastName: input.lastName,
    phone: input.phone,
    status: "active",
    attempts: 0,
    createdAt: now,
    expiresAt,
    lastSentAt: now,
    deliveryStatus: "pending",
    deliveryFailedAt: null,
    deliveryErrorCode: null,
    authorizationNonce: null,
    authorizationExpiresAt: null,
    verifiedAt: null,
    finalizedAt: null,
    finalizedUid: null,
  }
}

async function markDeliveryFailure(firestore: Firestore, registrationId: string, now: Date): Promise<void> {
  const challengeRef = getChallengeRef(firestore, registrationId)
  try {
    await firestore.runTransaction(async (transaction: Transaction) => {
      const snapshot = await transaction.get(challengeRef)
      const data = asRecord(snapshot.exists ? snapshot.data() : null)
      if (!snapshot.exists || data.registrationId !== registrationId || data.status !== "active") return
      transaction.update(challengeRef, {
        status: "delivery_failed",
        deliveryFailedAt: now,
        deliveryErrorCode: "smtp_send_failed",
      })
    })
  } catch {
    // The safe client error remains the same even if the failure marker cannot
    // be recorded. No Auth or profile write has happened at this stage.
  }
}

async function markDeliverySent(firestore: Firestore, registrationId: string, now: Date): Promise<void> {
  const challengeRef = getChallengeRef(firestore, registrationId)
  try {
    await firestore.runTransaction(async (transaction: Transaction) => {
      const snapshot = await transaction.get(challengeRef)
      const data = asRecord(snapshot.exists ? snapshot.data() : null)
      if (!snapshot.exists || data.registrationId !== registrationId || data.status !== "active") return
      transaction.update(challengeRef, { deliveryStatus: "sent", deliveredAt: now })
    })
  } catch {
    // SMTP acceptance is authoritative for delivery progress. Metadata cleanup
    // failure must not cause a duplicate send prompt.
  }
}

async function sendCode(
  email: string,
  code: string,
  config: ReturnType<typeof getEmailConfig>,
  dependencies: PendingRegistrationDependencies,
): Promise<void> {
  const transport = dependencies.transport || createGmailTransport(config)
  await transport.sendMail({
    from: config.from,
    to: email,
    subject: "One Estela Place — Your Verification Code",
    text: [
      "One Estela Place — Verify Your Email",
      "",
      `Your verification code is: ${code}`,
      "",
      `This code expires in ${Math.ceil(config.otpExpirySeconds / 60)} minutes. If you did not start signup, you can ignore this email.`,
      "",
      "One Estela Place",
    ].join("\n"),
    html: renderOtpHtml(code, Math.ceil(config.otpExpirySeconds / 60)),
  })
}

function assertCodeSource(dependencies: PendingRegistrationDependencies): string {
  const code = dependencies.generateCode ? String(dependencies.generateCode()) : generateEmailOtpCode()
  if (!/^\d{6}$/.test(code)) throw new PendingRegistrationError(503, "otp_generation_failed", "Email verification is temporarily unavailable. Please try again later.")
  return code
}

export async function issuePendingRegistration(
  rawInput: PendingRegistrationInput,
  ipAddress = "",
  dependencies: PendingRegistrationDependencies = {},
): Promise<PendingRegistrationIssueResult> {
  const input = normalizeInput(rawInput)
  const secret = getSecret(dependencies)
  const config = assertDeliveryReady(secret)
  if (!isAllowedEmailRecipient(input.email, config)) {
    throw new PendingRegistrationError(403, "otp_recipient_not_allowed", "This verification recipient is not enabled for the current environment.")
  }
  const auth = getAuth(dependencies)
  await assertEmailAvailable(auth, input.email)
  const firestore = getFirestore(dependencies)
  const now = getNow(dependencies)
  const indexRef = getIndexRef(firestore, input.email, secret)
  const newRegistrationId = getId(dependencies)
  const newChallengeRef = getChallengeRef(firestore, newRegistrationId)
  const rateRefs = getRateRefs(firestore, input.email, ipAddress, secret)
  let registrationId = newRegistrationId
  let code = ""

  await firestore.runTransaction(async (transaction: Transaction) => {
    const indexSnapshot = await transaction.get(indexRef)
    const indexData = asRecord(indexSnapshot.exists ? indexSnapshot.data() : null)
    const indexedId = typeof indexData.registrationId === "string" ? indexData.registrationId : ""
    const indexedRef = indexedId ? getChallengeRef(firestore, indexedId) : null
    const existingSnapshot = indexedRef ? await transaction.get(indexedRef) : null
    const existing = existingSnapshot?.exists ? asRecord(existingSnapshot.data()) : null
    const rateSnapshots = []
    for (const entry of rateRefs) rateSnapshots.push({ entry, snapshot: await transaction.get(entry.ref) })

    if (existing && (existing.status === "verified" || existing.status === "finalized") && secondsUntil(existing.authorizationExpiresAt, now) > 0) {
      throw new PendingRegistrationError(409, "registration_in_progress", "This email already has a verification in progress. Continue that signup or start again later.")
    }

    const previousSentAt = existing?.lastSentAt || existing?.createdAt
    const cooldownRemaining = previousSentAt
      ? Math.max(0, Math.ceil((timestampMs(previousSentAt) + config.otpResendCooldownSeconds * 1000 - now.getTime()) / 1000))
      : 0
    if (cooldownRemaining > 0) throw getRateLimitError(cooldownRemaining)

    const states = rateSnapshots.map(({ entry, snapshot }) => ({
      entry,
      state: getRateState(snapshot, now, entry.policy),
    }))
    const limited = states.find(({ state, entry }) => state.count >= entry.policy.max)
    if (limited) throw getRateLimitError(limited.state.retryAfterSeconds)

    code = assertCodeSource(dependencies)
    registrationId = existing && indexedId ? indexedId : newRegistrationId
    const challengeRef = existing && indexedRef ? indexedRef : newChallengeRef
    const expiresAt = new Date(now.getTime() + config.otpExpirySeconds * 1000)
    const challenge = buildChallenge(
      input,
      registrationId,
      createEmailDigest(input.email, secret),
      createPendingRegistrationOtpDigest(input.email, code, registrationId, secret),
      now,
      expiresAt,
    )
    transaction.set(challengeRef, challenge)
    transaction.set(indexRef, { registrationId, updatedAt: now })
    for (const { entry, state } of states) {
      transaction.set(entry.ref, {
        count: state.count + 1,
        windowStartedAt: state.windowStartedAt,
        updatedAt: now,
      }, { merge: true })
    }
  })

  try {
    await sendCode(input.email, code, config, dependencies)
  } catch {
    await markDeliveryFailure(firestore, registrationId, getNow(dependencies))
    throw new PendingRegistrationError(503, "otp_delivery_failed", "We could not send the verification code. Please try again later.")
  }
  await markDeliverySent(firestore, registrationId, getNow(dependencies))
  return {
    status: "sent",
    registrationId,
    email: input.email,
    retryAfterSeconds: config.otpResendCooldownSeconds,
    expiresInSeconds: config.otpExpirySeconds,
  }
}

export async function resendPendingRegistration(
  registrationIdValue: string,
  ipAddress = "",
  dependencies: PendingRegistrationDependencies = {},
): Promise<PendingRegistrationIssueResult> {
  const registrationId = assertRegistrationId(registrationIdValue)
  const secret = getSecret(dependencies)
  const config = assertDeliveryReady(secret)
  const firestore = getFirestore(dependencies)
  const challengeRef = getChallengeRef(firestore, registrationId)
  const initial = await challengeRef.get()
  if (!initial.exists) throw new PendingRegistrationError(404, "registration_not_found", "This signup session has expired. Start signup again.")
  const initialData = asRecord(initial.data())
  const email = normalizeOtpEmail(initialData.email)
  if (!isValidEmailAddress(email) || !safeEqual(String(initialData.emailDigest || ""), createEmailDigest(email, secret))) {
    throw new PendingRegistrationError(409, "registration_invalid", "This signup session is invalid. Start signup again.")
  }
  if (initialData.status === "verified" || initialData.status === "finalized") {
    throw new PendingRegistrationError(409, "registration_already_verified", "This email is already verified. Continue signup to finish creating the account.")
  }
  if (!isAllowedEmailRecipient(email, config)) {
    throw new PendingRegistrationError(403, "otp_recipient_not_allowed", "This verification recipient is not enabled for the current environment.")
  }
  const auth = getAuth(dependencies)
  await assertEmailAvailable(auth, email)
  const now = getNow(dependencies)
  const rateRefs = getRateRefs(firestore, email, ipAddress, secret)
  let code = ""

  await firestore.runTransaction(async (transaction: Transaction) => {
    const snapshot = await transaction.get(challengeRef)
    const data = asRecord(snapshot.exists ? snapshot.data() : null)
    const rateSnapshots = []
    for (const entry of rateRefs) rateSnapshots.push({ entry, snapshot: await transaction.get(entry.ref) })
    if (!snapshot.exists || data.registrationId !== registrationId) throw new PendingRegistrationError(404, "registration_not_found", "This signup session has expired. Start signup again.")
    if (data.status === "verified" || data.status === "finalized") throw new PendingRegistrationError(409, "registration_already_verified", "This email is already verified. Continue signup to finish creating the account.")
    const cooldownRemaining = Math.max(0, Math.ceil((timestampMs(data.lastSentAt || data.createdAt) + config.otpResendCooldownSeconds * 1000 - now.getTime()) / 1000))
    if (cooldownRemaining > 0) throw getRateLimitError(cooldownRemaining)
    const states = rateSnapshots.map(({ entry, snapshot: rateSnapshot }) => ({
      entry,
      state: getRateState(rateSnapshot, now, entry.policy),
    }))
    const limited = states.find(({ state, entry }) => state.count >= entry.policy.max)
    if (limited) throw getRateLimitError(limited.state.retryAfterSeconds)
    code = assertCodeSource(dependencies)
    transaction.update(challengeRef, {
      status: "active",
      attempts: 0,
      codeDigest: createPendingRegistrationOtpDigest(email, code, registrationId, secret),
      createdAt: data.createdAt || now,
      expiresAt: new Date(now.getTime() + config.otpExpirySeconds * 1000),
      lastSentAt: now,
      deliveryStatus: "pending",
      deliveryFailedAt: null,
      deliveryErrorCode: null,
    })
    for (const { entry, state } of states) {
      transaction.set(entry.ref, {
        count: state.count + 1,
        windowStartedAt: state.windowStartedAt,
        updatedAt: now,
      }, { merge: true })
    }
  })

  try {
    await sendCode(email, code, config, dependencies)
  } catch {
    await markDeliveryFailure(firestore, registrationId, getNow(dependencies))
    throw new PendingRegistrationError(503, "otp_delivery_failed", "We could not send the verification code. Please try again later.")
  }
  await markDeliverySent(firestore, registrationId, getNow(dependencies))
  return {
    status: "sent",
    registrationId,
    email,
    retryAfterSeconds: config.otpResendCooldownSeconds,
    expiresInSeconds: config.otpExpirySeconds,
  }
}

export async function verifyPendingRegistration(
  registrationIdValue: string,
  rawCode: unknown,
  dependencies: PendingRegistrationDependencies = {},
): Promise<PendingRegistrationVerifyResult> {
  const registrationId = assertRegistrationId(registrationIdValue)
  const code = assertSixDigitCode(rawCode)
  const secret = getSecret(dependencies)
  const firestore = getFirestore(dependencies)
  const challengeRef = getChallengeRef(firestore, registrationId)
  const now = getNow(dependencies)
  let result: PendingRegistrationVerifyResult | null = null
  let failure: PendingRegistrationError | null = null

  await firestore.runTransaction(async (transaction: Transaction) => {
    const snapshot = await transaction.get(challengeRef)
    const data = asRecord(snapshot.exists ? snapshot.data() : null)
    if (!snapshot.exists || data.registrationId !== registrationId) {
      failure = new PendingRegistrationError(404, "registration_not_found", "This signup session has expired. Start signup again.")
      return
    }
    const email = normalizeOtpEmail(data.email)
    if (!isValidEmailAddress(email) || !safeEqual(String(data.emailDigest || ""), createEmailDigest(email, secret))) {
      failure = new PendingRegistrationError(409, "registration_invalid", "This signup session is invalid. Start signup again.")
      return
    }
    if (data.status === "finalized") {
      failure = new PendingRegistrationError(409, "registration_already_finalized", "This signup session has already been completed. Please log in instead.")
      return
    }
    if (data.status === "verified") {
      failure = new PendingRegistrationError(409, "registration_already_verified", "This verification code has already been used. Continue signup or request a new code.")
      return
    }
    if (data.status === "locked") {
      failure = new PendingRegistrationError(429, "attempt_limit", "Too many incorrect attempts. Request a new verification code.")
      return
    }
    if (data.status === "delivery_failed") {
      failure = new PendingRegistrationError(400, "delivery_failed", "The verification code was not delivered. Request a new code.")
      return
    }
    if (secondsUntil(data.expiresAt, now) <= 0) {
      transaction.update(challengeRef, { status: "expired", expiredAt: now })
      failure = new PendingRegistrationError(400, "expired_code", "That verification code has expired. Request a new code.")
      return
    }
    const attempts = Math.max(0, Math.floor(Number(data.attempts) || 0))
    const expectedDigest = createPendingRegistrationOtpDigest(email, code, registrationId, secret)
    if (!safeEqual(String(data.codeDigest || ""), expectedDigest)) {
      const nextAttempts = attempts + 1
      transaction.update(challengeRef, {
        attempts: nextAttempts,
        lastAttemptAt: now,
        ...(nextAttempts >= EMAIL_OTP_MAX_ATTEMPTS ? { status: "locked", lockedAt: now } : {}),
      })
      failure = nextAttempts >= EMAIL_OTP_MAX_ATTEMPTS
        ? new PendingRegistrationError(429, "attempt_limit", "Too many incorrect attempts. Request a new verification code.")
        : new PendingRegistrationError(400, "invalid_code", "The verification code is invalid or has expired.")
      return
    }

    const authorizationNonce = getId(dependencies)
    const authorizationExpiresAt = new Date(now.getTime() + PENDING_REGISTRATION_AUTH_TTL_SECONDS * 1000)
    transaction.update(challengeRef, {
      status: "verified",
      verifiedAt: now,
      codeDigest: null,
      attempts,
      authorizationNonce,
      authorizationExpiresAt,
    })
    result = {
      status: "verified",
      email,
      authorizationToken: createPendingRegistrationAuthorization(email, registrationId, authorizationNonce, authorizationExpiresAt, secret),
      authorizationExpiresInSeconds: PENDING_REGISTRATION_AUTH_TTL_SECONDS,
    }
  })

  if (failure) throw failure
  if (!result) throw new PendingRegistrationError(503, "verification_unavailable", "Verification could not be completed. Please try again later.")
  return result
}

export async function getPendingRegistrationStatus(
  registrationIdValue: string,
  dependencies: PendingRegistrationDependencies = {},
): Promise<PendingRegistrationStatusResult> {
  const registrationId = assertRegistrationId(registrationIdValue)
  const firestore = getFirestore(dependencies)
  const snapshot = await getChallengeRef(firestore, registrationId).get()
  if (!snapshot.exists) throw new PendingRegistrationError(404, "registration_not_found", "This signup session has expired. Start signup again.")
  const data = asRecord(snapshot.data())
  const email = normalizeOtpEmail(data.email)
  if (!isValidEmailAddress(email)) throw new PendingRegistrationError(409, "registration_invalid", "This signup session is invalid. Start signup again.")
  return {
    status: String(data.status || "active") as PendingRegistrationStatusResult["status"],
    email,
    expiresInSeconds: Math.max(secondsUntil(data.expiresAt, getNow(dependencies)), secondsUntil(data.authorizationExpiresAt, getNow(dependencies))),
  }
}

type AuthUserLike = {
  uid?: string
  email?: string | null
  emailVerified?: boolean
  providerData?: Array<{ providerId?: string }>
  metadata?: { creationTime?: string }
}

function assertPasswordProvider(authUser: AuthUserLike): void {
  const providers = Array.isArray(authUser.providerData)
    ? authUser.providerData.map((provider) => String(provider?.providerId || "").trim().toLowerCase()).filter(Boolean)
    : []
  if (providers.length > 0 && !providers.includes("password")) {
    throw new PendingRegistrationError(403, "registration_provider_not_supported", "Only email and password accounts can complete signup.")
  }
}

function getAuthEmail(authUser: AuthUserLike): string {
  const email = normalizeOtpEmail(authUser.email)
  if (!isValidEmailAddress(email)) throw new PendingRegistrationError(409, "registration_email_unavailable", "The new account email could not be confirmed.")
  return email
}

async function readAuthUser(auth: PendingRegistrationAuth, uid: string): Promise<AuthUserLike> {
  try {
    return await auth.getUser(uid) as AuthUserLike
  } catch {
    throw new PendingRegistrationError(409, "registration_auth_missing", "Create the Firebase account again from this verified signup session.")
  }
}

export async function finalizePendingRegistration(
  input: { registrationId: string; authorizationToken: string; uid: string },
  dependencies: PendingRegistrationDependencies = {},
): Promise<PendingRegistrationFinalizeResult> {
  const registrationId = assertRegistrationId(input.registrationId)
  const uid = typeof input.uid === "string" ? input.uid.trim() : ""
  const token = typeof input.authorizationToken === "string" ? input.authorizationToken.trim() : ""
  if (!uid || uid.length > 256 || !token || token.length > 256) {
    throw new PendingRegistrationError(400, "invalid_finalization", "This signup session is invalid. Start signup again.")
  }
  const secret = getSecret(dependencies)
  const firestore = getFirestore(dependencies)
  const auth = getAuth(dependencies)
  const authUser = await readAuthUser(auth, uid)
  assertPasswordProvider(authUser)
  const authEmail = getAuthEmail(authUser)
  const challengeRef = getChallengeRef(firestore, registrationId)
  const initial = await challengeRef.get()
  if (!initial.exists) throw new PendingRegistrationError(404, "registration_not_found", "This signup session has expired. Start signup again.")
  const initialData = asRecord(initial.data())
  const challengeEmail = normalizeOtpEmail(initialData.email)
  if (authEmail !== challengeEmail || !safeEqual(String(initialData.emailDigest || ""), createEmailDigest(challengeEmail, secret))) {
    throw new PendingRegistrationError(409, "registration_identity_mismatch", "The Firebase account does not match the verified signup email.")
  }
  if (initialData.status === "finalized") {
    if (String(initialData.finalizedUid || "") !== uid) throw new PendingRegistrationError(409, "registration_already_used", "This signup authorization has already been used.")
    return { status: "finalized", uid, email: challengeEmail }
  }
  if (initialData.status !== "verified") throw new PendingRegistrationError(403, "registration_not_verified", "Verify the email code before creating the account.")
  const initialExpiresAt = asDate(initialData.authorizationExpiresAt)
  const initialNonce = String(initialData.authorizationNonce || "")
  if (!initialExpiresAt || !initialNonce || secondsUntil(initialExpiresAt, getNow(dependencies)) <= 0) {
    throw new PendingRegistrationError(400, "authorization_expired", "This verification session has expired. Start signup again.")
  }
  const expectedToken = createPendingRegistrationAuthorization(challengeEmail, registrationId, initialNonce, initialExpiresAt, secret)
  if (!safeEqual(token, expectedToken)) throw new PendingRegistrationError(403, "invalid_authorization", "This signup authorization is invalid. Verify the email again.")

  const verifiedAtMs = timestampMs(initialData.verifiedAt)
  const creationTimeMs = timestampMs(authUser.metadata?.creationTime)
  if (Number.isFinite(verifiedAtMs) && Number.isFinite(creationTimeMs) && creationTimeMs + 5000 < verifiedAtMs) {
    throw new PendingRegistrationError(409, "registration_identity_mismatch", "The Firebase account was not created by this verified signup session.")
  }

  if (authUser.emailVerified !== true) {
    try {
      await auth.updateUser(uid, { emailVerified: true })
    } catch {
      throw new PendingRegistrationError(503, "auth_update_failed", "The Firebase account could not be finalized. Please try again.")
    }
  }
  const refreshedAuthUser = await readAuthUser(auth, uid)
  if (getAuthEmail(refreshedAuthUser) !== challengeEmail || refreshedAuthUser.emailVerified !== true) {
    throw new PendingRegistrationError(503, "auth_update_unconfirmed", "The Firebase account could not be finalized. Please try again.")
  }

  const now = getNow(dependencies)
  const result = await firestore.runTransaction(async (transaction: Transaction): Promise<PendingRegistrationFinalizeResult> => {
    const challengeSnapshot = await transaction.get(challengeRef)
    const profileRef = firestore.collection("users").doc(uid)
    const profileSnapshot = await transaction.get(profileRef)
    const data = asRecord(challengeSnapshot.exists ? challengeSnapshot.data() : null)
    if (!challengeSnapshot.exists || data.registrationId !== registrationId) {
      throw new PendingRegistrationError(404, "registration_not_found", "This signup session has expired. Start signup again.")
    }
    if (data.status === "finalized") {
      if (String(data.finalizedUid || "") !== uid) throw new PendingRegistrationError(409, "registration_already_used", "This signup authorization has already been used.")
      return { status: "finalized", uid, email: challengeEmail }
    }
    if (data.status !== "verified") throw new PendingRegistrationError(403, "registration_not_verified", "Verify the email code before creating the account.")
    const expiresAt = asDate(data.authorizationExpiresAt)
    const nonce = String(data.authorizationNonce || "")
    if (!expiresAt || !nonce || secondsUntil(expiresAt, now) <= 0) throw new PendingRegistrationError(400, "authorization_expired", "This verification session has expired. Start signup again.")
    const currentExpectedToken = createPendingRegistrationAuthorization(challengeEmail, registrationId, nonce, expiresAt, secret)
    if (!safeEqual(token, currentExpectedToken)) throw new PendingRegistrationError(403, "invalid_authorization", "This signup authorization is invalid. Verify the email again.")
    const existingProfile = asRecord(profileSnapshot.exists ? profileSnapshot.data() : null)
    if (profileSnapshot.exists) {
      const profileEmail = normalizeOtpEmail(existingProfile.email)
      if (String(existingProfile.uid || "") !== uid || String(existingProfile.role || "") !== "client" || profileEmail !== challengeEmail) {
        throw new PendingRegistrationError(409, "profile_conflict", "This Firebase account already has a different profile. Contact support.")
      }
    } else {
      const firstName = normalizeText(data.firstName, "first name", true, 100)
      const middleName = normalizeText(data.middleName, "middle name", false, 100)
      const lastName = normalizeText(data.lastName, "last name", true, 100)
      const phone = normalizeText(data.phone, "phone number", false, 40)
      const createdAt = asDate(data.createdAt) || now
      transaction.create(profileRef, {
        uid,
        email: challengeEmail,
        fullName: formatDisplayName({ firstName, middleName, lastName }),
        firstName,
        middleName,
        lastName,
        phone,
        role: "client",
        profilePicture: "",
        status: "active",
        createdAt: createdAt.toISOString(),
        emailVerificationRequired: true,
      })
    }
    transaction.update(challengeRef, {
      status: "finalized",
      finalizedAt: now,
      finalizedUid: uid,
      authorizationNonce: null,
      authorizationExpiresAt: null,
    })
    return { status: "finalized", uid, email: challengeEmail }
  })
  return result
}
