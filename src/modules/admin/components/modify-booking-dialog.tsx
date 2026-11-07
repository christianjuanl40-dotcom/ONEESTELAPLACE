"use client"

import { useEffect, useMemo, useState } from "react"
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  UserRound,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/modules/shared/components/ui/dialog"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Label } from "@/src/modules/shared/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/modules/shared/components/ui/select"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { type Booking } from "@/src/modules/client/contexts/booking-context"
import { useCMS } from "@/src/modules/admin/contexts/cms-context"
import { useSpaceAvailability } from "@/src/modules/shared/hooks/use-space-availability"
import {
  addAvailabilityDays,
  formatAvailabilityTime,
  getAvailabilityTimeRange,
  getMinimumBookingDate,
  getOfficeRentalEndDate,
  MAX_OFFICE_SEARCH_DAYS,
  parseAvailabilityTime,
} from "@/src/modules/shared/lib/availability"
import { isOfficeResourceBooking, resolveResourceSpace } from "@/src/modules/shared/lib/resource-identity"
import { areBookingScheduleSnapshotsEqual, getBookingScheduleSnapshot, normalizeBookingScheduleSnapshot } from "@/src/modules/shared/lib/booking-schedule-history"
import { formatBookingDate } from "@/src/modules/shared/lib/booking-helpers"
import { BookingScheduleCard } from "@/src/modules/shared/components/booking-schedule-history"

export type AdminBookingChanges = Partial<Pick<Booking, "eventName" | "date" | "startTime" | "endTime">>

interface ModifyBookingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  booking: Booking
  onSave: (changes: AdminBookingChanges) => void
  isSaving?: boolean
  saveError?: string | null
  onCloseAutoFocus?: (event: Event) => void
}

function dateToValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function valueToDate(value: string | undefined): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return undefined
  const [year, month, day] = String(value).split("-").map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined
}

function monthFor(value: string | undefined): Date {
  const date = valueToDate(value) || valueToDate(getMinimumBookingDate()) || new Date()
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function readableTime(value: string | undefined): string {
  if (!value) return "Time not set"
  const minutes = parseAvailabilityTime(value)
  if (minutes !== null) return formatAvailabilityTime(minutes)
  return value
}

function sameTime(first: string | undefined, second: string | undefined): boolean {
  const firstMinutes = parseAvailabilityTime(first)
  const secondMinutes = parseAvailabilityTime(second)
  return firstMinutes !== null && secondMinutes !== null
    ? firstMinutes === secondMinutes
    : String(first || "") === String(second || "")
}

export function ModifyBookingDialog({
  open,
  onOpenChange,
  booking,
  onSave,
  isSaving = false,
  saveError,
  onCloseAutoFocus,
}: ModifyBookingDialogProps) {
  const { toast } = useToast()
  const { cmsData } = useCMS()
  const isOfficeBooking = isOfficeResourceBooking(booking as unknown as Record<string, unknown>)
  const [eventName, setEventName] = useState(booking.eventName || "")
  const [selectedDate, setSelectedDate] = useState(booking.date || "")
  const [selectedStartTime, setSelectedStartTime] = useState(booking.startTime || "")
  const [selectedEndTime, setSelectedEndTime] = useState(booking.endTime || "")
  const [calendarMonth, setCalendarMonth] = useState(() => monthFor(booking.date))
  const [officeSearchFrom, setOfficeSearchFrom] = useState("")
  const [validationMessage, setValidationMessage] = useState<string | null>(null)

  const resourceResolution = useMemo(
    () => resolveResourceSpace(cmsData || {}, booking as unknown as Record<string, unknown>),
    [booking, cmsData],
  )
  const availabilitySpace = resourceResolution.status === "resolved" ? resourceResolution.space : null
  const resourceError = resourceResolution.status !== "resolved"
    ? "This booking's exact space could not be identified. Schedule availability cannot be confirmed."
    : null
  const storedRentalTerm = String(booking.officeRentalTerm || booking.rentalTerm || booking.contractTerm || "")
  const rentalTerm = ["6_months", "1_year", "2_years"].includes(storedRentalTerm)
    ? storedRentalTerm as "6_months" | "1_year" | "2_years"
    : undefined
  const minimumBookingDate = getMinimumBookingDate()
  const searchFrom = officeSearchFrom > minimumBookingDate ? officeSearchFrom : minimumBookingDate
  const officeSearch = useMemo(() => isOfficeBooking && rentalTerm
    ? { from: searchFrom, to: addAvailabilityDays(searchFrom, MAX_OFFICE_SEARCH_DAYS - 1) }
    : undefined,
  [isOfficeBooking, rentalTerm, searchFrom])
  const availability = useSpaceAvailability(
    open,
    availabilitySpace,
    calendarMonth,
    booking.id,
    rentalTerm,
    "",
    officeSearch,
  )
  const currentSchedule = useMemo(
    () => getBookingScheduleSnapshot(booking as unknown as Record<string, unknown>),
    [booking],
  )
  const originalSchedule = useMemo(
    () => normalizeBookingScheduleSnapshot(booking.originalSchedule),
    [booking.originalSchedule],
  )
  const currentInterval = useMemo(() => getAvailabilityTimeRange(booking as unknown as Record<string, unknown>), [booking])
  const currentSlot = useMemo(() => {
    if (!currentInterval || isOfficeBooking) return null
    return {
      startMinutes: currentInterval.startMinutes,
      endMinutes: currentInterval.endMinutes,
      startTimeLabel: formatAvailabilityTime(currentInterval.startMinutes),
      endTimeLabel: formatAvailabilityTime(currentInterval.endMinutes),
      label: `${formatAvailabilityTime(currentInterval.startMinutes)} - ${formatAvailabilityTime(currentInterval.endMinutes)}`,
    }
  }, [currentInterval, isOfficeBooking])
  const selectedDay = selectedDate ? availability.days[selectedDate] : undefined
  const scheduleOptions = useMemo(() => {
    const options = [...(selectedDay?.availableSlots || [])]
    if (selectedDate === booking.date && currentSlot && !options.some((slot) => (
      slot.startMinutes === currentSlot.startMinutes && slot.endMinutes === currentSlot.endMinutes
    ))) options.unshift(currentSlot)
    return options
  }, [booking.date, currentSlot, selectedDate, selectedDay])

  useEffect(() => {
    if (!open) return
    setValidationMessage(null)
    setEventName(booking.eventName || "")
    setSelectedDate(booking.date || "")
    setSelectedStartTime(currentSlot?.startTimeLabel || booking.startTime || "")
    setSelectedEndTime(currentSlot?.endTimeLabel || booking.endTime || "")
    setCalendarMonth(monthFor(booking.date))
    setOfficeSearchFrom(minimumBookingDate)
  }, [booking, currentSlot, minimumBookingDate, open])

  useEffect(() => {
    if (isOfficeBooking || !selectedDate || !selectedStartTime || !selectedEndTime || availability.loading) return
    const day = availability.days[selectedDate]
    if (!day) return
    const selectedRange = getAvailabilityTimeRange({ startTime: selectedStartTime, endTime: selectedEndTime })
    if (!selectedRange) {
      setSelectedStartTime("")
      setSelectedEndTime("")
      return
    }
    const isAvailable = day.availableSlots.some((slot) => (
      slot.startMinutes === selectedRange.startMinutes && slot.endMinutes === selectedRange.endMinutes
    )) || (selectedDate === booking.date && currentSlot?.startMinutes === selectedRange.startMinutes && currentSlot.endMinutes === selectedRange.endMinutes)
    if (!isAvailable) {
      setSelectedStartTime("")
      setSelectedEndTime("")
    }
  }, [availability.days, availability.loading, booking.date, currentSlot, isOfficeBooking, selectedDate, selectedEndTime, selectedStartTime])

  const proposedRecord = useMemo(() => ({
    ...(booking as unknown as Record<string, unknown>),
    date: selectedDate || booking.date,
    ...(isOfficeBooking
      ? { endDate: getOfficeRentalEndDate(selectedDate || booking.date, storedRentalTerm) || booking.endDate }
      : {
          startTime: selectedStartTime || booking.startTime,
          endTime: selectedEndTime || booking.endTime,
          time: selectedStartTime && selectedEndTime ? `${selectedStartTime} - ${selectedEndTime}` : booking.time,
          ...(booking.endDate ? { endDate: selectedDate || booking.date } : {}),
        }),
  }), [booking, isOfficeBooking, selectedDate, selectedEndTime, selectedStartTime, storedRentalTerm])
  const proposedSchedule = useMemo(() => getBookingScheduleSnapshot(proposedRecord), [proposedRecord])
  const scheduleHasChanged = Boolean(currentSchedule && proposedSchedule && !areBookingScheduleSnapshotsEqual(currentSchedule, proposedSchedule))
  const eventNameHasChanged = eventName.trim() !== (booking.eventName || "")
  const timeHasChanged = !isOfficeBooking && (!sameTime(selectedStartTime, booking.startTime) || !sameTime(selectedEndTime, booking.endTime))
  const hasChanges = eventNameHasChanged || scheduleHasChanged
  const selectedRange = !isOfficeBooking && selectedStartTime && selectedEndTime
    ? getAvailabilityTimeRange({ startTime: selectedStartTime, endTime: selectedEndTime })
    : null
  const selectedSlotIsAvailable = isOfficeBooking
    ? Boolean(selectedDate && selectedDay && !availability.loading && !availability.error && selectedDay.status === "available")
    : Boolean(selectedDate && selectedRange && selectedDay && !availability.loading && !availability.error && (
      selectedDay.availableSlots.some((slot) => slot.startMinutes === selectedRange.startMinutes && slot.endMinutes === selectedRange.endMinutes)
      || (selectedDate === booking.date && currentSlot?.startMinutes === selectedRange.startMinutes && currentSlot.endMinutes === selectedRange.endMinutes)
    ))
  const scheduleSelectionValid = !scheduleHasChanged || selectedSlotIsAvailable
  const showScheduleAvailabilityMessage = scheduleHasChanged && !scheduleSelectionValid
  const availableVenueSlots = selectedDate ? selectedDay?.availableSlots || [] : []
  const occupiedIntervals = [...(selectedDay?.occupiedIntervals || [])]
    .sort((first, second) => first.startMinutes - second.startMinutes || first.endMinutes - second.endMinutes)

  if (!booking) return null

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return
    const value = dateToValue(date)
    if (value !== selectedDate) {
      if (!isOfficeBooking && value === booking.date) {
        setSelectedStartTime(currentSlot?.startTimeLabel || booking.startTime || "")
        setSelectedEndTime(currentSlot?.endTimeLabel || booking.endTime || "")
      } else {
        setSelectedStartTime("")
        setSelectedEndTime("")
      }
    }
    setSelectedDate(value)
    setValidationMessage(null)
  }

  const handleMonthChange = (offset: number) => {
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1))
    setSelectedDate("")
    setSelectedStartTime("")
    setSelectedEndTime("")
    setValidationMessage(null)
  }

  const handleSave = () => {
    if (!eventName.trim()) {
      setValidationMessage("Please provide an event name.")
      toast({ title: "Event name required", description: "Please provide an event name.", variant: "destructive" })
      return
    }
    if (!selectedDate || !scheduleSelectionValid) {
      const message = resourceError || availability.error || "Choose an available date and time before saving."
      setValidationMessage(message)
      toast({ title: "Schedule unavailable", description: message, variant: "destructive" })
      return
    }
    if (!hasChanges) {
      setValidationMessage("No changes to save.")
      return
    }
    const changes: AdminBookingChanges = {}
    if (eventNameHasChanged) changes.eventName = eventName.trim()
    if (selectedDate !== booking.date) changes.date = selectedDate
    if (!isOfficeBooking && timeHasChanged && selectedStartTime && selectedEndTime) {
      changes.startTime = selectedStartTime
      changes.endTime = selectedEndTime
    }
    if (!Object.keys(changes).length) {
      setValidationMessage("No changes to save.")
      return
    }
    setValidationMessage(null)
    onSave(changes)
  }

  const getCalendarDayState = (value: string) => {
    const isCurrentDate = value === booking.date
    const isSelected = selectedDate === value
    const dayAvailability = availability.days[value]
    let statusClass = "border-slate-200 bg-white text-slate-700 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700"
    let isDisabled = false
    let dayTitle = "Available"

    if (!isCurrentDate && value < minimumBookingDate) {
      statusClass = "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-300 opacity-60"
      isDisabled = true
      dayTitle = "Unavailable: booking must be at least 1 month from today"
    } else if (resourceError || availability.error) {
      statusClass = "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-300 opacity-60"
      isDisabled = true
      dayTitle = "Availability unavailable"
    } else if (availability.loading || !dayAvailability) {
      statusClass = "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-300 opacity-60"
      isDisabled = true
      dayTitle = "Loading availability"
    } else if (dayAvailability.status === "maintenance") {
      statusClass = "cursor-not-allowed border-slate-900 bg-slate-900 text-slate-400"
      isDisabled = true
      dayTitle = isOfficeBooking ? "Maintenance overlaps this rental term" : "Maintenance day"
    } else if (dayAvailability.status === "full") {
      statusClass = "cursor-not-allowed border-rose-100 bg-rose-50 text-rose-300"
      isDisabled = true
      dayTitle = isOfficeBooking ? "Reservation overlaps this rental term" : "Fully booked"
    } else if (dayAvailability.status === "few") {
      statusClass = "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100"
      dayTitle = "Few slots left"
    }

    if (isCurrentDate && !isSelected && !isDisabled) {
      statusClass = `${statusClass} ring-1 ring-slate-400 ring-offset-1`
      dayTitle = `Current saved date — ${dayTitle.toLowerCase()}`
    }
    if (isSelected && !isDisabled) {
      statusClass = `${statusClass} ring-2 ring-orange-600 ring-offset-1 scale-105`
      dayTitle = dayAvailability?.status === "few" ? "Few slots left (selected)" : "Selected date"
    }

    return { dayAvailability, isDisabled, statusClass, dayTitle }
  }

  const year = calendarMonth.getFullYear()
  const month = calendarMonth.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay = new Date(year, month, 1).getDay()
  const monthLabel = calendarMonth.toLocaleString("en-US", { month: "long", year: "numeric" })
  const calendarDays = Array.from({ length: daysInMonth }, (_, index) => index + 1)
  const emptySlots = Array.from({ length: firstDay }, (_, index) => index)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-4xl flex-col overflow-hidden rounded-2xl p-0"
      >
        <DialogHeader className="shrink-0 border-b border-slate-200 px-4 py-4 pr-14 text-left sm:px-6 sm:pr-14">
          <DialogTitle className="text-lg leading-6">Modify Booking</DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            Review the saved booking context, choose an available schedule, and update only the approved booking fields.
          </DialogDescription>
        </DialogHeader>

        <div data-modify-booking-body className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {(saveError || validationMessage) && (
            <p role="alert" aria-live="assertive" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-5 text-rose-700">
              {saveError || validationMessage}
            </p>
          )}

          <div className="space-y-5">
            <section aria-labelledby="modify-booking-context-heading" className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0 text-orange-700" aria-hidden="true" />
                <h2 id="modify-booking-context-heading" className="text-xs font-black uppercase tracking-[0.14em] text-slate-700">Read-only booking context</h2>
              </div>
              <dl className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="min-w-0">
                  <dt className="text-xs font-medium text-slate-500">Booking Reference</dt>
                  <dd className="mt-0.5 break-words text-sm font-bold text-slate-900">#{booking.id}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-medium text-slate-500">Reserved Space / Venue / Office</dt>
                  <dd className="mt-0.5 break-words text-sm font-bold text-slate-900">{booking.venue || "—"}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="flex items-center gap-1 text-xs font-medium text-slate-500"><UserRound className="h-3.5 w-3.5" aria-hidden="true" /> Customer</dt>
                  <dd className="mt-0.5 break-words text-sm font-bold text-slate-900">{booking.userInfo?.name || "Customer not recorded"}</dd>
                </div>
              </dl>
            </section>

            <section aria-labelledby="modify-event-details-heading" className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
              <div>
                <h2 id="modify-event-details-heading" className="text-sm font-bold text-slate-900">Editable event details</h2>
                <p className="mt-1 text-xs leading-5 text-slate-600">Only the event name and schedule can be changed from this Admin tool. Space, customer, guest, payment, and rental information remain read-only.</p>
              </div>
              <div className="mt-4 space-y-2">
                <Label htmlFor="eventName" className="text-sm font-semibold">Event Name</Label>
                <Input
                  id="eventName"
                  aria-label="Event Name"
                  value={eventName}
                  onChange={(event) => { setEventName(event.target.value); setValidationMessage(null) }}
                  placeholder="Enter event name"
                  required
                  className="h-11 min-w-0 w-full rounded-lg px-3"
                />
              </div>
            </section>

            <section aria-labelledby="modify-saved-schedule-heading" className="rounded-xl border border-orange-100 bg-orange-50/30 p-3 sm:p-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 shrink-0 text-orange-700" aria-hidden="true" />
                <div className="min-w-0">
                  <h2 id="modify-saved-schedule-heading" className="text-sm font-bold text-slate-900">Current saved schedule</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-600">The saved schedule stays visible while you select a proposed date and time.</p>
                </div>
              </div>
              <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <BookingScheduleCard label="Current Schedule" snapshot={currentSchedule} tone="current" />
                {originalSchedule && currentSchedule && !areBookingScheduleSnapshotsEqual(originalSchedule, currentSchedule) && (
                  <BookingScheduleCard label="Original Schedule" snapshot={originalSchedule} tone="original" />
                )}
              </div>
            </section>

            <section aria-labelledby="modify-schedule-selection-heading" className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-orange-700" aria-hidden="true" />
                  <div className="min-w-0">
                    <h2 id="modify-schedule-selection-heading" className="text-sm font-bold text-slate-900">Choose a new schedule</h2>
                    <p className="mt-1 text-xs leading-5 text-slate-600">Calendar states and time slots use the same availability rules as New Booking. The server rechecks resource, capacity, payment-hold, and transaction-lock conditions when you save.</p>
                  </div>
                </div>
                {scheduleHasChanged && (
                  <span className="shrink-0 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-orange-700">Proposed change</span>
                )}
              </div>

              <div className="mt-4 grid min-w-0 gap-5 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
                <div className="min-w-0 space-y-2">
                  <p id="modify-date-label" className="text-sm font-semibold text-slate-900">Select Date</p>
                  <div data-modify-calendar aria-label="Availability calendar" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-2.5 py-2">
                      <button
                        type="button"
                        aria-label="Previous month"
                        onClick={() => handleMonthChange(-1)}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <div className="text-center">
                        <h3 className="text-sm font-black leading-none text-slate-950">{monthLabel}</h3>
                        <p className="mt-1 text-[8px] font-bold uppercase tracking-[0.12em] text-slate-600">Choose an available day</p>
                      </div>
                      <button
                        type="button"
                        aria-label="Next month"
                        onClick={() => handleMonthChange(1)}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="p-2.5">
                      <div className="mb-1.5 grid grid-cols-7 text-center" aria-hidden="true">
                        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((dayLabel) => (
                          <div key={dayLabel} className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-700">{dayLabel}</div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 justify-items-center gap-0.5" aria-labelledby="modify-date-label">
                        {emptySlots.map((slot) => <div key={`empty-${slot}`} className="h-8 w-8" aria-hidden="true" />)}
                        {calendarDays.map((day) => {
                          const value = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
                          const state = getCalendarDayState(value)
                          return (
                            <button
                              type="button"
                              key={value}
                              aria-label={`Select ${value}`}
                              aria-selected={selectedDate === value}
                              data-day={`${month + 1}/${day}/${year}`}
                              data-selected-single={selectedDate === value ? "true" : undefined}
                              title={state.dayTitle}
                              disabled={state.isDisabled}
                              onClick={() => handleDateSelect(valueToDate(value))}
                              className={`flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-black outline-none transition-all focus-visible:ring-2 focus-visible:ring-orange-300 ${state.statusClass}`}
                            >
                              {day}
                            </button>
                          )
                        })}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-1 border-t border-slate-100 pt-2 sm:grid-cols-4" aria-label="Availability legend">
                        <span className="flex items-center justify-center gap-1 rounded-full bg-white px-1 py-1 text-[8px] font-black uppercase tracking-[0.06em] text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Available</span>
                        <span className="flex items-center justify-center gap-1 rounded-full bg-amber-50 px-1 py-1 text-[8px] font-black uppercase tracking-[0.06em] text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-300" /> Few slots</span>
                        <span className="flex items-center justify-center gap-1 rounded-full bg-rose-50 px-1 py-1 text-[8px] font-black uppercase tracking-[0.06em] text-rose-600"><span className="h-1.5 w-1.5 rounded-full bg-rose-300" /> Full</span>
                        <span className="flex items-center justify-center gap-1 rounded-full bg-slate-100 px-1 py-1 text-[8px] font-black uppercase tracking-[0.06em] text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-slate-900" /> Maint.</span>
                      </div>
                      <div className="mt-3 rounded-2xl border border-orange-100 bg-orange-50 px-2.5 py-2" aria-live="polite">
                        <p className="text-[8px] font-black uppercase tracking-[0.12em] text-orange-700">
                          {isOfficeBooking ? "Earliest available start date" : "Earliest bookable date"}
                        </p>
                        {isOfficeBooking ? (
                          <div className="mt-1 space-y-2 text-xs font-semibold leading-5 text-orange-900">
                            {availability.error ? <p>Availability could not be confirmed. Please retry.</p>
                              : availability.loading || !availability.officeSearch ? <p>Checking the full rental term…</p>
                                : availability.officeSearch.earliestAvailableStartDate ? (
                                  <>
                                    <p>{formatBookingDate(availability.officeSearch.earliestAvailableStartDate)}.</p>
                                    <p>The entire rental term must be available. Disabled dates cannot be selected.</p>
                                    <button type="button" className="font-bold text-orange-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300" onClick={() => {
                                      const earliest = availability.officeSearch?.earliestAvailableStartDate
                                      if (!earliest) return
                                      setCalendarMonth(monthFor(earliest))
                                      setSelectedDate("")
                                      setSelectedStartTime("")
                                      setSelectedEndTime("")
                                    }}>View earliest available month</button>
                                  </>
                                ) : (
                                  <>
                                    <p>No valid start date found from {formatBookingDate(availability.officeSearch.from)} through {formatBookingDate(availability.officeSearch.to)}.</p>
                                    <button type="button" className="font-bold text-orange-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300" onClick={() => {
                                      const nextFrom = addAvailabilityDays(availability.officeSearch?.to || searchFrom, 1)
                                      setOfficeSearchFrom(nextFrom)
                                      setCalendarMonth(monthFor(nextFrom))
                                      setSelectedDate("")
                                      setSelectedStartTime("")
                                      setSelectedEndTime("")
                                    }}>Search later start dates</button>
                                  </>
                                )}
                          </div>
                        ) : (
                          <p className="mt-0.5 text-[10px] font-bold leading-4 text-orange-900">{formatBookingDate(minimumBookingDate)}. The existing booking date remains selectable; other earlier dates are disabled.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="min-w-0 space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 shrink-0 text-orange-700" aria-hidden="true" />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-900">{isOfficeBooking ? "Rental schedule" : "Select Time"}</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-600">{isOfficeBooking ? "The room, rental term, and company details remain unchanged." : "Choose a safe six-hour slot after reviewing existing bookings on the selected date."}</p>
                    </div>
                  </div>

                  {resourceError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold leading-5 text-rose-700">{resourceError}</p>}
                  {availability.loading && <p role="status" className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Checking availability…</p>}
                  {availability.error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold leading-5 text-rose-700">{availability.error} <button type="button" className="ml-1 font-bold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300" onClick={availability.retry}>Retry availability</button></p>}

                  {!isOfficeBooking && selectedDate && !availability.loading && !availability.error && occupiedIntervals.length > 0 && (
                    <section aria-label="Selected date availability" className="space-y-2 rounded-lg border border-amber-100 bg-amber-50/60 p-3 text-xs">
                      <div>
                        <p className="font-bold text-slate-700">Existing booking(s)</p>
                        {occupiedIntervals.map((interval, index) => <p key={`${interval.startMinutes}:${interval.endMinutes}:${index}`} className="mt-1 font-semibold tabular-nums text-slate-600">{interval.startTimeLabel} – {interval.endTimeLabel}</p>)}
                      </div>
                      <div>
                        <p className="font-bold text-slate-700">Available start times</p>
                        <p className="mt-1 font-semibold tabular-nums text-orange-700">{availableVenueSlots.map((slot) => slot.startTimeLabel).join(", ") || "None"}</p>
                      </div>
                    </section>
                  )}

                  {!selectedDate ? (
                    <p className="rounded-lg border border-slate-200 bg-white p-3 text-xs font-semibold leading-5 text-slate-600">Select an available date to see selectable time slots.</p>
                  ) : isOfficeBooking ? (
                    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm leading-5 text-slate-700">
                      <p className="font-bold">Existing rental period</p>
                      <p className="mt-1">{formatBookingDate(booking.date)}{booking.endDate ? ` – ${formatBookingDate(booking.endDate)}` : ""}</p>
                      {selectedDay && !availability.loading && !availability.error && selectedDay.status !== "available" && (
                        <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">The selected rental term is unavailable from this date. Choose another date.</p>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="min-w-0 space-y-2">
                          <Label htmlFor="startTime" className="text-sm font-semibold">Start Time</Label>
                          <Select value={selectedStartTime} onValueChange={(value) => {
                            const option = scheduleOptions.find((slot) => slot.startTimeLabel === value)
                            if (!option) return
                            setSelectedStartTime(option.startTimeLabel)
                            setSelectedEndTime(option.endTimeLabel)
                            setValidationMessage(null)
                          }} disabled={availability.loading || !scheduleOptions.length}>
                            <SelectTrigger id="startTime" aria-label="Start Time" className="min-w-0 w-full rounded-lg px-3 data-[size=default]:h-11">
                              <SelectValue placeholder="Select start time" />
                            </SelectTrigger>
                            <SelectContent className="z-[10003] max-h-[min(18rem,var(--radix-select-content-available-height))]">
                              {scheduleOptions.map((slot) => <SelectItem key={`${slot.startMinutes}-${slot.endMinutes}-start`} value={slot.startTimeLabel}><span className="flex items-center gap-2"><Clock className="h-3.5 w-3.5 text-orange-700" aria-hidden="true" />{slot.startTimeLabel}</span></SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="min-w-0 space-y-2">
                          <Label htmlFor="endTime" className="text-sm font-semibold">End Time</Label>
                          <Select value={selectedEndTime} onValueChange={(value) => {
                            const option = scheduleOptions.find((slot) => slot.endTimeLabel === value)
                            if (!option) return
                            setSelectedStartTime(option.startTimeLabel)
                            setSelectedEndTime(option.endTimeLabel)
                            setValidationMessage(null)
                          }} disabled={availability.loading || !scheduleOptions.length}>
                            <SelectTrigger id="endTime" aria-label="End Time" className="min-w-0 w-full rounded-lg px-3 data-[size=default]:h-11">
                              <SelectValue placeholder="Select end time" />
                            </SelectTrigger>
                            <SelectContent className="z-[10003] max-h-[min(18rem,var(--radix-select-content-available-height))]">
                              {scheduleOptions.map((slot) => <SelectItem key={`${slot.startMinutes}-${slot.endMinutes}-end`} value={slot.endTimeLabel}>{slot.endTimeLabel}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {selectedStartTime && selectedEndTime && selectedSlotIsAvailable && (
                        <div className="flex items-start gap-2 rounded-lg border border-orange-100 bg-orange-50 p-3" aria-live="polite">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-orange-700" aria-hidden="true" />
                          <div><p className="text-[10px] font-black uppercase tracking-[0.14em] text-orange-900">Selected 6-Hour Schedule</p><p className="mt-0.5 text-sm font-black text-orange-700">{readableTime(selectedStartTime)} – {readableTime(selectedEndTime)}</p></div>
                        </div>
                      )}
                    </>
                  )}
                  {showScheduleAvailabilityMessage && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900">The proposed schedule is not available. Choose another date or time before saving.</p>}
                </div>
              </div>
            </section>

            <section aria-labelledby="modify-schedule-comparison-heading" data-schedule-comparison className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
              <h2 id="modify-schedule-comparison-heading" className="text-sm font-bold text-slate-900">Schedule comparison</h2>
              <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <BookingScheduleCard label="Before · Current Schedule" snapshot={currentSchedule} tone="current" />
                {scheduleHasChanged ? (
                  <BookingScheduleCard label="After · Proposed Schedule" snapshot={proposedSchedule} tone="proposed" />
                ) : (
                  <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-600">After · Proposed Schedule</p>
                    <p className="mt-1 text-sm font-semibold text-slate-600">No schedule change</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-slate-200 px-4 py-3 sm:px-6">
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={isSaving} className="h-11 w-full rounded-lg px-4 sm:w-auto" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" variant="brand" disabled={isSaving || !hasChanges || !selectedDate || !scheduleSelectionValid} aria-busy={isSaving} className="h-11 w-full rounded-lg px-4 sm:w-auto" onClick={handleSave}>
              {isSaving ? "Saving…" : "Update Booking"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
