"use client"

import React, { useState, useEffect, useMemo } from "react"
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader, DialogTrigger } from "@/src/modules/shared/components/ui/dialog"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/modules/shared/components/ui/select"
import { Textarea } from "@/src/modules/shared/components/ui/textarea"
import { Checkbox } from "@/src/modules/shared/components/ui/checkbox"
import { Label } from "@/src/modules/shared/components/ui/label"
import { Clock, ChevronLeft, ChevronRight, ArrowRight, Loader2, Calendar as CalendarIcon, PartyPopper, CheckCircle2 } from "lucide-react"

import { VENUE_RESERVATION_TERMS } from "@/src/modules/shared/lib/policies"
import { useBookings } from "@/src/modules/client/contexts/booking-context"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useToast } from "@/src/modules/shared/hooks/use-toast"

interface ReserveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedVenueId: string
  onBackToVenues?: () => void
  editingBooking?: any | null 
  onSubmitSuccess?: (bookingData: any) => void 
}

export function ReserveDialog({ open, onOpenChange, selectedVenueId, onBackToVenues, editingBooking, onSubmitSuccess }: ReserveDialogProps) {
  const { bookings, maintenanceDates, addBooking } = useBookings()
  const { user } = useAuth()
  const { toast } = useToast()
  const allBookings = bookings || []
  const activeMaint = maintenanceDates || []

  const [step, setStep] = useState(1)
  
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    d.setDate(1)
    return d
  })

  const [date, setDate] = useState("")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  
  const [eventName, setEventName] = useState("")
  const [eventType, setEventType] = useState("") 
  const [guests, setGuests] = useState("")
  const [notes, setNotes] = useState("")
  const [agreed, setAgreed] = useState(false) 
  
  const [isSubmitting, setIsSubmitting] = useState(false)

  // CONFIGURATION NG ORAS AT RULES
  const OP_START = 8 // 8:00 AM Opening
  const OP_END = 22 // 10:00 PM Closing
  const FIXED_DURATION = 6 // Strict 6 hours duration
  const REQUIRED_GAP = 1 // 1 hour cleaning gap between events

  const minBookableDate = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    d.setHours(0,0,0,0)
    return d
  }, [])

  useEffect(() => {
    if (open) {
      if (editingBooking) {
        setStep(1) 
        try {
          const d = new Date(editingBooking.date)
          setDate(d.toISOString().split('T')[0])
          setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1))
        } catch { setDate("") }
        
        if (editingBooking.time) {
          const parts = editingBooking.time.includes('-') ? editingBooking.time.split('-') : editingBooking.time.split(/to/i)
          setStartTime(parseTimeStr(parts[0]).toString())
          setEndTime(parseTimeStr(parts[1]).toString())
        }
        setEventName(editingBooking.eventName || "")
        setEventType(editingBooking.eventType || "")
        setGuests(editingBooking.guests?.toString() || editingBooking.guestCount?.toString() || "150") 
        setNotes(editingBooking.specialRequests || editingBooking.notes || "")
        setAgreed(false)
      } else {
        setStep(1)
        setDate("")
        setStartTime("")
        setEndTime("")
        setEventName("")
        setEventType("")
        setGuests("")
        setNotes("")
        setAgreed(false)
        const d = new Date()
        d.setMonth(d.getMonth() + 1)
        d.setDate(1)
        setCalendarMonth(d)
      }
    }
  }, [open, editingBooking])

  const parseTimeStr = (timeStr: string) => {
    if (!timeStr) return 0;
    try {
      const cleanStr = timeStr.trim().toUpperCase()
      const isPM = cleanStr.includes('PM')
      const isAM = cleanStr.includes('AM')
      const timeMatch = cleanStr.match(/(\d{1,2}):(\d{2})/)
      if (!timeMatch) return 0
      let hours = parseInt(timeMatch[1], 10)
      let minutes = parseInt(timeMatch[2], 10)
      if (isPM && hours !== 12) hours += 12
      if (isAM && hours === 12) hours = 0
      return hours + (minutes / 60)
    } catch { return 0 }
  }

  const formatTime = (timeFloat: number) => {
    const h = Math.floor(timeFloat)
    const m = Math.round((timeFloat - h) * 60)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const displayH = h > 12 ? h - 12 : (h === 0 ? 12 : h)
    return `${displayH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`
  }

  const bookedIntervals = useMemo(() => {
    if (!date) return []
    const [sYear, sMonth, sDay] = date.split('-').map(Number);

    return allBookings
      .filter(b => {
        if (editingBooking && b.id === editingBooking.id) return false;
        const isConfirmed = ["approved", "confirmed", "completed", "pending", "verifying"].includes(b.status?.toLowerCase() || "")
        
        const bDateObj = new Date(b.date);
        const isSameDate = bDateObj.getFullYear() === sYear && 
                           bDateObj.getMonth() === sMonth - 1 && 
                           bDateObj.getDate() === sDay;

        return isConfirmed && isSameDate && b.time
      })
      .map(b => {
        const time = b.time ?? ""
        const parts = time.includes('-') ? time.split('-') : time.split(/to/i)
        // Isama yung 1-hour clearing gap sa logic ng conflict checker
        return { start: parseTimeStr(parts[0]), end: parseTimeStr(parts[1]) + REQUIRED_GAP }
      })
      .sort((a, b) => a.start - b.start)
  }, [date, allBookings, editingBooking])

  // STRICT 6-HOURS & COLLISION LOGIC
  const startTimeOptions = useMemo(() => {
    const options = []
    
    // Iikot tayo mula 8:00 AM hanggang 10:00 PM
    for (let t = OP_START; t < OP_END; t += 1) { 
      const potentialEnd = t + FIXED_DURATION
      
      // RULE 1: Lalagpas ba sa 10:00 PM ang event kung 6 hours?
      const exceedsOpHours = potentialEnd > OP_END
      
      // RULE 2: Babangga ba ito sa existing booking o sa cleaning gap nila?
      const isOverlapping = bookedIntervals.some(interval => {
        return (t < interval.end && potentialEnd > interval.start)
      })

      const isDisabled = exceedsOpHours || isOverlapping

      options.push({ value: t.toString(), label: formatTime(t), disabled: isDisabled })
    }
    return options
  }, [bookedIntervals])

  const handleStartTimeChange = (val: string) => {
    setStartTime(val)
    // Walang manual end time selection, laging +6 hours ang end time
    setEndTime((parseFloat(val) + FIXED_DURATION).toString())
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!user) {
      toast({ title: "Login Required", description: "Please login to book.", variant: "destructive" })
      return
    }

    if (activeMaint.some(m => m.endsWith(date) || m === date)) {
      toast({
        title: "Date Unavailable",
        description: "This space is under maintenance on the selected date. Please choose another date.",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)

    const timeString = `${formatTime(parseFloat(startTime))} - ${formatTime(parseFloat(endTime))}`;
    
    const venueMap: Record<string, string> = {
      "v1": "Conference Hall",
      "v2": "Garden Pavilion",
      "v3": "Grand Ballroom",
      "v4": "Rooftop Terrace",
      "o1": "Private Office A",
      "o2": "Co-working Space"
    };

    const bookingPayload = {
      userId: user.id,
      venueId: selectedVenueId || "v1",
      venue: venueMap[selectedVenueId] || "Conference Hall",
      eventName,
      eventType,
      guestCount: parseInt(guests),
      date: date,
      time: timeString,
      startTime: formatTime(parseFloat(startTime)),
      endTime: formatTime(parseFloat(endTime)),
      specialRequests: notes,
      status: editingBooking ? editingBooking.status : "pending",
      totalPrice: editingBooking?.totalPrice ?? 0,
      userInfo: {
        name: user.name,
        email: user.email,
        phone: "(555) 000-0000",
      },
    }

    try {
      if (editingBooking) {
         if (onSubmitSuccess) {
           onSubmitSuccess({ ...bookingPayload, id: editingBooking.id });
         }
      } else {
         await addBooking(bookingPayload);
         if (onSubmitSuccess) onSubmitSuccess(bookingPayload);
      }

      setIsSubmitting(false)
      onOpenChange(false)
      
      toast({
        title: editingBooking ? "Reservation Updated" : "Reservation Submitted",
        description: editingBooking ? "Modifications saved." : "Your booking is Pending. Secure it by paying first!",
      })
    } catch (error) {
      setIsSubmitting(false)
      toast({ title: "Error", description: "Failed to submit booking.", variant: "destructive" })
    }
  }

  const handlePrevMonth = () => {
    const prev = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1)
    if (prev >= new Date(minBookableDate.getFullYear(), minBookableDate.getMonth(), 1)) {
       setCalendarMonth(prev)
    }
  }
  const handleNextMonth = () => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))

  const year = calendarMonth.getFullYear()
  const month = calendarMonth.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDayOfMonth = new Date(year, month, 1).getDay()
  const emptySlots = Array.from({ length: firstDayOfMonth }).map((_, i) => null)
  const days = Array.from({ length: daysInMonth }).map((_, i) => i + 1)

  const getDayStatus = (d: number) => {
    const iterDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (activeMaint.some(m => m.endsWith(iterDateStr) || m === iterDateStr)) return "maintenance"

    const iterDate = new Date(year, month, d)
    if (iterDate < minBookableDate) return "past"

    const dayBookings = allBookings.filter(b => {
      if (!b.date) return false;
      const bDate = new Date(b.date);
      return bDate.getFullYear() === year && bDate.getMonth() === month && bDate.getDate() === d && ["approved", "confirmed", "completed", "pending", "verifying"].includes(b.status?.toLowerCase() || "");
    })
    
    if (dayBookings.length === 0) return "none"

    const intervals = dayBookings.map(b => {
      if (!b.time) return { start: 0, end: 0 };
      const parts = b.time.includes('-') ? b.time.split('-') : b.time.split(/to/i);
      return { start: parseTimeStr(parts[0]), end: parseTimeStr(parts[1]) + REQUIRED_GAP };
    }).filter(i => i.start !== i.end).sort((a, b) => a.start - b.start);

    let maxGap = 0; let currentTime = OP_START;
    for (const interval of intervals) {
      if (interval.start > currentTime) {
        const gap = interval.start - currentTime;
        if (gap > maxGap) maxGap = gap;
      }
      if (interval.end > currentTime) currentTime = interval.end;
    }
    if (OP_END > currentTime) {
      const gap = OP_END - currentTime;
      if (gap > maxGap) maxGap = gap;
    }

    if (maxGap < FIXED_DURATION) return "full" 
    return "partial"
  }

  return (
    <Dialog open={open} onOpenChange={(val) => !isSubmitting && onOpenChange(val)}>
      <DialogContent className="sm:max-w-[900px] w-[95vw] p-0 bg-white rounded-[2rem] border-none shadow-2xl overflow-visible">
        
        <DialogTitle className="sr-only">Reservation Details</DialogTitle>
        <DialogDescription className="sr-only">Form to select date, time, and provide event details.</DialogDescription>

        <div className="flex flex-col md:flex-row min-h-[520px] overflow-x-hidden">
          {step === 1 ? (
            <>
              {/* --- LEFT ORANGE PANEL --- */}
              <div className="w-full md:w-[280px] bg-[#f97316] p-8 md:p-10 text-white shrink-0 flex flex-col justify-center relative overflow-hidden rounded-t-[2rem] md:rounded-l-[2rem] md:rounded-tr-none">
                <div className="relative z-10 flex flex-col h-full">
                  {onBackToVenues && (
                    <button onClick={onBackToVenues} className="text-white hover:text-orange-200 text-sm font-bold flex items-center mb-8 transition-colors w-fit">
                      <ChevronLeft className="w-4 h-4 mr-1" /> {editingBooking ? "Change Venue" : "Back"}
                    </button>
                  )}
                  <div className="mt-6 mb-auto">
                     <h2 className="text-4xl font-black tracking-tight mb-6 leading-tight break-words">Select<br/>Schedule</h2>
                    <p className="text-white/90 text-[15px] leading-relaxed">
                      Choose your preferred date and time. All events are fixed for <strong>6 Hours</strong>.
                    </p>
                  </div>
                </div>
              </div>

              {/* --- RIGHT WHITE PANEL (CALENDAR & TIME SIDE-BY-SIDE) --- */}
              <div className="flex-1 bg-white p-6 md:p-10 flex flex-col relative rounded-b-[2rem] md:rounded-r-[2rem] md:rounded-bl-none">
                
                <div className="flex flex-col md:flex-row gap-10 lg:gap-14 flex-1 items-start mt-4">
                  
                  {/* CALENDAR COLUMN */}
                  <div className="flex-1 min-w-[260px] flex flex-col">
                    <div className="flex items-center justify-between mb-6 px-2">
                      <button onClick={handlePrevMonth} className="text-slate-400 hover:text-slate-900 transition-colors">
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <div className="text-center">
                        <h3 className="font-bold text-slate-900 text-[15px] leading-snug whitespace-nowrap">
                          {calendarMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
                        </h3>
                      </div>
                      <button onClick={handleNextMonth} className="text-slate-400 hover:text-slate-900 transition-colors">
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-7 gap-x-1 gap-y-3 text-center mb-6">
                      {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => (
                        <div key={day} className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">{day}</div>
                      ))}
                      {emptySlots.map((_, i) => <div key={`empty-${i}`} className="aspect-square" />)}
                      {days.map((day) => {
                        const status = getDayStatus(day)
                        const iterDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                        const isSelected = date === iterDateStr
                        const isPast = status === "past"
                        const isMaintenance = status === "maintenance"
                        const isFull = status === "full" || isMaintenance

                        return (
                          <div key={day} className="flex justify-center items-center h-9">
                            <button 
                              disabled={isPast || isFull}
                              onClick={() => {
                                setDate(iterDateStr)
                                setStartTime("")
                                setEndTime("")
                              }}
                              className={`w-9 h-9 flex items-center justify-center text-[13px] font-bold rounded-full transition-all relative
                                ${isPast || isFull ? 'text-slate-300 cursor-not-allowed opacity-50' : 'text-slate-700 hover:bg-orange-50 hover:text-[#ea580c]'}
                                ${isSelected ? 'bg-[#0f172a] text-white shadow-md' : ''}
                              `}
                            >
                              {day}
                              {!isSelected && isMaintenance && <div className="absolute bottom-1 w-1 h-1 bg-slate-900 rounded-full"></div>}
                              {!isSelected && isFull && !isMaintenance && !isPast && <div className="absolute bottom-1 w-1 h-1 bg-rose-500 rounded-full"></div>}
                              {!isSelected && status === "partial" && !isPast && <div className="absolute bottom-1 w-1 h-1 bg-[#eab308] rounded-full"></div>}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                    
                    {/* FLAT LEGEND */}
                    <div className="mt-auto flex flex-wrap items-center justify-center gap-4 text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em] border-t border-slate-100 pt-4">
                      <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-rose-500 rounded-full"/> Full</span>
                      <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-[#eab308] rounded-full"/> Partial</span>
                      <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-slate-900 rounded-full"/> Maint</span>
                    </div>
                  </div>

                  {/* EVENT TIME COLUMN */}
                  <div className="w-full md:w-[240px] flex flex-col h-full shrink-0 border-t md:border-t-0 md:border-l border-slate-100 md:pl-8 pt-6 md:pt-0">
                    <div className="flex items-center gap-2 mb-6">
                      <Clock className="w-4 h-4 text-[#ea580c]" />
                      <h3 className="font-black text-slate-900 text-sm uppercase tracking-[0.2em]">Event Time</h3>
                    </div>
                    
                    <div className="space-y-5">
                      <div className="space-y-2">
                         <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Select Start Time</label>
                        <Select value={startTime} onValueChange={handleStartTimeChange} disabled={!date}>
                          <SelectTrigger className="bg-white border-slate-200 rounded-2xl h-11 w-full focus:ring-[#ea580c] text-sm shadow-sm">
                            <SelectValue placeholder={date ? "Choose start time" : "Select date first"} />
                          </SelectTrigger>
                          {/* FIX: position="popper" with high z-index para hindi makulong sa modal! */}
                          <SelectContent position="popper" sideOffset={4} className="rounded-xl max-h-[250px] z-[99999] w-[var(--radix-select-trigger-width)] bg-white shadow-xl">
                            {startTimeOptions.map(opt => (
                              <SelectItem 
                                key={opt.value} 
                                value={opt.value} 
                                disabled={opt.disabled} 
                                // Makikita agad na bawal i-click at naka-gray out
                                className={opt.disabled ? "opacity-40 line-through text-slate-400 cursor-not-allowed" : "font-bold text-slate-700"}
                              >
                                {opt.label} {opt.disabled && "- Unavailable"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      
                      {/* Read-only End Time na nag-a-auto compute */}
                      {startTime && endTime && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                           <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Computed End Time</label>
                           <div className="h-11 bg-slate-50 border border-slate-200 rounded-2xl flex items-center px-4 text-sm font-bold text-slate-700 shadow-inner">
                            {formatTime(parseFloat(endTime))}
                          </div>
                          <div className="bg-emerald-50 text-emerald-700 p-2.5 mt-2 rounded-xl flex items-center justify-center text-xs font-bold border border-emerald-100">
                            <CheckCircle2 className="w-4 h-4 mr-1.5" /> 6 Hours Standard Duration
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-auto pt-6">
                      <Button 
                        disabled={!date || !startTime || !endTime} 
                        onClick={() => setStep(2)}
                        className="w-full sm:w-auto h-14 rounded-2xl bg-[#fca5a5] opacity-80 hover:opacity-100 text-white font-bold text-[15px] shadow-sm transition-transform active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-400 disabled:opacity-50"
                        style={{ backgroundColor: (date && startTime && endTime) ? '#ea580c' : undefined }}
                      >
                        Continue to Details <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </div>
                  </div>

                </div>
              </div>
            </>
          ) : (
            
          /* ============================================================== */
          /* STEP 2: SUMMARY & COMPACT FORM DETAILS WITH TERMS              */
          /* ============================================================== */
            <>
              {/* LEFT: LIGHT ORANGE BOOKING SUMMARY */}
              <div className="w-full md:w-[280px] bg-[#f97316] p-8 md:p-10 text-white shrink-0 flex flex-col justify-center relative overflow-hidden rounded-t-[2rem] md:rounded-l-[2rem] md:rounded-tr-none">
                <div className="relative z-10 flex flex-col h-full">
                  <button onClick={() => setStep(1)} className="text-white hover:text-orange-200 text-sm font-bold flex items-center mb-8 transition-colors w-fit">
                    <ChevronLeft className="w-4 h-4 mr-1" /> Back
                  </button>
                  
                  <div className="mt-6 mb-auto">
                     <h2 className="text-3xl font-black tracking-tight mb-10 leading-tight break-words">Booking<br/>Summary</h2>

                    <div className="space-y-10">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-full border border-white/30 flex items-center justify-center shrink-0">
                          <CalendarIcon className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-white/80 uppercase tracking-[0.2em] mb-1">Selected Date</p>
                          <p className="font-bold text-lg">{date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ""}</p>
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-full border border-white/30 flex items-center justify-center shrink-0">
                          <Clock className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-white/80 uppercase tracking-[0.2em] mb-1">Time & Duration</p>
                          <p className="font-bold text-lg leading-snug">{startTime ? formatTime(parseFloat(startTime)) : ""} -<br/>{endTime ? formatTime(parseFloat(endTime)) : ""}</p>
                          <p className="text-sm text-white/90 mt-1">6 Hours (Fixed)</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT: COMPACT WHITE FORM DETAILS */}
              <div className="flex-1 bg-white p-6 md:p-8 flex flex-col justify-center relative overflow-y-auto max-h-[90vh] rounded-b-[2rem] md:rounded-r-[2rem] md:rounded-bl-none">
                
                <div className="w-full max-w-[500px] mx-auto animate-in slide-in-from-right-8">
                  <div className="mb-5">
                      <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2 break-words">
                        <PartyPopper className="w-6 h-6 text-[#f97316]" /> Event Details
                     </h2>
                     <p className="text-xs text-slate-500 mt-1">Fill out your information to complete the request.</p>
                  </div>
                  
                  <form onSubmit={handleSubmit} className="space-y-4">
                     
                     <div className="space-y-1.5">
                         <label className="text-[10px] font-black block uppercase tracking-[0.2em] text-slate-700">Event Name *</label>
                         <Input required value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g. 18th Birthday Party" className="bg-slate-50 border-slate-200 h-11 w-full rounded-lg px-4 text-xs focus-visible:ring-[#f97316] shadow-sm" />
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div className="space-y-1.5">
                           <label className="text-[10px] font-black block uppercase tracking-[0.2em] text-slate-700">Event Type *</label>
                           <Select value={eventType} onValueChange={setEventType} required>
                             <SelectTrigger className="bg-slate-50 border-slate-200 h-11 w-full rounded-lg px-4 text-xs focus-visible:ring-[#f97316] shadow-sm">
                              <SelectValue placeholder="Choose Event Type" />
                            </SelectTrigger>
                            <SelectContent className="rounded-lg text-xs z-[99999]">
                              <SelectItem value="wedding">Wedding</SelectItem>
                              <SelectItem value="birthday">Birthday / Debut</SelectItem>
                              <SelectItem value="corporate">Corporate Event</SelectItem>
                              <SelectItem value="seminar">Seminar / Workshop</SelectItem>
                              <SelectItem value="other">Other Event</SelectItem>
                            </SelectContent>
                          </Select>
                       </div>
                       <div className="space-y-1.5">
                           <label className="text-[10px] font-black block uppercase tracking-[0.2em] text-slate-700">Estimated Guests *</label>
                           <Input required type="number" value={guests} onChange={e => setGuests(e.target.value)} placeholder="Max 250" className="bg-slate-50 border-slate-200 h-11 w-full rounded-lg px-4 text-xs focus-visible:ring-[#f97316] shadow-sm" />
                       </div>
                     </div>
                     
                     <div className="space-y-1.5">
                         <label className="text-[10px] font-black block uppercase tracking-[0.2em] text-slate-700">Special Requests / Notes</label>
                        <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Tell us more about your event layout, catering needs, etc." className="bg-slate-50 border-slate-200 min-h-[60px] resize-none rounded-lg p-3 text-xs focus-visible:ring-[#f97316] shadow-sm w-full break-words" />
                     </div>

                     <div className="flex items-start space-x-2 py-2 mt-1 border-t border-slate-100 pt-3">
                        <Checkbox id="terms" checked={agreed} onCheckedChange={(c) => setAgreed(c as boolean)} className="mt-0.5 data-[state=checked]:bg-[#ea580c] data-[state=checked]:border-[#ea580c]" />
                        <div className="grid gap-1 leading-none">
                          <Label htmlFor="terms" className="text-xs font-medium leading-relaxed cursor-pointer text-slate-700">
                            I agree to the{" "}
                            <Dialog>
                              <DialogTrigger asChild>
                                <button type="button" className="text-[#ea580c] font-bold underline hover:text-[#c2410c]">
                                  Terms and Conditions
                                </button>
                              </DialogTrigger>
                               <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[90dvh] overflow-y-auto flex flex-col bg-white rounded-[2rem] z-[99999]">
                                <DialogHeader>
                                  <DialogTitle className="text-2xl font-black">Venue Booking Terms and Conditions</DialogTitle>
                                </DialogHeader>
                                <div className="flex-1 overflow-y-auto p-6 bg-slate-50 rounded-2xl text-sm text-slate-700 border border-slate-100 mt-2">
                                  {VENUE_RESERVATION_TERMS.map((term, i) => (
                                    <p key={i} className="mb-4 last:mb-0 leading-relaxed">
                                      <strong>{i + 1}. </strong>
                                      {term}
                                    </p>
                                  ))}
                                </div>
                              </DialogContent>
                            </Dialog>
                          </Label>
                          <p className="text-[10px] text-slate-400 mt-0.5">You must agree to the policies before proceeding.</p>
                        </div>
                     </div>
                     
                      <div className="pt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                         <Button type="submit" disabled={isSubmitting || !eventName || !eventType || !guests || !agreed} className="w-full sm:w-auto h-11 rounded-lg bg-[#ea580c] hover:bg-[#c2410c] text-white font-bold text-sm shadow-sm transition-transform active:scale-[0.98] disabled:opacity-50 disabled:bg-slate-300">
                          {isSubmitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing...</> : (editingBooking ? "Save Changes" : "Confirm Reservation")}
                        </Button>
                     </div>
                  </form>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}