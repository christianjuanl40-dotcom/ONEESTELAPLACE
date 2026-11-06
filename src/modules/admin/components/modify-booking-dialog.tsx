"use client"

import { useEffect, useState } from "react"
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
import { Textarea } from "@/src/modules/shared/components/ui/textarea"
import { Calendar } from "@/src/modules/shared/components/ui/calendar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/modules/shared/components/ui/tabs"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { type Booking } from "@/src/modules/client/contexts/booking-context"
import { isOfficeResourceBooking } from "@/src/modules/shared/lib/resource-identity"

interface ModifyBookingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  booking: Booking
  onSave: (updatedBooking: Booking) => void
  isSaving?: boolean
  saveError?: string | null
  onCloseAutoFocus?: (event: Event) => void
}

export function ModifyBookingDialog({ open, onOpenChange, booking, onSave, isSaving = false, saveError, onCloseAutoFocus }: ModifyBookingDialogProps) {
  const { toast } = useToast()
  const [validationMessage, setValidationMessage] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(booking?.date ? new Date(`${booking.date}T00:00:00`) : undefined)
  const [bookingData, setBookingData] = useState({
    eventName: booking?.eventName || "",
    companyName: booking?.companyName || booking?.eventName || "",
    natureOfBusiness: booking?.natureOfBusiness || booking?.eventType || "",
    guestCount: booking?.guestCount?.toString() || "",
    startTime: booking?.startTime || "",
    endTime: booking?.endTime || "",
    rentalTerm: booking?.officeRentalTerm || booking?.rentalTerm || booking?.contractTerm || "6_months",
    specialRequests: booking?.specialRequests || "",
  })

  const isOfficeBooking = isOfficeResourceBooking(booking as unknown as Record<string, unknown>)

  useEffect(() => {
    if (!open) return
    setValidationMessage(null)
    setSelectedDate(booking?.date ? new Date(`${booking.date}T00:00:00`) : undefined)
    setBookingData({
      eventName: booking?.eventName || "",
      companyName: booking?.companyName || booking?.eventName || "",
      natureOfBusiness: booking?.natureOfBusiness || booking?.eventType || "",
      guestCount: booking?.guestCount?.toString() || "",
      startTime: booking?.startTime || "",
      endTime: booking?.endTime || "",
      rentalTerm: booking?.officeRentalTerm || booking?.rentalTerm || booking?.contractTerm || "6_months",
      specialRequests: booking?.specialRequests || "",
    })
  }, [booking, open])

  const availableTimes = [
    "9:00 AM",
    "10:00 AM",
    "11:00 AM",
    "12:00 PM",
    "1:00 PM",
    "2:00 PM",
    "3:00 PM",
    "4:00 PM",
    "5:00 PM",
    "6:00 PM",
    "7:00 PM",
    "8:00 PM",
  ]

  const handleSaveChanges = () => {
    if (!selectedDate) {
      setValidationMessage("Please select an event date")
      toast({
        title: "Date required",
        description: "Please select an event date",
        variant: "destructive",
      })
      return
    }

    if (isOfficeBooking && (!bookingData.companyName.trim() || !bookingData.natureOfBusiness.trim())) {
      setValidationMessage("Please provide the company/tenant name and nature of business.")
      toast({
        title: "Tenant details required",
        description: "Please provide the company/tenant name and nature of business.",
        variant: "destructive",
      })
      return
    }

    const guestCount = Number.parseInt(bookingData.guestCount, 10)
    if (!isOfficeBooking && (!Number.isInteger(guestCount) || guestCount < 1)) {
      setValidationMessage("Please enter at least one expected guest.")
      toast({
        title: "Guest count required",
        description: "Please enter at least one expected guest.",
        variant: "destructive",
      })
      return
    }

    const dateValue = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`

    const updatedBooking = {
      ...booking,
      eventName: isOfficeBooking ? bookingData.companyName : bookingData.eventName,
      ...(isOfficeBooking ? {
        companyName: bookingData.companyName,
        natureOfBusiness: bookingData.natureOfBusiness,
        eventType: bookingData.natureOfBusiness,
        officeRentalTerm: bookingData.rentalTerm as Booking["officeRentalTerm"],
        rentalTerm: bookingData.rentalTerm,
        contractTerm: bookingData.rentalTerm,
      } : {
        guestCount,
      }),
      date: dateValue,
      ...(isOfficeBooking ? {} : {
        startTime: bookingData.startTime,
        endTime: bookingData.endTime,
      }),
      specialRequests: bookingData.specialRequests,
      modifiedAt: new Date().toISOString(),
    }

    setValidationMessage(null)
    onSave(updatedBooking)
  }

  // Check if the booking date is within 10 days (for rescheduling policy)
  const isWithin10Days = booking
    ? (new Date(booking.date).getTime() - new Date().getTime()) / (1000 * 3600 * 24) <= 10
    : false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus} className="w-[calc(100vw-2rem)] max-w-2xl max-h-[calc(100dvh-2rem)] rounded-2xl p-0">
        <DialogHeader className="shrink-0 border-b border-slate-200 px-4 py-4 pr-14 text-left sm:px-6 sm:pr-14">
          <DialogTitle className="text-lg leading-6">Modify Booking</DialogTitle>
          <DialogDescription className="text-sm text-slate-600">Update the booking details.</DialogDescription>
        </DialogHeader>

        <div data-modify-booking-body className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
        {(saveError || validationMessage) && (
          <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-5 text-rose-700">{saveError || validationMessage}</p>
        )}
        {isWithin10Days && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm leading-5 text-amber-800">
              Note: Your {isOfficeBooking ? "rental start date" : "event"} is within 10 days. Changes may incur additional fees and are subject to approval.
            </p>
          </div>
        )}

        <Tabs defaultValue="details" className="min-w-0 w-full">
          <TabsList className="grid h-11 w-full grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
            <TabsTrigger className="h-9 min-w-0 rounded-md px-2 text-sm focus-visible:ring-orange-600 data-[state=active]:bg-white data-[state=active]:text-orange-700 data-[state=active]:shadow-sm" value="details">{isOfficeBooking ? "Tenant Details" : "Event Details"}</TabsTrigger>
            <TabsTrigger className="h-9 min-w-0 rounded-md px-2 text-sm focus-visible:ring-orange-600 data-[state=active]:bg-white data-[state=active]:text-orange-700 data-[state=active]:shadow-sm" value="datetime">{isOfficeBooking ? "Rental Dates" : "Date & Time"}</TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="mt-5 min-w-0 space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={isOfficeBooking ? "companyName" : "eventName"} className="text-sm font-semibold">
                    {isOfficeBooking ? "Company / Tenant Name" : "Event Name"}
                  </Label>
                  <Input
                    id={isOfficeBooking ? "companyName" : "eventName"}
                    placeholder={isOfficeBooking ? "Enter company or tenant name" : "Enter event name"}
                    value={isOfficeBooking ? bookingData.companyName : bookingData.eventName}
                    onChange={(e) => setBookingData({
                      ...bookingData,
                      ...(isOfficeBooking ? { companyName: e.target.value } : { eventName: e.target.value }),
                    })}
                    required
                    className="h-11 min-w-0 w-full rounded-lg px-3"
                  />
                </div>
                {isOfficeBooking ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="natureOfBusiness" className="text-sm font-semibold">Nature of Business</Label>
                      <Input
                        id="natureOfBusiness"
                        placeholder="Enter nature of business"
                        value={bookingData.natureOfBusiness}
                        onChange={(e) => setBookingData({ ...bookingData, natureOfBusiness: e.target.value })}
                        required
                        className="h-11 min-w-0 w-full rounded-lg px-3"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rentalTerm" className="text-sm font-semibold">Rental Term</Label>
                      <Select
                        value={bookingData.rentalTerm}
                        onValueChange={(value) => setBookingData({ ...bookingData, rentalTerm: value })}
                      >
                        <SelectTrigger id="rentalTerm" className="min-w-0 w-full rounded-lg px-3 data-[size=default]:h-11">
                          <SelectValue placeholder="Select rental term" />
                        </SelectTrigger>
                        <SelectContent className="z-[10003] max-h-[min(18rem,var(--radix-select-content-available-height))]">
                          <SelectItem value="6_months">6 Months</SelectItem>
                          <SelectItem value="1_year">1 Year</SelectItem>
                          <SelectItem value="2_years">2 Years</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="guestCount" className="text-sm font-semibold">Expected Guests</Label>
                    <Input
                      id="guestCount"
                      type="number"
                      min={1}
                      placeholder="Number of guests"
                      value={bookingData.guestCount}
                      onChange={(e) => setBookingData({ ...bookingData, guestCount: e.target.value })}
                      required
                      className="h-11 min-w-0 w-full rounded-lg px-3"
                    />
                  </div>
                )}
                <div className="space-y-2">
                <Label htmlFor="specialRequests" className="text-sm font-semibold">Special Requests</Label>
                <Textarea
                  id="specialRequests"
                  placeholder="Any special requirements, decorations, catering preferences, etc."
                  value={bookingData.specialRequests}
                  onChange={(e) => setBookingData({ ...bookingData, specialRequests: e.target.value })}
                  className="min-h-24 min-w-0 w-full rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
          </TabsContent>
          <TabsContent value="datetime" className="mt-5 min-w-0 space-y-4">
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <p id="modify-date-label" className="text-sm font-semibold">Select Date</p>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  disabled={(date) => date < new Date()}
                  aria-labelledby="modify-date-label"
                  defaultMonth={selectedDate}
                  className="w-full min-w-0 rounded-lg border border-slate-200 p-2"
                />
              </div>
              <div className="min-w-0 space-y-4">
                {!isOfficeBooking && <>
                  <div className="space-y-2">
                  <Label htmlFor="startTime" className="text-sm font-semibold">Start Time</Label>
                  <Select
                    value={bookingData.startTime}
                    onValueChange={(value) => setBookingData({ ...bookingData, startTime: value })}
                  >
                    <SelectTrigger id="startTime" className="min-w-0 w-full rounded-lg px-3 data-[size=default]:h-11">
                      <SelectValue placeholder="Select start time">{bookingData.startTime || undefined}</SelectValue>
                    </SelectTrigger>
                    <SelectContent className="z-[10003] max-h-[min(18rem,var(--radix-select-content-available-height))]">
                      {availableTimes.map((time) => (
                        <SelectItem key={time} value={time}>
                          {time}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  </div>
                  <div className="space-y-2">
                  <Label htmlFor="endTime" className="text-sm font-semibold">End Time</Label>
                  <Select
                    value={bookingData.endTime}
                    onValueChange={(value) => setBookingData({ ...bookingData, endTime: value })}
                  >
                    <SelectTrigger id="endTime" className="min-w-0 w-full rounded-lg px-3 data-[size=default]:h-11">
                      <SelectValue placeholder="Select end time">{bookingData.endTime || undefined}</SelectValue>
                    </SelectTrigger>
                    <SelectContent className="z-[10003] max-h-[min(18rem,var(--radix-select-content-available-height))]">
                      {availableTimes.map((time) => (
                        <SelectItem key={time} value={time}>
                          {time}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  </div>
                </>}
                {isOfficeBooking && (
                  <div className="rounded-lg bg-blue-50 p-4">
                    <h4 className="mb-2 font-medium">Rental Schedule</h4>
                    <p className="text-sm text-slate-600">The end date is recalculated by the validated booking workflow from the selected rental term.</p>
                  </div>
                )}
                {selectedDate && (
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <h4 className="font-medium mb-2">Selected Date</h4>
                    <p className="text-sm text-gray-600">
                      {selectedDate.toLocaleDateString("en-US", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
        </div>

        <DialogFooter className="shrink-0 border-t border-slate-200 px-4 py-3 sm:px-6">
          <Button variant="outline" disabled={isSaving} className="h-11 w-full rounded-lg px-4 sm:w-auto" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" disabled={isSaving} aria-busy={isSaving} className="h-11 w-full rounded-lg px-4 sm:w-auto" onClick={handleSaveChanges}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
