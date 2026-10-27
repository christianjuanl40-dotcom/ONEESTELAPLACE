import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const boundary = vi.hoisted(() => ({ uid: "A", headers: vi.fn(), scope: vi.fn() }))
vi.mock("../auth-token", () => ({ getAuthHeaders: boundary.headers, getAuthScope: boundary.scope }))
import { fetchAvailability, fetchOfficeRoomAvailability } from "../availability-client"
import { getAvailabilityDataKey } from "../availability-read-fields"

const request = { category: "office" as const, venueId: "OFFICE", officeId: "OFFICE", spaceId: "ROOM", from: "2030-01-01", to: "2030-01-01" }
const result = (patch = {}) => ({ space: { category: "office", venueId: "OFFICE", officeId: "OFFICE", spaceId: "ROOM" },
  dates: { "2030-01-01": { status: "available", availableSlots: [], occupiedIntervals: [] } }, ...patch })
const reply = (body = result(), status = 200) => new Response(JSON.stringify(body), { status })
const fetcher = vi.fn<typeof fetch>()
beforeEach(() => {
  boundary.uid = "A"; boundary.scope.mockReset().mockImplementation(async () => boundary.uid)
  boundary.headers.mockReset().mockResolvedValue({ authorization: "Bearer fixture" })
  fetcher.mockReset().mockImplementation(async () => reply()); vi.stubGlobal("fetch", fetcher)
})
afterEach(() => { vi.unstubAllGlobals() })

describe("availability read boundary", () => {
  it("shares identical in-flight reads despite irrelevant display/catalog values", async () => {
    const pending = Promise.withResolvers<Response>(); fetcher.mockReturnValueOnce(pending.promise)
    const first = fetchAvailability({ ...request, name: "First label" }), second = fetchAvailability({ ...request, name: "Renamed label" })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); pending.resolve(reply())
    expect(await first).toEqual(await second)
    expect(String(fetcher.mock.calls[0][0])).not.toContain("name=")
    await fetchAvailability(request); expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("does not reuse an older in-flight read after a schedule invalidation", async () => {
    const pending = Promise.withResolvers<Response>(); fetcher.mockReturnValueOnce(pending.promise)
    const old = fetchAvailability({ ...request, revision: "before" })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await fetchAvailability({ ...request, revision: "after" })
    expect(fetcher).toHaveBeenCalledTimes(2); pending.resolve(reply()); await old
  })

  it("isolates rooms, date ranges, terms and account identities", async () => {
    await fetchAvailability(request)
    await expect(fetchAvailability({ ...request, spaceId: "OTHER" })).rejects.toThrow(/could not be confirmed/)
    await expect(fetchAvailability({ ...request, to: "2030-01-02" })).rejects.toThrow(/incomplete/)
    await fetchAvailability({ ...request, rentalTerm: "1_year" })
    boundary.uid = "B"; await fetchAvailability(request)
    expect(fetcher).toHaveBeenCalledTimes(5)
  })

  it("cancels an obsolete consumer without aborting a shared current consumer", async () => {
    const pending = Promise.withResolvers<Response>(), controller = new AbortController()
    fetcher.mockReturnValueOnce(pending.promise)
    const old = fetchAvailability(request, controller.signal).catch(error => error.name)
    const current = fetchAvailability(request)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); controller.abort()
    expect(await old).toBe("AbortError")
    expect((fetcher.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(false)
    pending.resolve(reply()); expect(await current).toEqual(result())
  })

  it("aborts transport when its last consumer is obsolete", async () => {
    const controller = new AbortController()
    fetcher.mockImplementationOnce((_, options) => new Promise((_, reject) => options?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")))))
    const pending = fetchAvailability(request, controller.signal).catch(error => error.name)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); controller.abort()
    expect(await pending).toBe("AbortError")
    expect((fetcher.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true)
  })

  it("waits for identity readiness and refuses a response from a changed account", async () => {
    const ready = Promise.withResolvers<string>(); boundary.scope.mockReturnValueOnce(ready.promise)
    const pending = Promise.withResolvers<Response>(); fetcher.mockReturnValueOnce(pending.promise)
    const requestPromise = fetchAvailability(request).catch(error => error.name)
    await Promise.resolve(); expect(fetcher).not.toHaveBeenCalled(); ready.resolve("A")
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); boundary.uid = "B"; pending.resolve(reply())
    expect(await requestPromise).toBe("AbortError")
  })

  it("uses bounded retry for safe transient GETs, without retrying authorization errors", async () => {
    fetcher.mockRejectedValueOnce(new TypeError("Network offline")).mockResolvedValueOnce(reply())
    await fetchAvailability(request); expect(fetcher).toHaveBeenCalledTimes(2)
    fetcher.mockReset().mockResolvedValueOnce(new Response(JSON.stringify({ error: "Temporary outage" }), { status: 503 })).mockResolvedValueOnce(reply())
    await fetchAvailability(request); expect(fetcher).toHaveBeenCalledTimes(2)
    fetcher.mockReset().mockResolvedValue(new Response(JSON.stringify({ error: "Still unavailable" }), { status: 503 }))
    await expect(fetchAvailability(request)).rejects.toThrow("Still unavailable"); expect(fetcher).toHaveBeenCalledTimes(2)
    fetcher.mockReset().mockResolvedValue(new Response(JSON.stringify({ error: "Permission required" }), { status: 403 }))
    await expect(fetchAvailability(request)).rejects.toThrow("Permission required"); expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("never accepts unloaded, incomplete, or malformed schedule/room data as available", async () => {
    for (const body of [null, {}, result({ dates: {} }), result({ dates: { "2030-01-01": { status: "available" } } })]) {
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }))
      await expect(fetchAvailability(request)).rejects.toThrow()
    }
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ officeId: "OFFICE", officeRooms: { ROOM: "unknown" } }), { status: 200 }))
    await expect(fetchOfficeRoomAvailability("OFFICE", "2030-01-01")).rejects.toThrow(/could not be confirmed/)
  })
})

describe("availability invalidation inputs", () => {
  it("ignores large proofs/receipts/notes but changes for scheduling, occupancy and hold-money fields", () => {
    const booking = { id: "B", venueId: "VENUE", date: "2030-01-01", status: "pending", amountPaid: 0, proofUrl: "large" }
    const key = getAvailabilityDataKey([booking], [], [])
    expect(getAvailabilityDataKey([{ ...booking, proofUrl: "data:image/png;base64," + "A".repeat(400000), receipt: { unrelated: true }, adminNote: "new" }], [], [])).toBe(key)
    for (const patch of [{ status: "confirmed" }, { date: "2030-01-02" }, { spaceId: "other" }, { amountPaid: 500 }, { hasActivePaymentSubmission: true }, { endDate: "2031-01-01" }]) {
      expect(getAvailabilityDataKey([{ ...booking, ...patch }], [], [])).not.toBe(key)
    }
    expect(getAvailabilityDataKey([booking], [{ id: "M", date: "2030-01-01", status: "active" }], [])).not.toBe(key)
    expect(getAvailabilityDataKey([booking], [], [{ id: "L", leaseStatus: "Active Lease" }])).not.toBe(key)
  })
})
