import { describe, expect, it } from "vitest"
import {
  formatReportDateKey,
  getReportDateKey,
  getReportMonthRange,
  getReportWeekRange,
  isReportDateInRange,
  resolveReportPeriod,
} from "../report-date-filters"

describe("report date filters", () => {
  it("uses Manila calendar boundaries for timestamp values and preserves date-only values", () => {
    expect(getReportDateKey("2026-11-11")).toBe("2026-11-11")
    expect(getReportDateKey("2026-11-11T15:59:59.999Z")).toBe("2026-11-11")
    expect(getReportDateKey("2026-11-11T16:00:00.000Z")).toBe("2026-11-12")
    expect(formatReportDateKey("2026-11-11")).toBe("Nov 11, 2026")
  })

  it("resolves a specific date inclusively", () => {
    expect(resolveReportPeriod({ period: "date", date: "2026-11-11" })).toEqual({
      range: { start: "2026-11-11", end: "2026-11-11" },
      ready: true,
      error: null,
    })
    expect(isReportDateInRange("2026-11-11", { start: "2026-11-11", end: "2026-11-11" })).toBe(true)
    expect(isReportDateInRange("2026-11-12", { start: "2026-11-11", end: "2026-11-11" })).toBe(false)
  })

  it("resolves a Monday-to-Sunday week from any selected day", () => {
    expect(getReportWeekRange("2026-11-11")).toEqual({ start: "2026-11-09", end: "2026-11-15" })
    expect(resolveReportPeriod({ period: "week", weekDate: "2026-11-15" }).range).toEqual({
      start: "2026-11-09",
      end: "2026-11-15",
    })
  })

  it("resolves month and year ranges", () => {
    expect(getReportMonthRange("2026", "1")).toEqual({ start: "2026-02-01", end: "2026-02-28" })
    expect(resolveReportPeriod({ period: "month", year: "2024", month: "1" }).range).toEqual({
      start: "2024-02-01",
      end: "2024-02-29",
    })
    expect(resolveReportPeriod({ period: "year", year: "2026" }).range).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
    })
  })

  it("includes custom range endpoints and rejects an inverted range", () => {
    expect(resolveReportPeriod({
      period: "custom",
      startDate: "2026-11-01",
      endDate: "2026-11-11",
    })).toEqual({
      range: { start: "2026-11-01", end: "2026-11-11" },
      ready: true,
      error: null,
    })
    expect(resolveReportPeriod({
      period: "custom",
      startDate: "2026-11-12",
      endDate: "2026-11-11",
    })).toMatchObject({ ready: false, error: "Start date must be on or before end date." })
  })
})
