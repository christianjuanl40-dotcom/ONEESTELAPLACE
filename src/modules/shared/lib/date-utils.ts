function parseDate(value?: string): Date | null {
  if (!value) return null
  const normalized = String(value).trim()
  let d: Date
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    d = new Date(`${normalized}T00:00:00`)
  } else {
    d = new Date(normalized)
  }
  return Number.isNaN(d.getTime()) ? null : d
}

function startOfDay(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function endOfDay(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(23, 59, 59, 999)
  return copy
}

// Calendar difference (sign-aware) between two dates, expressed in
// years / months / days using real calendar math (no 30-day approximation).
export function diffCalendarUnits(from: Date, to: Date): {
  years: number
  months: number
  days: number
} {
  const a = startOfDay(from)
  const b = startOfDay(to)

  let years = b.getFullYear() - a.getFullYear()
  let months = b.getMonth() - a.getMonth()
  let days = b.getDate() - a.getDate()

  if (days < 0) {
    months -= 1
    const daysInPrevMonth = new Date(b.getFullYear(), b.getMonth(), 0).getDate()
    days += daysInPrevMonth
  }

  if (months < 0) {
    years -= 1
    months += 12
  }

  return { years, months, days }
}

// Remaining rental/contract duration.
//
// The countdown ONLY uses: Current Date -> Contract Start Date -> Contract End Date.
// It MUST NOT be computed from the booking/reservation/createdAt date, and the
// countdown must not begin until the contract has actually started.
//
// Three cases:
//   CASE 1: today < start  -> "Starts in X" (rental has not started)
//   CASE 2: start <= today < end -> "X Remaining" (rental is active)
//   CASE 3: today >= end -> "Expired"
export function getRemainingDurationFromDates(endDate?: string, startDate?: string): string | null {
  if (!endDate) return null
  const end = parseDate(endDate)
  if (!end) return null

  const today = startOfDay(new Date())
  const endDay = startOfDay(end)

  // CASE 3: contract already ended (relative to end date only).
  if (today >= endDay) return "Expired"

  const start = parseDate(startDate)
  const startDay = start ? startOfDay(start) : null

  // CASE 1: contract has not started yet. Count down to the start date only.
  if (startDay && today < startDay) {
    const { years, months, days } = diffCalendarUnits(today, startDay)
    const parts: string[] = []
    if (years > 0) parts.push(years === 1 ? "1 Year" : `${years} Years`)
    if (months > 0) parts.push(`${months} Month${months > 1 ? "s" : ""}`)
    if (days > 0 || parts.length === 0) parts.push(`${days} Day${days > 1 ? "s" : ""}`)
    return `Starts in ${parts.join(" ")}`
  }

  // CASE 2: rental is active. Count remaining from today to the end date.
  const { years, months, days } = diffCalendarUnits(today, endDay)
  return formatDurationLabel(years, months, days)
}

// Full duration between a contract start date and end date, expressed as a
// contract term label (e.g. "6 Months", "1 Year", "2 Years", "18 Months").
export function getContractDurationLabel(startDate?: string, endDate?: string): string | null {
  const start = parseDate(startDate)
  const end = parseDate(endDate)
  if (!start || !end) return null

  const startDay = startOfDay(start)
  const endDay = startOfDay(end)
  if (endDay < startDay) return null

  const { years, months } = diffCalendarUnits(startDay, endDay)
  return formatDurationLabel(years, months, 0, true)
}

function formatDurationLabel(
  years: number,
  months: number,
  days: number,
  contractMode = false,
): string {
  const parts: string[] = []

  if (years > 0) {
    parts.push(years === 1 ? "1 Year" : `${years} Years`)
  }
  if (months > 0) {
    parts.push(`${months} Month${months > 1 ? "s" : ""}`)
  }

  if (contractMode) {
    if (parts.length === 0) return days > 0 ? `${days} Day${days > 1 ? "s" : ""}` : "0 Months"
    return parts.join(" ")
  }

  if (days > 0 && years === 0) {
    parts.push(`${days} Day${days > 1 ? "s" : ""}`)
  }

  if (parts.length === 0) return "Today"
  return `${parts.join(" ")} Remaining`
}
