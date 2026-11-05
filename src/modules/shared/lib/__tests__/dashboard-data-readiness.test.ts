import { describe, expect, it } from "vitest"
import { getDashboardDataReadiness } from "../dashboard-data-readiness"

describe("dashboard data readiness", () => {
  it("keeps a successful empty read ready for legitimate zero totals", () => {
    expect(getDashboardDataReadiness({ isLoading: false, dataErrors: {} })).toEqual({
      status: "ready",
      error: null,
      failedSources: [],
    })
  })

  it("fails closed when either required source is unavailable", () => {
    const result = getDashboardDataReadiness({
      isLoading: false,
      dataErrors: { payments: "Payments could not be loaded." },
    })

    expect(result.status).toBe("unavailable")
    expect(result.failedSources).toEqual(["payments"])
    expect(result.error).toContain("Payments could not be loaded.")
  })

  it("does not let an unrelated keyed listener failure block dashboard-owned sources", () => {
    expect(getDashboardDataReadiness({
      isLoading: false,
      dataError: "Maintenance could not be loaded.",
      dataErrors: { maintenance: "Maintenance could not be loaded." },
    }).status).toBe("ready")
  })

  it("keeps retry and account-scope transitions loading until recovery is confirmed", () => {
    expect(getDashboardDataReadiness({
      isLoading: true,
      dataError: "Previous read failed.",
      dataErrors: { bookings: "Previous read failed." },
    }).status).toBe("loading")
  })
})
