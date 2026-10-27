"use client"

import React, { useEffect, useState, useMemo, useRef } from "react"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useRouter } from "next/navigation"
import { useBookingData, Booking, calculateOfficeEndDate, type BookingStatus, type BookingStatusLabel, type PaymentStatus, type ContractStatus, type CancellationStatus, type RefundStatus, type OfficeRentalTerm } from "@/src/modules/client/contexts/booking-context"
import { 
  Building2, Tent, Calendar, Clock, MapPin, Users, AlertCircle, Plus, Receipt, ChevronLeft, ChevronRight, ChevronDown, CheckCircle2, XCircle, ArrowLeft, X, DoorOpen, PartyPopper, PlayCircle, PauseCircle, Navigation, Loader2, Star, MessageSquare, Briefcase, FileText, Camera
} from "lucide-react"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/src/modules/shared/components/ui/collapsible"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/src/modules/shared/components/ui/dialog"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/modules/shared/components/ui/select"
import { Label } from "@/src/modules/shared/components/ui/label"
import { Textarea } from "@/src/modules/shared/components/ui/textarea"
import { Checkbox } from "@/src/modules/shared/components/ui/checkbox"
import { cn } from "@/src/modules/shared/lib/utils"
import { getPolicyItems } from "@/src/modules/shared/lib/policies"
import { useCMS } from "@/src/modules/admin/contexts/cms-context"
import { getPublicSpacesFromData, getPanoramaSource } from "@/src/modules/client/lib/venue-data"
import { getDetailedDescription } from "@/src/modules/shared/lib/space-description"
import { isCatalogUnderRenovation } from "@/src/modules/shared/lib/catalog-status"
import { useSpaceAvailability } from "@/src/modules/shared/hooks/use-space-availability"
import { useOfficeRoomAvailability } from "@/src/modules/shared/hooks/use-office-room-availability"
import { getAvailabilityDataKey } from "@/src/modules/shared/lib/availability-read-fields"
import { addAvailabilityDays, getMinimumBookingDate, MAX_OFFICE_SEARCH_DAYS, type AvailabilitySpace } from "@/src/modules/shared/lib/availability"
import { db } from "@/lib/firebase"
import { collection, query, where, getDocs, orderBy } from "firebase/firestore"

declare global { interface Window { pannellum?: any; } }

type StoredVenueReview = {
  id: string
  bookingId: string
  eventId?: string
  eventName: string
  venue?: string
  customerName?: string
  rating: number
  comment: string
  createdAt: string
}

const REVIEW_STORAGE_KEY = "oneestela_event_reviews_v1"
const REVIEW_EVENT_NAME = "oneestela_reviews_updated"

const reviewsRef = collection(db, "reviews")

function normalizeReviewValue(value?: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

async function loadVenueReviews(): Promise<StoredVenueReview[]> {
  try {
    const snapshot = await getDocs(query(reviewsRef, orderBy("createdAt", "desc")))
    const result: StoredVenueReview[] = []
    snapshot.forEach((docSnap) => {
      const data = docSnap.data()
      result.push({
        id: docSnap.id,
        bookingId: data.bookingId || "",
        eventId: data.eventId || "",
        eventName: data.eventName || "",
        venue: data.venue || "",
        customerName: data.customerName || "",
        rating: data.rating || 5,
        comment: data.comment || "",
        createdAt: data.createdAt || new Date().toISOString(),
      })
    })
    return result
  } catch {
    return []
  }
}

function getReviewsForVenue(reviews: StoredVenueReview[], venueName: string) {
  const selectedVenue = normalizeReviewValue(venueName)

  if (!selectedVenue) return []

  return reviews.filter((review) => {
    const reviewVenue = normalizeReviewValue(review.venue)
    const reviewEventName = normalizeReviewValue(review.eventName)

    return (
      reviewVenue === selectedVenue ||
      reviewVenue.includes(selectedVenue) ||
      selectedVenue.includes(reviewVenue) ||
      reviewEventName === selectedVenue ||
      reviewEventName.includes(selectedVenue) ||
      selectedVenue.includes(reviewEventName)
    )
  })
}

function formatReviewDate(date: string) {
  const parsed = new Date(date)

  if (Number.isNaN(parsed.getTime())) return date

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(parsed)
}

function useVenueReviews(venueName: string) {
  const [reviews, setReviews] = useState<StoredVenueReview[]>([])

  useEffect(() => {
    loadVenueReviews().then(setReviews)
  }, [])

  const venueReviews = useMemo(() => {
    return getReviewsForVenue(reviews, venueName)
  }, [reviews, venueName])

  const averageRating = useMemo(() => {
    if (venueReviews.length === 0) return 0

    return (
      venueReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) /
      venueReviews.length
    )
  }, [venueReviews])

  return { venueReviews, averageRating }
}

function VenueRatingBadge({ venueName }: { venueName: string }) {
  const { venueReviews, averageRating } = useVenueReviews(venueName)

  return (
    <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-md px-2.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm">
      <Star className="w-3.5 h-3.5 fill-[#ea580c] text-[#ea580c]" />
      <span className="text-slate-900 text-[10px] font-black tracking-[0.2em]">
        {venueReviews.length > 0 ? averageRating.toFixed(1) : "0.0"}
      </span>
      <span className="text-slate-400 text-[9px] font-black tracking-[0.2em]">
        ({venueReviews.length})
      </span>
    </div>
  )
}

function VenueReviewsDialog({
  venueName,
  children,
}: {
  venueName: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const { venueReviews, averageRating } = useVenueReviews(venueName)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent aria-describedby={undefined} showCloseButton={false} className="w-[95vw] overflow-hidden rounded-2xl border-slate-200 bg-white p-0 shadow-xl sm:max-w-lg">
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="shrink-0 flex items-start justify-between border-b border-slate-100 p-5">
            <div>
              <DialogTitle className="text-xl font-black text-slate-950">
                Venue Reviews
              </DialogTitle>

              <p className="mt-1 text-sm font-semibold text-slate-500">
                Reviews for <span className="text-[#ea580c]">{venueName}</span>
              </p>
            </div>

            <button
              type="button"
              aria-label="Close venue reviews"
              onClick={() => setOpen(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-rose-50 hover:text-rose-500 outline-none focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mb-5 flex items-center justify-between rounded-2xl bg-orange-50 p-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#ea580c]">
                  Average Rating
                </p>

                <p className="mt-1 text-2xl font-black text-orange-700">
                  {venueReviews.length > 0 ? averageRating.toFixed(1) : "0.0"}
                </p>

                <p className="mt-1 text-xs font-bold text-orange-500">
                  {venueReviews.length} review{venueReviews.length === 1 ? "" : "s"}
                </p>
              </div>

              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <Star
                    key={value}
                    className={`h-5 w-5 ${
                      value <= Math.round(averageRating)
                        ? "fill-[#ea580c] text-[#ea580c]"
                        : "text-orange-200"
                    }`}
                  />
                ))}
              </div>
            </div>

            {venueReviews.length > 0 ? (
              <div className="space-y-3">
                {venueReviews.map((review) => (
                  <div
                    key={review.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4"
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-slate-950">
                          {review.customerName || "Customer"}
                        </p>

                        <p className="text-xs font-semibold text-slate-400">
                          {formatReviewDate(review.createdAt)}
                        </p>
                      </div>

                      <div className="flex shrink-0 gap-0.5">
                        {[1, 2, 3, 4, 5].map((value) => (
                          <Star
                            key={value}
                            className={`h-4 w-4 ${
                              value <= Number(review.rating || 0)
                                ? "fill-[#ea580c] text-[#ea580c]"
                                : "text-slate-300"
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    <p className="text-sm font-medium leading-6 text-slate-600">
                      {review.comment}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <MessageSquare className="mx-auto mb-3 h-9 w-9 text-slate-300" />

                <p className="font-black text-slate-600">No reviews yet</p>

                <p className="mt-1 text-sm font-semibold text-slate-400">
                  Reviews from completed bookings will appear here.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BookingConfirmationDialog({
  open,
  payload,
  isOffice,
  isSubmitting,
  canConfirm,
  onEdit,
  onConfirm,
}: {
  open: boolean
  payload: any | null
  isOffice: boolean
  isSubmitting: boolean
  canConfirm: boolean
  onEdit: () => void
  onConfirm: () => void
}) {
  if (!payload) return null

  const contractTermLabel = String(payload.contractTerm || payload.rentalTerm || "")
    .replace("6_months", "6 Months")
    .replace("1_year", "1 Year")
    .replace("2_years", "2 Years")

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onEdit()}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] w-[95vw] sm:max-w-lg flex-col gap-0 overflow-hidden rounded-2xl border-slate-200 bg-white p-0 shadow-2xl [&>button]:hidden">
        <div className="shrink-0 border-b border-slate-100 px-5 py-4">
          <DialogTitle className="text-xl md:text-2xl font-black text-slate-950">
            Confirm Booking Details
          </DialogTitle>
          <p className="mt-1 text-xs md:text-sm font-semibold leading-5 md:leading-6 text-slate-500">
            Please double-check the selected details before submitting your booking request.
          </p>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto max-h-[90dvh] px-5 py-4">
          <ConfirmBookingLine label="Full Name" value={payload.userInfo?.name || "Client"} />
          <ConfirmBookingLine label={isOffice ? "Rental Type" : "Event Type"} value={isOffice ? "Office Space Rental" : payload.eventType} />
          <ConfirmBookingLine label="Selected Space" value={payload.venue} />
          <ConfirmBookingLine label="Booking Date" value={payload.date} />
          {isOffice ? (
            <ConfirmBookingLine label="Contract Term" value={contractTermLabel || "N/A"} />
          ) : (
            <ConfirmBookingLine label="Reservation Time" value={payload.time || `${payload.startTime} - ${payload.endTime}`} />
          )}
          <ConfirmBookingLine
            label={isOffice ? "Reservation Amount" : "Total Amount"}
            value={`₱${Number(payload.totalPrice || 0).toLocaleString("en-PH")}`}
          />
          <ConfirmBookingLine
            label="Payment Method"
            value={isOffice ? "Select on payment page - slot reservation only" : "Select on payment page"}
          />
          {!canConfirm && <p role="status" className="text-xs font-semibold text-rose-700">Please review the current space and availability before confirming.</p>}
        </div>

        <div className="shrink-0 flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end sm:gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onEdit}
            disabled={isSubmitting}
            className="h-12 w-full rounded-xl border-slate-200 font-black text-slate-700 sm:order-2 sm:w-1/2"
          >
            Go Back / Edit Details
          </Button>

          <Button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting || !canConfirm}
            className="h-12 w-full rounded-xl bg-orange-600 font-black text-white hover:bg-orange-700 sm:order-1 sm:w-1/2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Confirm Booking"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmBookingLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5 md:rounded-xl md:px-4 md:py-3">
      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black md:text-[10px]">{label}</p>
      <p className="max-w-[55%] break-words text-right text-xs font-bold text-slate-900">{value}</p>
    </div>
  )
}

function TermsList({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2">
      {items.map((item, index) => (
        <li
          key={index}
          className="flex gap-3 text-sm leading-6 text-slate-700"
        >
          <span className="shrink-0 font-bold text-[#ea580c]">{index + 1}.</span>
          <span className="font-semibold">{item}</span>
        </li>
      ))}
    </ol>
  )
}


type StepType = 'category' | 'list' | 'room' | 'schedule' | 'details' | 'success'

const OFFICE_RENTAL_TERMS: Record<string, OfficeRentalTerm> = {
  "6 Months": "6_months",
  "1 Year": "1_year",
  "2 Years": "2_years",
}

interface ReserveDialogProps {
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ReserveDialog({ children, open: controlledOpen, onOpenChange: setControlledOpen }: ReserveDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen
  const setIsOpen = setControlledOpen || setInternalOpen

  const { addBooking, bookings, maintenanceRecords, officeRentals } = useBookingData({ bookings: isOpen, maintenance: isOpen, officeRentals: isOpen })
  const { user } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  const { cmsData } = useCMS()

  const { eventVenues: VENUES, officeSpaces: OFFICE_BUILDINGS } = useMemo(
    () => getPublicSpacesFromData(cmsData),
    [cmsData]
  )

  const [step, setStep] = useState<StepType>('category') 
  const [category, setCategory] = useState<'venue' | 'office' | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const selectedItem = (category === "office" ? OFFICE_BUILDINGS : VENUES)
    .find((item) => item.id === selectedItemId) || null
  const [expandedSpaceKey, setExpandedSpaceKey] = useState<string | null>(null)
  const [scheduleDescriptionKey, setScheduleDescriptionKey] = useState<string | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const selectedRoom = selectedItem?.rooms?.find((room) => String(room.id) === selectedRoomId && !room.isArchived) || null
  const [roomPage, setRoomPage] = useState(1)
  const ROOMS_PER_PAGE = 8
  
  const minimumBookingDate = getMinimumBookingDate()
  const minBookableDate = new Date(`${minimumBookingDate}T00:00:00`)

  const [calendarMonth, setCalendarMonth] = useState(() => {
    const minDate = new Date(`${getMinimumBookingDate()}T00:00:00`);
    return new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  });

  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedDuration, setSelectedDuration] = useState<string | null>(null)
  const [officeSearchFrom, setOfficeSearchFrom] = useState("")
  const [selectionWarning, setSelectionWarning] = useState("")
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0)
  const positionedSearch = useRef("")
  const previousResource = useRef("")

  const [eventName, setEventName] = useState("")
  const [eventType, setEventType] = useState("") 
  const [customEventType, setCustomEventType] = useState("") 
  const [guests, setGuests] = useState<number | "">("")
  const [notes, setNotes] = useState("")
  const [agreed, setAgreed] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSubmittingRef = useRef(false)
  const [isBookingConfirmOpen, setIsBookingConfirmOpen] = useState(false)
  const [pendingBookingPayload, setPendingBookingPayload] = useState<any | null>(null)
  
  const [isTermsOpen, setIsTermsOpen] = useState(false)

  const [isAutoRotating, setIsAutoRotating] = useState(true)
  const [libLoaded, setLibLoaded] = useState(false)
  const [isViewerReady, setIsViewerReady] = useState(false)
  const [isDesktopPreview, setIsDesktopPreview] = useState(false)
  const viewerRef = useRef<any>(null)
  const autoRotateRef = useRef(true)

  const maxPax = useMemo(() => {
    if (!selectedItem?.capacity) return 100;
    const matches = selectedItem.capacity.match(/\d+/g);
    return matches ? Math.max(...matches.map(Number)) : 100;
  }, [selectedItem]);

  const isOffice = category === 'office';
  const selectedRentalTerm = isOffice ? OFFICE_RENTAL_TERMS[selectedDuration || ""] : undefined
  const selectedSpaceName = selectedRoom ? `${selectedItem?.name} - ${selectedRoom.name}` : selectedItem?.name

  const availabilitySpace = useMemo<AvailabilitySpace | null>(() => {
    if (!selectedItem?.id || isCatalogUnderRenovation(selectedItem) || !category || (category === "office" && (!selectedRoom?.id || !selectedRoomId))) return null
    return category === "office"
      ? {
          category: "office",
          venueId: String(selectedItem.id || ""),
          officeId: String(selectedItem.id || ""),
          spaceId: String(selectedRoom.id),
          name: String(selectedItem.name || ""),
          roomName: String(selectedRoom.name || ""),
        }
      : {
          category: "venue",
          venueId: String(selectedItem.id || ""),
          spaceId: String(selectedItem.id || ""),
          name: String(selectedItem.name || ""),
        }
  }, [category, selectedItem, selectedRoom, selectedRoomId])

  const searchFrom = officeSearchFrom > minimumBookingDate ? officeSearchFrom : minimumBookingDate
  const officeSearch = useMemo(() => isOffice && selectedRentalTerm
    ? { from: searchFrom, to: addAvailabilityDays(searchFrom, MAX_OFFICE_SEARCH_DAYS - 1) } : undefined,
  [isOffice, selectedRentalTerm, searchFrom])
  const availabilityDataKey = useMemo(() => getAvailabilityDataKey(bookings, maintenanceRecords, officeRentals), [bookings, maintenanceRecords, officeRentals])
  const availabilityRefreshKey = `${availabilityAttempt}:${availabilityDataKey}`
  const roomAvailability = useOfficeRoomAvailability(isOpen && isOffice, selectedItemId || "", availabilityRefreshKey)
  const selectedRoomIsAvailable = !isOffice || (!roomAvailability.loading && !roomAvailability.error
    && Boolean(selectedRoomId && roomAvailability.rooms[selectedRoomId] === "available"))
  const { days: availabilityDays, loading: scheduleAvailabilityLoading, error: scheduleAvailabilityError, officeSearch: officeSearchResult } = useSpaceAvailability(
    isOpen && (step === "schedule" || step === "details"), availabilitySpace, calendarMonth, "", selectedRentalTerm,
    availabilityRefreshKey, officeSearch,
  )
  const availabilityLoading = scheduleAvailabilityLoading || (isOffice && roomAvailability.loading)
  const availabilityError = scheduleAvailabilityError || (isOffice ? roomAvailability.error : null)
  const selectedDay = selectedDate ? availabilityDays[selectedDate] : undefined
  const selectedScheduleIsAvailable = Boolean(selectedRoomIsAvailable && availabilitySpace && selectedDate && selectedDate >= minimumBookingDate && selectedDuration && selectedDay && !availabilityLoading && !availabilityError
    && (isOffice ? selectedRentalTerm && selectedDay.status === "available" : selectedDay.availableSlots.some((slot) => slot.label === selectedDuration)))

  const resourceSelectionKey = JSON.stringify([category, selectedItemId, selectedRoomId])
  useEffect(() => {
    if (!isOffice || !selectedRoomId || roomAvailability.loading || roomAvailability.error) return
    const status = roomAvailability.rooms[selectedRoomId]
    if (status && status !== "available" && (step === "schedule" || step === "details")) {
      setSelectedDate(null)
      setSelectedRoomId(null)
      setIsBookingConfirmOpen(false)
      setPendingBookingPayload(null)
      setSelectionWarning("This room is now reserved, occupied, or unavailable. Please choose another available room.")
      setStep("room")
    }
  }, [isOffice, selectedRoomId, roomAvailability, step])
  useEffect(() => {
    if (previousResource.current === resourceSelectionKey) return
    previousResource.current = resourceSelectionKey
    if (selectedDate) setSelectionWarning("The selected space changed. Your previous start date was cleared; choose a date for this room.")
    setSelectedDate(null)
    setSelectedDuration(category === "office" ? "6 Months" : null)
    setOfficeSearchFrom("")
    positionedSearch.current = ""
  }, [category, resourceSelectionKey, selectedDate])

  useEffect(() => {
    if (!selectedDate || availabilityLoading || availabilityError || !selectedDay) return
    if (isOffice && (selectedDay.status !== "available" || selectedDate < minimumBookingDate)) {
      setSelectedDate(null)
      positionedSearch.current = ""
      setSelectionWarning(selectedDate < minimumBookingDate
        ? "Your start date no longer satisfies the minimum booking notice. Please choose another date."
        : "Your previous start date was cleared because the full rental term overlaps a reservation or maintenance. Choose another start date or duration.")
    } else if (!isOffice && selectedDuration && !selectedScheduleIsAvailable) setSelectedDuration(null)
  }, [isOffice, selectedDate, selectedDuration, selectedDay, availabilityLoading, availabilityError, selectedScheduleIsAvailable, minimumBookingDate])

  const officeSearchKey = JSON.stringify([isOpen, resourceSelectionKey, selectedRentalTerm, searchFrom])
  useEffect(() => {
    if (!isOffice || availabilityLoading || availabilityError || !officeSearchResult) return
    const positionKey = JSON.stringify([officeSearchKey, officeSearchResult.earliestAvailableStartDate])
    if (positionedSearch.current === positionKey) return
    // Wait for a retained selection to be checked before positioning a new search.
    if (selectedDate && selectedDay?.status !== "available") return
    positionedSearch.current = positionKey
    const earliest = officeSearchResult.earliestAvailableStartDate
    if (!selectedDate && earliest) {
      const [year, month] = earliest.split("-").map(Number)
      setCalendarMonth(new Date(year, month - 1, 1))
    }
  }, [isOffice, availabilityLoading, availabilityError, officeSearchResult, officeSearchKey, selectedDate, selectedDay])

  useEffect(() => {
    if (!isOpen) return;

    if (window.pannellum) {
      setLibLoaded(true);
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-pannellum-script="true"]');
    const existingLink = document.querySelector<HTMLLinkElement>('link[data-pannellum-style="true"]');

    if (!existingLink) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css";
      link.dataset.pannellumStyle = "true";
      document.head.appendChild(link);
    }

    if (existingScript) {
      if (window.pannellum) setLibLoaded(true);
      else existingScript.addEventListener("load", () => setLibLoaded(true), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js";
    script.async = true;
    script.dataset.pannellumScript = "true";
    script.onload = () => setLibLoaded(true);
    script.onerror = () => {
      setLibLoaded(false);
      console.error("Failed to load Pannellum library.");
    };
    document.body.appendChild(script);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return
    const media = window.matchMedia("(min-width: 1024px)")
    const updatePreviewLayout = () => setIsDesktopPreview(media.matches)
    updatePreviewLayout()
    media.addEventListener("change", updatePreviewLayout)
    return () => media.removeEventListener("change", updatePreviewLayout)
  }, [isOpen])

  const resetState = () => {
    setStep('category'); setCategory(null); setSelectedItemId(null); setSelectedRoomId(null); setRoomPage(1);
    setExpandedSpaceKey(null); setScheduleDescriptionKey(null);
    setSelectedDate(null); setSelectedDuration(null);
    setOfficeSearchFrom(""); setSelectionWarning(""); positionedSearch.current = "";
    setEventName(""); setEventType(""); setCustomEventType(""); setGuests(""); setNotes(""); setAgreed(false);
    setPendingBookingPayload(null); setIsBookingConfirmOpen(false); setIsSubmitting(false);
    
    const minDate = new Date(`${getMinimumBookingDate()}T00:00:00`);
    setCalendarMonth(new Date(minDate.getFullYear(), minDate.getMonth(), 1));
    
    if (viewerRef.current) { viewerRef.current.destroy(); viewerRef.current = null; }
  }

  const handleClose = () => { setIsOpen(false); setTimeout(resetState, 300); }
  
  const handleBack = () => {
    if (step === 'list') setStep('category')
    else if (step === 'room') setStep('list')
    else if (step === 'schedule') {
        if (viewerRef.current) { viewerRef.current.destroy(); viewerRef.current = null; }
        setStep(category === 'office' ? 'room' : 'list')
    }
    else if (step === 'details') setStep('schedule')
  }

  const applyAutoRotate = (shouldRotate: boolean) => {
    const viewer = viewerRef.current
    if (!viewer) return

    try {
      if (shouldRotate) {
        if (viewer.startAutoRotate) {
          viewer.startAutoRotate(-2, 0)
        }
      } else if (viewer.stopAutoRotate) {
        viewer.stopAutoRotate()
      }
    } catch (error) {
      console.error("Failed to toggle panorama auto-pan", error)
    }
  }

  useEffect(() => {
    if (step !== 'schedule' || !selectedItem) {
      if (viewerRef.current) {
        viewerRef.current.destroy()
        viewerRef.current = null
      }
      setIsViewerReady(false)
      return
    }

    if (!libLoaded || !window.pannellum) {
      setIsViewerReady(false)
      return
    }

    let readyFallbackTimer: number | null = null
    const initTimer = window.setTimeout(() => {
      const containerId = isDesktopPreview ? "booking-panorama-viewer" : "booking-panorama-viewer-mobile"
      const container = document.getElementById(containerId)
      if (!container) return

      if (viewerRef.current) {
        viewerRef.current.destroy()
        viewerRef.current = null
      }

      container.innerHTML = ""
      setIsViewerReady(false)

      const panoramaSource = getPanoramaSource(selectedItem)

      if (!panoramaSource) {
        setIsViewerReady(true)
        return
      }

      try {
        const viewer = window.pannellum.viewer(containerId, {
          type: 'equirectangular',
          panorama: panoramaSource,
          autoLoad: true,
          autoRotate: autoRotateRef.current ? -2 : 0,
          showControls: false,
          showFullscreenCtrl: false,
          compass: false,
          hfov: 105,
          pitch: 0,
          yaw: 0,
        })

        viewerRef.current = viewer

        const markReady = () => {
          setIsViewerReady(true)

          const controls = container.querySelectorAll(
            '.pnlm-controls-container, .pnlm-fullscreen-toggle-button, .pnlm-zoom-controls, .pnlm-fullscreen-toggle-button'
          )
          controls.forEach((control) => {
            ;(control as HTMLElement).style.display = 'none'
          })

          applyAutoRotate(autoRotateRef.current)
        }

        if (viewer?.on) {
          viewer.on('load', markReady)
          viewer.on('error', () => setIsViewerReady(true))
        }

        readyFallbackTimer = window.setTimeout(markReady, 1200)
      } catch (e) {
        console.error("Pannellum Error", e)
        setIsViewerReady(true)
      }
    }, 150)

    return () => {
      window.clearTimeout(initTimer)
      if (readyFallbackTimer) window.clearTimeout(readyFallbackTimer)
      if (viewerRef.current) {
        viewerRef.current.destroy()
        viewerRef.current = null
      }
    }
  }, [step, selectedItem, libLoaded, isDesktopPreview])

  const toggleAutoRotate = () => {
    setIsAutoRotating((current) => {
      const nextState = !current
      autoRotateRef.current = nextState
      applyAutoRotate(nextState)
      return nextState
    })
  }

  const executeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (isSubmittingRef.current) return

    if (!user) {
      toast({
        title: "Login Required",
        description: "Please login to book.",
        variant: "destructive",
      })
      return
    }

    if (!selectedItem || !selectedDate || !selectedDuration) {
      toast({
        title: "Missing Booking Details",
        description: "Please complete the date and duration/time selection.",
        variant: "destructive",
      })
      return
    }

    if (!eventName.trim()) {
      toast({
        title: "Missing Name",
        description: isOffice
          ? "Please enter the company / tenant name."
          : "Please enter the event name.",
        variant: "destructive",
      })
      return
    }

    if (!eventType || (eventType === "others" && !customEventType.trim())) {
      toast({
        title: "Missing Type",
        description: isOffice
          ? "Please select or specify the nature of business."
          : "Please select or specify the event type.",
        variant: "destructive",
      })
      return
    }

    if (!isOffice && (!guests || Number(guests) < 1)) {
      toast({
        title: "Invalid Guest Count",
        description: "Please enter the expected number of guests.",
        variant: "destructive",
      })
      return
    }

    if (!agreed) {
      toast({
        title: "Terms Required",
        description: "Please agree to the terms and conditions first.",
        variant: "destructive",
      })
      return
    }

    if (selectedDate < minimumBookingDate) {
      toast({
        title: "Date Not Allowed",
        description:
          "Bookings must be scheduled at least 1 month from today. Please select an available future date.",
        variant: "destructive",
      })
      return
    }

    const selectedAvailability = availabilityDays[selectedDate]
    const selectedSlotIsAvailable = isOffice
      ? selectedAvailability?.status === "available"
      : selectedAvailability?.availableSlots.some((slot) => slot.label === selectedDuration)
    if (!selectedRoomIsAvailable || !availabilitySpace || availabilityLoading || availabilityError || !selectedAvailability || selectedAvailability.status === "maintenance" || selectedAvailability.status === "full" || !selectedSlotIsAvailable || (isOffice && !selectedRentalTerm)) {
      toast({
        title: "Date Unavailable",
        description: availabilityError || "The selected date or time is no longer available. Please choose another slot.",
        variant: "destructive",
      })
      return
    }

    const isOfficeBooking = isOffice
    const rentalTerm = selectedRentalTerm || ""

    const resolvedNatureOfBusiness = eventType === "others" ? customEventType.trim() : eventType

      const payload = {
      userId: user.id,
      venueId: selectedItem.id,
      officeId: isOfficeBooking ? selectedItem.id : "",
      spaceId: isOfficeBooking ? selectedRoomId || "" : selectedItem.id,
      venue: selectedSpaceName,
      eventName: eventName.trim() || "Space Rental",
      eventType: resolvedNatureOfBusiness,
      companyName: isOfficeBooking ? eventName.trim() : "",
      natureOfBusiness: isOfficeBooking ? resolvedNatureOfBusiness : "",
      customEventType: eventType === "others" ? customEventType.trim() : "",
      guestCount: isOfficeBooking ? 1 : Number(guests || 1),
      date: selectedDate,
      endDate: isOfficeBooking ? calculateOfficeEndDate(selectedDate, rentalTerm as OfficeRentalTerm) : "",
      time: selectedDuration,
      startTime: isOfficeBooking
        ? ""
        : selectedDuration.includes("-")
          ? selectedDuration.split("-")[0].trim()
          : selectedDuration,
      endTime: isOfficeBooking
        ? ""
        : selectedDuration.includes("-")
          ? selectedDuration.split("-")[1].trim()
          : selectedDuration,
      status: "pending" as BookingStatus,
      bookingStatus: "Pending" as BookingStatusLabel,
      isSlotSecured: false,
      paymentStatus: "unpaid" as PaymentStatus,
      paymentType: isOfficeBooking ? "slot_reservation" as const : "",
      paymentMethod: "",
      amountPaid: 0,
      remainingBalance: isOfficeBooking ? 0 : selectedItem.price,
      remainingBalancePaid: false,
      totalPrice: selectedItem.price,
      downPaymentPercentage: (selectedItem as any).downPaymentPercentage ?? 50,
      downPaymentAmount: (selectedItem as any).downPaymentPercentage
        ? selectedItem.price * ((selectedItem as any).downPaymentPercentage / 100)
        : selectedItem.price * 0.5,
      specialRequests: notes.trim(),
      userInfo: {
        name: user.name || "Client",
        email: user.email || "",
        phone: "0000000000",
      },
      bookingCategory: isOfficeBooking ? "office" : "venue",
      bookingType: isOfficeBooking ? "office" : "venue",
      isOfficeRental: isOfficeBooking,
      officeRentalTerm: rentalTerm,
      rentalTerm,
      contractTerm: rentalTerm,
      contractSigningRequired: true,
      contractSigned: false,
      contractStatus: "Not Available" as ContractStatus,
      requiresOnsiteContractSigning: isOfficeBooking,
      cancellationRequested: false,
      cancellationStatus: "None" as CancellationStatus,
      refundStatus: "Not Applicable" as RefundStatus,
      officePaymentNote: isOfficeBooking
        ? "This system payment is for slot reservation only. Succeeding office rental payments are settled onsite via check after contract signing."
        : "",
      adminLogs: isOfficeBooking
        ? [
            {
              action: "OFFICE_SLOT_RESERVATION_CREATED",
              message:
                "Office rental request created. Client must secure the slot first, then visit onsite for contract signing. Monthly payments will be tracked manually by admin via check.",
              createdAt: new Date().toISOString(),
            },
          ]
        : [],
    }

    setPendingBookingPayload(payload)
    setIsBookingConfirmOpen(true)
  }

  const confirmBookingSubmission = async () => {
    if (!pendingBookingPayload || isSubmittingRef.current) return
    if (!selectedScheduleIsAvailable || pendingBookingPayload.venue !== selectedSpaceName || pendingBookingPayload.totalPrice !== selectedItem?.price) {
      setIsBookingConfirmOpen(false)
      toast({ title: "Booking Details Changed", description: "Please review the current space and schedule before submitting.", variant: "destructive" })
      return
    }

    try {
      setIsSubmitting(true)
      isSubmittingRef.current = true

      const newId = await addBooking(pendingBookingPayload as any)

      if (!newId) {
        throw new Error("No booking ID returned.")
      }

      const isOfficeBooking = Boolean(pendingBookingPayload.isOfficeRental)

      toast({
        title: "Booking Saved",
        description: isOfficeBooking
          ? "Proceed to slot reservation payment. Contract signing will be done onsite."
          : "Redirecting to payment page...",
        className: "bg-[#ea580c] text-white border-none",
      })

      setIsBookingConfirmOpen(false)
      setPendingBookingPayload(null)
      setIsOpen(false)

      window.setTimeout(() => {
        router.push(`/portal/payments?bookingId=${newId}`)
      }, 150)
    } catch (error) {
      const err = error as any;
      console.error(err);
      console.error(err.code);
      console.error(err.message);
      console.error(err.stack);

      toast({
        title: "Error",
        description: err.message || "Failed to submit booking. Please try again.",
        variant: "destructive",
      })
    } finally {
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const renderCategory = () => (
    <div className="overflow-y-auto p-6 md:p-8 bg-slate-50">
      <div className="max-w-lg mx-auto w-full">
        <div className="text-center mb-6 md:mb-8">
          <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">Select Category</h2>
          <p className="text-slate-500 mt-1 text-sm">What type of space are you looking for?</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
          <button aria-label="Book Event Venue" onClick={() => { setCategory('venue'); setStep('list') }} className="bg-white border-2 border-slate-200 rounded-2xl p-4 md:p-5 text-left hover:border-[#ea580c] hover:shadow-md focus-visible:border-[#ea580c] focus-visible:ring-2 focus-visible:ring-orange-300 outline-none transition-all duration-300 group active:scale-[0.98]">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-orange-50 rounded-xl flex items-center justify-center mb-3 text-[#ea580c] group-hover:scale-110 transition-transform"><Tent className="w-5 h-5 md:w-6 md:h-6" /></div>
            <h4 className="text-base md:text-lg font-black text-slate-900">Event Venues</h4>
            <p className="text-slate-500 mt-1 text-sm leading-relaxed">Elegant spaces for weddings, birthdays, and corporate gatherings. Hourly rentals.</p>
          </button>
          <button aria-label="Book Office Space" onClick={() => { setCategory('office'); setStep('list') }} className="bg-white border-2 border-slate-200 rounded-2xl p-4 md:p-5 text-left hover:border-[#ea580c] hover:shadow-md focus-visible:border-[#ea580c] focus-visible:ring-2 focus-visible:ring-orange-300 outline-none transition-all duration-300 group active:scale-[0.98]">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-orange-50 rounded-xl flex items-center justify-center mb-3 text-[#ea580c] group-hover:scale-110 transition-transform"><Building2 className="w-5 h-5 md:w-6 md:h-6" /></div>
            <h4 className="text-base md:text-lg font-black text-slate-900">Office Spaces</h4>
            <p className="text-slate-500 mt-1 text-sm leading-relaxed">Private fully-furnished rooms for your business and team operations. Contract rentals.</p>
          </button>
        </div>
      </div>
    </div>
  )

  const renderList = () => {
    const items = category === 'venue' ? VENUES : OFFICE_BUILDINGS
    return (
      <div className="flex-1 overflow-y-auto p-4 md:p-5 bg-slate-50 min-h-0">
        <div className="max-w-4xl mx-auto w-full pb-5 pb-[env(safe-area-inset-bottom)]">
          <div className="mb-4 md:mb-5 text-center md:text-left">
            <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">{category === 'venue' ? 'Our Venues' : 'Office Wings'}</h2>
            <p className="text-slate-500 mt-1 text-sm">Click a photo for details, then select a space to view availability and its 360° preview.</p>
          </div>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
            {items.map((item) => {
              const isUnderRenovation = isCatalogUnderRenovation(item)
              const spaceKey = `${category}:${item.id}`
              const isExpanded = expandedSpaceKey === spaceKey
              return (
              <Collapsible key={spaceKey} open={isExpanded} onOpenChange={(expanded) => setExpandedSpaceKey(expanded ? spaceKey : null)} className={`bg-white rounded-[1.5rem] xl:rounded-[1rem] overflow-hidden shadow-sm border transition-colors duration-300 motion-reduce:transition-none group flex flex-col self-start w-full ${isUnderRenovation ? 'border-slate-300 opacity-75' : 'border-slate-200 hover:shadow-md'}`}>
                  <CollapsibleTrigger asChild>
                  <button type="button" aria-label={`${isExpanded ? "Hide" : "View"} details for ${item.name}`} aria-expanded={isExpanded} className="relative w-full aspect-[16/10] shrink-0 overflow-hidden bg-slate-100 min-h-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-400">
                   <img src={item.image} alt={item.name} loading="lazy" className="w-full h-full object-cover transition-transform duration-700 motion-reduce:transition-none group-hover:scale-105 motion-reduce:group-hover:scale-100" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
                  
                  <VenueRatingBadge venueName={item.name} />

                  <div className="absolute bottom-4 left-5 right-5 xl:bottom-4 xl:left-5"><h4 className="font-black text-white text-xl lg:text-lg leading-tight mb-1">{item.name}</h4><p className="text-white/80 text-xs xl:text-[10px] line-clamp-1">{item.description}</p>
                    <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-slate-950/80 px-2.5 py-1 text-xs font-bold text-orange-300">
                      {isExpanded ? "Hide Details" : "View Details"}
                      <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${isExpanded ? "rotate-180" : ""}`} />
                    </span>
                  </div>
                  
                  {isUnderRenovation && (
                    <div className="absolute top-3 right-3 rounded-full bg-slate-900/80 px-3 py-1 text-[9px] font-bold text-white backdrop-blur-sm border border-slate-600">
                      Under Renovation
                    </div>
                  )}
                </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-description-content overflow-hidden">
                  <p className="whitespace-pre-wrap break-words border-b border-orange-100 bg-orange-50/40 px-4 py-4 text-sm leading-relaxed text-slate-600">
                    {getDetailedDescription(item) || "More details will be available soon."}
                  </p>
                </CollapsibleContent>
                
                <div className="p-4 flex flex-col gap-3 bg-white shrink-0">
                  <div className="flex items-center justify-between">
                      <div>
                          <p className="text-[9px] text-black font-bold uppercase tracking-[0.2em] mb-0.5">{category === 'venue' ? 'Starting at' : 'Per Month'}</p>
                          <p className="text-base md:text-lg font-black text-[#ea580c]">₱{item.price.toLocaleString()}</p>
                      </div>
                      
                      <VenueReviewsDialog venueName={item.name}>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 underline underline-offset-4 transition-colors hover:text-[#ea580c]"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            View Reviews
                          </button>
                      </VenueReviewsDialog>
                  </div>
                  
                    <Button aria-label={isUnderRenovation ? `Under Renovation: ${item.name}` : `Select ${item.name}`} disabled={isUnderRenovation} onClick={() => { if (!isUnderRenovation) { setSelectedItemId(item.id); setSelectedRoomId(null); setStep(category === 'office' ? 'room' : 'schedule') }}} className="w-full rounded-full bg-slate-900 hover:bg-[#ea580c] text-white font-bold h-10 text-sm transition-colors shadow-sm disabled:bg-slate-300 disabled:cursor-not-allowed disabled:shadow-none">
                       {isUnderRenovation ? 'Under Renovation' : `Select ${category === 'venue' ? 'Venue' : 'Office'}`}
                  </Button>
                </div>
              </Collapsible>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  const renderRoomSelect = () => {
    const officeRooms = (selectedItem?.rooms && Array.isArray(selectedItem.rooms))
      ? selectedItem.rooms.filter((r: any) => !r.isArchived && !r.isHidden)
      : []
    const totalPages = Math.max(1, Math.ceil(officeRooms.length / ROOMS_PER_PAGE))
    const safePage = Math.min(roomPage, totalPages)
    const startIdx = (safePage - 1) * ROOMS_PER_PAGE
    const pageRooms = officeRooms.slice(startIdx, startIdx + ROOMS_PER_PAGE)
    return (
    <div className="flex-1 overflow-y-auto p-6 xl:p-8 flex flex-col bg-slate-50 min-h-0">
      <div className="max-w-3xl xl:max-w-3xl mx-auto w-full text-center flex-1 flex flex-col">
        <div className="w-16 h-16 xl:w-12 xl:h-12 bg-orange-50 text-[#ea580c] rounded-full flex items-center justify-center mx-auto mb-6 xl:mb-4"><DoorOpen className="w-8 h-8 xl:w-6 xl:h-6" /></div>
        <h2 className="text-2xl md:text-3xl xl:text-2xl font-black text-slate-900 tracking-tight mb-3 xl:mb-2">{selectedItem?.name} Rooms</h2>
        <p className="text-slate-500 mb-8 xl:mb-6 text-sm xl:text-xs max-w-xl mx-auto">Choose an available private room in this wing. All rooms share the same layout and premium amenities.</p>
        {selectionWarning && <p role="alert" className="mb-4 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">{selectionWarning}</p>}
        {roomAvailability.loading && <p role="status" className="mb-4 text-sm text-slate-600">Checking room availability…</p>}
        {roomAvailability.error && <div role="alert" className="mb-4 rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">
          <p>{roomAvailability.error}</p>
          <Button variant="outline" onClick={() => setAvailabilityAttempt((value) => value + 1)} className="mt-2 h-9">Retry room availability</Button>
        </div>}
        
        {officeRooms.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-8 text-center">
            <DoorOpen className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-500">No rooms available</p>
            <p className="text-xs text-slate-400 mt-1">Please contact admin to add rooms.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 xl:gap-4">
              {pageRooms.map((room: any) => {
                const status = roomAvailability.rooms[String(room.id)]
                const available = !roomAvailability.loading && !roomAvailability.error && status === "available" && room.isBookable !== false
                const badge = roomAvailability.loading ? "Checking…" : roomAvailability.error ? "Unavailable"
                  : ({ available: "Available", reserved: "Reserved", occupied: "Occupied", maintenance: "Under Maintenance", unavailable: "Unavailable" }[status || "unavailable"])
                return (
                  <button type="button" aria-label={`Select ${room.name}`} key={room.id} disabled={!available}
                    title={available ? "Choose a rental start date" : "Booking is unavailable until this room is released."}
                    onClick={() => { if (available) { setSelectionWarning(""); setSelectedRoomId(String(room.id || "")); setStep('schedule') } }}
                    className="min-w-0 p-4 xl:p-6 rounded-[1.5rem] xl:rounded-2xl border-2 transition-all flex flex-col items-center justify-center gap-2 min-h-[120px] xl:min-h-[100px] focus-visible:ring-2 focus-visible:ring-orange-300 outline-none bg-white enabled:hover:border-orange-600 enabled:hover:shadow-md border-slate-100 shadow-sm disabled:cursor-not-allowed disabled:bg-slate-100">
                    <div className="max-w-full [overflow-wrap:anywhere] text-sm font-bold text-black">{room.name}</div>
                    <span className={`max-w-full rounded-md border px-2 py-1 text-xs font-semibold ${available ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600"}`}>{badge}</span>
                  </button>
                )
              })}
            </div>

            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-4">
                <button type="button" disabled={safePage <= 1} onClick={() => setRoomPage(safePage - 1)}
                  className={`h-9 px-4 rounded-lg text-xs font-bold transition-colors ${safePage <= 1 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm'}`}>
                  ← Previous
                </button>
                <span className="text-xs font-bold text-slate-500">{safePage} / {totalPages}</span>
                <button type="button" disabled={safePage >= totalPages} onClick={() => setRoomPage(safePage + 1)}
                  className={`h-9 px-4 rounded-lg text-xs font-bold transition-colors ${safePage >= totalPages ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm'}`}>
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
    )
  }

  const renderSchedule = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const emptySlots = Array.from({ length: firstDay }).map((_, i) => null);
    const days = Array.from({ length: daysInMonth }).map((_, i) => i + 1);

    const displayName = selectedSpaceName

    const hasPanorama = !!(getPanoramaSource(selectedItem))
    const descriptionKey = `${category}:${selectedItem?.id}`
    const isDescriptionExpanded = scheduleDescriptionKey === descriptionKey
    const aboutSpace = (
      <Collapsible open={isDescriptionExpanded} onOpenChange={(expanded) => setScheduleDescriptionKey(expanded ? descriptionKey : null)} className="shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60">
        <CollapsibleTrigger asChild>
          <button type="button" aria-expanded={isDescriptionExpanded} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-xs font-bold text-orange-700 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-300">
            About This Space
            <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${isDescriptionExpanded ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-description-content overflow-hidden">
          <p className="whitespace-pre-wrap break-words px-4 pb-4 text-sm leading-relaxed text-slate-600">
            {getDetailedDescription(selectedItem) || "More details will be available soon."}
          </p>
        </CollapsibleContent>
      </Collapsible>
    )

    const availableVenueSlots = selectedDate
      ? availabilityDays[selectedDate]?.availableSlots || []
      : []
    const occupiedIntervals = [...(selectedDay?.occupiedIntervals || [])]
      .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes)

    const calendarCard = (
      <div className="overflow-hidden rounded-[1rem] border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-2.5 py-2">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => {
              setCalendarMonth(new Date(year, month - 1, 1))
              setSelectedDate(null)
              if (!isOffice) setSelectedDuration(null)
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          <div className="text-center">
            <h5 className="text-[13px] font-black leading-none text-slate-950 md:text-sm">
              {calendarMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </h5>
            <p className="mt-0.5 text-[7px] font-bold uppercase tracking-[0.12em] text-black">
              Choose an available day
            </p>
          </div>

          <button
            type="button"
            aria-label="Next month"
            onClick={() => {
              setCalendarMonth(new Date(year, month + 1, 1))
              setSelectedDate(null)
              if (!isOffice) setSelectedDuration(null)
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="p-2.5">
          <div className="mb-1.5 grid grid-cols-7 text-center">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((dayLabel) => (
              <div key={dayLabel} className="text-[7px] font-black uppercase tracking-[0.1em] text-black">
                {dayLabel}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 justify-items-center gap-0.5">
            {emptySlots.map((_, i) => <div key={`empty-${i}`} className="h-7 w-7 2xl:h-8 2xl:w-8" />)}
            {days.map(day => {
              const iterDate = new Date(year, month, day);
              const iterDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
               const isSelected = selectedDate === iterDateStr;
               const isBeforeAllowedWindow = iterDate < minBookableDate;
               const dayAvailability = availabilityDays[iterDateStr];

               let statusClass = "border-slate-200 bg-white text-slate-700 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700";
               let isDisabled = false;
               let dayTitle = "Available";

              if (isBeforeAllowedWindow) {
                 statusClass = "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-300 opacity-60";
                 isDisabled = true;
                 dayTitle = "Unavailable: booking must be at least 1 month from today";
               } else if (availabilityError || !availabilitySpace) {
                 statusClass = "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-300 opacity-60";
                 isDisabled = true;
                 dayTitle = "Availability unavailable";
               } else if (availabilityLoading || !dayAvailability || (isOffice && !selectedRentalTerm)) {
                 statusClass = "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-300 opacity-60";
                 isDisabled = true;
                 dayTitle = "Loading availability";
               } else if (dayAvailability.status === "maintenance") {
                 statusClass = "cursor-not-allowed border-slate-900 bg-slate-900 text-slate-400";
                 isDisabled = true;
                  dayTitle = isOffice ? "Maintenance overlaps this rental term" : "Maintenance day";
               } else if (dayAvailability.status === "full") {
                 statusClass = "cursor-not-allowed border-rose-100 bg-rose-50 text-rose-300";
                 isDisabled = true;
                  dayTitle = isOffice ? "Reservation overlaps this rental term" : "Fully booked";
               } else if (dayAvailability.status === "few") {
                   statusClass = "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100";
                   dayTitle = "Few slots left";
               }

               if (isSelected && !isDisabled) {
                 statusClass = `${statusClass} ring-2 ring-orange-600 ring-offset-1 scale-105`;
                 dayTitle = dayAvailability?.status === "few" ? "Few slots left (selected)" : "Selected date";
               }

              return (
                <button
                  aria-label={`Select ${iterDateStr}`}
                  title={dayTitle}
                  key={day}
                  disabled={isDisabled}
                  onClick={() => {
                     setSelectedDate(iterDateStr);
                     setSelectionWarning("");
                    if (!isOffice) setSelectedDuration(null);
                  }}
                  className={`flex h-7 w-7 2xl:h-8 2xl:w-8 items-center justify-center rounded-full border text-[10px] xl:text-[11px] font-black outline-none transition-all focus-visible:ring-2 focus-visible:ring-orange-300 ${statusClass}`}
                >
                  {day}
                </button>
              )
            })}
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1 border-t border-slate-100 pt-2">
            <div className="flex items-center justify-center gap-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.08em] text-amber-600">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-300" /> Few
            </div>
            <div className="flex items-center justify-center gap-1.5 rounded-full bg-rose-50 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.08em] text-rose-500">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-200" /> Full
            </div>
            <div className="flex items-center justify-center gap-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.08em] text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-900" /> Maint.
            </div>
          </div>

          <div className="mt-3 rounded-2xl border border-orange-100 bg-orange-50 px-2.5 py-2">
            <p className="text-[8px] font-black uppercase tracking-[0.12em] text-orange-700">
              {isOffice ? "Earliest available start date" : "Earliest bookable date"}
            </p>
            {isOffice ? (
              <div className="mt-1 space-y-2 text-xs font-semibold leading-5 text-orange-900" aria-live="polite">
                {availabilityError ? <p>Availability could not be confirmed. Please retry.</p>
                  : availabilityLoading || !officeSearchResult ? <p>Checking the full rental term...</p>
                    : officeSearchResult.earliestAvailableStartDate ? <>
                      <p>{new Date(`${officeSearchResult.earliestAvailableStartDate}T00:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}</p>
                      <p>For {selectedDuration}. The entire rental term must be available. Disabled dates cannot be selected.</p>
                      <button type="button" className="font-bold text-orange-700 underline" onClick={() => {
                        const [year, month] = officeSearchResult.earliestAvailableStartDate!.split("-").map(Number)
                        setCalendarMonth(new Date(year, month - 1, 1)); setSelectedDate(null)
                      }}>View earliest available month</button>
                    </> : <>
                      <p>No valid start date found from {officeSearchResult.from} through {officeSearchResult.to} for {selectedDuration}.</p>
                      <button type="button" className="font-bold text-orange-700 underline" onClick={() => {
                        const nextFrom = addAvailabilityDays(officeSearchResult.to, 1)
                        setOfficeSearchFrom(nextFrom); setSelectedDate(null)
                        const [year, month] = nextFrom.split("-").map(Number)
                        setCalendarMonth(new Date(year, month - 1, 1))
                      }}>Search later start dates</button>
                    </>}
              </div>
            ) : <p className="mt-0.5 text-[10px] font-bold leading-3 text-orange-900">
              {minBookableDate.toLocaleDateString('en-PH', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
              . Gray dates are not available for booking.
            </p>}
          </div>
        </div>
      </div>
    )

    const timePanel = (
      <>
      {selectionWarning && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">{selectionWarning}</p>}
      {!availabilitySpace || availabilityError ? (
        <p role="alert" className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
          {availabilityError || "This space is no longer available. Please select another space."}
          {availabilityError && <button type="button" onClick={() => setAvailabilityAttempt((attempt) => attempt + 1)} className="ml-2 font-bold underline">Retry availability</button>}
        </p>
      ) : availabilityLoading ? (
        <p role="status" className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking availability...</p>
      ) : null}
      {category === "venue" && selectedDate && !availabilityLoading && !availabilityError && occupiedIntervals.length > 0 && (
        <section aria-label="Selected date availability" className="mb-3 space-y-2 rounded-lg border border-amber-100 bg-amber-50/60 p-3 text-xs">
          <div>
            <p className="font-bold text-slate-700">Existing booking(s)</p>
            {occupiedIntervals.map((interval, index) => <p key={`${interval.startMinutes}:${interval.endMinutes}:${index}`} className="mt-1 font-semibold tabular-nums text-slate-600">{interval.startTimeLabel} - {interval.endTimeLabel}</p>)}
          </div>
          <div>
            <p className="font-bold text-slate-700">Available start times</p>
            <p className="mt-1 font-semibold tabular-nums text-orange-700">{availableVenueSlots.map((slot) => slot.startTimeLabel).join(", ") || "None"}</p>
          </div>
        </section>
      )}
      {!selectedDate && !isOffice ? (
        null
      ) : (
        <div className="space-y-3 animate-in fade-in rounded-[1rem] border border-slate-200 bg-white p-3 shadow-sm">
          {category === 'venue' ? (
            <div className="flex flex-col gap-2">
              <Select value={selectedDuration || ""} onValueChange={setSelectedDuration} disabled={availabilityLoading || Boolean(availabilityError) || availableVenueSlots.length === 0}>
                <SelectTrigger className="w-full h-10 md:h-11 rounded-lg bg-white border-2 border-slate-200 px-3 font-bold text-xs text-slate-700 focus-visible:ring-2 focus-visible:ring-[#ea580c] transition-all data-[state=open]:border-[#ea580c]">
                  <SelectValue placeholder="Select Start Time" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-200 shadow-xl max-h-[150px] md:max-h-[180px] z-[10003]">
                  {availableVenueSlots.map(slot => (
                      <SelectItem key={slot.label} value={slot.label} className="font-bold text-xs text-slate-700 py-2 cursor-pointer focus:bg-orange-50 focus:text-[#ea580c]">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3 h-3 text-[#ea580c]" />
                          {slot.startTimeLabel}
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              
              {selectedDuration && availableVenueSlots.some(s => s.label === selectedDuration) && (
                <div className="p-3 bg-orange-50 border border-orange-100 rounded-lg flex items-start gap-2 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 text-[#ea580c] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[8px] font-bold text-orange-900 uppercase tracking-[0.2em] leading-relaxed">
                      Selected 6-Hour Schedule
                    </p>
                    <p className="text-[10px] font-black text-[#ea580c]">
                      {selectedDuration}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
            {selectedRentalTerm && selectedDay && !availabilityLoading && !availabilityError && selectedDay.status !== "available" && (
              <p role="alert" className="text-xs font-semibold text-rose-700">The selected rental term is unavailable from this date. Choose another date or duration.</p>
            )}
            {Object.keys(OFFICE_RENTAL_TERMS).map((slot) => (
            <button key={slot} onClick={() => { setSelectedDuration(slot); setOfficeSearchFrom("") }} className={`w-full flex items-center justify-between p-3 min-h-[44px] rounded-lg border-2 transition-all focus-visible:ring-2 focus-visible:ring-orange-200 outline-none ${selectedDuration === slot ? 'border-[#ea580c] bg-orange-50 shadow-sm ring-2 ring-orange-50' : 'border-slate-100 bg-white hover:border-[#ea580c]'}`}>
                <div className="flex items-center gap-2">
                  <MapPin className={`w-4 h-4 ${selectedDuration === slot ? 'text-[#ea580c]' : 'text-slate-400'}`} />
                  <span className={`font-bold text-xs ${selectedDuration === slot ? 'text-orange-900' : 'text-slate-700'}`}>{slot}</span>
                </div>
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${selectedDuration === slot ? 'border-[#ea580c] bg-[#ea580c]' : 'border-slate-200'}`}>
                  {selectedDuration === slot && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                </div>
              </button>
            ))}
            </>
          )}
        </div>
      )}
      </>
    )

    const titlePriceBlock = (
      <div>
        <h2 className="text-xl font-black text-slate-900 tracking-tight leading-tight">{displayName}</h2>
        <p className="text-[#ea580c] font-black text-lg leading-tight mt-0.5">₱{selectedItem?.price.toLocaleString()} <span className="text-black font-bold text-[9px] tracking-[0.2em] uppercase">/ {category === 'venue' ? 'Per 6 Hrs' : 'Per Month'}</span></p>
      </div>
    )

    const panoramaBlock = (
      <div className="relative h-full min-h-[300px] overflow-hidden rounded-3xl bg-slate-950">
        <div id="booking-panorama-viewer" className="absolute inset-0 h-full w-full touch-pan-x [&_.pnlm-controls-container]:hidden [&_.pnlm-fullscreen-toggle-button]:hidden [&_.pnlm-zoom-controls]:hidden"></div>
        {hasPanorama ? (
          (!libLoaded || !isViewerReady) && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 gap-3">
              <Loader2 className="w-6 h-6 text-[#ea580c] animate-spin" />
              <p className="text-white text-[10px] font-black tracking-[0.2em] uppercase">Loading 360° Panorama...</p>
            </div>
          )
        ) : (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 gap-3">
            <Camera className="w-8 h-8 text-white/60" />
            <p className="text-white/80 text-[10px] font-black tracking-[0.2em] uppercase text-center px-4">
              360 tour preview is not available for this space.
            </p>
          </div>
        )}
        {hasPanorama && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-black/50 p-1.5 rounded-full backdrop-blur-md border border-white/10 shadow-sm pointer-events-auto">
            <button
              type="button"
              aria-label={isAutoRotating ? "Pause panorama auto-pan" : "Play panorama auto-pan"}
              title={isAutoRotating ? "Pause panorama auto-pan" : "Play panorama auto-pan"}
              onClick={toggleAutoRotate}
              className={`min-w-[32px] min-h-[32px] flex items-center justify-center rounded-full transition-colors ${isAutoRotating ? 'bg-[#ea580c] text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
            >
               {isAutoRotating ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
            </button>
            <div className="w-px h-4 bg-white/20"></div>
            <div className="flex items-center px-2 text-white/90 text-[10px] font-bold uppercase tracking-[0.2em] gap-1.5">
               <Navigation className="w-3 h-3 animate-pulse" /> Pan around
            </div>
          </div>
        )}
      </div>
    )

    return (
      <div className="flex flex-1 flex-col bg-white min-h-0 w-full">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-6 lg:py-6">

          {/* ─── MOBILE: stacked layout ─── */}
          <div className="flex w-full flex-col gap-5 lg:hidden">
            {titlePriceBlock}
            <div className="relative h-[220px] w-full overflow-hidden rounded-2xl bg-slate-950">
              <div id="booking-panorama-viewer-mobile" className="absolute inset-0 h-full w-full touch-pan-x [&_.pnlm-controls-container]:hidden [&_.pnlm-fullscreen-toggle-button]:hidden [&_.pnlm-zoom-controls]:hidden"></div>
              {hasPanorama ? (
                (!libLoaded || !isViewerReady) && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 gap-3">
                    <Loader2 className="w-6 h-6 text-[#ea580c] animate-spin" />
                    <p className="text-white text-[10px] font-black tracking-[0.2em] uppercase">Loading 360° Panorama...</p>
                  </div>
                )
              ) : (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 gap-3">
                  <Camera className="w-8 h-8 text-white/60" />
                  <p className="text-white/80 text-[10px] font-black tracking-[0.2em] uppercase text-center px-4">
                    360 tour preview is not available for this space.
                  </p>
                </div>
              )}
              {hasPanorama && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-black/50 p-1.5 rounded-full backdrop-blur-md border border-white/10 shadow-sm pointer-events-auto">
                  <button
                    type="button"
                    aria-label={isAutoRotating ? "Pause panorama auto-pan" : "Play panorama auto-pan"}
                    title={isAutoRotating ? "Pause panorama auto-pan" : "Play panorama auto-pan"}
                    onClick={toggleAutoRotate}
                    className={`min-w-[32px] min-h-[32px] flex items-center justify-center rounded-full transition-colors ${isAutoRotating ? 'bg-[#ea580c] text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
                  >
                     {isAutoRotating ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
                  </button>
                  <div className="w-px h-4 bg-white/20"></div>
                  <div className="flex items-center px-2 text-white/90 text-[10px] font-bold uppercase tracking-[0.2em] gap-1.5">
                     <Navigation className="w-3 h-3 animate-pulse" /> Pan around
                  </div>
                </div>
              )}
            </div>
            {aboutSpace}
            <div className="w-full">
              <div className="flex h-6 items-center gap-2 mb-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-950 text-[9px] text-white shadow-sm">1</span>
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-900">Select Date</span>
                <span className="ml-auto rounded-full bg-orange-50 px-2.5 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-orange-600">contract term</span>
              </div>
              {calendarCard}
            </div>
            <div className="w-full">
              <div className="flex h-6 items-center gap-2 mb-3">
                <div className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-[9px] shrink-0">2</div>
                <span className="text-[10px] font-black text-slate-900 tracking-[0.2em] uppercase">Select {category === 'venue' ? 'Time' : 'Duration'}</span>
              </div>
              {timePanel}
            </div>
            <Button disabled={!selectedScheduleIsAvailable} onClick={() => setStep('details')} className="w-full bg-[#ea580c] hover:bg-[#c2410c] text-white rounded-full h-12 font-bold text-xs md:text-sm transition-transform active:scale-95 disabled:opacity-50">
               Proceed to Details
            </Button>
          </div>

          {/* ─── DESKTOP: 3-column grid ─── */}
          <div className="hidden lg:grid w-full items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(250px,0.85fr)_minmax(180px,0.7fr)]">
            {/* Left: 360 panorama */}
            <div className="flex min-h-0 min-w-0 flex-col gap-3">
              <div className="min-h-[300px] flex-1">{panoramaBlock}</div>
              {aboutSpace}
            </div>

            {/* Middle: title + Select Date calendar */}
            <div className="flex min-h-0 flex-col gap-3">
              {titlePriceBlock}
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex h-6 items-center gap-2 mb-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-950 text-[9px] text-white shadow-sm">1</span>
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-900">Select Date</span>
                  <span className="ml-auto rounded-full bg-orange-50 px-2.5 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-orange-600">contract term</span>
                </div>
                <div className="flex-1">
                  {calendarCard}
                </div>
              </div>
            </div>

            {/* Right: Select Time + Proceed */}
            <div className="flex min-h-0 flex-col gap-3 pt-[62px]">
              <div className="flex h-6 items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-[9px] shrink-0">2</div>
                <span className="text-[10px] font-black text-slate-900 tracking-[0.2em] uppercase">Select {category === 'venue' ? 'Time' : 'Duration'}</span>
              </div>
              <div className="w-full">
                {timePanel}
              </div>
              <div className="flex-1" />
              <Button disabled={!selectedScheduleIsAvailable} onClick={() => setStep('details')} className="w-full bg-[#ea580c] hover:bg-[#c2410c] text-white rounded-full h-11 font-bold text-xs md:text-sm transition-transform active:scale-95 disabled:opacity-50">
                 Proceed to Details
              </Button>
            </div>
          </div>

        </div>
      </div>
    )
  }

  const renderDetails = () => {
    const isFormValid = selectedScheduleIsAvailable && eventName.trim() && eventType && (eventType !== 'others' || customEventType.trim()) && (isOffice || guests) && agreed && !isSubmitting;

    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:py-6 relative">
        
        <div className="mx-auto w-full max-w-[520px] flex flex-col pb-4">
          
          <div className="shrink-0 mb-5 text-center">
            <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">Final Details</h2>
            <p className="text-slate-500 mt-1 text-xs">Complete your {isOffice ? 'tenant' : 'event'} information to finalize your request.</p>
          </div>

          <form onSubmit={executeSubmit} className="flex flex-col gap-4">
            {(selectionWarning || availabilityError) && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
              {availabilityError || selectionWarning} <button type="button" className="font-bold underline" onClick={() => setStep("schedule")}>Review schedule</button>
            </p>}
            <h3 className="shrink-0 text-xs font-black text-slate-900 flex items-center gap-2 mb-1">
              {isOffice ? <Briefcase className="w-4 h-4 text-[#ea580c]" /> : <PartyPopper className="w-4 h-4 text-[#ea580c]" />} 
              {isOffice ? 'Company / Tenant Information' : 'Event Information'}
            </h3>
            
            <div className="space-y-1">
                <label className="text-[10px] font-bold text-black uppercase tracking-[0.2em]">
                    {isOffice ? 'Company / Tenant Name *' : 'Event Name *'}
                </label>
                <Input required value={eventName} onChange={e => setEventName(e.target.value)} placeholder={isOffice ? "e.g. Acme Corp / Juan Dela Cruz" : "e.g. 18th Birthday Party"} className="h-10 w-full rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs focus-visible:ring-2 focus-visible:ring-[#ea580c]" />
            </div>

            {isOffice ? (
                <div className="space-y-1">
                    <label className="text-[10px] font-bold text-black uppercase tracking-[0.2em]">
                        Nature of Business *
                    </label>
                    <select
                      value={eventType}
                      onChange={(e) => setEventType(e.target.value)}
                      required
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    >
                      <option value="" disabled>Select nature of business</option>
                      <option value="tech">Technology / IT</option>
                      <option value="freelance">Freelance / Professional Services</option>
                      <option value="agency">Agency / Creative Studio</option>
                      <option value="corporate">Corporate Office</option>
                      <option value="others">Others</option>
                    </select>
                    {eventType === 'others' && (
                        <div className="mt-2 animate-in slide-in-from-top-1">
                            <Input required value={customEventType} onChange={e => setCustomEventType(e.target.value)} placeholder="Please specify business nature..." className="h-10 w-full rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs focus-visible:ring-2 focus-visible:ring-[#ea580c]" />
                        </div>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                    <label className="text-[10px] font-bold text-black uppercase tracking-[0.2em]">
                            Event Type *
                        </label>
                        <select
                          value={eventType}
                          onChange={(e) => setEventType(e.target.value)}
                          required
                          className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                        >
                          <option value="" disabled>Select type</option>
                          <option value="Birthday">Birthday</option>
                          <option value="Wedding">Wedding</option>
                          <option value="Debut">Debut</option>
                          <option value="Corporate Event">Corporate Event</option>
                          <option value="Conference / Seminar">Conference / Seminar</option>
                          <option value="Baptism / Christening">Baptism / Christening</option>
                          <option value="Reunion">Reunion</option>
                          <option value="Private Celebration">Private Celebration</option>
                          <option value="others">Other</option>
                        </select>
                    </div>
                    
                    <div className="space-y-1">
                    <label className="text-[10px] font-bold text-black uppercase tracking-[0.2em]">
                            Expected Guests *
                        </label>
                        <Input 
                            required 
                            type="number" 
                            min={1}
                            max={maxPax}
                            value={guests} 
                            onChange={e => {
                            let val = parseInt(e.target.value);
                            if (val > maxPax) val = maxPax; 
                            if (val < 1) val = 1;
                            setGuests(val || "");
                            }} 
                            placeholder={`Up to ${maxPax} pax`} 
                            className="h-10 w-full rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs focus-visible:ring-2 focus-visible:ring-[#ea580c]" 
                        />
                    </div>

                    {eventType === 'others' && (
                        <div className="col-span-1 sm:col-span-2 animate-in slide-in-from-top-1">
                            <Input required value={customEventType} onChange={e => setCustomEventType(e.target.value)} placeholder="Please specify event type..." className="h-10 w-full rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs focus-visible:ring-2 focus-visible:ring-[#ea580c]" />
                        </div>
                    )}
                </div>
            )}

            <div className="shrink-0 pt-4 border-t border-slate-100">
              <div className="flex items-center gap-3 mb-4">
                <Checkbox
                  id="terms"
                  checked={agreed}
                  onCheckedChange={(c) => setAgreed(c as boolean)}
                  className="h-5 w-5 shrink-0 rounded-md data-[state=checked]:bg-[#ea580c] data-[state=checked]:border-[#ea580c]"
                />
                <Label htmlFor="terms" className="text-xs text-slate-600 leading-relaxed cursor-pointer select-none">
                    I agree to the{" "}
                    <span
                        onClick={(e) => { e.preventDefault(); setIsTermsOpen(true); }}
                        className="font-bold text-[#ea580c] hover:underline cursor-pointer"
                    >
                        Terms & Conditions
                    </span>.
                </Label>
              </div>
              <Button disabled={!isFormValid} type="submit" className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-full h-12 font-bold text-sm shadow-sm active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">
                 {isSubmitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/> Processing...</> : "Submit Reservation Request"}
              </Button>
            </div>
          </form>
        </div>

        <Dialog open={isTermsOpen} onOpenChange={setIsTermsOpen}>
          <DialogContent aria-describedby={undefined} showCloseButton={false} className="w-[92vw] overflow-hidden rounded-[2rem] border-0 bg-white p-0 shadow-2xl sm:max-w-2xl">
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <div className="shrink-0 flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4 md:px-8">
                <div>
                  <DialogTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                    <FileText className="h-5 w-5 text-[#ea580c]" />
                    Terms & Conditions
                  </DialogTitle>

                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                    Please read carefully before proceeding with your reservation.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setIsTermsOpen(false)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 md:px-8">
                {isOffice ? (
                  <div className="space-y-3">
                    <h3 className="text-sm font-black uppercase tracking-[0.18em] text-[#ea580c]">
                      Office Space Rental Terms and Conditions
                    </h3>

                    <TermsList
                      items={getPolicyItems("officeTerms")}
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <h3 className="text-sm font-black uppercase tracking-[0.18em] text-[#ea580c]">
                      Event Venue Terms and Conditions
                    </h3>

                    <TermsList
                      items={getPolicyItems("venueTerms")}
                    />
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-4 md:px-8">
                <Button
                  type="button"
                  onClick={() => { setAgreed(true); setIsTermsOpen(false); }}
                  className="h-11 w-full rounded-full bg-slate-900 font-bold text-white shadow-sm transition hover:bg-[#ea580c] active:scale-95"
                >
                  I Understand
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) setTimeout(resetState, 300); }}>
      <DialogTrigger asChild>{children || <Button className="bg-[#ea580c] text-white">Book Now</Button>}</DialogTrigger>
      
      <DialogContent aria-describedby={undefined} showCloseButton={false} className={cn(
        "!flex !flex-col !gap-0 !p-0 overflow-hidden bg-white rounded-none sm:rounded-[2rem] border-0 shadow-2xl transition-all duration-300 ease-in-out w-full sm:max-h-[calc(100dvh-48px)]",
        step === 'category' && "!max-w-full sm:!max-w-[600px]",
        (step === 'list' || step === 'room') && "!max-w-full sm:!max-w-[95vw] lg:!max-w-[960px]",
        step === 'schedule' && "w-[95vw] max-w-[1180px] max-h-[calc(100dvh-32px)]",
        step === 'details' && "!max-w-full sm:!max-w-[580px]",
      )}>
        
        <DialogTitle className="hidden">Reservation Modal</DialogTitle>

        {step !== 'success' && (
            <>
                {step !== 'category' && (
                    <div className="absolute top-5 left-5 z-50">
                        <button aria-label="Go Back" onClick={handleBack} className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center rounded-full bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors border border-slate-200 shadow-sm"><ArrowLeft className="w-3.5 h-3.5 md:w-5 md:h-5" /></button>
                    </div>
                )}
                <div className="absolute top-5 right-5 z-50">
                    <button aria-label="Close" onClick={handleClose} className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center rounded-full bg-white text-slate-500 hover:bg-rose-100 hover:text-rose-500 transition-colors border border-slate-200 shadow-sm"><X className="w-3.5 h-3.5 md:w-5 md:h-5" /></button>
                </div>
            </>
        )}

        {step !== 'success' && (
          <div className="shrink-0 px-3 pt-5 pb-1 bg-white border-b border-slate-100">
            <div className="flex items-center justify-center gap-0">
              {[
                { key: 'category', label: 'Category' },
                { key: 'list', label: 'Venue' },
                { key: 'schedule', label: 'Schedule' },
                { key: 'details', label: 'Details' },
              ].map((s, i) => {
                const stepRank = step === 'room' ? 'list' : step
                const ordered = ['category', 'list', 'schedule', 'details']
                const currentIdx = ordered.indexOf(stepRank)
                const isActive = i <= currentIdx
                const showConnector = i < ordered.length - 1
                return (
                  <React.Fragment key={s.key}>
                    <div className="flex items-center gap-1.5">
                      <div className={`flex h-6 w-6 md:h-7 md:w-7 items-center justify-center rounded-full text-[10px] md:text-[11px] font-black transition-colors ${isActive ? 'bg-[#ea580c] text-white' : 'bg-slate-100 text-slate-400'}`}>
                        {i + 1}
                      </div>
                      <span className={`hidden sm:inline text-[8px] md:text-[9px] font-bold uppercase tracking-wider ${isActive ? 'text-slate-900' : 'text-slate-400'}`}>
                        {s.label}
                      </span>
                    </div>
                    {showConnector && (
                      <div className={`h-px w-4 md:w-6 transition-colors ${i < currentIdx ? 'bg-[#ea580c]' : 'bg-slate-200'}`} />
                    )}
                  </React.Fragment>
                )
              })}
            </div>
          </div>
        )}

        <div className={cn(
          "relative overflow-x-hidden bg-white flex flex-col min-h-0 min-w-0 w-full",
          step !== 'category' && "flex-1",
        )}>
          {step === 'category' && renderCategory()}
          {step === 'list' && renderList()}
          {step === 'room' && renderRoomSelect()}
          {step === 'schedule' && renderSchedule()}
          {step === 'details' && renderDetails()}
        </div>
      </DialogContent>
    </Dialog>

    <BookingConfirmationDialog
      open={isBookingConfirmOpen}
      payload={pendingBookingPayload}
      isOffice={isOffice}
      isSubmitting={isSubmitting}
      canConfirm={selectedScheduleIsAvailable && pendingBookingPayload?.venue === selectedSpaceName && pendingBookingPayload?.totalPrice === selectedItem?.price}
      onEdit={() => setIsBookingConfirmOpen(false)}
      onConfirm={confirmBookingSubmission}
    />
    </>
  )
}
