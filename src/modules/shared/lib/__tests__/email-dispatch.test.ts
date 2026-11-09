import { beforeEach, describe, expect, it, vi } from "vitest"

const boundary = vi.hoisted(() => ({
  after: vi.fn(),
  callbacks: [] as Array<() => void | Promise<void>>,
  process: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/server", () => ({ after: boundary.after }))
vi.mock("@/lib/email-worker", () => ({ processEmailOutbox: boundary.process }))

import { scheduleImmediateEmailDispatch } from "@/lib/email-dispatch"

beforeEach(() => {
  boundary.callbacks.length = 0
  boundary.after.mockReset().mockImplementation((callback: () => void | Promise<void>) => {
    boundary.callbacks.push(callback)
  })
  boundary.process.mockReset().mockResolvedValue({
    status: "processed",
    processed: 1,
    sent: 1,
    retried: 0,
    failed: 0,
    blocked: 0,
  })
})

describe("immediate email dispatch", () => {
  it("schedules only unique non-empty newly-created job IDs after the response", async () => {
    scheduleImmediateEmailDispatch([" job-1 ", "job-1", "", "job-2"])

    expect(boundary.after).toHaveBeenCalledTimes(1)
    expect(boundary.callbacks).toHaveLength(1)
    await boundary.callbacks[0]()

    expect(boundary.process).toHaveBeenCalledWith(2, {}, { jobIds: ["job-1", "job-2"] })
  })

  it("swallows immediate worker failures so the committed business response is unaffected", async () => {
    const error = new Error("temporary SMTP outage")
    boundary.process.mockRejectedValue(error)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    scheduleImmediateEmailDispatch(["job-1"])
    await expect(boundary.callbacks[0]()).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith("[email immediate dispatch] processing failed:", "temporary SMTP outage")
    errorSpy.mockRestore()
  })
})
