"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, CalendarDays, CheckCircle2, Clock, Loader2 } from "lucide-react"
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
import { Calendar } from "@/src/modules/shared/components/ui/calendar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/modules/shared/components/ui/tabs"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { type Booking } from "@/src/modules/client/contexts/booking-context"
import { useCMS } from "@/src/modules/admin/contexts/cms-context"
import { useSpaceAvailability } from "@/src/modules/shared/hooks/use-space-availability"
import {
  formatAvailabilityTime,
  getAvailabilityTimeRange,
  getMinimumBookingDate,
  getOfficeRentalEndDate,
  parseAvailabilityTime,
} from "@/src/modules/shared/lib/availability"
import { isOfficeResourceBooking, resolveResourceSpace } from "@/src/modules/shared/lib/resource-identity"
import { getBookingScheduleSnapshot, areBookingScheduleSnapshotsEqual, normalizeBookingScheduleSnapshot } from "@/src/modules/shared/lib/booking-schedule-history"
import { formatBookingDate } from "@/src/modules/shared/lib/booking-helpers"
import { BookingScheduleCard } from "@/src/modules/shared/components/booking-schedule-history"
import { cn } from "@/src/modules/shared/lib/utils"

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
  const [step, setStep] = useState<"details" | "schedule">("details")
  const [eventName, setEventName] = useState(booking.eventName || "")
  const [selectedDate, setSelectedDate] = useState(booking.date || "")
  const [selectedStartTime, setSelectedStartTime] = useState(booking.startTime || "")
  const [selectedEndTime, setSelectedEndTime] = useState(booking.endTime || "")
  const [calendarMonth, setCalendarMonth] = useState(() => monthFor(booking.date))
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
  const availability = useSpaceAvailability(open, availabilitySpace, calendarMonth, booking.id, rentalTerm)
  const minimumBookingDate = getMinimumBookingDate()
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
    setStep("details")
    setValidationMessage(null)
    setEventName(booking.eventName || "")
    setSelectedDate(booking.date || "")
    setSelectedStartTime(currentSlot?.startTimeLabel || booking.startTime || "")
    setSelectedEndTime(currentSlot?.endTimeLabel || booking.endTime || "")
    setCalendarMonth(monthFor(booking.date))
  }, [booking, currentSlot, open])

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

  if (!booking) return null

  const showScheduleAvailabilityMessage = scheduleHasChanged && !scheduleSelectionValid
  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return
    const value = dateToValue(date)
    setSelectedDate(value)
    setValidationMessage(null)
  }

  const handleSave = () => {
    if (!eventName.trim()) {
      setValidationMessage("Please provide an event name.")
      toast({ title: "Event name required", description: "Please provide an event name.", variant: "destructive" })
      setStep("details")
      return
    }
    if (!selectedDate || !scheduleSelectionValid) {
      setValidationMessage(resourceError || availability.error || "Choose an available date and time before saving.")
      toast({ title: "Schedule unavailable", description: resourceError || availability.error || "Choose an available date and time before saving.", variant: "destructive" })
      return
    }
    if (!hasChanges) {
      setValidationMessage("No changes to save.")
      return
    }
    const changes: AdminBookingChanges = {}
    if (eventNameHasChanged) changes.eventName = eventName.trim()
    if (selectedDate !== booking.date) changes.date = selectedDate
    if (!isOfficeBooking && selectedStartTime && selectedEndTime && (
      selectedStartTime !== booking.startTime || selectedEndTime !== booking.endTime
    )) {
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

  const renderDateDisabled = (date: Date) => {
    const value = dateToValue(date)
    const isCurrentDate = value === booking.date
    if (!isCurrentDate && value < minimumBookingDate) return true
    if (isCurrentDate && value < minimumBookingDate) return false
    if (!availabilitySpace || availability.loading || availability.error) return true
    const day = availability.days[value]
    if (!day || day.status === "maintenance" || day.status === "full") return true
    return isOfficeBooking ? day.status !== "available" : day.availableSlots.length === 0
  }

  const setStartTime = (value: string) => {
    const option = scheduleOptions.find((slot) => slot.startTimeLabel === value)
    if (!option) return
    setSelectedStartTime(option.startTimeLabel)
    setSelectedEndTime(option.endTimeLabel)
    setValidationMessage(null)
  }

  const setEndTime = (value: string) => {
    const option = scheduleOptions.find((slot) => slot.endTimeLabel === value)
    if (!option) return
    setSelectedStartTime(option.startTimeLabel)
    setSelectedEndTime(option.endTimeLabel)
    setValidationMessage(null)
  }

  const stepIndex = step === "details" ? 0 : 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-3xl flex-col overflow-hidden rounded-2xl p-0"
      >
        <DialogHeader className="shrink-0 border-b border-slate-200 px-4 py-4 pr-14 text-left sm:px-6 sm:pr-14">
          <DialogTitle className="text-lg leading-6">{step === "details" ? "Edit Event Details" : "Update Event Schedule"}</DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            {step === "details" ? "Update the event name, then review the saved schedule before continuing." : "Choose an available date and time. The current schedule remains visible until you save."}
          </DialogDescription>
        </DialogHeader>

        <div data-modify-booking-body className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {(saveError || validationMessage) && (
            <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-5 text-rose-700">{saveError || validationMessage}</p>
          )}

          <Tabs
            value={step}
            onValueChange={(value) => {
              if (value === "schedule" && !eventName.trim()) {
                setValidationMessage("Please provide an event name before continuing.")
                return
              }
              setValidationMessage(null)
              setStep(value as "details" | "schedule")
            }}
            className="min-w-0 w-full"
          >
            <TabsList aria-label="Modify booking steps" className="grid h-11 w-full grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
              <TabsTrigger className="h-9 min-w-0 rounded-md px-2 text-sm focus-visible:ring-orange-600 data-[state=active]:bg-white data-[state=active]:text-orange-700 data-[state=active]:shadow-sm" value="details">
                <span aria-hidden="true" className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] text-white">1</span>
                Event Details
              </TabsTrigger>
              <TabsTrigger className="h-9 min-w-0 rounded-md px-2 text-sm focus-visible:ring-orange-600 data-[state=active]:bg-white data-[state=active]:text-orange-700 data-[state=active]:shadow-sm" value="schedule">
                <span aria-hidden="true" className={cn("mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-white", stepIndex === 1 ? "bg-orange-700" : "bg-slate-400")}>2</span>
                Date &amp; Time
              </TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="mt-5 min-w-0 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Read-only booking context</p>
                <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="min-w-0"><dt className="text-xs font-medium text-slate-500">Booking Reference</dt><dd className="mt-0.5 break-words text-sm font-bold text-slate-900">#{booking.id}</dd></div>
                  <div className="min-w-0"><dt className="text-xs font-medium text-slate-500">Reserved Space</dt><dd className="mt-0.5 break-words text-sm font-bold text-slate-900">{booking.venue || "—"}</dd></div>
                </dl>
              </div>
              <div className="space-y-2">
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
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-orange-700" aria-hidden="true" />
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-700">Current booking schedule</p>
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  <BookingScheduleCard label="Current Schedule" snapshot={currentSchedule} tone="current" />
                  {originalSchedule && currentSchedule && !areBookingScheduleSnapshotsEqual(originalSchedule, currentSchedule) && (
                    <BookingScheduleCard label="Original Schedule" snapshot={originalSchedule} tone="original" />
                  )}
                </div>
                <p className="text-xs leading-5 text-slate-600">The current date and time are shown before you choose a new schedule.</p>
              </div>
            </TabsContent>

            <TabsContent value="schedule" className="mt-5 min-w-0 space-y-4">
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2" data-schedule-comparison>
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
              {originalSchedule && currentSchedule && !areBookingScheduleSnapshotsEqual(originalSchedule, currentSchedule) && (
                <BookingScheduleCard label="Original Schedule" snapshot={originalSchedule} tone="original" />
              )}

              <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
                <div className="min-w-0 space-y-2">
                  <p id="modify-date-label" className="text-sm font-semibold">Event Date</p>
                  <Calendar
                    mode="single"
                    month={calendarMonth}
                    onMonthChange={setCalendarMonth}
                    selected={valueToDate(selectedDate)}
                    onSelect={handleDateSelect}
                    disabled={renderDateDisabled}
                    aria-labelledby="modify-date-label"
                    className="w-full min-w-0 rounded-lg border border-slate-200 p-2"
                  />
                  <div className="rounded-lg border border-orange-100 bg-orange-50 px-3 py-2" aria-live="polite">
                    <p className="text-[10px] font-black uppercase tracking-[0.12em] text-orange-700">Earliest new date</p>
                    <p className="mt-0.5 text-xs font-semibold leading-5 text-orange-900">{formatBookingDate(minimumBookingDate)}. The existing booking date remains selectable.</p>
                  </div>
                </div>

                <div className="min-w-0 space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-orange-700" aria-hidden="true" />
                    <p className="text-sm font-semibold">{isOfficeBooking ? "Rental schedule" : "Event time"}</p>
                  </div>
                  {resourceError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold leading-5 text-rose-700">{resourceError}</p>}
                  {availability.loading && <p role="status" className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Checking availability…</p>}
                  {availability.error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold leading-5 text-rose-700">{availability.error}</p>}
                  {isOfficeBooking ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-5 text-slate-700">
                      <p className="font-bold">Existing rental period</p>
                      <p className="mt-1">{formatBookingDate(booking.date)}{booking.endDate ? ` – ${formatBookingDate(booking.endDate)}` : ""}</p>
                      <p className="mt-2 text-xs text-slate-500">The rental term, room, and company details remain unchanged. Choosing a new start date keeps the existing validated term.</p>
                    </div>
                  ) : (
                    <>
                      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="min-w-0 space-y-2">
                          <Label htmlFor="startTime" className="text-sm font-semibold">Start Time</Label>
                          <Select value={selectedStartTime} onValueChange={setStartTime} disabled={availability.loading || !scheduleOptions.length}>
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
                          <Select value={selectedEndTime} onValueChange={setEndTime} disabled={availability.loading || !scheduleOptions.length}>
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
                          <div><p className="text-[10px] font-black uppercase tracking-[0.14em] text-orange-900">Selected schedule</p><p className="mt-0.5 text-sm font-black text-orange-700">{readableTime(selectedStartTime)} – {readableTime(selectedEndTime)}</p></div>
                        </div>
                      )}
                    </>
                  )}
                  {showScheduleAvailabilityMessage && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900">The proposed schedule is not available. Choose another date or time.</p>}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="shrink-0 border-t border-slate-200 px-4 py-3 sm:px-6">
          {step === "details" ? (
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" disabled={isSaving} className="h-11 w-full rounded-lg px-4 sm:w-auto" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="brand" disabled={isSaving || !eventName.trim()} className="h-11 w-full rounded-lg px-4 sm:w-auto" onClick={() => {
                if (!eventName.trim()) { setValidationMessage("Please provide an event name."); return }
                setValidationMessage(null)
                setStep("schedule")
              }}>
                Continue
              </Button>
            </div>
          ) : (
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="outline" disabled={isSaving} className="h-11 w-full rounded-lg px-4 sm:w-auto" onClick={() => { setValidationMessage(null); setStep("details") }}>
                <ArrowLeft className="size-4" aria-hidden="true" /> Back
              </Button>
              <Button variant="brand" disabled={isSaving || !hasChanges || !scheduleSelectionValid || !selectedDate} aria-busy={isSaving} className="h-11 w-full rounded-lg px-4 sm:w-auto" onClick={handleSave}>
                {isSaving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
