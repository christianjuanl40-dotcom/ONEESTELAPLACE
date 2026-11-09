import "server-only"

export const EMAIL_EVENT_TYPES = [
  "booking_submitted",
  "booking_approved",
  "booking_rejected",
  "booking_schedule_updated",
  "booking_cancelled",
  "payment_submitted",
  "payment_verified",
  "payment_rejected",
  "payment_incomplete",
  "balance_reminder",
] as const

export const EMAIL_OTP_MIN_SECRET_LENGTH = 32

export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number]

export type EmailConfig = {
  enabled: boolean
  otpEnabled: boolean
  otpStagingApproved: boolean
  otpProductionApproved: boolean
  otpReady: boolean
  otpExpirySeconds: number
  otpResendCooldownSeconds: number
  host: string
  port: number
  secure: boolean
  user: string
  appPassword: string
  from: string
  appBaseUrl: string
  appBaseUrlConfigured: boolean
  smtpConfigured: boolean
  ready: boolean
  testRecipientAllowlist: string[]
  isProduction: boolean
  maxAttempts: number
}

function isEnabled(value: string | undefined): boolean {
  return String(value || "").trim().toLowerCase() === "true"
}

function safeBaseUrl(value: string | undefined): string {
  const raw = String(value || "").trim()
  if (!raw) return ""
  try {
    const parsed = new URL(raw)
    const isLocalHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname)
    if (parsed.protocol !== "https:" && !isLocalHttp) return ""
    return parsed.origin.replace(/\/$/, "")
  } catch {
    return ""
  }
}

function readAllowlist(value: string | undefined): string[] {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry, index, all) => Boolean(entry) && all.indexOf(entry) === index)
}

/**
 * Server-only email configuration. Credentials are intentionally returned only
 * to other server-only modules and are never included in logs or API payloads.
 */
export function getEmailConfig(): EmailConfig {
  const enabled = isEnabled(process.env.EMAIL_SENDING_ENABLED)
  const otpEnabled = isEnabled(process.env.EMAIL_OTP_SENDING_ENABLED)
  const otpStagingApproved = isEnabled(process.env.EMAIL_OTP_STAGING_APPROVED)
  const portValue = Number(process.env.SMTP_PORT || 465)
  const port = Number.isInteger(portValue) && portValue > 0 && portValue < 65_536 ? portValue : 465
  const secureValue = process.env.SMTP_SECURE
  const secure = secureValue === undefined ? port === 465 : isEnabled(secureValue)
  const host = String(process.env.SMTP_HOST || "smtp.gmail.com").trim()
  const user = String(process.env.SMTP_USER || "").trim()
  const appPassword = String(process.env.SMTP_APP_PASSWORD || "").trim()
  const from = String(process.env.EMAIL_FROM || user).trim()
  const appBaseUrl = safeBaseUrl(process.env.APP_BASE_URL)
  const smtpConfigured = host.toLowerCase() === "smtp.gmail.com" && Boolean(user && appPassword && from)
  const appBaseUrlConfigured = Boolean(appBaseUrl)
  const isProduction = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production"
  const maxAttemptsValue = Number(process.env.EMAIL_MAX_ATTEMPTS || 5)
  const maxAttempts = Number.isInteger(maxAttemptsValue) && maxAttemptsValue >= 1 && maxAttemptsValue <= 10
    ? maxAttemptsValue
    : 5
  const otpExpiryValue = Number(process.env.EMAIL_OTP_EXPIRY_SECONDS || 600)
  const otpExpirySeconds = Number.isInteger(otpExpiryValue) && otpExpiryValue >= 60 && otpExpiryValue <= 3600
    ? otpExpiryValue
    : 600
  const otpCooldownValue = Number(process.env.EMAIL_OTP_RESEND_COOLDOWN_SECONDS || 60)
  const otpResendCooldownSeconds = Number.isInteger(otpCooldownValue) && otpCooldownValue >= 30 && otpCooldownValue <= 900
    ? otpCooldownValue
    : 60
  const otpProductionApproved = isEnabled(process.env.EMAIL_OTP_PRODUCTION_APPROVED)
  const isStaging = String(process.env.ONEESTELA_ENV || "").trim().toLowerCase() === "staging"
  const otpAllowedToSend = otpEnabled
    && (!isStaging || otpStagingApproved)
    && (!isProduction || otpProductionApproved)
  const otpSecret = String(process.env.EMAIL_OTP_SECRET || "").trim()

  return {
    enabled,
    otpEnabled,
    otpStagingApproved,
    otpProductionApproved,
    otpReady: otpAllowedToSend && smtpConfigured && otpSecret.length >= EMAIL_OTP_MIN_SECRET_LENGTH,
    otpExpirySeconds,
    otpResendCooldownSeconds,
    host,
    port,
    secure,
    user,
    appPassword,
    from,
    appBaseUrl,
    appBaseUrlConfigured,
    smtpConfigured,
    ready: enabled && smtpConfigured && appBaseUrlConfigured,
    testRecipientAllowlist: readAllowlist(process.env.EMAIL_TEST_RECIPIENT_ALLOWLIST),
    isProduction,
    maxAttempts,
  }
}

export function isEmailSendingEnabled(): boolean {
  return getEmailConfig().enabled
}

export function isEmailOtpSendingEnabled(): boolean {
  const config = getEmailConfig()
  const isStaging = String(process.env.ONEESTELA_ENV || "").trim().toLowerCase() === "staging"
  return config.otpEnabled
    && (!isStaging || config.otpStagingApproved)
    && (!config.isProduction || config.otpProductionApproved)
}

/**
 * The OTP HMAC secret is deliberately read through a server-only helper. It is
 * never included in EmailConfig, diagnostics, API responses, or client code.
 */
export function getEmailOtpSecret(): string {
  const secret = String(process.env.EMAIL_OTP_SECRET || "").trim()
  if (secret.length < EMAIL_OTP_MIN_SECRET_LENGTH) throw new Error("Email OTP secret is not configured.")
  return secret
}

export function isEmailVerificationEnforcementEnabled(): boolean {
  return isEnabled(process.env.EMAIL_VERIFICATION_ENFORCEMENT_ENABLED)
}

/**
 * A missing activation boundary deliberately fails open. This prevents a
 * feature flag typo from locking legacy clients out of protected workflows.
 */
export function getEmailVerificationActivationStart(): Date | null {
  if (!isEmailVerificationEnforcementEnabled()) return null
  const raw = String(process.env.EMAIL_VERIFICATION_ENFORCEMENT_START_AT || "").trim()
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

export function isValidEmailAddress(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 320
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

/**
 * Preview/local environments must have an explicit test recipient. Production
 * may use the configured Gmail recipient policy, while an allowlist remains an
 * optional additional restriction for controlled smoke tests.
 */
export function isAllowedEmailRecipient(email: string, config = getEmailConfig()): boolean {
  const normalized = email.trim().toLowerCase()
  if (!isValidEmailAddress(normalized)) return false
  const isStaging = String(process.env.ONEESTELA_ENV || "").trim().toLowerCase() === "staging"
  if (isStaging && config.testRecipientAllowlist.length !== 1) return false
  if (config.testRecipientAllowlist.length > 0) return config.testRecipientAllowlist.includes(normalized)
  return config.isProduction
}
