import { getManilaDateKey } from "./time-format"

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export type ReportPeriod = "all" | "date" | "week" | "month" | "year" | "custom"

export type ReportDateRange = {
  start: string
  end: string
}

export type ReportPeriodSelection = {
  period: ReportPeriod
  date?: string
  weekDate?: string
  month?: string
  year?: string
  startDate?: string
  endDate?: string
}

export type ReportPeriodResolution = {
  range: ReportDateRange | null
  ready: boolean
  error: string | null
}

function parseDateKey(value: unknown) {
  const text = typeof value === "string" ? value.trim() : ""
  const match = text.match(DATE_KEY_PATTERN)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null

  return { year, month, day, key: text }
}

export function getReportDateKey(value: unknown) {
  if (typeof value === "string" && DATE_KEY_PATTERN.test(value.trim())) {
    return parseDateKey(value)?.key || null
  }

  return getManilaDateKey(value)
}

export function getReportDateParts(dateKey: string) {
  return parseDateKey(dateKey)
}

export function formatReportDateKey(
  dateKey: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
) {
  const parts = parseDateKey(dateKey)
  if (!parts) return dateKey

  return new Intl.DateTimeFormat("en-PH", { ...options, timeZone: "UTC" }).format(
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day)),
  )
}

export function addReportDateDays(dateKey: string, days: number) {
  const parts = parseDateKey(dateKey)
  if (!parts || !Number.isInteger(days)) return null

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function getReportWeekRange(dateKey: string): ReportDateRange | null {
  const parts = parseDateKey(dateKey)
  if (!parts) return null

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  const day = date.getUTCDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const start = addReportDateDays(dateKey, mondayOffset)
  const end = start ? addReportDateDays(start, 6) : null
  return start && end ? { start, end } : null
}

export function getReportMonthRange(year: string, month: string): ReportDateRange | null {
  if (!/^\d{4}$/.test(year) || !/^\d+$/.test(month)) return null

  const numericYear = Number(year)
  const numericMonth = Number(month)
  if (!Number.isInteger(numericYear) || numericMonth < 0 || numericMonth > 11) return null

  const lastDay = new Date(Date.UTC(numericYear, numericMonth + 1, 0)).getUTCDate()
  return {
    start: `${year}-${String(numericMonth + 1).padStart(2, "0")}-01`,
    end: `${year}-${String(numericMonth + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  }
}

export function getReportYearRange(year: string): ReportDateRange | null {
  if (!/^\d{4}$/.test(year)) return null
  return { start: `${year}-01-01`, end: `${year}-12-31` }
}

export function resolveReportPeriod(selection: ReportPeriodSelection): ReportPeriodResolution {
  switch (selection.period) {
    case "all":
      return { range: null, ready: true, error: null }
    case "date": {
      const date = parseDateKey(selection.date)
      return date
        ? { range: { start: date.key, end: date.key }, ready: true, error: null }
        : { range: null, ready: false, error: "Select a calendar date." }
    }
    case "week": {
      const date = parseDateKey(selection.weekDate)
      const range = date ? getReportWeekRange(date.key) : null
      return range
        ? { range, ready: true, error: null }
        : { range: null, ready: false, error: "Select a day in the week." }
    }
    case "month": {
      const range = selection.year && selection.month
        ? getReportMonthRange(selection.year, selection.month)
        : null
      return range
        ? { range, ready: true, error: null }
        : { range: null, ready: false, error: "Select both a month and year." }
    }
    case "year": {
      const range = selection.year ? getReportYearRange(selection.year) : null
      return range
        ? { range, ready: true, error: null }
        : { range: null, ready: false, error: "Select a year." }
    }
    case "custom": {
      const start = parseDateKey(selection.startDate)?.key || null
      const end = parseDateKey(selection.endDate)?.key || null
      if (!start || !end) return { range: null, ready: false, error: "Select both start and end dates." }
      if (start > end) return { range: null, ready: false, error: "Start date must be on or before end date." }
      return { range: { start, end }, ready: true, error: null }
    }
  }
}

export function isReportDateInRange(dateKey: string | null, range: ReportDateRange | null) {
  return Boolean(dateKey && range && dateKey >= range.start && dateKey <= range.end)
}

export function enumerateReportDateRange(range: ReportDateRange) {
  const dates: string[] = []
  let current: string | null = range.start

  while (current && current <= range.end) {
    dates.push(current)
    current = addReportDateDays(current, 1)
  }

  return dates
}
