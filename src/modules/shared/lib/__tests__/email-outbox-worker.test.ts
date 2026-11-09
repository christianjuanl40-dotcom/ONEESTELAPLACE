import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Auth } from "firebase-admin/auth"
import type { Firestore } from "firebase-admin/firestore"
import { TransactionStore } from "./helpers/transaction-store"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: vi.fn(),
  getAdminFirestore: vi.fn(),
}))

import { enqueueEmailEvent } from "@/lib/email-outbox"
import { processEmailOutbox, type EmailWorkerDependencies } from "@/lib/email-worker"

afterEach(() => vi.unstubAllEnvs())

const payload = {
  bookingReference: "BK-WORKER-01",
  eventName: "Worker fixture",
  venue: "Main Hall",
  customerName: "Fixture Client",
  schedule: { date: "2099-07-01", time: "08:00 - 14:00" },
}

function enableEmail() {
  vi.stubEnv("EMAIL_SENDING_ENABLED", "true")
  vi.stubEnv("SMTP_HOST", "smtp.gmail.com")
  vi.stubEnv("SMTP_PORT", "465")
  vi.stubEnv("SMTP_SECURE", "true")
  vi.stubEnv("SMTP_USER", "mailer@example.test")
  vi.stubEnv("SMTP_APP_PASSWORD", "fake-password")
  vi.stubEnv("EMAIL_FROM", "One Estela Place <mailer@example.test>")
  vi.stubEnv("APP_BASE_URL", "https://one-estela.example")
  vi.stubEnv("EMAIL_TEST_RECIPIENT_ALLOWLIST", "client@example.test")
  vi.stubEnv("NODE_ENV", "test")
}

function seedJob(store: TransactionStore, overrides: Record<string, unknown> = {}) {
  store.seed("emailOutbox/job-1", {
    eventType: "payment_submitted",
    eventId: "payment_submitted_PAY-1",
    bookingId: "BK-WORKER-01",
    recipientUid: "client-uid",
    templateVersion: "v1",
    status: "pending",
    attempts: 0,
    createdAt: new Date("2026-11-08T00:00:00.000Z"),
    nextAttemptAt: new Date("2026-11-08T00:00:00.000Z"),
    claimedAt: null,
    claimExpiresAt: null,
    sentAt: null,
    lastErrorCode: null,
    payload,
    ...overrides,
  })
}

function workerDependencies(store: TransactionStore, sendMail: ReturnType<typeof vi.fn>, now = new Date("2026-11-08T00:01:00.000Z")) {
  const auth = { getUser: vi.fn().mockResolvedValue({ uid: "client-uid", email: "client@example.test" }) }
  const transport = { verify: vi.fn().mockResolvedValue(true), sendMail }
  return {
    firestore: store as unknown as Firestore,
    auth: auth as unknown as Auth,
    transport: transport as unknown as EmailWorkerDependencies["transport"],
    now: () => now,
    verifyTransport: true,
  }
}

describe("transactional email outbox", () => {
  beforeEach(() => enableEmail())

  it("is disabled without creating jobs and is idempotent for one event ID", async () => {
    const store = new TransactionStore()
    vi.stubEnv("EMAIL_SENDING_ENABLED", "false")
    const disabled = await store.runTransaction((transaction) => enqueueEmailEvent(transaction, store as unknown as Firestore, {
      eventType: "booking_submitted",
      eventId: "booking_submitted_BK-1",
      bookingId: "BK-1",
      recipientUid: "client-uid",
      payload,
    }))
    expect(disabled).toBe(false)
    expect(store.data.size).toBe(0)

    vi.stubEnv("EMAIL_SENDING_ENABLED", "true")
    const first = await store.runTransaction((transaction) => enqueueEmailEvent(transaction, store as unknown as Firestore, {
      eventType: "booking_submitted",
      eventId: "booking_submitted_BK-1",
      bookingId: "BK-1",
      recipientUid: "client-uid",
      payload,
    }))
    const duplicate = await store.runTransaction((transaction) => enqueueEmailEvent(transaction, store as unknown as Firestore, {
      eventType: "booking_submitted",
      eventId: "booking_submitted_BK-1",
      bookingId: "BK-1",
      recipientUid: "client-uid",
      payload,
    }))

    expect(first).toBe(true)
    expect(duplicate).toBe(false)
    expect(store.data.get("emailOutbox/booking_submitted_BK-1")).toMatchObject({ status: "pending", attempts: 0, recipientUid: "client-uid" })
  })
})

describe("email worker", () => {
  beforeEach(() => enableEmail())

  it("resolves the recipient from Firebase Auth and marks a claimed job sent", async () => {
    const store = new TransactionStore()
    seedJob(store, { payload: { ...payload, customerName: "<not an address>" } })
    const sendMail = vi.fn().mockResolvedValue({ messageId: "fake-message-id" })

    const result = await processEmailOutbox(1, workerDependencies(store, sendMail))

    expect(result).toMatchObject({ status: "processed", processed: 1, sent: 1, retried: 0, failed: 0, blocked: 0 })
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: "client@example.test", from: "One Estela Place <mailer@example.test>" })
    expect(store.data.get("emailOutbox/job-1")).toMatchObject({ status: "sent", attempts: 1, messageId: "fake-message-id" })
  })

  it("blocks non-allowlisted recipients without contacting SMTP", async () => {
    const store = new TransactionStore()
    seedJob(store)
    const sendMail = vi.fn()
    const dependencies = workerDependencies(store, sendMail)
    ;(dependencies.auth as unknown as { getUser: ReturnType<typeof vi.fn> }).getUser.mockResolvedValue({ email: "other@example.test" })

    const result = await processEmailOutbox(1, dependencies)

    expect(result).toMatchObject({ processed: 1, blocked: 1, sent: 0 })
    expect(sendMail).not.toHaveBeenCalled()
    expect(store.data.get("emailOutbox/job-1")).toMatchObject({ status: "blocked", lastErrorCode: "test_recipient_not_allowed" })
  })

  it("retries transient SMTP failures and later succeeds after the backoff", async () => {
    const store = new TransactionStore()
    seedJob(store)
    const transient = Object.assign(new Error("socket timeout"), { code: "ETIMEDOUT" })
    const sendMail = vi.fn().mockRejectedValueOnce(transient).mockResolvedValueOnce({ messageId: "eventual-message" })
    let now = new Date("2026-11-08T00:01:00.000Z")

    const first = await processEmailOutbox(1, workerDependencies(store, sendMail, now))
    expect(first).toMatchObject({ processed: 1, retried: 1, sent: 0 })
    expect(store.data.get("emailOutbox/job-1")).toMatchObject({ status: "retry", attempts: 1, lastErrorCode: "etimedout" })

    now = new Date(now.getTime() + 31_000)
    const second = await processEmailOutbox(1, workerDependencies(store, sendMail, now))
    expect(second).toMatchObject({ processed: 1, sent: 1, retried: 0 })
    expect(store.data.get("emailOutbox/job-1")).toMatchObject({ status: "sent", attempts: 2 })
  })

  it("moves a permanent or exhausted SMTP failure to terminal failed state", async () => {
    const store = new TransactionStore()
    seedJob(store)
    vi.stubEnv("EMAIL_MAX_ATTEMPTS", "1")
    const permanent = Object.assign(new Error("mailbox rejected"), { responseCode: 550 })
    const sendMail = vi.fn().mockRejectedValue(permanent)

    const result = await processEmailOutbox(1, workerDependencies(store, sendMail))

    expect(result).toMatchObject({ processed: 1, failed: 1, retried: 0 })
    expect(store.data.get("emailOutbox/job-1")).toMatchObject({ status: "failed", attempts: 1, lastErrorCode: "smtp_550" })
  })

  it("allows only one concurrent worker to claim a pending job", async () => {
    const store = new TransactionStore()
    seedJob(store)
    const sendMail = vi.fn().mockResolvedValue({ messageId: "single-claim" })
    const first = workerDependencies(store, sendMail)
    const second = workerDependencies(store, sendMail)

    const results = await Promise.all([
      processEmailOutbox(1, first),
      processEmailOutbox(1, second),
    ])

    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(results.map((result) => result.sent).sort()).toEqual([0, 1])
    expect(store.data.get("emailOutbox/job-1")).toMatchObject({ status: "sent", attempts: 1 })
  })

  it("recovers an expired lease and never sends an unallowlisted browser address", async () => {
    const store = new TransactionStore()
    const now = new Date("2026-11-08T00:10:00.000Z")
    seedJob(store, {
      status: "processing",
      attempts: 1,
      claimedAt: new Date("2026-11-08T00:00:00.000Z"),
      claimExpiresAt: new Date("2026-11-08T00:05:00.000Z"),
      payload: { ...payload, recipientEmail: "attacker@example.test" },
    })
    const sendMail = vi.fn().mockResolvedValue({ messageId: "recovered-message" })

    const result = await processEmailOutbox(1, workerDependencies(store, sendMail, now))

    expect(result).toMatchObject({ processed: 1, sent: 1 })
    expect(sendMail.mock.calls[0][0].to).toBe("client@example.test")
    expect(store.data.get("emailOutbox/job-1")).toMatchObject({ status: "sent", attempts: 2 })
  })

  it("does not contact Firebase or SMTP when sending is disabled", async () => {
    const store = new TransactionStore()
    seedJob(store)
    vi.stubEnv("EMAIL_SENDING_ENABLED", "false")
    const sendMail = vi.fn()
    const dependencies = workerDependencies(store, sendMail)

    const result = await processEmailOutbox(1, dependencies)

    expect(result.status).toBe("disabled")
    expect(sendMail).not.toHaveBeenCalled()
    expect(store.data.get("emailOutbox/job-1")).toMatchObject({ status: "pending", attempts: 0 })
  })
})
