import {
  getPaymentRecordStatusLabel,
  getRecordsForBooking,
  isAcceptedPaymentRecord,
  isIncompletePaymentRecord,
  isRejectedPaymentRecord,
  isUnresolvedPaymentRecord,
  type BookingLike,
  type PaymentRecordLike,
} from "./payment-calculations"

export type PaymentReviewAction = "verify" | "reject" | "incomplete"
export interface PaymentReviewRequest {
  action: PaymentReviewAction
  bookingId: string
  paymentRecordId?: string
  verifiedAmount?: number
  adminNote?: string
}
export interface PaymentReviewResult {
  booking: BookingLike & Record<string, unknown>
  payment: PaymentRecordLike & { id: string }
}

class ReviewResponseError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function readResult(body: unknown, input: PaymentReviewRequest): PaymentReviewResult {
  if (!isRecord(body) || !isRecord(body.booking) || !isRecord(body.payment)
    || body.booking.id !== input.bookingId || body.payment.id !== input.paymentRecordId
    || !getRecordsForBooking([body.payment], body.booking).length) {
    throw new Error("The payment server returned an invalid review response.")
  }
  return body as unknown as PaymentReviewResult
}

function matchesAction(payment: PaymentRecordLike, action: PaymentReviewAction): boolean {
  if (action === "verify") return isAcceptedPaymentRecord(payment)
  if (action === "reject") return isRejectedPaymentRecord(payment)
  return isIncompletePaymentRecord(payment) && !isRejectedPaymentRecord(payment)
}

/** One instance per authenticated provider scope. Never automatically repeats a POST. */
export function createPaymentReviewClient(options: {
  getAuthHeaders: () => Promise<Record<string, string>>
  fetch?: typeof fetch
}) {
  const request = options.fetch || ((...args: Parameters<typeof fetch>) => fetch(...args))
  const uncertain = new Set<string>()
  const inFlight = new Map<string, { action: PaymentReviewAction; promise: Promise<PaymentReviewResult> }>()

  async function readResponse(response: Response): Promise<unknown> {
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      throw new ReviewResponseError(isRecord(body) && typeof body.error === "string" ? body.error : "Unable to review the selected payment.", response.status)
    }
    return body
  }

  async function reconcile(input: PaymentReviewRequest): Promise<PaymentReviewResult | null> {
    const params = new URLSearchParams({ bookingId: input.bookingId, paymentRecordId: input.paymentRecordId! })
    const response = await request(`/api/payments/review?${params}`, {
      method: "GET", cache: "no-store", headers: await options.getAuthHeaders(),
    })
    const saved = readResult(await readResponse(response), input)
    if (matchesAction(saved.payment, input.action)) return saved
    if (!isUnresolvedPaymentRecord(saved.payment)) {
      throw new ReviewResponseError(`The selected submission is already ${getPaymentRecordStatusLabel(saved.payment).toLowerCase()}. Refresh its saved review before continuing.`, 409)
    }
    return null
  }

  async function execute(input: PaymentReviewRequest, key: string): Promise<PaymentReviewResult> {
    if (uncertain.has(key)) {
      // A previous request may still have committed after its response was lost.
      // Check the server again immediately BEFORE permitting a user-initiated retry.
      let saved: PaymentReviewResult | null
      try { saved = await reconcile(input) }
      catch (error) {
        if (error instanceof ReviewResponseError) throw error
        throw new Error("The review result could not be confirmed. Check the selected submission's saved status before trying again.")
      }
      if (saved) { uncertain.delete(key); return saved }
    }
    const headers = await options.getAuthHeaders()
    try {
      const response = await request("/api/payments/review", {
        method: "POST", headers, body: JSON.stringify(input),
      })
      const result = readResult(await readResponse(response), input)
      if (!matchesAction(result.payment, input.action)) throw new Error("The saved payment review could not be confirmed.")
      uncertain.delete(key)
      return result
    } catch (error) {
      if (error instanceof ReviewResponseError && error.status < 500) throw error
      uncertain.add(key)
      // Network/JSON/5xx failure is an uncertain outcome, not proof of rollback.
      let saved: PaymentReviewResult | null
      try {
        saved = await reconcile(input)
      } catch (readError) {
        if (readError instanceof ReviewResponseError) throw readError
        throw new Error("The review result could not be confirmed. Check the selected submission's saved status before trying again.")
      }
      if (saved) { uncertain.delete(key); return saved }
      // Keep the uncertain marker: another request may still be committing. The
      // next click must perform a new authoritative read, even after this read.
      throw new Error(error instanceof ReviewResponseError ? error.message
        : "The review response was not received. The selected submission is still awaiting review. Try again to check its saved status.")
    }
  }

  return {
    review(input: PaymentReviewRequest): Promise<PaymentReviewResult> {
      if (!input.paymentRecordId) return Promise.reject(new Error("Select a valid payment submission to review."))
      const key = JSON.stringify([input.bookingId, input.paymentRecordId])
      const pending = inFlight.get(key)
      if (pending) return pending.action === input.action ? pending.promise
        : Promise.reject(new Error("A review of this submission is already in progress."))
      const promise = execute(input, key).finally(() => { inFlight.delete(key) })
      inFlight.set(key, { action: input.action, promise })
      return promise
    },
  }
}
