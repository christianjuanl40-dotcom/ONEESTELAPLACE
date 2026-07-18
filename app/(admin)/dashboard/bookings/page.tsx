"use client"

import type React from "react"
import { useEffect, useMemo, useState } from "react"
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
import { useBookings, type Booking } from "@/src/modules/client/contexts/booking-context"
import { createNotification } from "@/src/modules/shared/lib/notifications"
import { getPaymentMethodLabel } from "@/src/modules/shared/lib/labels"
import { Textarea } from "@/src/modules/shared/components/ui/textarea"
import { Label } from "@/src/modules/shared/components/ui/label"
import { getAllVenues, getAllOffices } from "@/lib/central-data"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/src/modules/shared/components/ui/tabs"

function formatDate(date?: string) {
  if (!date) return "—"
  try {
    return new Intl.DateTimeFormat("en-PH", { month: "long", day: "2-digit", year: "numeric" }).format(new Date(date))
  } catch {
    return date
  }
}

function formatMoney(value?: number | string) {
  const amount = Number(value || 0)
  return `₱${Number.isFinite(amount) ? amount.toLocaleString("en-PH") : "0"}`
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
      <DialogContent className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 bg-white p-0 shadow-2xl [&>button]:hidden">
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
                  <span className="font-bold text-blue-700">₱{Number(
                    (booking as any).remainingBalance ||
                    Math.max(Number(booking.totalPrice || 0) - Number((booking as any).amountPaid || 0), 0)
                  ).toLocaleString()}</span>
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

function getPaymentBadgeClass(paymentStatus?: string, status?: string) {
  const bookingStatus = String(status || "").toLowerCase()
  if (["cancelled", "declined"].includes(bookingStatus)) return "border-rose-100 bg-rose-50 text-rose-700"
  if (bookingStatus === "completed") return "border-blue-100 bg-blue-50 text-blue-700"
  if (bookingStatus === "rental_expired") return "border-red-100 bg-red-50 text-red-700"

  const v = String(paymentStatus || "").toLowerCase()
  if (["verified", "paid", "slot_verified"].includes(v)) return "border-emerald-100 bg-emerald-50 text-emerald-700"
  if (v === "partial") return "border-amber-100 bg-amber-50 text-amber-700"
  if (["for_review", "cash_pending", "slot_pending"].includes(v)) return "border-amber-100 bg-amber-50 text-amber-700"
  if (v === "rejected") return "border-rose-100 bg-rose-50 text-rose-700"
  return "border-slate-200 bg-slate-50 text-slate-600"
}

function getStatusLabel(status?: string) {
  const v = String(status || "").toLowerCase()
  if (v === "pending") return "Pending"
  if (v === "verifying") return "Verifying"
  if (v === "confirmed") return "Confirmed"
  if (v === "completed" || v === "complete") return "Completed"
  if (v === "cancelled") return "Cancelled"
  if (v === "declined") return "Declined"
  if (v === "cancellation_requested") return "Cancel Req"
  if (v === "modification_under_review") return "Modification Req"
  if (v === "reservation_secured") return "Reservation Secured"
  if (v === "contract_signing_required") return "Contract Signing"
  if (v === "active_rental") return "Active Rental"
  if (v === "rental_expired") return "Rental Expired"
  return String(status || "Unknown").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function getPaymentStatusLabel(paymentStatus?: string, status?: string) {
  const bookingStatus = String(status || "").toLowerCase()
  if (["cancelled", "declined"].includes(bookingStatus)) return "Cancelled"
  if (bookingStatus === "completed") return "Completed"
  if (bookingStatus === "rental_expired") return "Rental Expired"

  const v = String(paymentStatus || "").toLowerCase()
  if (v === "verified" || v === "paid" || v === "slot_verified") return "Verified"
  if (v === "for_review" || v === "cash_pending" || v === "slot_pending") return "For Review"
  if (v === "partial") return "Partial Payment"
  if (v === "incomplete") return "Incomplete Payment"
  if (v === "fully paid") return "Fully Paid"
  if (v === "rejected") return "Rejected"
  if (v === "unpaid") return "Unpaid"
  if (!v) return "Not Set"
  return String(paymentStatus || "").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatTextLabel(value?: string) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function isOfficeBooking(booking: Booking) {
  const text = [(booking as any)?.bookingType, (booking as any)?.rentalType, booking?.venue, booking?.eventType]
    .join(" ")
    .toLowerCase()
  return text.includes("office")
}

export default function AdminBookingsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { toast } = useToast()
  const bookingCtx = useBookings()
  const bookings = bookingCtx?.bookings || []
  const {
    markContractSigned,
    modifyBooking,
    approveCancellation,
    declineCancellation,
    updateBookingStatus,
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
  const { maintenanceDates, toggleMaintenanceDate } = bookingCtx || {}

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
    const venues = new Set(bookings.map((b) => b.venue).filter(Boolean) as string[])
    return ["all", ...Array.from(venues).sort()]
  }, [bookings])

  const filteredBookings = useMemo(() => {
    return bookings
      .filter((b) => {
        if (statusFilter !== "all") {
          if (statusFilter === "confirmed") {
            if (b.status !== "confirmed" && b.status !== "reservation_secured") return false
          } else if (statusFilter === "requests") {
            if (b.status !== "cancellation_requested" && b.status !== "modification_under_review") return false
          } else {
            if (b.status !== statusFilter) return false
          }
        }
        if (venueFilter !== "all" && b.venue !== venueFilter) return false
        if (!searchQuery) return true
        const q = searchQuery.toLowerCase()
        return [b.id, b.eventName, b.venue, b.userInfo?.name, b.userInfo?.email, b.userInfo?.phone, b.paymentMethod]
          .some((f) => f && String(f).toLowerCase().includes(q))
      })
      .sort((a, b) => {
        const getTime = (record: Booking) => {
          const t = (record as any).lastActivityAt || record.createdAt
          if (!t) return 0
          const d = new Date(t).getTime()
          return isNaN(d) ? 0 : d
        }
        return getTime(b) - getTime(a)
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

  const confirmApproveCancellation = () => {
    const id = showApproveCancellationTarget
    if (!id) return
    setShowApproveCancellationConfirm(false)
    setShowApproveCancellationTarget(null)
    approveCancellation?.(id)
    toast({
      title: "Cancellation Approved",
      description: `Booking ${id} has been cancelled.`,
      className: "border-none bg-rose-500 text-white",
    })
  }

  const confirmDeclineCancellation = () => {
    if (!declineCancellationTarget || !declineCancellationReason.trim()) return
    const target = declineCancellationTarget
    const reason = declineCancellationReason.trim()
    declineCancellation?.(target.id, reason)
    setShowDeclineCancellationModal(false)
    setDeclineCancellationTarget(null)
    setDeclineCancellationReason("")
    toast({
      title: "Cancellation Declined",
      description: `Booking ${target.id} will continue. Cancellation request has been declined.`,
      className: "border-none bg-emerald-500 text-white",
    })
  }

  const confirmApproveModification = () => {
    const id = showApproveModificationTarget
    if (!id || !bookingCtx?.approveModification) return
    bookingCtx.approveModification(id)
    setShowApproveModificationConfirm(false)
    setShowApproveModificationTarget(null)
    if (selectedBooking && selectedBooking.id === id) {
      const updated = bookings.find((b: Booking) => b.id === id)
      if (updated) setSelectedBooking(updated)
    }
    toast({
      title: "Modification Approved",
      description: `Booking ${id} has been updated with the requested changes.`,
      className: "border-none bg-blue-500 text-white",
    })
  }

  const confirmDeclineModification = () => {
    if (!declineModificationTarget || !declineModificationReason.trim() || !bookingCtx?.declineModification) return
    const target = declineModificationTarget
    const reason = declineModificationReason.trim()
    bookingCtx.declineModification(target.id, reason)
    setShowDeclineModificationModal(false)
    setDeclineModificationTarget(null)
    setDeclineModificationReason("")
    const updated = bookings.find((b: Booking) => b.id === target.id)
    if (updated) setSelectedBooking(updated)
    toast({
      title: "Modification Declined",
      description: `Booking ${target.id} has been declined. Original booking unchanged.`,
      className: "border-none bg-amber-500 text-white",
    })
  }

  const handleMarkCompleted = (id: string) => {
    setShowMarkCompletedTarget(id)
    setShowMarkCompletedConfirm(true)
  }

  const confirmMarkCompleted = () => {
    const id = showMarkCompletedTarget
    if (!id) return
    updateBookingStatus?.(id, "completed")
    setShowMarkCompletedConfirm(false)
    setShowMarkCompletedTarget(null)
    toast({
      title: "Booking Completed",
      description: `Booking ${id} has been marked as completed.`,
      className: "border-none bg-emerald-500 text-white",
    })
  }

  const handleMarkContractSigned = () => {
    if (!selectedBooking || !markContractSigned) return
    const id = selectedBooking.id
    markContractSigned(id, "Administrator")
    setShowContractConfirm(false)

    toast({
      title: "Contract Signed",
      description: `Contract for booking ${id} has been marked as signed.`,
      className: "border-none bg-blue-500 text-white",
    })
  }

  const STATUS_OPTIONS = [
    { value: "all", label: "All" },
    { value: "pending", label: "Pencil Booking" },
    { value: "verifying", label: "For Verification" },
    { value: "confirmed", label: "Confirmed / Secured" },
    { value: "requests", label: "Requests" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ]

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
          open={!!sendReminderTarget}
          onCancel={() => setSendReminderTarget(null)}
          onConfirm={() => {
            if (!sendReminderTarget) return
            const id = sendReminderTarget.id
            modifyBooking?.(id, {
              balanceReminderSent: true,
              balanceReminderSentAt: new Date().toISOString(),
              balanceReminderSentBy: "Administrator",
            })
            createNotification({
              type: "balance_reminder",
              title: "Remaining Balance Reminder",
              message: `Please settle the remaining balance for Booking ${id}.`,
              bookingId: id,
              userId: sendReminderTarget.userId,
              link: "/portal/payments",
            })
            setSendReminderTarget(null)
            toast({
              title: "Balance Reminder Sent",
              description: `Reminder has been recorded for booking ${id}.`,
              className: "border-none bg-blue-500 text-white",
            })
          }}
        />

        <section className="border-b border-slate-200 pb-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-orange-600">
                  Admin Booking Management
                </p>
                <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
                  Booking Management
                </h1>
                <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">
                  View and manage all customer bookings.
                </p>
              </div>
              <Button
                onClick={() => setShowMaintenanceModal(true)}
                variant="outline"
                className="h-10 shrink-0 whitespace-nowrap rounded-xl border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-orange-600 gap-1.5 self-start sm:self-auto"
              >
                <Wrench className="h-3.5 w-3.5" />
                Calendar
              </Button>
            </div>

            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Select value={venueFilter} onValueChange={setVenueFilter}>
                <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-orange-600 sm:w-[170px]">
                  <div className="flex items-center gap-2">
                    <Filter className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <SelectValue placeholder="All Venues" />
                  </div>
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-200 shadow-xl">
                  <SelectItem value="all" className="font-bold">All Venues</SelectItem>
                  {venueOptions.filter((v) => v !== "all").map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
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
          </div>
        </section>

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
                onView={() => setSelectedBooking(booking)}
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
}: {
  booking: Booking
  onView: () => void
}) {
  const isOfficeRental = isOfficeBooking(booking)
  const startDate = formatDate(booking.date)
  const endDate = (booking as any)?.endDate ? formatDate((booking as any).endDate) : startDate

  return (
    <div className="group flex w-full max-w-full min-w-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange-200 hover:shadow-md sm:flex-row sm:items-center sm:gap-4">
      <div className="flex shrink-0 items-center gap-3 sm:w-[200px]">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
          {isOfficeRental ? <FileText className="h-5 w-5" /> : <Calendar className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
            {isOfficeRental ? "Rental" : "Event"}
          </p>
          <p className="break-words whitespace-normal text-sm font-black text-slate-900">
            {booking.eventName || "Untitled"}
          </p>
          <p className="break-words whitespace-normal text-[11px] font-bold text-orange-600">
            {booking.id}
          </p>
        </div>
      </div>

      <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-2 gap-y-1.5 sm:grid-cols-4 sm:gap-x-3">
        <div className="min-w-0 max-w-full">
          <p className="whitespace-normal break-words text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Customer</p>
          <p className="whitespace-normal break-words text-xs font-black text-slate-800">{booking.userInfo?.name || "—"}</p>
          <p className="whitespace-normal break-words text-[10px] font-bold text-slate-500">{booking.userInfo?.email || "—"}</p>
        </div>
        <div className="min-w-0 max-w-full">
          <p className="whitespace-normal break-words text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Venue</p>
          <p className="whitespace-normal break-words text-xs font-bold text-slate-800">{booking.venue || "N/A"}</p>
        </div>
        <div className="min-w-0 max-w-full">
          <p className="whitespace-normal break-words text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">
            {isOfficeRental ? "Start Date" : "Event Date"}
          </p>
          <p className="whitespace-normal break-words text-xs font-bold text-slate-800">{startDate}</p>
        </div>
        <div className="min-w-0 max-w-full">
          <p className="whitespace-normal break-words text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">End Date</p>
          <p className="whitespace-normal break-words text-xs font-bold text-slate-800">{endDate}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end sm:gap-1">
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] whitespace-nowrap",
            getStatusBadgeClass(booking.status),
          )}
        >
          {getStatusLabel(booking.status)}
        </span>
        <TooltipProvider delayDuration={400}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                onClick={onView}
                className="h-8 shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-2.5 text-[10px] font-bold text-slate-700 hover:bg-slate-50 active:scale-[0.97] transition-transform"
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
}) {
  const { bookings } = useBookings()
  const router = useRouter()

  const booking = useMemo(() => {
    if (!propBooking) return null
    return bookings.find((b) => b.id === propBooking.id) || propBooking
  }, [bookings, propBooking?.id])

  if (!booking) return null

  const isPaymentVerified = (() => {
    const ps = String(booking.paymentStatus || "").toLowerCase()
    return (
      ps === "verified" ||
      ps === "paid" ||
      ps === "partial" ||
      ps === "slot_verified" ||
      booking.isSlotSecured === true
    )
  })()

  const isOfficeRental = isOfficeBooking(booking)
  const typeLabel = isOfficeRental ? "Office Space Rental" : booking.eventType || "Event Venue Rental"
  const startDate = formatDate(booking.date)
  const endDate = (booking as any)?.endDate ? formatDate((booking as any).endDate) : startDate
  const isCompleted = String(booking.status || "").toLowerCase() === "completed"
  const isCancelled = String(booking.status || "").toLowerCase() === "cancelled"

  const normalizeStatus = (value: any) => String(value || "").trim().toLowerCase()

  const getAmount = (value: any) => {
    const numberValue = Number(String(value || 0).replace(/[^0-9.-]+/g, ""))
    return Number.isFinite(numberValue) ? numberValue : 0
  }

  const totalAmount = getAmount(
    (booking as any).totalAmount || booking.totalPrice || (booking as any).amount || (booking as any).price
  )

  const amountPaid = getAmount(
    (booking as any).amountPaid || (booking as any).paymentAmount || (booking as any).paidAmount
  )

  const remainingBalance = getAmount(
    (booking as any).remainingBalance || Math.max(totalAmount - amountPaid, 0)
  )

  const paymentStatus = normalizeStatus((booking as any).paymentStatus)
  const balanceStatus = normalizeStatus((booking as any).balanceStatus)
  const paymentStage = normalizeStatus((booking as any).paymentStage)

  const bookingStatus = normalizeStatus((booking as any).bookingStatus || booking.status)
  const isCancellationRequested = normalizeStatus(booking.status) === "cancellation_requested" || normalizeStatus((booking as any).cancelRequestStatus) === "pending"
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

  const isFullyPaid =
    remainingBalance === 0 &&
    amountPaid >= totalAmount &&
    (paymentStage === "fully paid" || paymentStatus === "paid" || balanceStatus === "settled")

  const timeValue =
    booking.time ||
    `${booking.startTime || ""}${booking.startTime && booking.endTime ? " – " : ""}${booking.endTime || ""}` ||
    "—"

  const bankRef = (booking as any)?.bankReferenceNumber || (booking as any)?.referenceNumber || null

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="w-[95vw] sm:max-w-[560px] max-h-[90dvh] overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 flex items-start justify-between gap-4 border-b border-slate-100 bg-white px-5 py-5">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">
              Booking Details
            </p>
            <DialogTitle className="mt-1.5 break-words text-xl font-black text-slate-900">
              {booking.eventName || "Untitled Booking"}
            </DialogTitle>
            <p className="mt-1 text-xs font-bold text-slate-500">
              {typeLabel} <span className="mx-1.5 text-slate-300">·</span> #{booking.id}
            </p>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em]",
                getStatusBadgeClass(booking.status),
              )}
            >
              {getStatusLabel(booking.status)}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em]",
                getPaymentBadgeClass(booking.paymentStatus, booking.status),
              )}
            >
              {getPaymentStatusLabel(booking.paymentStatus, booking.status)}
            </span>
            {booking.cancellationStatus && booking.cancellationStatus !== "None" && (
              <>
                <span className="inline-flex items-center rounded-md border border-amber-100 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">
                  Cancel: {booking.cancellationStatus}
                </span>
                {amountPaid > 0 && booking.refundStatus && (
                  <span className="inline-flex items-center rounded-md border border-blue-100 bg-blue-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-blue-700">
                    Refund: {booking.refundStatus}
                  </span>
                )}
                {amountPaid <= 0 && (
                  <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                    No Payment Made
                  </span>
                )}
              </>
            )}
          </div>

          <div className="divide-y divide-slate-100">
            <section className="py-5 first:pt-0">
              <div className="mb-4 flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Booking Information</p>
              </div>
              <div className="space-y-3.5">
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Customer</p>
                  <p className="mt-0.5 break-words text-xs font-bold text-slate-800">{booking.userInfo?.name || "—"}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Email</p>
                  <p className="mt-0.5 break-words text-xs font-bold text-slate-800">{booking.userInfo?.email || "—"}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Booking Date</p>
                  <p className="mt-0.5 break-words text-xs font-bold text-slate-800">{formatDate(booking.createdAt) || "—"}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">{isOfficeRental ? "Start Date" : "Event Date"}</p>
                  <p className="mt-0.5 break-words text-xs font-bold text-slate-800">{startDate || "—"}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">End Date</p>
                  <p className="mt-0.5 break-words text-xs font-bold text-slate-800">{endDate || "—"}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Venue / Office</p>
                  <p className="mt-0.5 break-words text-xs font-bold text-slate-800">{booking.venue || "—"}</p>
                </div>
                {isOfficeRental && (
                  <>
                    <div className="min-w-0">
                      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Company Name</p>
                      <p className="mt-0.5 break-words text-xs font-bold text-slate-800">{(booking as any).companyName || booking.eventName || "N/A"}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Nature of Business</p>
                      <p className="mt-0.5 break-words text-xs font-bold text-slate-800">{(booking as any).natureOfBusiness || booking.eventType || "N/A"}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Rental Term</p>
                      <p className="mt-0.5 break-words text-xs font-bold text-slate-800">{(booking as any).rentalTerm || (booking as any).contractTerm || (booking as any).officeRentalTerm || "—"}</p>
                    </div>
                  </>
                )}
                {!isOfficeRental && (
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Guests</p>
                    <p className="mt-0.5 break-words text-xs font-bold text-slate-800">{booking.guestCount ? `${booking.guestCount} pax` : "—"}</p>
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Time</p>
                  <p className="mt-0.5 break-words text-xs font-bold text-slate-800">{timeValue}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Booking ID</p>
                  <p className="mt-0.5 break-words text-xs font-bold text-slate-800">#{booking.id}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Event Type</p>
                  <p className="mt-0.5 break-words text-xs font-bold text-slate-800">{typeLabel}</p>
                </div>
              </div>
            </section>

            <section className="py-5 first:pt-0">
              <PaymentSummaryCard booking={booking} bankRef={bankRef} />
            </section>
          </div>

          {booking.specialRequests && (
            <section className="py-5 first:pt-0">
              <div className="mb-2 flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Special Requests</p>
              </div>
              <p className="text-xs font-semibold leading-relaxed text-slate-700">{booking.specialRequests}</p>
            </section>
          )}

          {(booking.cancellationStatus && booking.cancellationStatus !== "None") || ((booking as any).cancelRequestStatus && (booking as any).cancelRequestStatus !== "None") ? (
            <section className="py-5 first:pt-0">
              <div className="mb-4 flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Cancellation / Refund Status</p>
              </div>
              <div className="space-y-2.5 text-xs font-semibold text-slate-700">
                <div className="flex justify-between">
                  <span className="text-slate-400">Cancellation</span>
                  <span className="font-bold text-slate-900">{booking.cancellationStatus || (booking as any).cancelRequestStatus || "None"}</span>
                </div>
                {(booking.cancellationReason || (booking as any).cancelReason) && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Reason</span>
                    <span className="font-bold text-slate-900 max-w-[60%] text-right">{booking.cancellationReason || (booking as any).cancelReason}</span>
                  </div>
                )}
                {(booking.cancellationRequestedAt || (booking as any).cancelRequestedAt) && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Request Date</span>
                    <span className="font-bold text-slate-900">{formatDate(booking.cancellationRequestedAt || (booking as any).cancelRequestedAt)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-400">Refund</span>
                  <span className="font-bold text-slate-900">{amountPaid > 0 ? (booking.refundStatus || "Not Applicable") : "Not Applicable"}</span>
                </div>
                {booking.refundEligibilityNote && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Eligibility</span>
                    <span className="font-bold text-slate-900">{booking.refundEligibilityNote}</span>
                  </div>
                )}
                {booking.daysBeforeEventAtCancellation !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Days before event</span>
                    <span className="font-bold text-slate-900">{booking.daysBeforeEventAtCancellation} days</span>
                  </div>
                )}
                {booking.refundClaimNote && (
                  <div className="mt-2 rounded-lg bg-amber-100/50 px-3 py-2 text-[11px] font-semibold text-amber-800">
                    {booking.refundClaimNote}
                  </div>
                )}
                {booking.cancellationDeclineReason && (
                  <div className="mt-2 rounded-lg bg-rose-100/50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                    Decline Reason: {booking.cancellationDeclineReason}
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {booking.modificationRequested && booking.modificationStatus && booking.modificationStatus !== "None" && (
            <section className="py-5 first:pt-0">
              <div className="mb-4 flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Modification Status</p>
              </div>
              <div className="space-y-2.5 text-xs font-semibold text-slate-700">
                <div className="flex justify-between">
                  <span className="text-slate-400">Status</span>
                  <span className="font-bold text-slate-900">{booking.modificationStatus}</span>
                </div>
                {booking.modificationReason && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Reason</span>
                    <span className="font-bold text-slate-900">{booking.modificationReason}</span>
                  </div>
                )}
                {booking.modificationDeclineReason && (
                  <div className="mt-2 rounded-lg bg-rose-100/50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                    Decline Reason: {booking.modificationDeclineReason}
                  </div>
                )}
              </div>
            </section>
          )}

          {(booking.contractStatus === "Signed" || booking.contractSigned) && (
            <section className="py-5 first:pt-0">
              <div className="mb-4 flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-500" />
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Contract</p>
              </div>
              <div className="space-y-2">
                <span
                  className={cn(
                    "inline-block rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em]",
                    "border-emerald-100 bg-emerald-50 text-emerald-700",
                  )}
                >
                  Contract Status: Signed
                </span>
                {booking.contractSignedDate && (
                  <p className="text-xs font-semibold text-slate-700">
                    Signed Date: {formatDate(booking.contractSignedDate)}
                  </p>
                )}
                {booking.contractSignedBy && (
                  <p className="text-xs font-semibold text-slate-700">
                    Signed By: {booking.contractSignedBy}
                  </p>
                )}
                <p className="text-xs font-semibold text-slate-500">
                  Signing Method: Face-to-face
                </p>
              </div>
            </section>
          )}

          {(() => {
            const normStatus = normalizeStatus(booking.status)
            const isContractSigningRequired = normStatus === "contract_signing_required"
            const showContractSigning =
              isOfficeRental
                ? isContractSigningRequired
                : isPaymentVerified
            const contractAlreadySigned = booking.contractStatus === "Signed" || booking.contractSigned
            if (contractAlreadySigned) return null
            if (!showContractSigning || isCancelled || isCompleted) return null
            return (
              <section className="py-5 first:pt-0">
                <div className="mb-4 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-slate-500" />
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Contract</p>
                </div>
                <div className="min-w-0 space-y-3">
                  <span
                    className={cn(
                      "inline-block rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em]",
                      "border-orange-100 bg-orange-50 text-orange-700",
                    )}
                  >
                    Contract Status: Pending Signature
                  </span>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-orange-700">
                      Contract signing must be completed onsite at the One Estela Place office.
                    </p>
                    <p className="text-[11px] font-semibold text-slate-500">
                      The customer must personally sign the official contract at the One Estela Place office.
                    </p>
                  </div>
                  <TooltipProvider delayDuration={400}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={onMarkContractSigned}
                          className="h-11 w-full rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-sm hover:bg-blue-700 active:scale-[0.97] transition-transform"
                        >
                          <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                          Mark Contract as Signed
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-[10px] font-semibold">
                        Confirm contract signing
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </section>
            )
          })()}

          {(() => {
            if (booking.contractStatus === "Signed" || booking.contractSigned) return null
            const normStatus = normalizeStatus(booking.status)
            if (isOfficeRental && normStatus === "contract_signing_required") return null
            if (isPaymentVerified && !isOfficeRental) return null
            if (isCancelled || isCompleted) return null
            return (
              <section className="py-5 first:pt-0">
                <div className="mb-4 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-slate-500" />
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Contract</p>
                </div>
                <span
                  className={cn(
                    "inline-block rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em]",
                    "border-slate-200 bg-slate-50 text-slate-600",
                  )}
                >
                  Contract Status: Not Available
                </span>
                <p className="mt-2 text-xs font-semibold text-slate-500">
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
              const remainingMs = endMs - now
              if (remainingMs <= 0) return "Expired"
              const days = Math.ceil(remainingMs / 86400000)
              if (days >= 30) {
                const months = Math.floor(days / 30)
                const remainingDays = days % 30
                return remainingDays > 0 ? `${months}mo ${remainingDays}d` : `${months}mo`
              }
              return `${days}d`
            }
            return (
              <section className="py-5 first:pt-0">
                <div className="mb-4 flex items-center gap-2">
                  <Calendar className={`h-4 w-4 ${bookingStatus === "active_rental" ? "text-sky-500" : "text-rose-500"}`} />
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Rental Information</p>
                </div>
                <div className="space-y-2 text-xs font-semibold">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Start Date</span>
                    <span className="font-bold text-slate-900">{startDate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">End Date</span>
                    <span className="font-bold text-slate-900">{endDate}</span>
                  </div>
                  {bookingStatus === "active_rental" && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Days Used</span>
                        <span className="font-bold text-slate-900">{daysUsed} / {totalDays}d</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Remaining</span>
                        <span className="font-bold text-sky-600">{remainingDuration()}</span>
                      </div>
                      <div className="mt-2">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-sky-500 transition-all"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[10px] font-bold text-slate-400 text-right">{progressPct}% complete</p>
                      </div>
                    </>
                  )}
                  {bookingStatus === "rental_expired" && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Status</span>
                      <span className="font-bold text-rose-600">Rental Period Ended</span>
                    </div>
                  )}
                </div>
              </section>
            )
          })()}
        </div>

        {/* ── Status-Based Action Buttons ── */}
        {(() => {
          const normStatus = normalizeStatus(booking.status)
          const isPencilBooking =
            normStatus === "pending" &&
            !["for_review", "cash_pending", "slot_pending", "pending_verification", "pending verification", "for verification"].includes(paymentStatus)
          const isForVerificationStatus =
            normStatus === "verifying" ||
            ["for_review", "cash_pending", "slot_pending", "pending_verification", "pending verification", "for verification"].includes(paymentStatus)
          const isApprovedOrConfirmed =
            ["confirmed", "reservation_secured"].includes(normStatus)

          const hasCustomerSubmittedPayment =
            (booking as any).hasActivePaymentSubmission === true ||
            paymentStatus === "for_review" ||
            paymentStatus === "cash_pending" ||
            paymentStatus === "slot_pending" ||
            paymentStatus === "pending_verification" ||
            Boolean((booking as any).paymentSubmittedAt)
          const canDoRecordOnsite =
            remainingBalance > 0 &&
            !isFullyPaid &&
            !isCompleted &&
            !isCancelled &&
            !isForVerificationStatus &&
            !hasActiveProof &&
            !hasCustomerSubmittedPayment
          const canDoBalanceReminder =
            isApprovedOrConfirmed &&
            remainingBalance > 0 &&
            !isCompleted &&
            !isCancelled
          const isMarkCompletedEnabled =
            isFullyPaid &&
            remainingBalance === 0 &&
            isEventFinished &&
            !isCompleted &&
            !isCancelled
          const isMarkCompletedVisible =
            isFullyPaid &&
            remainingBalance === 0 &&
            !isCompleted &&
            !isCancelled

          if (isCancellationRequested && !isCompleted && !isCancelled) {
            return (
              <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-5">
                <div className="rounded-xl bg-amber-50 p-3 text-center mb-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600">Cancellation Under Review</p>
                  <p className="mt-1 text-xs font-semibold text-amber-700">
                    The customer has requested to cancel this booking. Please review and take action.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {onContinueBooking && (
                    <Button
                      onClick={() => onContinueBooking(booking.id)}
                      variant="outline"
                      className="h-11 w-full rounded-xl border-emerald-200 px-4 text-sm font-black text-emerald-700 hover:bg-emerald-50"
                    >
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      Continue Booking
                    </Button>
                  )}
                  {onApproveCancellation && (
                    <Button
                      onClick={() => onApproveCancellation(booking.id)}
                      className="h-11 w-full rounded-xl border-rose-200 bg-rose-50 px-4 text-sm font-black text-rose-700 hover:bg-rose-100"
                    >
                      <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
                      Approve Cancellation
                    </Button>
                  )}
                </div>
              </div>
            )
          }

          if (isModificationUnderReview && !isCompleted && !isCancelled) {
            return (
              <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-5">
                <div className="rounded-xl bg-purple-50 p-3 text-center mb-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-600">Modification Under Review</p>
                  <p className="mt-1 text-xs font-semibold text-purple-700">
                    The customer has requested to modify this booking. Please review and take action.
                  </p>
                  {booking.modificationReason && (
                    <p className="mt-2 text-[11px] font-semibold text-purple-600">
                      Reason: {booking.modificationReason}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {onDeclineModification && (
                    <Button
                      onClick={() => onDeclineModification(booking.id)}
                      variant="outline"
                      className="h-11 w-full rounded-xl border-amber-200 px-4 text-sm font-black text-amber-700 hover:bg-amber-50"
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      Decline Modification
                    </Button>
                  )}
                  {onApproveModification && (
                    <Button
                      onClick={() => onApproveModification(booking.id)}
                      className="h-11 w-full rounded-xl border-emerald-200 bg-emerald-50 px-4 text-sm font-black text-emerald-700 hover:bg-emerald-100"
                    >
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      Approve Modification
                    </Button>
                  )}
                </div>
              </div>
            )
          }

          if (isForVerificationStatus) return null
          if (isCompleted || isCancelled) return null

          if (normStatus === "contract_signing_required" || normStatus === "active_rental") {
            const canRecord = canDoRecordOnsite && onRecordOnsitePayment
            const canRemind = isApprovedOrConfirmed && remainingBalance > 0 && onSendReminder
            if (!canRecord && !canRemind) return null
            return (
              <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-5">
                {remainingBalance > 0 && (
                  <div className="rounded-xl bg-amber-50 p-3 text-center mb-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600">Remaining Balance</p>
                    <p className="mt-1 text-xl font-black text-amber-700">₱{remainingBalance.toLocaleString()}</p>
                  </div>
                )}
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                  {canRemind && (
                    <Button
                      onClick={() => onSendReminder(booking.id)}
                      variant="outline"
                      className="h-11 rounded-xl border-blue-200 px-4 text-sm font-black text-blue-700 hover:bg-blue-50"
                    >
                      <Bell className="mr-1.5 h-3.5 w-3.5" />
                      Send Balance Reminder
                    </Button>
                  )}
                  {canRecord && (
                    <Button
                      onClick={() => onRecordOnsitePayment(booking.id)}
                      className="h-11 rounded-xl border-emerald-200 bg-emerald-50 px-4 text-sm font-black text-emerald-700 hover:bg-emerald-100"
                    >
                      <DollarSign className="mr-1.5 h-3.5 w-3.5" />
                      Record Onsite Payment
                    </Button>
                  )}
                </div>
              </div>
            )
          }

          if (normStatus === "rental_expired") {
            const canMarkCompleted = isFullyPaid && !isCompleted && onMarkCompleted
            if (!canMarkCompleted) return null
            return (
              <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-5">
                <Button
                  onClick={() => onMarkCompleted(booking.id)}
                  className="h-11 w-full rounded-xl bg-emerald-600 px-4 text-sm font-black text-white shadow-sm hover:bg-emerald-700"
                >
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Mark as Completed
                </Button>
              </div>
            )
          }

          if (isPencilBooking) {
            if (!canDoRecordOnsite || !onRecordOnsitePayment) return null
            return (
              <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <Button
                    onClick={() => onRecordOnsitePayment(booking.id)}
                    className="h-11 rounded-xl border-emerald-200 bg-emerald-50 px-4 text-sm font-black text-emerald-700 hover:bg-emerald-100"
                  >
                    <DollarSign className="mr-1.5 h-3.5 w-3.5" />
                    Record Onsite Payment
                  </Button>
                </div>
              </div>
            )
          }

          if (isApprovedOrConfirmed) {
            if (!remainingBalance && !canDoBalanceReminder && !canDoRecordOnsite && !isMarkCompletedVisible) return null
            return (
              <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-5">
                {remainingBalance > 0 && (
                  <div className="rounded-xl bg-amber-50 p-3 text-center mb-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600">Remaining Balance</p>
                    <p className="mt-1 text-xl font-black text-amber-700">₱{remainingBalance.toLocaleString()}</p>
                  </div>
                )}
                {(canDoBalanceReminder || canDoRecordOnsite) && (
                  <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                    {canDoBalanceReminder && onSendReminder && (
                      <Button
                        onClick={() => onSendReminder(booking.id)}
                        variant="outline"
                        className="h-11 rounded-xl border-blue-200 px-4 text-sm font-black text-blue-700 hover:bg-blue-50"
                      >
                        <Bell className="mr-1.5 h-3.5 w-3.5" />
                        Send Balance Reminder
                      </Button>
                    )}
                    {canDoRecordOnsite && onRecordOnsitePayment && (
                      <Button
                        onClick={() => onRecordOnsitePayment(booking.id)}
                        className="h-11 rounded-xl border-emerald-200 bg-emerald-50 px-4 text-sm font-black text-emerald-700 hover:bg-emerald-100"
                      >
                        <DollarSign className="mr-1.5 h-3.5 w-3.5" />
                        Record Onsite Payment
                      </Button>
                    )}
                  </div>
                )}
                {isMarkCompletedVisible && (
                  <div className={remainingBalance > 0 || canDoBalanceReminder || canDoRecordOnsite ? "mt-3" : ""}>
                    <Button
                      onClick={() => isMarkCompletedEnabled && onMarkCompleted(booking.id)}
                      disabled={!isMarkCompletedEnabled}
                      className="h-11 w-full rounded-xl px-4 text-sm font-black text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: isMarkCompletedEnabled ? '#059669' : '#9ca3af',
                      }}
                    >
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      Mark as Completed
                    </Button>
                    {!isEventFinished && (
                      <p className="mt-2 text-[10px] font-semibold text-slate-500 text-center">
                        This action will be available after the event has ended.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          }

          if (isFullyPaid && !isCompleted && !isCancelled) {
            if (!isMarkCompletedVisible) return null
            return (
              <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-5">
                <Button
                  onClick={() => isMarkCompletedEnabled && onMarkCompleted(booking.id)}
                  disabled={!isMarkCompletedEnabled}
                  className="h-11 w-full rounded-xl px-4 text-sm font-black text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: isMarkCompletedEnabled ? '#059669' : '#9ca3af',
                  }}
                >
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Mark as Completed
                </Button>
                {!isEventFinished && (
                  <p className="mt-2 text-[10px] font-semibold text-slate-500 text-center">
                    This action will be available after the event has ended.
                  </p>
                )}
              </div>
            )
          }

          return null
        })()}
      </div>
      </DialogContent>
    </Dialog>
  )
}

function RecordOnsitePaymentModal({
  booking,
  open,
  onClose,
  onRecorded,
}: {
  booking: Booking | null
  open: boolean
  onClose: () => void
  onRecorded: (updated: Booking) => void
}) {
  const { manualRecordOnsitePayment } = useBookings()
  const [step, setStep] = useState<"form" | "confirm">("form")
  const [paymentType, setPaymentType] = useState("downpayment")
  const [amountReceived, setAmountReceived] = useState("")
  const [adminNote, setAdminNote] = useState("")

  useEffect(() => {
    if (open) {
      setStep("form")
      setPaymentType("downpayment")
      setAmountReceived("")
      setAdminNote("")
    }
  }, [open])

  if (!booking) return null

  const totalAmount = (() => {
    const val = (booking as any).totalAmount || booking.totalPrice || (booking as any).amount || (booking as any).price
    const num = Number(String(val || 0).replace(/[^0-9.-]+/g, ""))
    return Number.isFinite(num) ? num : 0
  })()

  const currentAmountPaid = (() => {
    const val = (booking as any).amountPaid || (booking as any).paymentAmount || (booking as any).paidAmount
    const num = Number(String(val || 0).replace(/[^0-9.-]+/g, ""))
    return Number.isFinite(num) ? num : 0
  })()

  const remainingBalance = Math.max(totalAmount - currentAmountPaid, 0)
  const enteredAmount = (() => {
    const num = Number(String(amountReceived || "0").replace(/[^0-9.-]+/g, ""))
    return Number.isFinite(num) ? num : 0
  })()

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

  const handleConfirm = () => {
    if (enteredAmount <= 0) return

    manualRecordOnsitePayment(booking.id, {
      paymentType: paymentType as "downpayment" | "remaining_balance" | "full_payment",
      amountReceived: enteredAmount,
      adminNote: adminNote.trim(),
      adminName: "Administrator",
    })

    // Booking data is updated in context by manualRecordOnsitePayment
    let fullUpdated: Booking = booking

    onRecorded(fullUpdated)
  }

  const summary = getNewPaymentSummary()
  const typeLabel = paymentType === "full_payment" ? "Full Payment" : paymentType === "remaining_balance" ? "Remaining Balance" : "Downpayment"

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 p-0 shadow-2xl [&>button]:hidden bg-white">
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
                    <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
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
                    <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                      Actual Method *
                    </Label>
                    <div className="mt-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-700">
                      Cash / Onsite
                    </div>
                  </div>

                  <div>
                    <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
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
                  </div>

                  <div>
                    <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
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
                    <span className="font-bold text-slate-900">₱{summary.newAmountPaid.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">New Remaining Balance</span>
                    <span className="font-bold text-amber-700">₱{summary.newRemainingBalance.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">New Status</span>
                    <span className="font-bold text-slate-900">{summary.newPaymentStatus}</span>
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
                  disabled={enteredAmount <= 0}
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
                  onClick={handleConfirm}
                  className="h-11 w-full sm:w-auto rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700"
                >
                  Confirm Onsite Payment
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PaymentSummaryCard({
  booking,
  bankRef,
}: {
  booking: Booking
  bankRef: string | null
}) {
  const rawAmountPaid = (booking as any)?.amountPaid || 0
  const amountPaid = Number(rawAmountPaid) || 0
  const totalPrice = Number(booking.totalPrice) || 0
  const hasPaid = amountPaid > 0
  const hasTotal = totalPrice > 0
  const remaining = hasTotal ? Math.max(0, totalPrice - amountPaid) : null
  const selectedDP = Number((booking as any).selectedDownpaymentAmount || 0)
  const downpaymentPaid = Number((booking as any).downpaymentPaid || 0)
  const downpaymentRemaining = Number((booking as any).downpaymentRemaining || 0)
  const paymentStage = String((booking as any).paymentStage || "")
  const isDownpayment = String(booking.paymentType || "").toLowerCase() === "downpayment"
  const showDP = isDownpayment && selectedDP > 0

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <div className="h-1.5 w-1.5 rounded-full bg-orange-500" />
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Payment Summary</p>
      </div>

      <div className="space-y-3">
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Method</p>
          <p className="mt-0.5 whitespace-nowrap text-xs font-bold text-slate-800">
            {booking.paymentMethod ? getPaymentMethodLabel(booking.paymentMethod) : "—"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Type</p>
          <p className="mt-0.5 whitespace-nowrap text-xs font-bold text-slate-800">
            {booking.paymentType ? formatTextLabel(booking.paymentType) : "—"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Total Amount</p>
          <p className="mt-0.5 whitespace-nowrap text-xs font-bold text-slate-800">{hasTotal ? formatMoney(totalPrice) : "—"}</p>
        </div>
        {showDP && (
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Selected Downpayment</p>
            <p className="mt-0.5 whitespace-nowrap text-xs font-bold text-slate-800">{formatMoney(selectedDP)}</p>
          </div>
        )}
        {showDP && (
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Downpayment Paid</p>
            <p className="mt-0.5 whitespace-nowrap text-xs font-bold text-slate-800">{formatMoney(downpaymentPaid)}</p>
          </div>
        )}
        {showDP && downpaymentRemaining > 0 && (
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-amber-600">Downpayment Remaining</p>
            <p className="mt-0.5 whitespace-nowrap text-xs font-bold text-amber-700">{formatMoney(downpaymentRemaining)}</p>
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Amount Paid</p>
          <p className="mt-0.5 whitespace-nowrap text-xs font-bold text-slate-800">{hasPaid ? formatMoney(amountPaid) : "—"}</p>
        </div>
        {remaining !== null && remaining > 0 && (
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-amber-600">Remaining Balance</p>
            <p className="mt-0.5 whitespace-nowrap text-xs font-bold text-amber-700">{formatMoney(remaining)}</p>
          </div>
        )}
        {paymentStage && (
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Payment Stage</p>
            <p className="mt-0.5 whitespace-nowrap text-xs font-bold text-slate-800">{paymentStage}</p>
          </div>
        )}
        {bankRef && (
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Bank Reference</p>
            <p className="mt-0.5 whitespace-nowrap text-xs font-bold text-slate-900">{bankRef}</p>
          </div>
        )}
      </div>
    </div>
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
      <DialogContent className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 bg-white p-0 shadow-2xl [&>button]:hidden">
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
      <DialogContent className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 bg-white p-0 shadow-2xl [&>button]:hidden">
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
      <DialogContent className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 bg-white p-0 shadow-2xl [&>button]:hidden">
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
              <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Decline Reason *</Label>
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
      <DialogContent className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 bg-white p-0 shadow-2xl [&>button]:hidden">
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
      <DialogContent className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 bg-white p-0 shadow-2xl [&>button]:hidden">
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
              <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Decline Reason *</Label>
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
      <DialogContent className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] rounded-2xl border-0 bg-white p-0 shadow-2xl [&>button]:hidden">
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
    addMaintenanceRecord,
    removeMaintenanceRecord,
    bookings: allBookings,
  } = useBookings()
  const { toast } = useToast()

  const venues = useMemo(() => getAllVenues(), [])
  const offices = useMemo(() => getAllOffices(), [])

  const [maintType, setMaintType] = useState<"venue" | "office">("venue")
  const [officeGroup, setOfficeGroup] = useState<"A" | "B" | "">("")
  const [selectedSpaceId, setSelectedSpaceId] = useState("")
  const [selectedDate, setSelectedDate] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [useRange, setUseRange] = useState(false)
  const [reason, setReason] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  useEffect(() => {
    if (open) {
      const firstVenue = venues[0]?.id || "v1"
      setSelectedSpaceId(maintType === "venue" ? firstVenue : "")
      setOfficeGroup("")
    }
  }, [open, maintType, venues])

  const currentSpaces = maintType === "venue" ? venues : (officeGroup ? offices.filter(o => {
    const num = parseInt(o.id.slice(1))
    return officeGroup === "A" ? num >= 1 && num <= 8 : num >= 9 && num <= 16
  }) : [])

  const filteredRecords = maintenanceRecords.filter(
    r => r.type === maintType
  ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const spaceFilteredRecords = selectedSpaceId
    ? filteredRecords.filter(r => r.spaceId === selectedSpaceId || r.spaceName === selectedSpaceId)
    : filteredRecords

  // Calendar computations
  const calYear = calendarMonth.getFullYear()
  const calMonth = calendarMonth.getMonth()
  const firstDayOfWeek = new Date(calYear, calMonth, 1).getDay()
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
  const daysInMonthArray = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  const spaceMaintDates = useMemo(() => {
    const dates = new Set<string>()
    if (!selectedSpaceId) return dates
    for (const rec of maintenanceRecords) {
      if (rec.spaceId !== selectedSpaceId && rec.spaceName !== selectedSpaceId) continue
      if (rec.date) dates.add(rec.date)
      if (rec.startDate && rec.endDate) {
        const rangeDates = getDatesInRange(rec.startDate, rec.endDate)
        for (const d of rangeDates) dates.add(d)
      }
    }
    return dates
  }, [maintenanceRecords, selectedSpaceId])

  const getDayStatus = (day: number) => {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const todayStr = new Date().toISOString().split("T")[0]
    if (dateStr < todayStr) return "past"
    if (spaceMaintDates.has(dateStr)) return "maintenance"

    const spaceName = currentSpaces.find(s => s.id === selectedSpaceId)?.name || ""
    const dayBookings = (allBookings || []).filter(b =>
      b.date === dateStr &&
      (b.venueId === selectedSpaceId || b.venue === spaceName) &&
      ["approved", "confirmed", "completed", "contract_signing_required", "reservation_secured", "active_rental"].includes(b.status?.toLowerCase() || "")
    )
    const pendingBookings = (allBookings || []).filter(b =>
      b.date === dateStr &&
      (b.venueId === selectedSpaceId || b.venue === spaceName) &&
      ["pending", "verifying"].includes(b.status?.toLowerCase() || "")
    )
    const modRequestBookings = (allBookings || []).filter(b =>
      b.date === dateStr &&
      (b.venueId === selectedSpaceId || b.venue === spaceName) &&
      ["modification_under_review", "cancellation_requested"].includes(b.status?.toLowerCase() || "")
    )

    if (modRequestBookings.length > 0) return "modification_request"
    if (pendingBookings.length > 0) return "pending"
    if (maintType === "office") {
      if (dayBookings.length >= 1) return "booked"
    } else {
      if (dayBookings.length >= 2) return "booked"
      if (dayBookings.length === 1) {
        const hasReserved = dayBookings.some(b => ["reservation_secured", "contract_signing_required"].includes(b.status?.toLowerCase() || ""))
        return hasReserved ? "reserved" : "booked"
      }
    }

    return "available"
  }

  const handleSave = () => {
    const dateToUse = useRange ? startDate : selectedDate
    if (!dateToUse) {
      toast({ title: "Date Required", description: "Please select a date.", variant: "destructive" })
      return
    }
    if (!selectedSpaceId) {
      toast({ title: "Space Required", description: "Please select a space.", variant: "destructive" })
      return
    }
    if (useRange && startDate && endDate && endDate < startDate) {
      toast({ title: "Invalid Range", description: "End date must be after start date.", variant: "destructive" })
      return
    }

    const datesToAdd = useRange && startDate && endDate
      ? getDatesInRange(startDate, endDate)
      : [dateToUse]

    const spaceName = currentSpaces.find(s => s.id === selectedSpaceId)?.name || ""
    const bookedDates = datesToAdd.filter(d => {
      const dayBookings = (allBookings || []).filter(b =>
        b.date === d &&
        (b.venueId === selectedSpaceId || b.venue === spaceName) &&
        ["approved", "confirmed", "completed", "contract_signing_required", "reservation_secured", "active_rental"].includes(b.status?.toLowerCase() || "")
      )
      return dayBookings.length > 0
    })
    if (bookedDates.length > 0) {
      toast({
        title: "Date(s) Already Booked",
        description: `Cannot schedule maintenance on booked date(s): ${bookedDates.join(", ")}.`,
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)
    const space = currentSpaces.find(s => s.id === selectedSpaceId)

    for (const d of datesToAdd) {
      const exists = maintenanceRecords.some(
        r => r.spaceId === selectedSpaceId && r.date === d
      )
      if (!exists) {
        addMaintenanceRecord({
          type: maintType,
          spaceId: selectedSpaceId,
          spaceName: space?.name || selectedSpaceId,
          date: d,
          startDate: useRange ? startDate : undefined,
          endDate: useRange ? endDate : undefined,
          reason: reason || undefined,
          status: "Active",
        })
      }
    }

    setIsSaving(false)
    setSelectedDate("")
    setStartDate("")
    setEndDate("")
    setReason("")
    setUseRange(false)
    toast({
      title: "Maintenance Saved",
      description: `${datesToAdd.length} date(s) blocked for ${space?.name || selectedSpaceId}.`,
    })
  }

  const todayStr = new Date().toISOString().split("T")[0]

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="flex flex-col border-0 bg-white p-0 shadow-2xl gap-0 rounded-3xl w-[95vw] sm:max-w-[520px] max-h-[90dvh]"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* HEADER */}
          <div className="shrink-0 border-b border-slate-100 px-5 py-4">
            <DialogTitle className="text-xl font-black text-slate-950">
              Schedule Maintenance
            </DialogTitle>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Block dates for maintenance per space.
            </p>
          </div>

          {/* BODY */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Type selector */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                Space Type
              </label>
              <select
                value={maintType}
                onChange={(e) => {
                  setMaintType(e.target.value as "venue" | "office")
                  setSelectedSpaceId("")
                  setOfficeGroup("")
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
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                  Select Venue
                </label>
                <select
                  value={selectedSpaceId}
                  onChange={(e) => setSelectedSpaceId(e.target.value)}
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
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                    Select Building
                  </label>
                  <select
                    value={officeGroup}
                    onChange={(e) => {
                      setOfficeGroup(e.target.value as "A" | "B")
                      setSelectedSpaceId("")
                    }}
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  >
                    <option value="">Select office building</option>
                    <option value="A">Office A</option>
                    <option value="B">Office B</option>
                  </select>
                </div>
                {officeGroup && (
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                      Select Room
                    </label>
                    <select
                      value={selectedSpaceId}
                      onChange={(e) => setSelectedSpaceId(e.target.value)}
                      className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    >
                      <option value="" disabled>Select room</option>
                      {currentSpaces.map((s) => {
                        const roomNum = officeGroup === "A" ? parseInt(s.id.slice(1)) : parseInt(s.id.slice(1)) - 8
                        return (
                          <option key={s.id} value={s.id}>
                            Room {roomNum}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                )}
              </>
            )}

            {/* Calendar */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                  {useRange ? "Date Range" : "Select Date"}
                </label>
                <button
                  type="button"
                  onClick={() => setUseRange(!useRange)}
                  className={`text-[9px] font-bold uppercase tracking-[0.2em] px-2 py-0.5 rounded-lg transition-all ${
                    useRange
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  {useRange ? "Single Date" : "Date Range"}
                </button>
              </div>

              {useRange ? (
                <div className="mt-1.5 space-y-2">
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    min={todayStr}
                    className="h-10 rounded-xl border-slate-200 text-xs font-bold"
                    placeholder="Start date"
                  />
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    min={startDate || todayStr}
                    className="h-10 rounded-xl border-slate-200 text-xs font-bold"
                    placeholder="End date"
                  />
                </div>
              ) : !selectedSpaceId ? (
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
                      <div key={d} className="text-[7px] font-black uppercase tracking-[0.1em] text-slate-400">
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
                      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                      const isSel = selectedDate === dateStr
                      const status = getDayStatus(day)

                      const statusStyles: Record<string, string> = {
                        booked: "cursor-not-allowed border-rose-300 bg-rose-100 text-rose-700",
                        pending: "cursor-not-allowed border-amber-300 bg-amber-100 text-amber-700",
                        modification_request: "cursor-not-allowed border-purple-300 bg-purple-100 text-purple-700",
                        reserved: "cursor-not-allowed border-blue-300 bg-blue-100 text-blue-700",
                        maintenance: "cursor-not-allowed border-slate-900 bg-slate-900 text-slate-400",
                        past: "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-300 opacity-60",
                        available: "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50",
                      }
                      const statusTitles: Record<string, string> = {
                        booked: "Fully Booked",
                        pending: "Pending",
                        modification_request: "Modification Request",
                        reserved: "Reserved",
                        maintenance: "Maintenance",
                        past: "Past date",
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
                          onClick={() => !isDisabled && setSelectedDate(dateStr)}
                          className={`flex h-7 w-7 2xl:h-8 2xl:w-8 items-center justify-center rounded-full border text-[10px] xl:text-[11px] font-black outline-none transition-all focus-visible:ring-2 focus-visible:ring-orange-300 ${dayClass}`}
                        >
                          {day}
                        </button>
                      )
                    })}
                  </div>

                  {/* Legend */}
                  <div className="mt-3 grid grid-cols-4 gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2.5">
                    <div className="flex items-center justify-center gap-1.5">
                      <div className="h-2.5 w-2.5 rounded-full border border-slate-200 bg-white" />
                      <span className="text-[7px] font-black uppercase tracking-[0.08em] text-slate-400">Available</span>
                    </div>
                    <div className="flex items-center justify-center gap-1.5">
                      <div className="h-2.5 w-2.5 rounded-full bg-rose-300" />
                      <span className="text-[7px] font-black uppercase tracking-[0.08em] text-rose-600">Full Slot / Booked</span>
                    </div>
                    <div className="flex items-center justify-center gap-1.5">
                      <div className="h-2.5 w-2.5 rounded-full bg-blue-300" />
                      <span className="text-[7px] font-black uppercase tracking-[0.08em] text-blue-600">Reserved</span>
                    </div>
                    <div className="flex items-center justify-center gap-1.5">
                      <div className="h-2.5 w-2.5 rounded-full bg-slate-900" />
                      <span className="text-[7px] font-black uppercase tracking-[0.08em] text-slate-600">Maintenance</span>
                    </div>
                  </div>

                  {/* Selected date display */}
                  {selectedDate && (
                    <div className="mt-2 rounded-lg bg-orange-50 border border-orange-100 px-3 py-2 text-center">
                      <p className="text-[9px] font-bold text-orange-700">
                        Selected: {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Reason */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                Reason / Notes <span className="text-slate-300">(optional)</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Annual plumbing inspection"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 placeholder:text-slate-300 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 resize-none min-h-[60px]"
              />
            </div>

            {/* Save button */}
            <Button
              onClick={handleSave}
              disabled={isSaving || (useRange ? !startDate || !endDate : !selectedDate) || !selectedSpaceId}
              className="h-10 w-full rounded-xl bg-slate-900 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {isSaving ? "Saving..." : "Block Maintenance"}
            </Button>

            {/* Existing records */}
            {spaceFilteredRecords.length > 0 && (
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                  Existing Maintenance
                </label>
                <div className="mt-1.5 space-y-1.5 max-h-[220px] overflow-y-auto">
                  {spaceFilteredRecords.map((rec) => {
                    const space = (maintType === "venue" ? venues : offices).find(
                      s => s.id === rec.spaceId
                    )
                    return (
                      <div
                        key={rec.id}
                        className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-bold text-slate-700 truncate">
                            {space?.name || rec.spaceName}
                          </p>
                          <p className="text-[9px] font-semibold text-slate-400">
                            {formatDateSimple(rec.date)}
                            {rec.startDate && rec.endDate && rec.startDate !== rec.endDate
                              ? ` - ${formatDateSimple(rec.endDate)}`
                              : ""}
                            {rec.reason ? ` · ${rec.reason}` : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeMaintenanceRecord(rec.id)}
                          className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                          title="Remove maintenance"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* FOOTER */}
          <div className="shrink-0 shrink-0 border-t border-slate-100 bg-white px-5 py-5">
            <Button
              onClick={onClose}
              variant="outline"
              className="h-10 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )

  function getDatesInRange(start: string, end: string): string[] {
    const dates: string[] = []
    const current = new Date(start + "T00:00:00")
    const endDateObj = new Date(end + "T00:00:00")
    while (current <= endDateObj) {
      dates.push(current.toISOString().split("T")[0])
      current.setDate(current.getDate() + 1)
    }
    return dates
  }
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
