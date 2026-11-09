import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  EMAIL_OTP_MIN_SECRET_LENGTH,
  getEmailConfig,
  getEmailRuntimeDiagnostics,
  getEmailVerificationActivationStart,
  isAllowedEmailRecipient,
  isEmailOtpSendingEnabled,
  isValidEmailAddress,
} from "@/lib/email-config"

afterEach(() => vi.unstubAllEnvs())

describe("server email configuration", () => {
  it("keeps sending disabled and not ready by default", () => {
    vi.stubEnv("EMAIL_SENDING_ENABLED", "false")
    vi.stubEnv("SMTP_USER", "")
    vi.stubEnv("SMTP_APP_PASSWORD", "")
    vi.stubEnv("APP_BASE_URL", "")

    const config = getEmailConfig()
    expect(config.enabled).toBe(false)
    expect(config.ready).toBe(false)
    expect(config.smtpConfigured).toBe(false)
    expect(config.appBaseUrlConfigured).toBe(false)
  })

  it("accepts only Gmail SMTP when the server controls are complete", () => {
    vi.stubEnv("EMAIL_SENDING_ENABLED", "true")
    vi.stubEnv("SMTP_HOST", "smtp.gmail.com")
    vi.stubEnv("SMTP_PORT", "465")
    vi.stubEnv("SMTP_SECURE", "true")
    vi.stubEnv("SMTP_USER", "mailer@example.test")
    vi.stubEnv("SMTP_APP_PASSWORD", "fake-app-password")
    vi.stubEnv("EMAIL_FROM", "One Estela Place <mailer@example.test>")
    vi.stubEnv("APP_BASE_URL", "https://preview.example.test")

    expect(getEmailConfig()).toMatchObject({
      enabled: true,
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      smtpConfigured: true,
      appBaseUrlConfigured: true,
      ready: true,
    })

    vi.stubEnv("SMTP_HOST", "smtp.example.test")
    expect(getEmailConfig().smtpConfigured).toBe(false)
    expect(getEmailConfig().ready).toBe(false)
  })

  it("normalizes and enforces preview recipient allowlists", () => {
    vi.stubEnv("EMAIL_TEST_RECIPIENT_ALLOWLIST", " Allowed@Example.test,second@example.test,allowed@example.test ")
    vi.stubEnv("NODE_ENV", "test")
    const config = getEmailConfig()

    expect(config.testRecipientAllowlist).toEqual(["allowed@example.test", "second@example.test"])
    expect(isAllowedEmailRecipient("ALLOWED@example.test", config)).toBe(true)
    expect(isAllowedEmailRecipient("other@example.test", config)).toBe(false)
    expect(isAllowedEmailRecipient("not-an-email", config)).toBe(false)
    expect(isValidEmailAddress("client@example.test")).toBe(true)
    expect(isValidEmailAddress("client@example")).toBe(false)
  })

  it("requires exactly one recipient in staging", () => {
    vi.stubEnv("ONEESTELA_ENV", "staging")
    vi.stubEnv("EMAIL_TEST_RECIPIENT_ALLOWLIST", "first@example.test,second@example.test")
    expect(isAllowedEmailRecipient("first@example.test")).toBe(false)

    vi.stubEnv("EMAIL_TEST_RECIPIENT_ALLOWLIST", "first@example.test")
    expect(isAllowedEmailRecipient("first@example.test")).toBe(true)
  })
})

describe("verification rollout configuration", () => {
  it("fails open when enforcement is disabled or has no boundary", () => {
    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_ENABLED", "false")
    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_START_AT", "2026-01-01T00:00:00.000Z")
    expect(getEmailVerificationActivationStart()).toBeNull()

    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_ENABLED", "true")
    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_START_AT", "")
    expect(getEmailVerificationActivationStart()).toBeNull()
  })

  it("parses a valid activation boundary and rejects malformed values", () => {
    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_ENABLED", "true")
    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_START_AT", "2026-11-08T00:00:00.000Z")
    expect(getEmailVerificationActivationStart()?.toISOString()).toBe("2026-11-08T00:00:00.000Z")

    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_START_AT", "not-a-date")
    expect(getEmailVerificationActivationStart()).toBeNull()
  })
})

describe("OTP delivery configuration", () => {
  it("keeps OTP disabled by default and requires a strong secret", () => {
    vi.stubEnv("EMAIL_OTP_SENDING_ENABLED", "true")
    vi.stubEnv("EMAIL_OTP_SECRET", "too-short")
    vi.stubEnv("SMTP_USER", "mailer@example.test")
    vi.stubEnv("SMTP_APP_PASSWORD", "fake-app-password")
    vi.stubEnv("EMAIL_FROM", "One Estela Place <mailer@example.test>")

    expect(EMAIL_OTP_MIN_SECRET_LENGTH).toBeGreaterThanOrEqual(32)
    expect(getEmailConfig().otpReady).toBe(false)

    vi.stubEnv("EMAIL_OTP_SECRET", "x".repeat(EMAIL_OTP_MIN_SECRET_LENGTH))
    expect(getEmailConfig().otpReady).toBe(true)
  })

  it("requires an explicit production approval flag", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("VERCEL_ENV", "")
    vi.stubEnv("EMAIL_OTP_SENDING_ENABLED", "true")
    vi.stubEnv("EMAIL_OTP_SECRET", "x".repeat(EMAIL_OTP_MIN_SECRET_LENGTH))
    vi.stubEnv("SMTP_USER", "mailer@example.test")
    vi.stubEnv("SMTP_APP_PASSWORD", "fake-app-password")
    vi.stubEnv("EMAIL_FROM", "One Estela Place <mailer@example.test>")

    expect(getEmailConfig().otpReady).toBe(false)
    vi.stubEnv("EMAIL_OTP_PRODUCTION_APPROVED", "true")
    expect(getEmailConfig().otpReady).toBe(true)
  })

  it("treats Vercel Preview as non-production even though Next uses production NODE_ENV", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("VERCEL_ENV", "preview")
    vi.stubEnv("EMAIL_OTP_SENDING_ENABLED", "true")
    vi.stubEnv("EMAIL_OTP_SECRET", "x".repeat(EMAIL_OTP_MIN_SECRET_LENGTH))
    vi.stubEnv("SMTP_HOST", "smtp.gmail.com")
    vi.stubEnv("SMTP_USER", "mailer@example.test")
    vi.stubEnv("SMTP_APP_PASSWORD", "fake-app-password")
    vi.stubEnv("EMAIL_FROM", "One Estela Place <mailer@example.test>")
    vi.stubEnv("EMAIL_TEST_RECIPIENT_ALLOWLIST", "client@example.test")

    const config = getEmailConfig()
    expect(config.isProduction).toBe(false)
    expect(config.otpReady).toBe(true)
    expect(isAllowedEmailRecipient("client@example.test", config)).toBe(true)
    expect(isAllowedEmailRecipient("other@example.test", config)).toBe(false)
  })

  it("requires a separate staging approval flag", () => {
    vi.stubEnv("ONEESTELA_ENV", "staging")
    vi.stubEnv("EMAIL_OTP_SENDING_ENABLED", "true")
    vi.stubEnv("EMAIL_OTP_SECRET", "x".repeat(EMAIL_OTP_MIN_SECRET_LENGTH))
    vi.stubEnv("SMTP_HOST", "smtp.gmail.com")
    vi.stubEnv("SMTP_USER", "mailer@example.test")
    vi.stubEnv("SMTP_APP_PASSWORD", "fake-app-password")
    vi.stubEnv("EMAIL_FROM", "One Estela Place <mailer@example.test>")
    vi.stubEnv("EMAIL_TEST_RECIPIENT_ALLOWLIST", "client@example.test")

    expect(getEmailConfig().otpReady).toBe(false)
    vi.stubEnv("EMAIL_OTP_STAGING_APPROVED", "true")
    expect(getEmailConfig().otpReady).toBe(true)
  })

  it("keeps the OTP runtime helper gated by staging approval", () => {
    vi.stubEnv("ONEESTELA_ENV", "staging")
    vi.stubEnv("EMAIL_OTP_SENDING_ENABLED", "true")
    expect(isEmailOtpSendingEnabled()).toBe(false)
    vi.stubEnv("EMAIL_OTP_STAGING_APPROVED", "true")
    expect(isEmailOtpSendingEnabled()).toBe(true)
  })

  it("keeps production recipients open unless the explicit allowlist-only gate is enabled", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("EMAIL_TEST_RECIPIENT_ALLOWLIST", "owner@example.test")
    const config = getEmailConfig()

    expect(isAllowedEmailRecipient("customer@example.test", config)).toBe(true)
    expect(isAllowedEmailRecipient("owner@example.test", config)).toBe(true)

    vi.stubEnv("EMAIL_TEST_RECIPIENT_ALLOWLIST_ONLY", "true")
    const restricted = getEmailConfig()
    expect(isAllowedEmailRecipient("customer@example.test", restricted)).toBe(false)
    expect(isAllowedEmailRecipient("owner@example.test", restricted)).toBe(true)
  })

  it("reports only safe OTP readiness booleans and a gate code", () => {
    vi.stubEnv("EMAIL_OTP_SENDING_ENABLED", "true")
    vi.stubEnv("EMAIL_OTP_SECRET", "too-short")
    vi.stubEnv("SMTP_USER", "")
    vi.stubEnv("SMTP_APP_PASSWORD", "")
    vi.stubEnv("EMAIL_FROM", "")
    const diagnostics = getEmailRuntimeDiagnostics()

    expect(diagnostics).toMatchObject({
      otpSendingEnabled: true,
      otpSecretConfigured: false,
      otpReady: false,
      otpGateReason: "smtp_incomplete",
    })
    expect(JSON.stringify(diagnostics)).not.toContain("too-short")
  })
})
