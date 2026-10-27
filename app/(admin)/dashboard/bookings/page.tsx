"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  AlertCircle,
  Calendar,
  CalendarDays,
  CheckCircle2,
  DollarSign,
  FileText,
  Filter,
  Inbox,
  Search,
  X,
  XCircle,
  ShieldCheck,
  ArrowRight,
  Bell,
  ChevronLeft,
  ChevronRight,
  Wrench,
  Trash2,
} from "lucide-react"

import { Button } from "@/src/modules/shared/components/ui/button"
import { BookingDetailsFooter, bookingDetailsStackedActionClassName, bookingDetailsActionToneClassNames } from "@/src/modules/shared/components/booking-details-actions"
import { Input } from "@/src/modules/shared/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/src/modules/shared/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "@/src/modules/shared/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/modules/shared/components/ui/select"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { cn } from "@/src/modules/shared/lib/utils"
import { getCancellationAudit } from "@/src/modules/shared/lib/cancellation"
import { getRemainingDurationFromDates, getContractDurationLabel } from "@/src/modules/shared/lib/date-utils"
import {
  getBookingLifecycleLabel,
  getBookingLifecycleStatus,
} from "@/src/modules/shared/lib/booking-helpers"
import type { AvailabilitySpace } from "@/src/modules/shared/lib/availability"
import { fetchAvailability } from "@/src/modules/shared/lib/availability-client"
import { useSpaceAvailability } from "@/src/modules/shared/hooks/use-space-availability"
import { getAvailabilityDataKey } from "@/src/modules/shared/lib/availability-read-fields"
import { getCatalogAvailabilitySpace, isOfficeResourceBooking, resolveResourceSpace } from "@/src/modules/shared/lib/resource-identity"
import { useBookingData, useBookings, type Booking } from "@/src/modules/client/contexts/booking-context"
import { type NotificationType } from "@/src/modules/shared/lib/notifications"
import { useNotifications } from "@/src/modules/shared/contexts/notification-context"
import {
  calculatePaymentSummary,
  getRecordsForBooking,
  type PaymentRecordLike,
} from "@/src/modules/shared/lib/payment-calculations"
import { Textarea } from "@/src/modules/shared/components/ui/textarea"
import { Label } from "@/src/modules/shared/components/ui/label"
import { useCMS } from "@/src/modules/admin/contexts/cms-context"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/src/modules/shared/components/ui/tabs"

const adminBookingDetailsActionColors = {
  reminder: "bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA] hover:bg-[#FFEDD5] hover:text-[#C2410C]",
  onsite: "bg-[#EA580C] bg-none text-white border border-transparent hover:bg-[#C2410C] hover:text-white",
  contract: "bg-[#F1F5F9] text-[#334155] border border-[#CBD5E1] hover:bg-[#E2E8F0] hover:text-[#334155]",
} as const

function formatDate(date?: string) {
  if (!date) return "—"
  try {
    return new Intl.DateTimeFormat("en-PH", { month: "long", day: "2-digit", year: "numeric" }).format(new Date(date))
  } catch {
    return date
  }
}

function getStatusBadgeClass(status?: string) {
  const v = String(status || "").toLowerCase()
  if (["confirmed", "reservation_secured", "slot_secured", "slot_verified"].includes(v)) return "border-emerald-100 bg-emerald-50 text-emerald-700"
  if (["completed", "complete"].includes(v)) return "border-blue-100 bg-blue-50 text-blue-700"
  if (["pending", "verifying"].includes(v)) return "border-orange-100 bg-orange-50 text-orange-700"
  if (["cancellation_requested", "cancellation requested"].includes(v)) return "border-amber-100 bg-amber-50 text-amber-700"
  if (["modification_under_review"].includes(v)) return "border-purple-100 bg-purple-50 text-purple-700"
  if (["cancelled", "declined"].includes(v)) return "border-rose-100 bg-rose-50 text-rose-700"
  if (v === "contract_signing_required") return "border-yellow-100 bg-yellow-50 text-yellow-700"
  if (v === "active_rental") return "border-sky-100 bg-sky-50 text-sky-700"
  if (v === "rental_expired") return "border-rose-100 bg-rose-50 text-rose-700"
  return "border-slate-200 bg-slate-50 text-slate-600"
}

function BalanceReminderModal({
  booking,
  remainingBalance,
  open,
  onCancel,
  onConfirm,
}: {
  booking: Booking | null
  remainingBalance?: number
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent aria-describedby={undefined} className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 bg-white p-0 shadow-2xl [&>button]:hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7 sm:py-6">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <Bell className="h-8 w-8" />
            </div>
            <DialogTitle className="text-2xl font-black text-slate-950">
              Send Balance Reminder?
            </DialogTitle>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Send balance reminder to this customer?
            </p>
            {booking && (
              <div className="mt-5 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Booking ID</span>
                  <span className="font-bold text-slate-900">{booking.id}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Customer</span>
                  <span className="font-bold text-slate-900">{booking.userInfo?.name || "No Name"}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Remaining Balance</span>
                  <span className="font-bold text-blue-700">₱{(remainingBalance ?? Math.max(Number(booking.totalPrice || 0) - Number((booking as any).amountPaid || 0), 0)).toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
          <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-5 sm:px-7">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={onCancel}
                className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700"
              >
                Cancel
              </Button>
              <Button
                onClick={onConfirm}
                className="h-11 w-full sm:w-auto rounded-xl bg-blue-600 text-sm font-black text-white hover:bg-blue-700"
              >
                Send Reminder
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MarkCompletedAction({
  enabled,
  eventFinished,
  onClick,
  className,
  secondary = false,
}: {
  enabled: boolean
  eventFinished: boolean
  onClick: () => void
  className?: string
  secondary?: boolean
}) {
  return (
    <div className={cn("min-w-0 w-full", className)}>
      <Button
        onClick={onClick}
        disabled={!enabled}
        variant={enabled && !secondary ? "default" : "outline"}
        className={cn(
          bookingDetailsStackedActionClassName,
          secondary ? bookingDetailsActionToneClassNames.slate : bookingDetailsActionToneClassNames.primary,
        )}
      >
        <CheckCircle2 className="size-4" />
        Mark as Completed
      </Button>
      {!eventFinished && (
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Available after the event has ended.
        </p>
      )}
    </div>
  )
}

function ContractSigningAction({ onClick, secondary = false }: { onClick: () => void; secondary?: boolean }) {
  return (
    <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={onClick}
              variant={secondary ? "outline" : "default"}
              className={cn(bookingDetailsStackedActionClassName, adminBookingDetailsActionColors.contract)}
            >
              <ShieldCheck className="size-4" />
              Mark Contract as Signed
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs font-bold">
            Confirm contract signing
          </TooltipContent>
        </Tooltip>
    </TooltipProvider>
  )
}

function BookingDetail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}

function getStatusLabel(status?: string) {
  return getBookingLifecycleLabel({ status })
}

function getRefundStatusLabel(status?: string) {
  switch (status) {
    case "eligible":
      return "Eligible for Refund"
    case "requested":
      return "Refund Requested"
    case "refunded":
      return "Refunded"
    case "not_eligible":
      return "Not Eligible"
    default:
      return status || "Not Applicable"
  }
}

function isOfficeBooking(booking: Booking) {
  return isOfficeResourceBooking(booking as unknown as Record<string, unknown>)
}

function isCancellationRequestPending(booking: Booking) {
  const cancellationStatus = String(booking.cancellationStatus || "").trim().toLowerCase()
  return Boolean(
    booking.cancellationRequested === true ||
      String(booking.status || "").trim().toLowerCase() === "cancellation_requested" ||
      ["pending", "under review", "requested"].includes(cancellationStatus) ||
      String((booking as any).cancelRequestStatus || "").trim().toLowerCase() === "pending",
  )
}

export default function AdminBookingsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { toast } = useToast()
  const bookingCtx = useBookingData({ bookings: true, payments: true })
  const bookings = bookingCtx?.bookings || []
  const { markByBookingId } = useNotifications()
  const ADMIN_BOOKING_TYPES: NotificationType[] = ["booking_submitted", "cancellation_requested", "modification_requested"]

  useEffect(() => {
    console.log(
      `[DEBUG][ADMIN BOOKINGS] component mounted — uid: ${user?.id ?? "null"}, role: ${user?.role ?? "null"}, provider isLoading: ${bookingCtx.isLoading}`,
    )
  }, [user?.id, user?.role])

  useEffect(() => {
    if (bookingCtx.isLoading) return
    console.log(`[DEBUG][ADMIN BOOKINGS] data ready — raw bookings: ${bookings.length}, provider isLoading: ${bookingCtx.isLoading}`)
  }, [bookingCtx.isLoading, bookings])
  const {
    markContractSigned,
    approveCancellation,
    declineCancellation,
    updateBookingStatus,
    markAsRefunded,
    sendBalanceReminder,
  } = bookingCtx || {}
  const [searchQuery, setSearchQuery] = useState("")

  useEffect(() => {
    if (user && user.role === "staff" && !user.permissions?.bookings) {
      router.replace("/dashboard")
    }
  }, [user, router])

  const [statusFilter, setStatusFilter] = useState("all")
  const [venueFilter, setVenueFilter] = useState("all")
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [showContractConfirm, setShowContractConfirm] = useState(false)
  const [sendReminderTarget, setSendReminderTarget] = useState<Booking | null>(null)
  const [onsitePaymentTarget, setOnsitePaymentTarget] = useState<Booking | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const ITEMS_PER_PAGE = 10

  const [showApproveCancellationConfirm, setShowApproveCancellationConfirm] = useState(false)
  const [showDeclineCancellationModal, setShowDeclineCancellationModal] = useState(false)
  const [declineCancellationReason, setDeclineCancellationReason] = useState("")
  const [declineCancellationTarget, setDeclineCancellationTarget] = useState<Booking | null>(null)
  const [showApproveModificationConfirm, setShowApproveModificationConfirm] = useState(false)
  const [showDeclineModificationModal, setShowDeclineModificationModal] = useState(false)
  const [declineModificationReason, setDeclineModificationReason] = useState("")
  const [declineModificationTarget, setDeclineModificationTarget] = useState<Booking | null>(null)
  const [showMarkCompletedConfirm, setShowMarkCompletedConfirm] = useState(false)
  const [showApproveCancellationTarget, setShowApproveCancellationTarget] = useState<string | null>(null)
  const [showApproveModificationTarget, setShowApproveModificationTarget] = useState<string | null>(null)
  const [showMarkCompletedTarget, setShowMarkCompletedTarget] = useState<string | null>(null)
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false)

  useEffect(() => {
    if (!selectedBooking) return
    const found = bookings.find((b: Booking) => b.id === selectedBooking.id)
    if (found && found !== selectedBooking) {
      setSelectedBooking(found)
    }
  }, [bookings, selectedBooking?.id])

  const searchParams = useSearchParams()

  useEffect(() => {
    const statusParam = searchParams?.get("status")
    if (statusParam) {
      setStatusFilter(statusParam)
    }
  }, [searchParams])

  const venueOptions = useMemo(() => {
    const hasOffice = bookings.some((b) => isOfficeBooking(b))
    const hasEvent = bookings.some((b) => !isOfficeBooking(b))
    const options: { value: string; label: string }[] = [{ value: "all", label: "All Venues" }]
    if (hasOffice) options.push({ value: "office", label: "Office Rental" })
    if (hasEvent) options.push({ value: "event", label: "Event Venue" })
    return options
  }, [bookings])

  const filteredBookings = useMemo(() => {
    return bookings
      .filter((b) => {
        if (statusFilter !== "all") {
          if (statusFilter === "requests") {
            if (!isCancellationRequestPending(b) && b.status !== "modification_under_review") return false
          } else {
            if (getBookingLifecycleStatus(b as unknown as Record<string, unknown>) !== statusFilter) return false
          }
        }
        if (venueFilter === "office" && !isOfficeBooking(b)) return false
        if (venueFilter === "event" && isOfficeBooking(b)) return false
        if (!searchQuery) return true
        const q = searchQuery.toLowerCase()
        return [b.id, b.eventName, b.venue, b.userInfo?.name, b.userInfo?.email, b.userInfo?.phone, b.paymentMethod]
          .some((f) => f && String(f).toLowerCase().includes(q))
      })
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return (isNaN(bTime) ? 0 : bTime) - (isNaN(aTime) ? 0 : aTime)
      })
  }, [bookings, statusFilter, venueFilter, searchQuery])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, statusFilter, venueFilter])

  const totalPages = Math.ceil(filteredBookings.length / ITEMS_PER_PAGE)
  const safePage = currentPage > totalPages ? Math.max(totalPages, 1) : currentPage
  const paginatedBookings = filteredBookings.slice(
    (safePage - 1) * ITEMS_PER_PAGE,
    safePage * ITEMS_PER_PAGE,
  )

  useEffect(() => {
    if (bookingCtx.isLoading) return
    console.log(
      `[DEBUG][ADMIN BOOKINGS] pipeline — raw bookings: ${bookings.length}, after filters: ${filteredBookings.length}, UI rows on page: ${paginatedBookings.length} (status="${statusFilter}", venue="${venueFilter}", search="${searchQuery}")`,
    )
  }, [bookings, filteredBookings, paginatedBookings, bookingCtx.isLoading, statusFilter, venueFilter, searchQuery])

  const [highlightedBookingId, setHighlightedBookingId] = useState<string | null>(null)
  const highlightHandledRef = useRef(false)
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const h = sessionStorage.getItem("admin_booking_highlight")
    if (h) {
      setHighlightedBookingId(h)
      setSearchQuery("")
      setStatusFilter("all")
      setVenueFilter("all")
    }
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ bookingId: string }>
      const bookingId = customEvent.detail?.bookingId
      if (!bookingId) return
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
        highlightTimeoutRef.current = null
      }
      highlightHandledRef.current = false
      if (highlightedBookingId === bookingId) {
        setHighlightedBookingId(null)
        requestAnimationFrame(() => {
          highlightHandledRef.current = false
          setHighlightedBookingId(bookingId)
        })
      } else {
        setHighlightedBookingId(bookingId)
      }
      setSearchQuery("")
      setStatusFilter("all")
      setVenueFilter("all")
    }
    window.addEventListener("admin-booking-highlight", handler)
    return () => {
      window.removeEventListener("admin-booking-highlight", handler)
    }
  }, [highlightedBookingId])

  useEffect(() => {
    if (!highlightedBookingId || filteredBookings.length === 0) return
    if (highlightHandledRef.current) return
    const idx = filteredBookings.findIndex((b) => b.id === highlightedBookingId)
    if (idx === -1) return
    const page = Math.floor(idx / ITEMS_PER_PAGE) + 1
    if (page !== safePage) {
      setCurrentPage(page)
      return
    }
    highlightHandledRef.current = true
    sessionStorage.removeItem("admin_booking_highlight")
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedBookingId(null)
      highlightTimeoutRef.current = null
    }, 3000)
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
        highlightTimeoutRef.current = null
      }
    }
  }, [highlightedBookingId, filteredBookings, safePage])

  const confirmApproveCancellation = async () => {
    const id = showApproveCancellationTarget
    if (!id || !approveCancellation) return
    try {
      await approveCancellation(id)
      setShowApproveCancellationConfirm(false)
      setShowApproveCancellationTarget(null)
      toast({
        title: "Cancellation Approved",
        description: `Booking ${id} has been cancelled.`,
        className: "border-none bg-rose-500 text-white",
      })
    } catch (error: unknown) {
      toast({
        title: "Cancellation Approval Failed",
        description: error instanceof Error ? error.message : "Unable to approve this cancellation.",
        variant: "destructive",
      })
    }
  }

  const confirmDeclineCancellation = async () => {
    if (!declineCancellationTarget || !declineCancellationReason.trim() || !declineCancellation) return
    const target = declineCancellationTarget
    const reason = declineCancellationReason.trim()
    try {
      await declineCancellation(target.id, reason)
      setShowDeclineCancellationModal(false)
      setDeclineCancellationTarget(null)
      setDeclineCancellationReason("")
      toast({
        title: "Cancellation Declined",
        description: `Booking ${target.id} will continue. Cancellation request has been declined.`,
        className: "border-none bg-emerald-500 text-white",
      })
    } catch (error: unknown) {
      toast({
        title: "Cancellation Rejection Failed",
        description: error instanceof Error ? error.message : "Unable to reject this cancellation.",
        variant: "destructive",
      })
    }
  }

  const confirmApproveModification = async () => {
    const id = showApproveModificationTarget
    if (!id || !bookingCtx?.approveModification) return
    try {
      const updated = await bookingCtx.approveModification(id)
      setShowApproveModificationConfirm(false)
      setShowApproveModificationTarget(null)
      if (selectedBooking && selectedBooking.id === id) setSelectedBooking(updated)
      toast({
        title: "Modification Approved",
        description: `Booking ${id} has been updated with the requested changes.`,
        className: "border-none bg-blue-500 text-white",
      })
    } catch (error) {
      toast({
        title: "Modification Approval Failed",
        description: error instanceof Error ? error.message : "Unable to approve this modification.",
        variant: "destructive",
      })
    }
  }

  const confirmDeclineModification = async () => {
    if (!declineModificationTarget || !declineModificationReason.trim() || !bookingCtx?.declineModification) return
    const target = declineModificationTarget
    const reason = declineModificationReason.trim()
    try {
      const updated = await bookingCtx.declineModification(target.id, reason)
      setShowDeclineModificationModal(false)
      setDeclineModificationTarget(null)
      setDeclineModificationReason("")
      if (selectedBooking?.id === target.id) setSelectedBooking(updated)
      toast({
        title: "Modification Declined",
        description: `Booking ${target.id} has been declined. Original booking unchanged.`,
        className: "border-none bg-amber-500 text-white",
      })
    } catch (error) {
      toast({
        title: "Modification Rejection Failed",
        description: error instanceof Error ? error.message : "Unable to decline this modification.",
        variant: "destructive",
      })
    }
  }

  const handleMarkCompleted = (id: string) => {
    setShowMarkCompletedTarget(id)
    setShowMarkCompletedConfirm(true)
  }

  const confirmMarkCompleted = async () => {
    const id = showMarkCompletedTarget
    if (!id) return
    const updated = await updateBookingStatus?.(id, "completed")
    if (!updated) return
    setShowMarkCompletedConfirm(false)
    setShowMarkCompletedTarget(null)
    toast({
      title: "Booking Completed",
      description: `Booking ${id} has been marked as completed.`,
      className: "border-none bg-emerald-500 text-white",
    })
  }

  const handleMarkContractSigned = async () => {
    if (!selectedBooking || !markContractSigned) return
    const id = selectedBooking.id
    try {
      await markContractSigned(id, "Administrator")
      setShowContractConfirm(false)
      toast({
        title: "Contract Signed",
        description: `Contract for booking ${id} has been marked as signed.`,
        className: "border-none bg-blue-500 text-white",
      })
    } catch (error) {
      toast({
        title: "Contract Update Failed",
        description: error instanceof Error ? error.message : "Unable to mark the contract as signed.",
        variant: "destructive",
      })
    }
  }

  const STATUS_OPTIONS = [
    { value: "all", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "confirmed", label: "Confirmed" },
    { value: "requests", label: "Requests" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ]

  if (bookingCtx?.isLoading && bookings.length === 0) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-x-hidden">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-orange-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 animate-in fade-in duration-500">
        <BookingDetailsModal
          booking={selectedBooking}
          open={!!selectedBooking}
          onClose={() => { setSelectedBooking(null); setShowContractConfirm(false) }}
          onMarkCompleted={handleMarkCompleted}
          onMarkContractSigned={() => setShowContractConfirm(true)}
          onSendReminder={(id) => {
            const target = bookings.find((b) => b.id === id)
            if (target) setSendReminderTarget(target)
          }}
          onRecordOnsitePayment={(id) => {
            const target = bookings.find((b) => b.id === id)
            if (target) setOnsitePaymentTarget(target)
          }}
          onApproveCancellation={(id) => {
            setShowApproveCancellationTarget(id)
            setShowApproveCancellationConfirm(true)
          }}
          onContinueBooking={(id) => {
            const target = bookings.find((b) => b.id === id)
            if (target) {
              setDeclineCancellationTarget(target)
              setShowDeclineCancellationModal(true)
            }
          }}
          paymentRecords={bookingCtx?.paymentRecords || []}
          onApproveModification={(id) => {
            setShowApproveModificationTarget(id)
            setShowApproveModificationConfirm(true)
          }}
          onDeclineModification={(id) => {
            const target = bookings.find((b) => b.id === id)
            if (target) {
              setDeclineModificationTarget(target)
              setShowDeclineModificationModal(true)
            }
          }}
          onMarkAsRefunded={markAsRefunded}
        />

        <ApproveCancellationConfirmModal
          open={showApproveCancellationConfirm}
          booking={selectedBooking}
          onCancel={() => { setShowApproveCancellationConfirm(false); setShowApproveCancellationTarget(null) }}
          onConfirm={confirmApproveCancellation}
        />
        <DeclineCancellationModal
          open={showDeclineCancellationModal}
          booking={declineCancellationTarget}
          reason={declineCancellationReason}
          onReasonChange={setDeclineCancellationReason}
          onCancel={() => { setShowDeclineCancellationModal(false); setDeclineCancellationTarget(null); setDeclineCancellationReason("") }}
          onConfirm={confirmDeclineCancellation}
        />
        <ApproveModificationConfirmModal
          open={showApproveModificationConfirm}
          booking={selectedBooking}
          onCancel={() => { setShowApproveModificationConfirm(false); setShowApproveModificationTarget(null) }}
          onConfirm={confirmApproveModification}
        />
        <DeclineModificationModal
          open={showDeclineModificationModal}
          booking={declineModificationTarget}
          reason={declineModificationReason}
          onReasonChange={setDeclineModificationReason}
          onCancel={() => { setShowDeclineModificationModal(false); setDeclineModificationTarget(null); setDeclineModificationReason("") }}
          onConfirm={confirmDeclineModification}
        />
        <MarkCompletedConfirmModal
          open={showMarkCompletedConfirm}
          booking={selectedBooking}
          onCancel={() => { setShowMarkCompletedConfirm(false); setShowMarkCompletedTarget(null) }}
          onConfirm={confirmMarkCompleted}
        />

        <ContractSigningConfirmModal
          booking={selectedBooking}
          open={showContractConfirm}
          onCancel={() => setShowContractConfirm(false)}
          onConfirm={handleMarkContractSigned}
        />
        <RecordOnsitePaymentModal
          booking={onsitePaymentTarget}
          open={!!onsitePaymentTarget}
          onClose={() => setOnsitePaymentTarget(null)}
          paymentRecords={bookingCtx?.paymentRecords || []}
          onRecorded={(updated) => {
            setSelectedBooking(updated)
            setOnsitePaymentTarget(null)
            toast({
              title: "Onsite Payment Recorded",
              description: `Onsite payment has been recorded for booking ${updated.id}.`,
              className: "border-none bg-emerald-500 text-white",
            })
          }}
        />
        <MaintenanceCalendarModal
          open={showMaintenanceModal}
          onClose={() => setShowMaintenanceModal(false)}
        />
        <BalanceReminderModal
          booking={sendReminderTarget}
          remainingBalance={sendReminderTarget ? calculatePaymentSummary(sendReminderTarget, getRecordsForBooking(bookingCtx?.paymentRecords || [], sendReminderTarget)).remainingBalance : undefined}
          open={!!sendReminderTarget}
          onCancel={() => setSendReminderTarget(null)}
          onConfirm={() => {
            if (!sendReminderTarget || !sendBalanceReminder) return
            const id = sendReminderTarget.id
            void sendBalanceReminder(id).then(() => {
              setSendReminderTarget(null)
              toast({
                title: "Balance Reminder Sent",
                description: `Reminder has been recorded for booking ${id}.`,
                className: "border-none bg-blue-500 text-white",
              })
            }).catch((error: unknown) => {
              toast({
                title: "Balance Reminder Failed",
                description: error instanceof Error ? error.message : "Unable to send the balance reminder.",
                variant: "destructive",
              })
            })
          }}
        />

        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <Button
                onClick={() => setShowMaintenanceModal(true)}
                variant="outline"
                className="h-10 shrink-0 whitespace-nowrap rounded-xl border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-orange-600 gap-1.5 self-start sm:self-auto"
              >
                <Wrench className="h-3.5 w-3.5" />
                Maintenance Calendar
              </Button>

              <Select value={venueFilter} onValueChange={setVenueFilter}>
                <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-orange-600 sm:w-[170px]">
                  <div className="flex items-center gap-2">
                    <Filter className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <SelectValue placeholder="All Venues" />
                  </div>
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-200 shadow-xl">
                  {venueOptions.map((v) => (
                    <SelectItem key={v.value} value={v.value} className={v.value === "all" ? "font-bold" : ""}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-orange-600 sm:w-[150px]">
                  <div className="flex items-center gap-2">
                    <SelectValue placeholder="All" />
                  </div>
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-200 shadow-xl">
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="font-bold">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative w-full sm:w-[300px]">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search bookings..."
                  className="h-10 rounded-xl border-slate-200 bg-white pl-9 pr-16 text-xs focus-visible:ring-orange-600"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(""); setStatusFilter("all"); window.history.replaceState(null, "", window.location.pathname) }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 transition hover:bg-slate-100 hover:text-orange-600"
                  >
                    Clear
                  </button>
                )}
              </div>
        </div>

        <section className="mt-4 space-y-3">
          {filteredBookings.length === 0 ? (
            <div className="flex min-h-[230px] flex-col items-center justify-center px-6 py-10 text-center">
              <Inbox className="mb-3 h-10 w-10 text-slate-300" />
              <h3 className="text-base font-black text-slate-900">No bookings found</h3>
              <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
                {searchQuery || statusFilter !== "all"
                  ? "No bookings match your current filters."
                  : "No bookings have been created yet."}
              </p>
            </div>
          ) : (
            paginatedBookings.map((booking) => (
              <AdminBookingCard
                key={booking.id}
                booking={booking}
                onView={() => { setSelectedBooking(booking); markByBookingId(booking.id, ADMIN_BOOKING_TYPES) }}
                isHighlighted={highlightedBookingId === booking.id}
              />
            ))
          )}
        </section>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 pt-4 pb-2">
            <Button
              variant="outline"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="h-9 rounded-lg border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Previous
            </Button>
            <span className="text-xs font-semibold text-slate-500">
              Page {safePage} of {totalPages}
            </span>
            <Button
              variant="outline"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="h-9 rounded-lg border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function AdminBookingCard({
  booking,
  onView,
  isHighlighted,
}: {
  booking: Booking
  onView: () => void
  isHighlighted?: boolean
}) {
  const isOfficeRental = isOfficeBooking(booking)
  const cardRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef(false)

  useEffect(() => {
    if (!isHighlighted || !cardRef.current) return
    if (highlightRef.current) return
    highlightRef.current = true
    cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    sessionStorage.removeItem("admin_booking_highlight")
    const timer = setTimeout(() => {
      highlightRef.current = false
    }, 3000)
    return () => clearTimeout(timer)
  }, [isHighlighted])

  const innerCard = (
    <div
      ref={cardRef}
      className="group grid w-full max-w-full min-w-0 grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition sm:flex sm:items-center sm:gap-6 hover:border-orange-200 hover:shadow-md"
    >
      <div className="flex min-w-0 items-center gap-3 sm:flex-1">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
          {isOfficeRental ? <FileText className="h-5 w-5" /> : <Calendar className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
            {isOfficeRental ? "Rental" : "Event"}
          </p>
          <p className="break-words whitespace-normal text-sm font-black leading-snug text-slate-900 line-clamp-2">
            {booking.eventName || "Untitled"}
          </p>
          <p className="break-words text-[11px] font-bold text-orange-600">
            {booking.id}
          </p>
        </div>
      </div>

      <div className="min-w-0 sm:flex-1">
        <p className="whitespace-normal break-words text-[9px] font-black uppercase tracking-[0.2em] text-black">Customer</p>
        <p className="whitespace-normal break-words text-xs font-black text-slate-800">{booking.userInfo?.name || "—"}</p>
        <p className="whitespace-normal break-words text-[10px] font-bold text-slate-500">{booking.userInfo?.email || "—"}</p>
      </div>

      <div className="min-w-0 sm:flex-1">
        <p className="whitespace-normal break-words text-[9px] font-black uppercase tracking-[0.2em] text-black">Venue</p>
        <p className="whitespace-normal break-words text-xs font-bold text-slate-800">{booking.venue || "N/A"}</p>
      </div>

      <div className="col-span-2 flex shrink-0 flex-col gap-2.5 sm:col-span-1 sm:w-[160px] sm:items-end">
        <span
          className={cn(
            "inline-flex w-full items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap sm:w-[160px]",
            getStatusBadgeClass(booking.status),
          )}
        >
          {getStatusLabel(booking.status)}
        </span>
        {isCancellationRequestPending(booking) && (
          <span className="inline-flex w-full items-center justify-center rounded-md border border-amber-100 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-amber-700 whitespace-nowrap sm:w-[160px]">
            Cancellation Requested
          </span>
        )}
        <TooltipProvider delayDuration={400}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                onClick={onView}
                className="h-9 w-full shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:w-[160px]"
              >
                View Details
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-[10px] font-semibold">
              Open booking details
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )

  return (
    <div className={isHighlighted ? "notification-target-highlight" : undefined}>
      {innerCard}
    </div>
  )
}

function BookingDetailsModal({
  booking: propBooking,
  open,
  onClose,
  onMarkCompleted,
  onMarkContractSigned,
  onSendReminder,
  onRecordOnsitePayment,
  onApproveCancellation,
  onContinueBooking,
  onApproveModification,
  onDeclineModification,
  onMarkAsRefunded,
  paymentRecords,
}: {
  booking: Booking | null
  open: boolean
  onClose: () => void
  onMarkCompleted: (id: string) => void
  onMarkContractSigned: () => void
  onSendReminder?: (id: string) => void
  onRecordOnsitePayment?: (id: string) => void
  onApproveCancellation?: (id: string) => void
  onContinueBooking?: (id: string) => void
  onApproveModification?: (id: string) => void
  onDeclineModification?: (id: string) => void
  onMarkAsRefunded?: (id: string) => void
  paymentRecords?: PaymentRecordLike[] | null
}) {
  const { bookings } = useBookings()
  const router = useRouter()

  const booking = useMemo(() => {
    if (!propBooking) return null
    return bookings.find((b) => b.id === propBooking.id) || propBooking
  }, [bookings, propBooking?.id])

  const { toast } = useToast()

  if (!booking) return null

  // Canonical overall payment state — identical to the Payment Verification
  // page: the booking's overall status derives from its accepted/verified
  // payment records only, never from the latest record or stored fields.
  const bookingPaymentRecords = getRecordsForBooking(paymentRecords, booking)
  const hasPaymentRecords = bookingPaymentRecords.length > 0
  const paymentSummary = calculatePaymentSummary(
    booking,
    bookingPaymentRecords,
  )
  const canonicalPayStatus = paymentSummary.overallStatus

  const isPaymentVerified = (() => {
    if (hasPaymentRecords) {
      return canonicalPayStatus === "completed" || canonicalPayStatus === "partial"
    }
    return (
      canonicalPayStatus === "completed" ||
      canonicalPayStatus === "partial" ||
      booking.isSlotSecured === true
    )
  })()

  const isOfficeRental = isOfficeBooking(booking)
  const typeLabel = isOfficeRental ? "Office Space Rental" : booking.eventType || "Event Venue Rental"
  const startDate = formatDate(booking.date)
  const endDate = (booking as any)?.endDate ? formatDate((booking as any).endDate) : startDate
  const isCompleted = String(booking.status || "").toLowerCase() === "completed"
  const isCancelled = ["cancelled", "declined"].includes(String(booking.status || "").toLowerCase())

  const normalizeStatus = (value: any) => String(value || "").trim().toLowerCase()

  const amountPaid = paymentSummary.moneyReceivedTotal

  const remainingBalance = paymentSummary.remainingBalance

  const paymentStatus = normalizeStatus(
    hasPaymentRecords ? canonicalPayStatus : (booking as any).paymentStatus,
  )

  const bookingStatus = normalizeStatus((booking as any).bookingStatus || booking.status)
  const isCancellationRequested = isCancellationRequestPending(booking)
  const cancellationAudit = getCancellationAudit(booking as unknown as Record<string, unknown>)
  const isModificationUnderReview = normalizeStatus(booking.status) === "modification_under_review"

  const hasActiveProof = (() => {
    const proofExists = Boolean(
      booking?.proofUrl ||
      (booking as any)?.paymentProof ||
      (booking as any)?.proofOfPayment ||
      (booking as any)?.proofImage ||
      (booking as any)?.receiptImage
    )
    const isUnderReview =
      paymentStatus === "for_review" ||
      paymentStatus === "cash_pending" ||
      paymentStatus === "slot_pending" ||
      paymentStatus === "pending_verification" ||
      normalizeStatus(booking.status) === "verifying"
    return proofExists && isUnderReview
  })()

  const isEventFinished = (() => {
    if (!booking.date) return false
    const bookingEndDate = (booking as any)?.endDate
    if (bookingEndDate) {
      const endDateObj = new Date(bookingEndDate + "T23:59:59")
      if (!isNaN(endDateObj.getTime())) return endDateObj.getTime() < Date.now()
    }
    const eventDate = new Date(booking.date)
    const endTime = booking.endTime
    if (endTime) {
      const [hours, minutes] = String(endTime).split(":").map(Number)
      if (!isNaN(hours)) eventDate.setHours(hours, minutes || 0, 0, 0)
    }
    return eventDate.getTime() < Date.now()
  })()

  const isFullyPaid = paymentSummary.fullyPaid

  const normalizedStatus = normalizeStatus(booking.status)
  const isPaymentUnderReview =
    normalizedStatus === "verifying" ||
    ["for_review", "cash_pending", "slot_pending", "pending_verification", "pending verification", "for verification"].includes(paymentStatus)
  const isContractSigningActionVisible = (() => {
    const isContractSigningRequired = normalizedStatus === "contract_signing_required"
    const showContractSigning = isOfficeRental
      ? isContractSigningRequired
      : isPaymentVerified
    const contractAlreadySigned = booking.contractStatus === "Signed" || booking.contractSigned
    return !contractAlreadySigned && showContractSigning && !isCancelled && !isCompleted
  })()
  const showContractSigningActionInFooter =
    isContractSigningActionVisible &&
    (normalizedStatus === "confirmed" ||
      normalizedStatus === "reservation_secured" ||
      normalizedStatus === "rental_expired" ||
      (isFullyPaid &&
        !isPaymentUnderReview &&
        !isCancellationRequested &&
        !isModificationUnderReview &&
        !["contract_signing_required", "active_rental", "pending"].includes(normalizedStatus)))

  const timeValue =
    booking.time ||
    `${booking.startTime || ""}${booking.startTime && booking.endTime ? " – " : ""}${booking.endTime || ""}` ||
    "—"

  // Keep the existing refund action's availability in both cancellation views.
  const showRefundAction = Boolean(booking.refundStatus === "requested" && (isCancelled
    ? amountPaid > 0 && Boolean(onMarkAsRefunded)
    : isCancellationRequested ||
      (booking.cancellationStatus && booking.cancellationStatus !== "None") ||
      ((booking as any).cancelRequestStatus && (booking as any).cancelRequestStatus !== "None")))
  const hasCustomerSubmittedPayment =
    (booking as any).hasActivePaymentSubmission === true ||
    paymentSummary.hasPendingSubmission ||
    paymentStatus === "for_review" ||
    paymentStatus === "cash_pending" ||
    paymentStatus === "slot_pending" ||
    paymentStatus === "pending_verification"
  const secondaryActionClassName = bookingDetailsActionToneClassNames.slate
  const managementActions = (() => {
    if (isCancelled) return null
    const normStatus = normalizeStatus(booking.status)
    const isPencilBooking =
      normStatus === "pending" &&
      !["for_review", "cash_pending", "slot_pending", "pending_verification", "pending verification", "for verification"].includes(paymentStatus)
    const isForVerificationStatus =
      normStatus === "verifying" ||
      ["for_review", "cash_pending", "slot_pending", "pending_verification", "pending verification", "for verification"].includes(paymentStatus)
    const isApprovedOrConfirmed = ["confirmed", "reservation_secured"].includes(normStatus)
    const canDoRecordOnsite =
      remainingBalance > 0 && !isFullyPaid && !isCompleted && !isCancelled &&
      !hasActiveProof && !hasCustomerSubmittedPayment
    const canDoBalanceReminder =
      isApprovedOrConfirmed && remainingBalance > 0 && !isCompleted && !isCancelled
    const isMarkCompletedEnabled =
      isFullyPaid && remainingBalance === 0 && isEventFinished && !isCompleted && !isCancelled
    const isMarkCompletedVisible =
      isFullyPaid && remainingBalance === 0 && !isCompleted && !isCancelled

    if (isCancellationRequested && !isCompleted && !isCancelled) {
      if (!onContinueBooking && !onApproveCancellation) return null
      return <>
        {onContinueBooking && (
          <Button onClick={() => onContinueBooking(booking.id)} variant="outline"
            className={cn(bookingDetailsStackedActionClassName, bookingDetailsActionToneClassNames.slate)}>
            <CheckCircle2 className="size-4" /> Reject Cancellation
          </Button>
        )}
        {onApproveCancellation && (
          <Button onClick={() => onApproveCancellation(booking.id)} variant={showRefundAction ? "outline" : "default"}
            className={cn(bookingDetailsStackedActionClassName, showRefundAction ? secondaryActionClassName : "bg-rose-600 text-white hover:bg-rose-700")}>
            <AlertCircle className="size-4" /> Approve Cancellation
          </Button>
        )}
      </>
    }
    if (isModificationUnderReview && !isCompleted && !isCancelled) {
      if (!onDeclineModification && !onApproveModification) return null
      return <>
        {onDeclineModification && (
          <Button onClick={() => onDeclineModification(booking.id)} variant="outline"
            className={cn(bookingDetailsStackedActionClassName, bookingDetailsActionToneClassNames.destructive)}>
            <XCircle className="size-4" /> Decline Modification
          </Button>
        )}
        {onApproveModification && (
          <Button onClick={() => onApproveModification(booking.id)} variant={showRefundAction ? "outline" : "default"}
            className={cn(bookingDetailsStackedActionClassName, showRefundAction ? secondaryActionClassName : bookingDetailsActionToneClassNames.primary)}>
            <CheckCircle2 className="size-4" /> Approve Modification
          </Button>
        )}
      </>
    }
    if (hasCustomerSubmittedPayment && remainingBalance > 0) {
      return (
        <Button type="button" disabled className={cn(bookingDetailsStackedActionClassName, adminBookingDetailsActionColors.onsite)}>
          <DollarSign className="size-4" /> Record Onsite Payment
        </Button>
      )
    }
    if (isForVerificationStatus) {
      if (!canDoRecordOnsite || !onRecordOnsitePayment) return null
      return (
        <Button onClick={() => onRecordOnsitePayment(booking.id)} variant={showRefundAction ? "outline" : "default"}
          className={cn(bookingDetailsStackedActionClassName, adminBookingDetailsActionColors.onsite)}>
          <DollarSign className="size-4" /> Record Onsite Payment
        </Button>
      )
    }
    if (isCompleted || isCancelled) return null
    if (normStatus === "contract_signing_required" || normStatus === "active_rental") {
      const canRecord = canDoRecordOnsite && onRecordOnsitePayment
      const canRemind = isApprovedOrConfirmed && remainingBalance > 0 && onSendReminder
      if (!canRecord && !canRemind) return null
      return <>
        {canRemind && (
          <Button onClick={() => onSendReminder(booking.id)} variant="outline"
            className={cn(bookingDetailsStackedActionClassName, adminBookingDetailsActionColors.reminder)}>
            <Bell className="size-4" /> Send Balance Reminder
          </Button>
        )}
        {canRecord && (
          <Button onClick={() => onRecordOnsitePayment(booking.id)} variant={showRefundAction ? "outline" : "default"}
            className={cn(bookingDetailsStackedActionClassName, adminBookingDetailsActionColors.onsite)}>
            <DollarSign className="size-4" /> Record Onsite Payment
          </Button>
        )}
      </>
    }
    if (normStatus === "rental_expired") {
      const canMarkCompleted = isFullyPaid && !isCompleted && onMarkCompleted
      if (!canMarkCompleted && !showContractSigningActionInFooter) return null
      return <>
        {showContractSigningActionInFooter && (
          <ContractSigningAction onClick={onMarkContractSigned} secondary={Boolean(canMarkCompleted || showRefundAction)} />
        )}
        {canMarkCompleted && (
          <MarkCompletedAction enabled={Boolean(canMarkCompleted)} eventFinished={isEventFinished}
            onClick={() => onMarkCompleted(booking.id)} secondary={Boolean(showRefundAction)} />
        )}
      </>
    }
    if (isPencilBooking) {
      if (!canDoRecordOnsite || !onRecordOnsitePayment) return null
      return (
        <Button onClick={() => onRecordOnsitePayment(booking.id)} variant={showRefundAction ? "outline" : "default"}
          className={cn(bookingDetailsStackedActionClassName, adminBookingDetailsActionColors.onsite)}>
          <DollarSign className="size-4" /> Record Onsite Payment
        </Button>
      )
    }
    if (isApprovedOrConfirmed) {
      if (!(canDoBalanceReminder && onSendReminder) && !(canDoRecordOnsite && onRecordOnsitePayment) &&
        !isMarkCompletedVisible && !showContractSigningActionInFooter) return null
      return <>
        {canDoBalanceReminder && onSendReminder && (
          <Button onClick={() => onSendReminder(booking.id)} variant="outline"
            className={cn(bookingDetailsStackedActionClassName, adminBookingDetailsActionColors.reminder)}>
            <Bell className="size-4" /> Send Balance Reminder
          </Button>
        )}
        {canDoRecordOnsite && onRecordOnsitePayment && (
          <Button onClick={() => onRecordOnsitePayment(booking.id)} variant={showRefundAction ? "outline" : "default"}
            className={cn(bookingDetailsStackedActionClassName, adminBookingDetailsActionColors.onsite)}>
            <DollarSign className="size-4" /> Record Onsite Payment
          </Button>
        )}
        {showContractSigningActionInFooter && (
          <ContractSigningAction onClick={onMarkContractSigned}
            secondary={Boolean((canDoRecordOnsite && onRecordOnsitePayment) || isMarkCompletedVisible || showRefundAction)} />
        )}
        {isMarkCompletedVisible && (
          <MarkCompletedAction enabled={isMarkCompletedEnabled} eventFinished={isEventFinished}
            onClick={() => onMarkCompleted(booking.id)} secondary={Boolean(showRefundAction)} />
        )}
      </>
    }
    if (isFullyPaid && !isCompleted && !isCancelled) {
      if (!isMarkCompletedVisible && !showContractSigningActionInFooter) return null
      return <>
        {showContractSigningActionInFooter && (
          <ContractSigningAction onClick={onMarkContractSigned} secondary={isMarkCompletedVisible || Boolean(showRefundAction)} />
        )}
        {isMarkCompletedVisible && (
          <MarkCompletedAction enabled={isMarkCompletedEnabled} eventFinished={isEventFinished}
            onClick={() => onMarkCompleted(booking.id)} secondary={Boolean(showRefundAction)} />
        )}
      </>
    }
    return null
  })()

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent aria-describedby={undefined}
        plain
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[900px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-orange-700">
              Booking Details
            </p>
            <DialogTitle className="mt-1 text-lg font-bold leading-snug text-slate-900 [overflow-wrap:anywhere] sm:text-xl">
              {booking.eventName || "Untitled Booking"}
            </DialogTitle>
            <p className="mt-1 text-xs font-medium text-slate-500 [overflow-wrap:anywhere]">
              {typeLabel} <span className="mx-1.5 text-slate-300">·</span> #{booking.id}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em]",
                  getStatusBadgeClass(booking.status),
                )}
              >
                {getStatusLabel(booking.status)}
              </span>
              {booking.cancellationStatus && booking.cancellationStatus !== "None" && (
                <span className="inline-flex items-center rounded-md border border-amber-100 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-amber-700">
                  Cancellation: {isCancellationRequested ? "Pending Review" : booking.cancellationStatus}
                </span>
              )}
              {booking.refundStatus && (
                <span className={cn(
                  "inline-flex items-center rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em]",
                  booking.refundStatus === "eligible"
                    ? "border-yellow-200 bg-yellow-50 text-yellow-700"
                    : booking.refundStatus === "requested"
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : booking.refundStatus === "refunded"
                        ? "border-slate-200 bg-slate-50 text-slate-600"
                        : booking.refundStatus === "not_eligible"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : "border-blue-100 bg-blue-50 text-blue-700",
                )}>
                  Refund: {booking.refundStatus === "eligible"
                    ? "Eligible"
                    : booking.refundStatus === "requested"
                      ? "Requested"
                      : booking.refundStatus === "refunded"
                        ? "Refunded"
                        : booking.refundStatus === "not_eligible"
                          ? "Not Eligible"
                          : booking.refundStatus}
                </span>
              )}
            </div>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2"
              aria-label="Close booking details"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </header>

        <div role="region" aria-label="Booking details content" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-600 sm:px-6">

          {isCancelled && (
            <div className="space-y-5">
              {(isCancelled || (booking.cancellationStatus && booking.cancellationStatus !== "None")) && (
                <section>
                  <div className="mb-4 flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                    <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Cancellation Details</p>
                  </div>
                  <div className="space-y-3 text-sm font-bold text-slate-700">
                    <div className="flex justify-between">
                      <span className="text-sm font-bold text-slate-900">Cancellation Status</span>
                      <span className="text-sm font-black text-slate-900">{booking.cancellationStatus || (booking as any).cancelRequestStatus || "Approved"}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900 shrink-0">Source</span>
                      <span className="text-sm font-black text-slate-900 max-w-[60%] text-right break-words">{cancellationAudit.source}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900 shrink-0">Type</span>
                      <span className="text-sm font-black text-slate-900 max-w-[60%] text-right break-words">{cancellationAudit.type}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900 shrink-0">Actor</span>
                      <span className="text-sm font-black text-slate-900 max-w-[60%] text-right break-words">{cancellationAudit.actorName}</span>
                    </div>
                    {booking.cancellationReviewedByName && (
                      <div className="flex justify-between gap-2">
                        <span className="text-sm font-bold text-slate-900 shrink-0">Reviewed By</span>
                        <span className="text-sm font-black text-slate-900 max-w-[60%] text-right break-words">{booking.cancellationReviewedByName}</span>
                      </div>
                    )}
                    <div className="flex justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900 shrink-0">Cancellation Reason</span>
                      <span className="text-sm font-black text-slate-900 max-w-[60%] text-right break-words">{cancellationAudit.reason}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900 shrink-0">Notes</span>
                      <span className="text-sm font-black text-slate-900 max-w-[60%] text-right break-words">{cancellationAudit.notes}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900">Cancellation Date</span>
                      <span className="text-sm font-black text-slate-900">{cancellationAudit.date === "Not recorded" ? cancellationAudit.date : formatDate(cancellationAudit.date)}</span>
                    </div>
                  </div>
                </section>
              )}

              <section>
                <div className="mb-4 flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                  <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Refund Details</p>
                </div>
                <div className="space-y-3 text-sm font-bold text-slate-700">
                  <div className="flex justify-between">
                    <span className="text-sm font-bold text-slate-900">Refund Eligibility</span>
                    <span className="text-sm font-black text-slate-900">
                      {getRefundStatusLabel(booking.refundStatus)}
                    </span>
                  </div>
                  {booking.refundEligibilityNote && (
                    <div className="flex justify-between">
                      <span className="text-sm font-bold text-slate-900">Eligibility Note</span>
                      <span className="text-sm font-black text-slate-900">{booking.refundEligibilityNote}</span>
                    </div>
                  )}
                  {booking.daysBeforeEventAtCancellation !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-sm font-bold text-slate-900">Days Before Event</span>
                      <span className="text-sm font-black text-slate-900">{booking.daysBeforeEventAtCancellation} days</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-sm font-bold text-slate-900">Refund Status</span>
                    <span className="text-sm font-black text-slate-900">
                      {getRefundStatusLabel(booking.refundStatus)}
                    </span>
                  </div>
                  {booking.refundClaimNote && (
                    <div className="mt-2 rounded-lg bg-amber-100/50 px-3 py-2 text-sm font-bold text-amber-800">
                      {booking.refundClaimNote}
                    </div>
                  )}
                  {booking.refundStatus === "requested" && (
                    <div className="mt-2 rounded-lg bg-blue-100/50 px-3 py-2 text-sm font-bold text-blue-700">
                      <p className="font-black text-sm">Customer has requested a refund.</p>
                      <p className="mt-1 text-sm font-bold">Verify their Official Receipt and Valid Government-issued ID, then mark as refunded.</p>
                      {booking.refundRequestedAt && (
                        <p className="mt-1 text-sm font-bold text-blue-500">Requested on: {new Date(booking.refundRequestedAt).toLocaleDateString()}</p>
                      )}
                    </div>
                  )}
                  {amountPaid > 0 && booking.refundStatus === "eligible" && (
                    <p className="text-sm font-bold text-amber-600">Awaiting refund request from customer</p>
                  )}
                  {booking.refundStatus === "refunded" && (
                    <div className="mt-2 rounded-lg bg-slate-100/50 px-3 py-2 text-sm font-bold text-slate-600">
                      <p className="font-black text-sm">Refund Completed</p>
                      {booking.refundedAt && (
                        <p className="mt-1 text-sm font-bold text-slate-400">Completed on: {new Date(booking.refundedAt).toLocaleDateString()}</p>
                      )}
                    </div>
                  )}
                  {booking.cancellationDeclineReason && (
                    <div className="mt-2 rounded-lg bg-rose-100/50 px-3 py-2 text-sm font-bold text-rose-700">
                      Decline Reason: {booking.cancellationDeclineReason}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
          {!isCancelled && (
          <>
            {isCancellationRequested && !isCompleted && (
              <div className="mb-3 rounded-xl bg-amber-50 p-3">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-amber-700">Cancellation Request</p>
                <p className="mt-1 text-sm text-amber-800">
                  The customer has requested to cancel this booking. Please review and take action.
                </p>
              </div>
            )}
            {isModificationUnderReview && !isCancellationRequested && !isCompleted && (
              <div className="mb-3 rounded-xl bg-purple-50 p-3">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-purple-700">Modification Under Review</p>
                <p className="mt-1 text-sm text-purple-800">
                  The customer has requested to modify this booking. Please review and take action.
                </p>
                {booking.modificationReason && (
                  <p className="mt-2 text-sm text-purple-700">Reason: {booking.modificationReason}</p>
                )}
              </div>
            )}
            {!((isCancellationRequested || isModificationUnderReview) && !isCompleted) &&
              hasCustomerSubmittedPayment && remainingBalance > 0 && (
              <p className="mb-3 text-xs font-semibold text-slate-500">
                Resolve the pending payment before recording another onsite payment.
              </p>
            )}
            <div className="space-y-3">
            <section className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 sm:p-4">
              <div className="mb-3 flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-700">Booking Information</p>
              </div>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 md:grid-cols-3">
                <BookingDetail label="Customer" value={booking.userInfo?.name || "—"} />
                <BookingDetail label="Email" value={booking.userInfo?.email || "—"} />
                <BookingDetail label="Booking Date" value={formatDate(booking.createdAt) || "—"} />
                <BookingDetail label={isOfficeRental ? "Start Date" : "Event Date"} value={startDate || "—"} />
                <BookingDetail label="End Date" value={endDate || "—"} />
                <BookingDetail label="Venue / Office" value={booking.venue || "—"} />
                {isOfficeRental && (
                  <>
                    <BookingDetail label="Company Name" value={(booking as any).companyName || booking.eventName || "N/A"} />
                    <BookingDetail label="Nature of Business" value={(booking as any).natureOfBusiness || booking.eventType || "N/A"} />
                    <BookingDetail label="Rental Term" value={(booking as any).rentalTerm || (booking as any).contractTerm || (booking as any).officeRentalTerm || "—"} />
                  </>
                )}
                {!isOfficeRental && (
                  <BookingDetail label="Guests" value={booking.guestCount ? `${booking.guestCount} pax` : "—"} />
                )}
                <BookingDetail label="Time" value={timeValue} />
                <BookingDetail label="Booking ID" value={`#${booking.id}`} />
                <BookingDetail label="Event Type" value={typeLabel} />
              </dl>
            </section>

          </div>

          {booking.specialRequests && (
            <section className="py-3 first:pt-0">
              <div className="mb-2 flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Special Requests</p>
              </div>
              <p className="text-sm font-bold leading-relaxed text-slate-700">{booking.specialRequests}</p>
            </section>
          )}

          {!isCancelled && (isCancellationRequested ||
            (booking.cancellationStatus && booking.cancellationStatus !== "None") ||
            ((booking as any).cancelRequestStatus && (booking as any).cancelRequestStatus !== "None")) ? (
            <section className="py-3 first:pt-0">
              <div className="mb-4 flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                <p className="text-sm font-black uppercase tracking-[0.2em] text-black">
                  {isCancellationRequested ? "Cancellation Request" : "Cancellation / Refund Status"}
                </p>
              </div>
              <div className="space-y-3 text-sm font-bold text-slate-700">
                <div className="flex justify-between">
                  <span className="text-sm font-bold text-slate-900">Status</span>
                  <span className="text-sm font-black text-slate-900">
                    {isCancellationRequested
                      ? "Pending Review"
                      : booking.cancellationStatus || (booking as any).cancelRequestStatus || "None"}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900">Source</span>
                  <span className="text-sm font-black text-slate-900 max-w-[60%] text-right break-words">{cancellationAudit.source}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900">Type</span>
                  <span className="text-sm font-black text-slate-900 max-w-[60%] text-right break-words">{cancellationAudit.type}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900">Actor</span>
                  <span className="text-sm font-black text-slate-900 max-w-[60%] text-right break-words">{cancellationAudit.actorName}</span>
                </div>
                {booking.cancellationReviewedByName && (
                  <div className="flex justify-between gap-2">
                    <span className="text-sm font-bold text-slate-900">Reviewed By</span>
                    <span className="text-sm font-black text-slate-900 max-w-[60%] text-right break-words">{booking.cancellationReviewedByName}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900">Reason</span>
                  <span className="text-sm font-black text-slate-900 max-w-[60%] text-right break-words">{cancellationAudit.reason}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900">Notes</span>
                  <span className="text-sm font-black text-slate-900 max-w-[60%] text-right break-words">{cancellationAudit.notes}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-bold text-slate-900">Date</span>
                  <span className="text-sm font-black text-slate-900">{cancellationAudit.date === "Not recorded" ? cancellationAudit.date : formatDate(cancellationAudit.date)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-bold text-slate-900">Refund</span>
                  <span className="text-sm font-black text-slate-900">{getRefundStatusLabel(booking.refundStatus)}</span>
                </div>
                {booking.refundEligibilityNote && (
                  <div className="flex justify-between">
                    <span className="text-sm font-bold text-slate-900">Eligibility</span>
                    <span className="text-sm font-black text-slate-900">{booking.refundEligibilityNote}</span>
                  </div>
                )}
                {booking.daysBeforeEventAtCancellation !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-sm font-bold text-slate-900">Days before event</span>
                    <span className="text-sm font-black text-slate-900">{booking.daysBeforeEventAtCancellation} days</span>
                  </div>
                )}
                {booking.refundClaimNote && (
                  <div className="mt-2 rounded-lg bg-amber-100/50 px-3 py-2 text-sm font-bold text-amber-800">
                    {booking.refundClaimNote}
                  </div>
                )}
                {booking.refundStatus === "requested" && (
                  <div className="mt-2 rounded-lg bg-blue-100/50 px-3 py-2 text-sm font-bold text-blue-700">
                    <p className="font-black text-sm">Customer has requested a refund.</p>
                    <p className="mt-1 text-sm font-bold">Verify their Official Receipt and Valid Government-issued ID, then mark as refunded.</p>
                    {booking.refundRequestedAt && (
                      <p className="mt-1 text-sm font-bold text-blue-500">Requested on: {new Date(booking.refundRequestedAt).toLocaleDateString()}</p>
                    )}
                  </div>
                )}
                {booking.refundStatus === "refunded" && (
                  <div className="mt-2 rounded-lg bg-slate-100/50 px-3 py-2 text-sm font-bold text-slate-600">
                    <p className="font-black text-sm">Refund Completed</p>
                    {booking.refundedAt && (
                      <p className="mt-1 text-sm font-bold text-slate-400">Completed on: {new Date(booking.refundedAt).toLocaleDateString()}</p>
                    )}
                  </div>
                )}
                {booking.cancellationDeclineReason && (
                  <div className="mt-2 rounded-lg bg-rose-100/50 px-3 py-2 text-sm font-bold text-rose-700">
                    Decline Reason: {booking.cancellationDeclineReason}
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {booking.modificationRequested && booking.modificationStatus && booking.modificationStatus !== "None" && (
            <section className="py-3 first:pt-0">
              <div className="mb-4 flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Modification Status</p>
              </div>
              <div className="space-y-3 text-sm font-bold text-slate-700">
                <div className="flex justify-between">
                  <span className="text-sm font-bold text-slate-900">Status</span>
                  <span className="text-sm font-black text-slate-900">{booking.modificationStatus}</span>
                </div>
                {booking.modificationReason && (
                  <div className="flex justify-between">
                    <span className="text-sm font-bold text-slate-900">Reason</span>
                    <span className="text-sm font-black text-slate-900">{booking.modificationReason}</span>
                  </div>
                )}
                {booking.modificationDeclineReason && (
                  <div className="mt-2 rounded-lg bg-rose-100/50 px-3 py-2 text-sm font-bold text-rose-700">
                    Decline Reason: {booking.modificationDeclineReason}
                  </div>
                )}
              </div>
            </section>
          )}

          {(booking.contractStatus === "Signed" || booking.contractSigned) && (
            <section className="py-3 first:pt-0">
              <div className="mb-4 flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Contract</p>
              </div>
              <div className="space-y-2">
                <span
                  className={cn(
                    "inline-block rounded-md border px-2.5 py-1 text-xs font-black uppercase tracking-[0.2em]",
                    "border-emerald-100 bg-emerald-50 text-emerald-700",
                  )}
                >
                  Contract Status: Signed
                </span>
                {booking.contractSignedDate && (
                  <p className="text-sm font-bold text-slate-700">
                    Signed Date: {formatDate(booking.contractSignedDate)}
                  </p>
                )}
                {booking.contractSignedBy && (
                  <p className="text-sm font-bold text-slate-700">
                    Signed By: {booking.contractSignedBy}
                  </p>
                )}
                <p className="text-sm font-bold text-slate-500">
                  Signing Method: Face-to-face
                </p>
              </div>
            </section>
          )}

          {isContractSigningActionVisible && (
            <section className="py-3 first:pt-0">
              <div className="mb-4 flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Contract</p>
              </div>
              <div className="min-w-0 space-y-3">
                <span
                  className={cn(
                    "inline-block rounded-md border px-2.5 py-1 text-xs font-black uppercase tracking-[0.2em]",
                    "border-orange-100 bg-orange-50 text-orange-700",
                  )}
                >
                  Contract Status: Pending Signature
                </span>
                <div className="space-y-2">
                  <p className="text-sm font-bold text-orange-700">
                    Contract signing must be completed onsite at the One Estela Place office.
                  </p>
                  <p className="text-sm font-bold text-slate-500">
                    The customer must personally sign the official contract at the One Estela Place office.
                  </p>
                </div>
              </div>
            </section>
          )}

          {(() => {
            if (booking.contractStatus === "Signed" || booking.contractSigned) return null
            const normStatus = normalizeStatus(booking.status)
            if (isOfficeRental && normStatus === "contract_signing_required") return null
            if (isPaymentVerified && !isOfficeRental) return null
            if (isCancelled || isCompleted) return null
            return (
              <section className="py-3 first:pt-0">
                <div className="mb-4 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-slate-500" />
                  <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Contract</p>
                </div>
                <span
                  className={cn(
                    "inline-block rounded-md border px-2.5 py-1 text-xs font-black uppercase tracking-[0.2em]",
                    "border-slate-200 bg-slate-50 text-slate-600",
                  )}
                >
                  Contract Status: Not Available
                </span>
                <p className="mt-2 text-sm font-bold text-slate-500">
                  Contract will be available once payment is verified.
                </p>
              </section>
            )
          })()}

          {isOfficeRental && (bookingStatus === "active_rental" || bookingStatus === "rental_expired") && (() => {
            const startDate = booking.date ? formatDate(booking.date) : "—"
            const endDate = (booking as any).endDate ? formatDate((booking as any).endDate) : "—"
            const startMs = booking.date ? new Date(booking.date).getTime() : 0
            const endMs = (booking as any).endDate ? new Date((booking as any).endDate + "T23:59:59").getTime() : 0
            const now = Date.now()
            const totalDays = endMs > startMs ? Math.max(1, Math.ceil((endMs - startMs) / 86400000)) : 0
            const daysUsed = endMs > startMs && startMs > 0 ? Math.max(0, Math.min(totalDays, Math.ceil((now - startMs) / 86400000))) : 0
            const progressPct = totalDays > 0 ? Math.min(100, Math.round((daysUsed / totalDays) * 100)) : 0
            const remainingDuration = () => {
              if (!booking.date || !(booking as any).endDate) return "—"
              return getRemainingDurationFromDates((booking as any).endDate, booking.date) || "—"
            }
            return (
              <section className="py-3 first:pt-0">
                <div className="mb-4 flex items-center gap-2">
                  <Calendar className={`h-4 w-4 ${bookingStatus === "active_rental" ? "text-sky-500" : "text-rose-500"}`} />
                  <p className="text-sm font-black uppercase tracking-[0.2em] text-black">Rental Information</p>
                </div>
                <div className="space-y-3 text-sm font-bold">
                  <div className="flex justify-between">
                    <span className="text-sm font-bold text-slate-900">Start Date</span>
                    <span className="text-sm font-black text-slate-900">{startDate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-bold text-slate-900">End Date</span>
                    <span className="text-sm font-black text-slate-900">{endDate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-bold text-slate-900">Contract Duration</span>
                    <span className="text-sm font-black text-slate-900">{getContractDurationLabel(booking.date, (booking as any).endDate) || "—"}</span>
                  </div>
                  {bookingStatus === "active_rental" && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-sm font-bold text-slate-900">Days Used</span>
                        <span className="text-sm font-black text-slate-900">{daysUsed} / {totalDays}d</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm font-bold text-slate-900">Remaining</span>
                        <span className="text-sm font-black text-sky-600">{remainingDuration()}</span>
                      </div>
                      <div className="mt-2">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-sky-500 transition-all"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <p className="mt-1 text-sm font-bold text-slate-400 text-right">{progressPct}% complete</p>
                      </div>
                    </>
                  )}
                  {bookingStatus === "rental_expired" && (
                    <div className="flex justify-between">
                      <span className="text-sm font-bold text-slate-900">Status</span>
                      <span className="text-sm font-black text-rose-600">Rental Period Ended</span>
                    </div>
                  )}
                </div>
              </section>
            )
          })()}
          </>
          )}

      </div>

      <BookingDetailsFooter layout="stacked">
        {isContractSigningActionVisible && !showContractSigningActionInFooter && (
          <ContractSigningAction onClick={onMarkContractSigned} secondary={Boolean(managementActions || showRefundAction)} />
        )}
        {managementActions}
        {showRefundAction && (
          <Button onClick={() => { if (booking.id && onMarkAsRefunded) onMarkAsRefunded(booking.id) }}
            className={cn(bookingDetailsStackedActionClassName, "bg-slate-900 text-white hover:bg-slate-800")}>
            <CheckCircle2 className="size-4" /> Mark as Refunded
          </Button>
        )}
      </BookingDetailsFooter>
  </DialogContent>
</Dialog>
  )
}

function RecordOnsitePaymentModal({
  booking,
  open,
  onClose,
  onRecorded,
  paymentRecords,
}: {
  booking: Booking | null
  open: boolean
  onClose: () => void
  onRecorded: (updated: Booking) => void
  paymentRecords?: PaymentRecordLike[] | null
}) {
  const { manualRecordOnsitePayment } = useBookings()
  const { toast } = useToast()
  const [step, setStep] = useState<"form" | "confirm">("form")
  const [paymentType, setPaymentType] = useState("downpayment")
  const [amountReceived, setAmountReceived] = useState("")
  const [adminNote, setAdminNote] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setStep("form")
      setPaymentType("downpayment")
      setAmountReceived("")
      setAdminNote("")
      setIsSubmitting(false)
    }
  }, [open])

  if (!booking) return null

  const summary = calculatePaymentSummary(
    booking,
    getRecordsForBooking(paymentRecords, booking),
  )
  const totalAmount = summary.bookingTotal
  const currentAmountPaid = summary.moneyReceivedTotal
  const remainingBalance = summary.remainingBalance
  const enteredAmount = (() => {
    const num = Number(String(amountReceived || "0").replace(/[^0-9.-]+/g, ""))
    return Number.isFinite(num) ? num : 0
  })()
  const isOverPayment = enteredAmount > remainingBalance
  const isFullPaymentMismatch =
    paymentType === "full_payment" &&
    remainingBalance > 0 &&
    enteredAmount !== remainingBalance

  const getNewPaymentSummary = () => {
    if (paymentType === "full_payment") {
      return {
        newAmountPaid: totalAmount,
        newRemainingBalance: 0,
        newPaymentStatus: "Fully Paid",
      }
    }

    if (paymentType === "remaining_balance") {
      const newAmount = currentAmountPaid + enteredAmount
      const newRemaining = Math.max(totalAmount - newAmount, 0)
      return {
        newAmountPaid: newAmount,
        newRemainingBalance: newRemaining,
        newPaymentStatus: newRemaining === 0 ? "Fully Paid" : "Partial Payment",
      }
    }

    const newAmount = currentAmountPaid + enteredAmount
    const remaining = totalAmount - newAmount
    return {
      newAmountPaid: newAmount,
      newRemainingBalance: remaining,
      newPaymentStatus: remaining === 0 ? "Fully Paid" : "Partial Payment",
    }
  }

  const handleConfirm = async () => {
    if (enteredAmount <= 0 || isSubmitting) return
    setIsSubmitting(true)
    try {
      const updatedBooking = await manualRecordOnsitePayment(booking.id, {
        paymentType: paymentType as "downpayment" | "remaining_balance" | "full_payment",
        amountReceived: enteredAmount,
        adminNote: adminNote.trim(),
        adminName: "Administrator",
      })
      onRecorded(updatedBooking ?? booking)
    } catch (error) {
      toast({
        title: "Onsite Payment Failed",
        description: error instanceof Error ? error.message : "Unable to record the onsite payment.",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const newPaymentPreview = getNewPaymentSummary()
  const typeLabel = paymentType === "full_payment" ? "Full Payment" : paymentType === "remaining_balance" ? "Remaining Balance" : "Downpayment"

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 p-0 shadow-2xl [&>button]:hidden bg-white">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto p-6 sm:p-7">
            {step === "form" ? (
              <>
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <DollarSign className="h-8 w-8" />
                </div>

                <DialogTitle className="text-2xl font-black text-slate-950">
                  Record Onsite Payment
                </DialogTitle>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Use this only if the customer has already paid at the One Estela Place office.
                </p>

                <div className="mt-5 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Booking ID</span>
                    <span className="font-bold text-slate-900">{booking.id}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Customer</span>
                    <span className="font-bold text-slate-900">{booking.userInfo?.name || "No Name"}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Total Amount</span>
                    <span className="font-bold text-slate-900">₱{totalAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Current Paid</span>
                    <span className="font-bold text-slate-900">₱{currentAmountPaid.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Remaining</span>
                    <span className="font-bold text-amber-700">₱{remainingBalance.toLocaleString()}</span>
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  <div>
                    <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
                      Payment Type *
                    </Label>
                    <Select value={paymentType} onValueChange={setPaymentType}>
                      <SelectTrigger className="mt-1.5 h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-emerald-600">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-slate-200 shadow-xl">
                        <SelectItem value="downpayment">Downpayment</SelectItem>
                        <SelectItem value="remaining_balance">Remaining Balance</SelectItem>
                        <SelectItem value="full_payment">Full Payment</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
                      Actual Method *
                    </Label>
                    <div className="mt-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-700">
                      Cash / Onsite
                    </div>
                  </div>

                  <div>
                    <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
                      Amount Received *
                    </Label>
                    <Input
                      value={amountReceived}
                      onChange={(e) => {
                        const digitsOnly = e.target.value.replace(/[^0-9.]/g, "")
                        setAmountReceived(digitsOnly)
                      }}
                      placeholder="Enter amount received"
                      className="mt-1.5 h-10 w-full rounded-xl border-slate-200 text-xs font-bold focus-visible:ring-emerald-600"
                    />
                    {isOverPayment && enteredAmount > 0 && (
                      <p className="mt-1.5 text-[11px] font-semibold text-rose-600">
                        Amount received cannot exceed the remaining balance of ₱{remainingBalance.toLocaleString()}.
                      </p>
                    )}
                    {isFullPaymentMismatch && enteredAmount > 0 && (
                      <p className="mt-1.5 text-[11px] font-semibold text-rose-600">
                        Full payment requires exactly ₱{remainingBalance.toLocaleString()}.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
                      Admin Note / Reference
                    </Label>
                    <Textarea
                      value={adminNote}
                      onChange={(e) => setAdminNote(e.target.value)}
                      placeholder="Example: Paid onsite and received by staff."
                      className="mt-1.5 min-h-[80px] w-full resize-none rounded-xl border-slate-200 text-xs focus-visible:ring-emerald-600"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                  <AlertCircle className="h-8 w-8" />
                </div>

                <DialogTitle className="text-2xl font-black text-slate-950">
                  Confirm Onsite Payment
                </DialogTitle>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Are you sure you want to record this onsite payment? This should only be done after confirming the actual payment received at the One Estela Place office.
                </p>

                <div className="mt-5 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Booking ID</span>
                    <span className="font-bold text-slate-900">{booking.id}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Customer</span>
                    <span className="font-bold text-slate-900">{booking.userInfo?.name || "No Name"}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Type</span>
                    <span className="font-bold text-slate-900">{typeLabel}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Method</span>
                    <span className="font-bold text-slate-900">Cash / Onsite</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Amount Received</span>
                    <span className="font-bold text-emerald-700">₱{enteredAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">New Amount Paid</span>
                    <span className="font-bold text-slate-900">₱{newPaymentPreview.newAmountPaid.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">New Remaining Balance</span>
                    <span className="font-bold text-amber-700">₱{newPaymentPreview.newRemainingBalance.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">New Status</span>
                    <span className="font-bold text-slate-900">{newPaymentPreview.newPaymentStatus}</span>
                  </div>
                  {adminNote.trim() && (
                    <div className="flex justify-between text-xs">
                      <span className="font-semibold text-slate-400">Note</span>
                      <span className="font-bold text-slate-900">{adminNote.trim()}</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="shrink-0 border-t p-6 sm:p-7">
            {step === "form" ? (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700"
                >
                  Cancel
                </Button>
                <Button
                  disabled={enteredAmount <= 0 || isOverPayment || isFullPaymentMismatch}
                  onClick={() => setStep("confirm")}
                  className="h-11 w-full sm:w-auto rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Continue
                </Button>
              </div>
            ) : (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  onClick={() => setStep("form")}
                  className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700"
                >
                  Back
                </Button>
                <Button
                  disabled={isSubmitting}
                  onClick={handleConfirm}
                  className="h-11 w-full sm:w-auto rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {isSubmitting ? "Recording..." : "Confirm Onsite Payment"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ContractSigningConfirmModal({
  booking,
  open,
  onCancel,
  onConfirm,
}: {
  booking: Booking | null
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent aria-describedby={undefined} className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 bg-white p-0 shadow-2xl [&>button]:hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7 sm:py-6">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <FileText className="h-8 w-8" />
            </div>

            <DialogTitle className="text-2xl font-black text-slate-950">
              Mark Contract as Signed?
            </DialogTitle>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              Are you sure you want to mark this contract as signed? This should only be done after
              the customer has signed the official contract face-to-face at the One Estela Place office.
            </p>

            {booking && (
              <div className="mt-5 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Booking ID</span>
                  <span className="font-bold text-slate-900">{booking.id}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Customer</span>
                  <span className="font-bold text-slate-900">{booking.userInfo?.name || "No Name"}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Event</span>
                  <span className="font-bold text-slate-900">{booking.eventName || "Untitled"}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Contract Status</span>
                  <span className="font-bold text-slate-900">{booking.contractStatus === "Signed" ? "Signed" : "Pending Signature"}</span>
                </div>
              </div>
            )}
          </div>
          <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-5 sm:px-7">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={onCancel}
                className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700"
              >
                Cancel
              </Button>
              <Button
                onClick={onConfirm}
                className="h-11 w-full sm:w-auto rounded-xl bg-blue-600 text-sm font-black text-white hover:bg-blue-700"
              >
                Yes, Mark as Signed
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ApproveCancellationConfirmModal({
  open,
  booking,
  onCancel,
  onConfirm,
}: {
  open: boolean
  booking: Booking | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent aria-describedby={undefined} className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 bg-white p-0 shadow-2xl [&>button]:hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7 sm:py-6">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
              <AlertCircle className="h-8 w-8" />
            </div>
            <DialogTitle className="text-2xl font-black text-slate-950">
              Approve Cancellation?
            </DialogTitle>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Are you sure you want to approve this cancellation request? This will cancel the booking and apply the existing refund eligibility logic.
            </p>
            {booking && (
              <div className="mt-5 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Booking ID</span>
                  <span className="font-bold text-slate-900">{booking.id}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Customer</span>
                  <span className="font-bold text-slate-900">{booking.userInfo?.name || "No Name"}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Event</span>
                  <span className="font-bold text-slate-900">{booking.eventName || "Untitled"}</span>
                </div>
                {booking.cancellationReason && (
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Reason</span>
                    <span className="font-bold text-slate-900">{booking.cancellationReason}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-5 sm:px-7">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={onCancel} className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700">Cancel</Button>
              <Button onClick={onConfirm} className="h-11 w-full sm:w-auto rounded-xl bg-rose-600 text-sm font-black text-white hover:bg-rose-700">Approve Cancellation</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DeclineCancellationModal({
  open,
  booking,
  reason,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  open: boolean
  booking: Booking | null
  reason: string
  onReasonChange: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const [reasonError, setReasonError] = useState(false)

  const handleConfirm = () => {
    if (!reason.trim()) {
      setReasonError(true)
      return
    }
    setReasonError(false)
    onConfirm()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent aria-describedby={undefined} className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 bg-white p-0 shadow-2xl [&>button]:hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7 sm:py-6">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <DialogTitle className="text-2xl font-black text-slate-950">
              Continue Booking?
            </DialogTitle>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              This will decline the cancellation request and restore the booking to its previous status. Please provide a reason.
            </p>
            {booking && (
              <div className="mt-5 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Booking ID</span>
                  <span className="font-bold text-slate-900">{booking.id}</span>
                </div>
              </div>
            )}
            <div className="mt-4">
              <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-black">Decline Reason *</Label>
              <Textarea
                value={reason}
                onChange={(e) => { onReasonChange(e.target.value); if (reasonError && e.target.value.trim()) setReasonError(false) }}
                placeholder="Enter reason for declining cancellation..."
                className={cn("mt-1.5 min-h-[80px] resize-none rounded-xl border text-xs focus-visible:ring-emerald-600", reasonError ? "border-rose-300" : "border-slate-200")}
              />
              {reasonError && <p className="mt-1 text-[11px] font-semibold text-rose-600">Please provide a reason.</p>}
            </div>
          </div>
          <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-5 sm:px-7">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={onCancel} className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700">Cancel</Button>
              <Button onClick={handleConfirm} className="h-11 w-full sm:w-auto rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700">Continue Booking</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ApproveModificationConfirmModal({
  open,
  booking,
  onCancel,
  onConfirm,
}: {
  open: boolean
  booking: Booking | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent aria-describedby={undefined} className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 bg-white p-0 shadow-2xl [&>button]:hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7 sm:py-6">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <DialogTitle className="text-2xl font-black text-slate-950">
              Approve Modification?
            </DialogTitle>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Are you sure you want to approve this modification request? The requested changes will be applied to the booking.
            </p>
            {booking && (
              <div className="mt-5 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Booking ID</span>
                  <span className="font-bold text-slate-900">{booking.id}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Customer</span>
                  <span className="font-bold text-slate-900">{booking.userInfo?.name || "No Name"}</span>
                </div>
                {booking.modificationReason && (
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Reason</span>
                    <span className="font-bold text-slate-900">{booking.modificationReason}</span>
                  </div>
                )}
                {booking.requestedChanges && (
                  <div className="mt-2 pt-2 border-t border-slate-200">
                    <p className="text-[10px] font-semibold text-slate-500 mb-1">Requested Changes:</p>
                    {Object.entries(booking.requestedChanges as Record<string, unknown>).map(([key, value]) => (
                      <div key={key} className="flex justify-between text-[11px]">
                        <span className="font-semibold text-slate-500">{key}:</span>
                        <span className="font-bold text-slate-900">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-5 sm:px-7">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={onCancel} className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700">Cancel</Button>
              <Button onClick={onConfirm} className="h-11 w-full sm:w-auto rounded-xl bg-blue-600 text-sm font-black text-white hover:bg-blue-700">Approve Modification</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DeclineModificationModal({
  open,
  booking,
  reason,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  open: boolean
  booking: Booking | null
  reason: string
  onReasonChange: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const [reasonError, setReasonError] = useState(false)

  const handleConfirm = () => {
    if (!reason.trim()) {
      setReasonError(true)
      return
    }
    setReasonError(false)
    onConfirm()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent aria-describedby={undefined} className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 bg-white p-0 shadow-2xl [&>button]:hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7 sm:py-6">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
              <XCircle className="h-8 w-8" />
            </div>
            <DialogTitle className="text-2xl font-black text-slate-950">
              Decline Modification?
            </DialogTitle>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              This will decline the modification request. The original booking details will remain unchanged. Please provide a reason.
            </p>
            {booking && (
              <div className="mt-5 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Booking ID</span>
                  <span className="font-bold text-slate-900">{booking.id}</span>
                </div>
              </div>
            )}
            <div className="mt-4">
              <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-black">Decline Reason *</Label>
              <Textarea
                value={reason}
                onChange={(e) => { onReasonChange(e.target.value); if (reasonError && e.target.value.trim()) setReasonError(false) }}
                placeholder="Enter reason for declining modification..."
                className={cn("mt-1.5 min-h-[80px] resize-none rounded-xl border text-xs focus-visible:ring-amber-600", reasonError ? "border-rose-300" : "border-slate-200")}
              />
              {reasonError && <p className="mt-1 text-[11px] font-semibold text-rose-600">Please provide a reason.</p>}
            </div>
          </div>
          <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-5 sm:px-7">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={onCancel} className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700">Cancel</Button>
              <Button onClick={handleConfirm} className="h-11 w-full sm:w-auto rounded-xl bg-amber-600 text-sm font-black text-white hover:bg-amber-700">Decline Modification</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MarkCompletedConfirmModal({
  open,
  booking,
  onCancel,
  onConfirm,
}: {
  open: boolean
  booking: Booking | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent aria-describedby={undefined} className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 bg-white p-0 shadow-2xl [&>button]:hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7 sm:py-6">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <DialogTitle className="text-2xl font-black text-slate-950">
              Mark Booking as Completed?
            </DialogTitle>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Are you sure you want to mark this booking as completed? This action cannot be undone.
            </p>
            {booking && (
              <div className="mt-5 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Booking ID</span>
                  <span className="font-bold text-slate-900">{booking.id}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Customer</span>
                  <span className="font-bold text-slate-900">{booking.userInfo?.name || "No Name"}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-400">Event</span>
                  <span className="font-bold text-slate-900">{booking.eventName || "Untitled"}</span>
                </div>
              </div>
            )}
          </div>
          <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-5 sm:px-7">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={onCancel} className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700">Cancel</Button>
              <Button onClick={onConfirm} className="h-11 w-full sm:w-auto rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700">Mark as Completed</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MaintenanceCalendarModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const {
    maintenanceRecords,
    maintenanceError,
    isMaintenanceLoading,
    isLoading,
    addMaintenanceRecords,
    removeMaintenanceRecord,
    removeMaintenanceRecords,
    retryData,
    bookings: allBookings,
    officeRentals,
  } = useBookingData({ maintenance: open, bookings: open, officeRentals: open })
  const { toast } = useToast()
  const { cmsData, getOfficeRooms } = useCMS()
  const catalog = cmsData as unknown as Record<string, unknown>
  const venues = cmsData.venues.filter((venue) => !venue.isArchived)
  const offices = cmsData.offices.filter((office) => !office.isArchived)

  const [maintType, setMaintType] = useState<"venue" | "office">("venue")
  const [officeGroup, setOfficeGroup] = useState("")
  const [officeScope, setOfficeScope] = useState<"room" | "building">("room")
  const [selectedSpaceId, setSelectedSpaceId] = useState("")
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [reason, setReason] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ ids: string[]; label: string } | null>(null)
  const [filterLocation, setFilterLocation] = useState("all")
  const [maintPage, setMaintPage] = useState(1)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  useEffect(() => {
    if (open) {
      setSelectedSpaceId("")
      setOfficeGroup("")
      setSelectedDates([])
      setReason("")
      setFilterLocation("all")
      setMaintPage(1)
      setDeleteTarget(null)
    }
  }, [open])

  const currentRooms = officeGroup ? getOfficeRooms(officeGroup) : []
  const selectedSpace = useMemo(() => getCatalogAvailabilitySpace(catalog, maintType,
    maintType === "venue" ? selectedSpaceId : officeGroup,
    maintType === "office" && officeScope === "room" ? selectedSpaceId : undefined,
    maintType === "office" && officeScope === "building"),
  [catalog, maintType, selectedSpaceId, officeGroup, officeScope])
  const availabilityRefreshKey = useMemo(() => getAvailabilityDataKey(allBookings, maintenanceRecords, officeRentals),
    [allBookings, maintenanceRecords, officeRentals])
  const availability = useSpaceAvailability(open, selectedSpace, calendarMonth, "", undefined, availabilityRefreshKey)
  const resourceKey = (space: AvailabilitySpace) => JSON.stringify([
    space.category, space.officeId || space.venueId, space.spaceId || space.officeId || space.venueId,
  ])
  const recordLocations = new Map(maintenanceRecords.map((record) => {
    const resolution = resolveResourceSpace(catalog, record as unknown as Record<string, unknown>, "maintenance")
    const space = resolution.status === "resolved" ? resolution.space : null
    return [record.id, {
      space,
      key: space ? resourceKey(space) : JSON.stringify(["unresolved", record.id]),
      label: space ? (space.roomName || (space.category === "office" ? "Entire Building" : space.name)) : record.spaceName || record.id,
      group: space?.category === "office" ? space.name : record.officeName || "",
    }]
  }))
  const filteredRecords = maintenanceRecords.filter((record) => (
    String(record.status).trim().toLowerCase() === "active"
      && (recordLocations.get(record.id)?.space?.category || record.type) === maintType
  ))
  const spaceFilteredRecords = filteredRecords.filter((record) => (
    filterLocation === "all" || recordLocations.get(record.id)?.key === filterLocation
  )).sort((a, b) => (a.startDate || a.date || "").localeCompare(b.startDate || b.date || ""))
  const filterOptions = [...new Map(filteredRecords.map((record) => {
    const location = recordLocations.get(record.id)!
    return [location.key, { value: location.key, label: location.label, group: location.group }]
  })).values()]

  // Calendar computations
  const calYear = calendarMonth.getFullYear()
  const calMonth = calendarMonth.getMonth()
  const firstDayOfWeek = new Date(calYear, calMonth, 1).getDay()
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
  const daysInMonthArray = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const monthPrefix = `${calYear}-${String(calMonth + 1).padStart(2, "0")}`
  const availabilityReady = !availability.loading && !availability.error
    && daysInMonthArray.every((day) => availability.days[`${monthPrefix}-${String(day).padStart(2, "0")}`])

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date())
  const getDayStatus = (dateStr: string) => {
    if (dateStr < todayStr) return "past"
    if (isLoading || isMaintenanceLoading || maintenanceError || !selectedSpace || !availabilityReady) return "loading"
    return availability.days[dateStr]?.status || "loading"
  }

  const handleSave = async () => {
    if (isSaving || isLoading || isMaintenanceLoading || maintenanceError || !availabilityReady) return
    const datesToAdd = [...selectedDates].sort()
    if (datesToAdd.length === 0) {
      toast({ title: "Date Required", description: "Please select at least one date.", variant: "destructive" })
      return
    }
    if (!selectedSpace) {
      toast({ title: "Space Required", description: "Please select a space.", variant: "destructive" })
      return
    }

    const bookedDates = datesToAdd.filter((date) => date < todayStr
      || (availability.days[date] && availability.days[date].status !== "available"))
    if (bookedDates.length > 0) {
      toast({
        title: "Date(s) Already Booked",
        description: `These dates are no longer available for full-day maintenance: ${bookedDates.join(", ")}.`,
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)
    try {
      // Selections survive month navigation; confirm off-screen dates before writing.
      const offscreenDates = datesToAdd.filter((date) => !availability.days[date])
      for (const month of new Set(offscreenDates.map((date) => date.slice(0, 7)))) {
        const dates = offscreenDates.filter((date) => date.startsWith(`${month}-`))
        const response = await fetchAvailability({ ...selectedSpace, from: dates[0], to: dates[dates.length - 1] })
        if (dates.some((date) => response.dates?.[date]?.status !== "available")) {
          throw new Error("Selected dates could not be confirmed as available for full-day maintenance.")
        }
      }
      const saved = await addMaintenanceRecords(datesToAdd.map((date) => ({
        type: maintType,
        scope: maintType === "venue" ? "venue" : officeScope,
        venueId: selectedSpace.venueId,
        ...(maintType === "office" ? { officeId: officeGroup } : {}),
        spaceId: maintType === "office" && officeScope === "building" ? officeGroup : selectedSpaceId,
        date,
        reason,
      })))
      setSelectedDates([])
      setReason("")
      toast({ title: "Maintenance Saved", description: `Blocked ${saved.length} date${saved.length === 1 ? "" : "s"} for ${selectedSpace.name}${selectedSpace.roomName ? ` - ${selectedSpace.roomName}` : ""}.` })
    } catch (error) {
      toast({ title: "Maintenance Save Failed", description: error instanceof Error ? error.message : "No maintenance dates were saved.", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const handleRemove = async (id: string) => {
    if (isSaving || maintenanceError) return
    setIsSaving(true)
    try {
      await removeMaintenanceRecord(id)
      toast({ title: "Maintenance Removed", description: "The selected maintenance record was removed." })
    } catch (error) {
      toast({ title: "Maintenance Removal Failed", description: error instanceof Error ? error.message : "The record was not removed.", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteAll = async () => {
    if (!deleteTarget || isSaving || maintenanceError) return
    setIsSaving(true)
    try {
      await removeMaintenanceRecords(deleteTarget.ids)
      setDeleteTarget(null)
      toast({ title: "Maintenance Cleared", description: `Removed ${deleteTarget.ids.length} maintenance records from ${deleteTarget.label}.` })
    } catch (error) {
      toast({ title: "Maintenance Removal Failed", description: error instanceof Error ? error.message : "No records were removed.", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => !v && !isSaving && onClose()}>
      <DialogContent aria-describedby={undefined}
        className="flex min-h-0 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 rounded-3xl border-0 bg-white p-0 shadow-2xl sm:max-w-[520px]"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* HEADER */}
          <div className="shrink-0 border-b border-slate-100 px-5 py-4 pr-14">
            <DialogTitle className="text-xl font-black text-slate-950">
              Schedule Maintenance
            </DialogTitle>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Block dates for maintenance per space.
            </p>
          </div>

          {/* BODY */}
          <div role="region" aria-label="Maintenance content" tabIndex={0} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-600">
          <fieldset disabled={isSaving} className="min-w-0 space-y-5">
            {maintenanceError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700"><span>{maintenanceError}</span> <button type="button" onClick={retryData} className="font-bold underline">Retry data loading</button></p>}
            {isMaintenanceLoading && <p role="status" className="text-xs font-semibold text-slate-500">Loading maintenance records...</p>}
            {availability.error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{availability.error}</p>}
            {availability.loading && <p role="status" className="text-xs font-semibold text-slate-500">Loading availability...</p>}
            {/* Type selector */}
            <div>
              <label htmlFor="maintenance-type" className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
                Space Type
              </label>
              <select
                id="maintenance-type"
                value={maintType}
                onChange={(e) => {
                  setMaintType(e.target.value as "venue" | "office")
                  setSelectedSpaceId("")
                  setOfficeGroup("")
                  setSelectedDates([])
                  setFilterLocation("all")
                  setMaintPage(1)
                }}
                className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              >
                <option value="venue">Event Venue</option>
                <option value="office">Office Space</option>
              </select>
            </div>

            {/* Space dropdown */}
            {maintType === "venue" ? (
              <div>
                <label htmlFor="maintenance-venue" className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
                  Select Venue
                </label>
                <select
                  id="maintenance-venue"
                  value={selectedSpaceId}
                  onChange={(e) => { setSelectedSpaceId(e.target.value); setSelectedDates([]) }}
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                >
                  <option value="" disabled>Select event venue</option>
                  {venues.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="maintenance-building" className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
                    Select Building
                  </label>
                  <select
                    id="maintenance-building"
                    value={officeGroup}
                    onChange={(e) => {
                      setOfficeGroup(e.target.value)
                      setSelectedSpaceId("")
                      setSelectedDates([])
                    }}
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  >
                    <option value="">Select office building</option>
                    {offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
                  </select>
                </div>
                {officeGroup && (
                  <div>
                    <label htmlFor="maintenance-scope" className="text-[10px] font-black uppercase tracking-[0.2em] text-black">Maintenance Scope</label>
                    <select
                      id="maintenance-scope"
                      value={officeScope}
                      onChange={(event) => { setOfficeScope(event.target.value as "room" | "building"); setSelectedSpaceId(""); setSelectedDates([]) }}
                      className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    >
                      <option value="room">One Room</option>
                      <option value="building">Entire Building (All Rooms)</option>
                    </select>
                  </div>
                )}
                {officeGroup && officeScope === "room" && (
                  <div>
                    <label htmlFor="maintenance-room" className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
                      Select Room
                    </label>
                    <select
                      id="maintenance-room"
                      value={selectedSpaceId}
                      onChange={(e) => { setSelectedSpaceId(e.target.value); setSelectedDates([]) }}
                      className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    >
                      <option value="" disabled>Select room</option>
                      {currentRooms.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </>
            )}

            {/* Calendar */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
                  Select Dates
                </label>
              </div>

              {!selectedSpace ? (
                <div className="mt-2 flex min-h-[160px] items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50">
                  <p className="text-[11px] font-bold text-slate-400 text-center px-4">
                    Select a space first before choosing a maintenance date.
                  </p>
                </div>
              ) : (
                <div className="mt-1.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  {/* Month navigation */}
                  <div className="flex items-center justify-between mb-3">
                    <button
                      type="button"
                      onClick={() => setCalendarMonth(new Date(calYear, calMonth - 1, 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                      aria-label="Previous month"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <h5 className="text-[13px] font-black leading-none text-slate-950">
                      {calendarMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </h5>
                    <button
                      type="button"
                      onClick={() => setCalendarMonth(new Date(calYear, calMonth + 1, 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                      aria-label="Next month"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Day-of-week headers */}
                  <div className="mb-1.5 grid grid-cols-7 text-center">
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                      <div key={d} className="text-[7px] font-black uppercase tracking-[0.1em] text-black">
                        {d}
                      </div>
                    ))}
                  </div>

                  {/* Day grid */}
                  <div className="grid grid-cols-7 justify-items-center gap-0.5">
                    {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                      <div key={`empty-${i}`} className="h-7 w-7 2xl:h-8 2xl:w-8" />
                    ))}
                    {daysInMonthArray.map((day) => {
                      const dateStr = `${monthPrefix}-${String(day).padStart(2, '0')}`
                      const isSel = selectedDates.includes(dateStr)
                      const status = getDayStatus(dateStr)

                      const statusStyles: Record<string, string> = {
                        full: "cursor-not-allowed border-rose-300 bg-rose-100 text-rose-700",
                        few: "cursor-not-allowed border-amber-300 bg-amber-100 text-amber-700",
                        maintenance: "cursor-not-allowed border-slate-900 bg-slate-900 text-slate-400",
                        past: "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-300 opacity-60",
                        loading: "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-400",
                        available: "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50",
                      }
                      const statusTitles: Record<string, string> = {
                        full: "Existing Reservation",
                        few: "Few: an existing reservation prevents full-day maintenance",
                        maintenance: "Maintenance",
                        past: "Past date",
                        loading: "Availability could not be confirmed yet",
                        available: "Available",
                      }

                      const isDisabled = status !== "available"

                      let dayClass = statusStyles[status] || statusStyles.available

                      if (isSel && !isDisabled) {
                        dayClass = "border-orange-600 bg-orange-600 text-white shadow-md shadow-orange-200 scale-105"
                      }

                      return (
                        <button
                          key={day}
                          type="button"
                          title={statusTitles[status] || "Available"}
                          disabled={isDisabled}
                          onClick={() => {
                            if (isDisabled) return
                            setSelectedDates(prev =>
                              prev.includes(dateStr)
                                ? prev.filter(d => d !== dateStr)
                                : [...prev, dateStr]
                            )
                          }}
                          className={`flex h-7 w-7 2xl:h-8 2xl:w-8 items-center justify-center rounded-full border text-[10px] xl:text-[11px] font-black outline-none transition-all focus-visible:ring-2 focus-visible:ring-orange-300 ${dayClass}`}
                        >
                          {day}
                        </button>
                      )
                    })}
                  </div>

                   {/* Legend */}
                   <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5">
                      {[
                        { dot: "bg-rose-300", label: "Booked", color: "text-rose-600" },
                        { dot: "bg-amber-300", label: "Few", color: "text-amber-600" },
                        { dot: "bg-slate-900", label: "Maintenance", color: "text-slate-600" },
                        { dot: "bg-orange-600", label: "Selected", color: "text-orange-600" },
                      ].map((it) => (
                       <div key={it.label} className="flex items-center gap-1 whitespace-nowrap">
                         <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${it.dot}`} />
                         <span className={`text-[7px] font-black uppercase leading-none tracking-[0.08em] ${it.color}`}>{it.label}</span>
                       </div>
                     ))}
                   </div>

                   <p className="mt-2 text-[10px] leading-5 text-slate-500">Maintenance blocks the entire day. Dates with any reservation, including Few, cannot be selected. The server rechecks every date before saving.</p>
                   {/* Selected dates summary */}
                  {selectedDates.length > 0 && (
                    <div className="mt-2 rounded-lg bg-orange-50 border border-orange-100 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-orange-700">
                          Selected ({selectedDates.length} {selectedDates.length === 1 ? "Date" : "Dates"})
                        </p>
                        <button
                          type="button"
                          onClick={() => setSelectedDates([])}
                          className="rounded-md px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.2em] text-rose-600 hover:bg-rose-100 transition-colors"
                        >
                          Clear All
                        </button>
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {[...selectedDates]
                          .sort()
                          .map((d) => (
                            <li key={d} className="flex items-center gap-1.5 text-[11px] font-bold text-orange-700">
                              <span className="text-orange-400">•</span>
                              {new Date(d + "T00:00:00").toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Reason */}
            <div>
              <label htmlFor="maintenance-reason" className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
                Reason / Notes <span className="text-slate-300">(optional)</span>
              </label>
              <textarea
                id="maintenance-reason"
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Annual plumbing inspection"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 placeholder:text-slate-300 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 resize-none min-h-[60px]"
              />
            </div>

            {/* Existing records */}
            {filteredRecords.length > 0 && (
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-black">
                    Existing Maintenance
                  </label>
                  <button
                    type="button"
                    disabled={isSaving || isMaintenanceLoading || Boolean(maintenanceError) || spaceFilteredRecords.length === 0}
                    onClick={() => {
                      const option = filterOptions.find((location) => location.value === filterLocation)
                      setDeleteTarget({
                        ids: spaceFilteredRecords.map((record) => record.id),
                        label: option ? `${option.group ? `${option.group} - ` : ""}${option.label}` : maintType === "venue" ? "all event venue locations" : "all office locations",
                      })
                    }}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.2em] text-rose-500 hover:bg-rose-50 hover:text-rose-700 transition-colors"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                    Delete All
                  </button>
                </div>

                <div className="mt-2">
                  <label htmlFor="maintenance-location-filter" className="text-[9px] font-black uppercase tracking-[0.2em] text-black">
                    Filter Location
                  </label>
                  <select
                    id="maintenance-location-filter"
                    value={filterLocation}
                    onChange={(e) => { setFilterLocation(e.target.value); setMaintPage(1) }}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  >
                    <option value="all">All Locations</option>
                    {filterOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.group ? `${option.group} - ` : ""}{option.label}</option>
                    ))}
                  </select>
                </div>

                <div className="mt-2 space-y-1.5">
                  {(() => {
                    const PAGE_SIZE = 5
                    const totalPages = Math.max(1, Math.ceil(spaceFilteredRecords.length / PAGE_SIZE))
                    const safePage = Math.min(maintPage, totalPages)
                    const pageItems = spaceFilteredRecords.slice(
                      (safePage - 1) * PAGE_SIZE,
                      safePage * PAGE_SIZE
                    )
                    return (
                      <>
                        {pageItems.map((rec) => {
                          const location = recordLocations.get(rec.id)!
                          return (
                            <div
                              key={rec.id}
                              className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 gap-2"
                            >
                              <div className="min-w-0 flex-1">
                                {location.group && <p className="text-[10px] font-black uppercase tracking-[0.1em] text-black">{location.group}</p>}
                                <p className="text-[11px] font-bold text-slate-700 break-words">{location.label}</p>
                                {!location.space && <p className="text-[10px] font-semibold text-amber-700">Resource identity needs review</p>}
                                <p className="text-[9px] font-semibold text-slate-400">
                                  {formatDateSimple(rec.startDate || rec.date)}
                                  {rec.startDate && rec.endDate && rec.startDate !== rec.endDate
                                    ? ` - ${formatDateSimple(rec.endDate)}`
                                    : ""}
                                  {rec.reason ? ` · ${rec.reason}` : ""}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemove(rec.id)}
                                disabled={isSaving || isMaintenanceLoading || Boolean(maintenanceError)}
                                className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                                title="Remove maintenance"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )
                        })}

                        {totalPages > 1 && (
                          <div className="flex items-center justify-between pt-1">
                            <button
                              type="button"
                              onClick={() => setMaintPage((p) => Math.max(1, p - 1))}
                              disabled={safePage <= 1}
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none"
                            >
                              <ChevronLeft className="h-3 w-3" />
                              Previous
                            </button>
                            <div className="flex items-center gap-1">
                              {Array.from({ length: totalPages }).map((_, i) => {
                                const p = i + 1
                                return (
                                  <button
                                    key={p}
                                    type="button"
                                    onClick={() => setMaintPage(p)}
                                    className={`h-6 w-6 rounded-md text-[10px] font-bold transition-colors ${
                                      p === safePage
                                        ? "bg-slate-900 text-white"
                                        : "text-slate-500 hover:bg-slate-100"
                                    }`}
                                  >
                                    {p}
                                  </button>
                                )
                              })}
                            </div>
                            <button
                              type="button"
                              onClick={() => setMaintPage((p) => Math.min(totalPages, p + 1))}
                              disabled={safePage >= totalPages}
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none"
                            >
                              Next
                              <ChevronRight className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>
            )}
          </fieldset>
          </div>
          <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-3">
            <Button
              onClick={handleSave}
              disabled={isSaving || isLoading || isMaintenanceLoading || Boolean(maintenanceError) || !availabilityReady || selectedDates.length === 0 || !selectedSpace}
              className="h-11 w-full rounded-xl bg-slate-900 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {isSaving ? "Saving..." : "Block Date"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(v) => !v && !isSaving && setDeleteTarget(null)}>
        <DialogContent showCloseButton={false} plain className="max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
          <DialogTitle className="text-base font-black text-slate-900">Delete {deleteTarget?.ids.length} maintenance records?</DialogTitle>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            This will remove the {deleteTarget?.ids.length} records currently selected by the location filter: {deleteTarget?.label}. Other locations and records added after this confirmation opened are not included.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isSaving}
              className="h-9 flex-1 rounded-lg border-slate-200 text-xs font-bold"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleDeleteAll}
              disabled={isSaving || Boolean(maintenanceError)}
              className="h-9 flex-1 rounded-lg bg-rose-600 text-xs font-bold text-white hover:bg-rose-700"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {isSaving ? "Deleting..." : "Delete All"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function formatDateSimple(dateStr: string) {
  if (!dateStr) return ""
  try {
    return new Intl.DateTimeFormat("en-PH", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    }).format(new Date(dateStr + "T00:00:00"))
  } catch {
    return dateStr
  }
}
