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
}

export function ModifyBookingDialog({ open, onOpenChange, booking, onSave, isSaving = false }: ModifyBookingDialogProps) {
  const { toast } = useToast()
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
      toast({
        title: "Date required",
        description: "Please select an event date",
        variant: "destructive",
      })
      return
    }

    if (isOfficeBooking && (!bookingData.companyName.trim() || !bookingData.natureOfBusiness.trim())) {
      toast({
        title: "Tenant details required",
        description: "Please provide the company/tenant name and nature of business.",
        variant: "destructive",
      })
      return
    }

    const guestCount = Number.parseInt(bookingData.guestCount, 10)
    if (!isOfficeBooking && (!Number.isInteger(guestCount) || guestCount < 1)) {
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

    onSave(updatedBooking)
  }

  // Check if the booking date is within 10 days (for rescheduling policy)
  const isWithin10Days = booking
    ? (new Date(booking.date).getTime() - new Date().getTime()) / (1000 * 3600 * 24) <= 10
    : false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-2xl overflow-y-auto max-h-[90dvh] rounded-2xl">
        <DialogHeader>
          <DialogTitle>Modify Booking</DialogTitle>
          <DialogDescription>
            Update the details of your booking. Changes are subject to availability and venue policies.
          </DialogDescription>
        </DialogHeader>

        {isWithin10Days && (
          <div className="rounded-md bg-amber-50 p-4 mb-4">
            <p className="text-amber-800 font-medium">
              Note: Your {isOfficeBooking ? "rental start date" : "event"} is within 10 days. Changes may incur additional fees and are subject to approval.
            </p>
          </div>
        )}

        <Tabs defaultValue="details" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="details">{isOfficeBooking ? "Tenant Details" : "Event Details"}</TabsTrigger>
            <TabsTrigger value="datetime">{isOfficeBooking ? "Rental Dates" : "Date & Time"}</TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={isOfficeBooking ? "companyName" : "eventName"} className="text-[10px] font-black uppercase tracking-[0.2em]">
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
                    className="h-11 w-full"
                  />
                </div>
                {isOfficeBooking ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="natureOfBusiness" className="text-[10px] font-black uppercase tracking-[0.2em]">Nature of Business</Label>
                      <Input
                        id="natureOfBusiness"
                        placeholder="Enter nature of business"
                        value={bookingData.natureOfBusiness}
                        onChange={(e) => setBookingData({ ...bookingData, natureOfBusiness: e.target.value })}
                        required
                        className="h-11 w-full"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rentalTerm" className="text-[10px] font-black uppercase tracking-[0.2em]">Rental Term</Label>
                      <Select
                        value={bookingData.rentalTerm}
                        onValueChange={(value) => setBookingData({ ...bookingData, rentalTerm: value })}
                      >
                        <SelectTrigger id="rentalTerm" className="w-full">
                          <SelectValue placeholder="Select rental term" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="6_months">6 Months</SelectItem>
                          <SelectItem value="1_year">1 Year</SelectItem>
                          <SelectItem value="2_years">2 Years</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="guestCount" className="text-[10px] font-black uppercase tracking-[0.2em]">Expected Guests</Label>
                    <Input
                      id="guestCount"
                      type="number"
                      min={1}
                      placeholder="Number of guests"
                      value={bookingData.guestCount}
                      onChange={(e) => setBookingData({ ...bookingData, guestCount: e.target.value })}
                      required
                      className="h-11 w-full"
                    />
                  </div>
                )}
                <div className="space-y-2">
                <Label htmlFor="specialRequests" className="text-[10px] font-black uppercase tracking-[0.2em]">Special Requests</Label>
                <Textarea
                  id="specialRequests"
                  placeholder="Any special requirements, decorations, catering preferences, etc."
                  value={bookingData.specialRequests}
                  onChange={(e) => setBookingData({ ...bookingData, specialRequests: e.target.value })}
                />
              </div>
            </div>
          </TabsContent>
          <TabsContent value="datetime" className="space-y-4">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <Label className="text-[10px] font-black uppercase tracking-[0.2em]">Select Date</Label>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  disabled={(date) => date < new Date()}
                  className="rounded-md border"
                />
              </div>
              <div className="space-y-4">
                {!isOfficeBooking && <>
                  <div className="space-y-2">
                  <Label htmlFor="startTime" className="text-[10px] font-black uppercase tracking-[0.2em]">Start Time</Label>
                  <Select
                    value={bookingData.startTime}
                    onValueChange={(value) => setBookingData({ ...bookingData, startTime: value })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select start time" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTimes.map((time) => (
                        <SelectItem key={time} value={time}>
                          {time}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  </div>
                  <div className="space-y-2">
                  <Label htmlFor="endTime" className="text-[10px] font-black uppercase tracking-[0.2em]">End Time</Label>
                  <Select
                    value={bookingData.endTime}
                    onValueChange={(value) => setBookingData({ ...bookingData, endTime: value })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select end time" />
                    </SelectTrigger>
                    <SelectContent>
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

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={isSaving} className="w-full sm:w-auto h-11" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={isSaving} className="w-full sm:w-auto h-11" onClick={handleSaveChanges}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
