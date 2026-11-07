import { CalendarDays, Clock, History } from "lucide-react"
import { formatBookingDate, formatBookingDateTime } from "@/src/modules/shared/lib/booking-helpers"
import {
  areBookingScheduleSnapshotsEqual,
  getBookingScheduleSnapshot,
  normalizeBookingScheduleHistory,
  normalizeBookingScheduleSnapshot,
  type BookingScheduleSnapshot,
} from "@/src/modules/shared/lib/booking-schedule-history"
import { cn } from "@/src/modules/shared/lib/utils"

type ScheduleRecord = Record<string, unknown>

function formatTime(value: string | undefined): string {
  if (!value) return "Time not set"
  return value
}

function scheduleLabel(snapshot: BookingScheduleSnapshot | null): string {
  if (!snapshot) return "Schedule unavailable"
  const start = formatBookingDate(snapshot.date)
  const end = snapshot.endDate ? formatBookingDate(snapshot.endDate) : ""
  const date = end && end !== start ? `${start} – ${end}` : start
  const time = snapshot.startTime || snapshot.endTime
    ? `${formatTime(snapshot.startTime)}${snapshot.startTime && snapshot.endTime ? " – " : ""}${formatTime(snapshot.endTime)}`
    : "Time not set"
  return `${date} · ${time}`
}

export function BookingScheduleCard({
  label,
  snapshot,
  tone,
}: {
  label: string
  snapshot: BookingScheduleSnapshot | null
  tone: "original" | "current" | "previous" | "proposed"
}) {
  const toneClasses = {
    original: "border-slate-200 bg-slate-50",
    current: "border-orange-200 bg-orange-50/60",
    previous: "border-amber-200 bg-amber-50/60",
    proposed: "border-orange-200 bg-white",
  } as const
  return (
    <div className={cn("min-w-0 rounded-lg border p-3", toneClasses[tone])}>
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-600">{label}</p>
      {snapshot ? (
        <>
          <p className="mt-1 flex items-start gap-1.5 text-sm font-bold leading-5 text-slate-900 [overflow-wrap:anywhere]">
            <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-orange-700" aria-hidden="true" />
            <span>{snapshot.endDate && snapshot.endDate !== snapshot.date
              ? `${formatBookingDate(snapshot.date)} – ${formatBookingDate(snapshot.endDate)}`
              : formatBookingDate(snapshot.date)}</span>
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-xs font-semibold leading-5 text-slate-700 [overflow-wrap:anywhere]">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
            <span>{snapshot.startTime || snapshot.endTime
              ? `${formatTime(snapshot.startTime)}${snapshot.startTime && snapshot.endTime ? " – " : ""}${formatTime(snapshot.endTime)}`
              : "Time not set"}</span>
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm font-semibold text-slate-500">{scheduleLabel(snapshot)}</p>
      )}
    </div>
  )
}

export function BookingScheduleHistory({
  booking,
  showHistory = false,
  className,
}: {
  booking: ScheduleRecord
  showHistory?: boolean
  className?: string
}) {
  const original = normalizeBookingScheduleSnapshot(booking.originalSchedule)
  const current = getBookingScheduleSnapshot(booking)
  const history = normalizeBookingScheduleHistory(booking.scheduleHistory)
  const hasHistory = Boolean(original && current && !areBookingScheduleSnapshotsEqual(original, current)) || history.length > 0
  if (!hasHistory || !current) return null

  return (
    <section
      aria-label="Schedule history"
      data-schedule-history
      className={cn("rounded-xl border border-orange-100 bg-orange-50/30 p-3 sm:p-4", className)}
    >
      <div className="mb-3 flex items-start gap-2">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-orange-700" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-orange-800">Schedule Updated</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">This booking&apos;s schedule has been updated. The original request remains available for reference.</p>
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <BookingScheduleCard label="Original Schedule" snapshot={original} tone="original" />
        <BookingScheduleCard label="Current Schedule" snapshot={current} tone="current" />
      </div>
      {showHistory && history.length > 0 && (
        <div className="mt-3 border-t border-orange-100 pt-3">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-600">
            <History className="h-3.5 w-3.5" aria-hidden="true" /> Schedule revisions
          </p>
          <ol className="space-y-2 pr-1">
            {history.map((revision) => (
              <li key={`${revision.revision}-${revision.changedAt}`} className="grid min-w-0 grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-white p-2.5 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] sm:items-start">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Revision {revision.revision}</p>
                  <p className="mt-1 text-[11px] font-semibold leading-4 text-slate-500 [overflow-wrap:anywhere]">{formatBookingDateTime(revision.changedAt)}{revision.changedByName ? ` · ${revision.changedByName}` : ""}</p>
                </div>
                <BookingScheduleCard label="Previous" snapshot={revision.previousSchedule} tone="previous" />
                <BookingScheduleCard label="Current" snapshot={revision.currentSchedule} tone="proposed" />
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
