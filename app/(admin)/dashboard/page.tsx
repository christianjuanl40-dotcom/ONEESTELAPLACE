"use client"

import type React from "react"
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  Inbox,
  Tent,
  TrendingUp,
  X,
} from "lucide-react"

import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useRouter } from "next/navigation"
import { cn } from "@/src/modules/shared/lib/utils"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { isOfficeResourceBooking } from "@/src/modules/shared/lib/resource-identity"
import { useBookingData, type Booking } from "@/src/modules/client/contexts/booking-context"
import {
  calculatePaymentSummary,
  getPaymentOverallStatusLabel,
  getRecordsForBooking,
  type PaymentRecordLike,
} from "@/src/modules/shared/lib/payment-calculations"
import { getBookingLifecycleStatus } from "@/src/modules/shared/lib/booking-helpers"
import { Button } from "@/src/modules/shared/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/src/modules/shared/components/ui/dialog"
import { ModifyBookingDialog } from "@/src/modules/admin/components/modify-booking-dialog"
import {
  buildPaymentReviewQueue,
  DashboardPaymentReviewQueueModal,
  type PaymentReviewQueueEntry,
} from "@/src/modules/admin/components/dashboard-payment-review-queue"
import {
  ApproveCancellationConfirmModal,
  ApproveModificationConfirmModal,
  BalanceReminderModal,
  BookingDetailsModal,
  ContractSigningConfirmModal,
  DeclineCancellationModal,
  DeclineModificationModal,
  MarkCompletedConfirmModal,
  RecordOnsitePaymentModal,
} from "@/src/modules/admin/components/booking-management-page"

interface DashboardStats {
  totalRevenue: number
  pending: number
  verifying: number
  confirmed: number
  cancelled: number
  cancellationRequests: number
  modificationRequests: number
  total: number
}

// Dashboard data uses the same page-scoped provider streams as Booking
// Management. This keeps the details modal/actions and Dashboard summaries on
// one realtime source without creating duplicate booking/payment listeners.
function useDashboardData() {
  const bookingCtx = useBookingData({ bookings: true, payments: true })
  const paymentReviewQueue = useMemo<PaymentReviewQueueEntry[]>(
    () => buildPaymentReviewQueue(bookingCtx.bookings, bookingCtx.paymentRecords),
    [bookingCtx.bookings, bookingCtx.paymentRecords],
  )
  const stats = useMemo<DashboardStats>(() => {
    const bookings = bookingCtx.bookings

    return {
      totalRevenue: bookings
        .filter((booking) => ["confirmed", "completed"].includes(String(booking.status || "").toLowerCase()))
        .reduce((total, booking) => total + getSafePrice(booking.totalPrice), 0),
      pending: bookings.filter((booking) => ["pending", "verifying"].includes(String(booking.status || "").toLowerCase())).length,
      verifying: paymentReviewQueue.length,
      confirmed: bookings.filter((booking) => String(booking.status || "").toLowerCase() === "confirmed").length,
      cancelled: bookings.filter((booking) => ["cancelled", "declined"].includes(String(booking.status || "").toLowerCase())).length,
      cancellationRequests: bookings.filter((booking) => String(booking.status || "").toLowerCase() === "cancellation_requested").length,
      modificationRequests: bookings.filter((booking) => String(booking.status || "").toLowerCase() === "modification_under_review").length,
      total: bookings.length,
    }
  }, [bookingCtx.bookings, paymentReviewQueue])

  const recentBookings = useMemo(() => (
    [...bookingCtx.bookings]
      .sort((a, b) => getDateTime(b.createdAt) - getDateTime(a.createdAt))
      .slice(0, 50)
  ), [bookingCtx.bookings])

  return { stats, recentBookings, paymentReviewQueue, ready: !bookingCtx.isLoading, bookingCtx }
}

type DashboardQueueMode = "pending" | "requests"

const ROUTES = {
  bookings: "/dashboard/bookings",
  reports: "/dashboard/reports",
  confirmedBookings: "/dashboard/bookings?status=confirmed",
  cancelledBookings: "/dashboard/bookings?status=cancelled",
}

export default function AdminDashboardPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { toast } = useToast()
  const { stats, recentBookings, paymentReviewQueue, ready, bookingCtx } = useDashboardData()
  const bookings = bookingCtx.bookings
  const canManageBookings = user?.role === "admin" || user?.permissions?.bookings === true
  const [queueOpen, setQueueOpen] = useState(false)
  const [paymentReviewOpen, setPaymentReviewOpen] = useState(false)
  const [queueMode, setQueueMode] = useState<DashboardQueueMode>("pending")
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [editBookingTarget, setEditBookingTarget] = useState<Booking | null>(null)
  const [onsitePaymentTarget, setOnsitePaymentTarget] = useState<Booking | null>(null)
  const [reminderTarget, setReminderTarget] = useState<Booking | null>(null)
  const [actionPending, setActionPending] = useState<string | null>(null)
  const [showContractConfirm, setShowContractConfirm] = useState(false)
  const [showApproveCancellationConfirm, setShowApproveCancellationConfirm] = useState(false)
  const [approveCancellationTarget, setApproveCancellationTarget] = useState<string | null>(null)
  const [showDeclineCancellationModal, setShowDeclineCancellationModal] = useState(false)
  const [declineCancellationTarget, setDeclineCancellationTarget] = useState<Booking | null>(null)
  const [declineCancellationReason, setDeclineCancellationReason] = useState("")
  const [showApproveModificationConfirm, setShowApproveModificationConfirm] = useState(false)
  const [approveModificationTarget, setApproveModificationTarget] = useState<string | null>(null)
  const [showDeclineModificationModal, setShowDeclineModificationModal] = useState(false)
  const [declineModificationTarget, setDeclineModificationTarget] = useState<Booking | null>(null)
  const [declineModificationReason, setDeclineModificationReason] = useState("")
  const [showMarkCompletedConfirm, setShowMarkCompletedConfirm] = useState(false)
  const [markCompletedTarget, setMarkCompletedTarget] = useState<string | null>(null)
  const [isEditingBooking, setIsEditingBooking] = useState(false)

  useEffect(() => {
    if (user && user.role === "staff" && !user.permissions?.dashboard) {
      router.replace("/dashboard")
    }
  }, [user, router])

  useEffect(() => {
    if (!selectedBooking) return
    const current = bookings.find((booking) => booking.id === selectedBooking.id)
    if (current && current !== selectedBooking) setSelectedBooking(current)
  }, [bookings, selectedBooking?.id])

  const recent = useMemo(() => recentBookings.slice(0, 4), [recentBookings])
  const findBooking = (id: string | null) => id ? bookings.find((booking) => booking.id === id) || null : null
  const toastSuccess = (title: string, description: string) => toast({ title, description, className: "border-none bg-emerald-500 text-white" })
  const toastError = (title: string, error: unknown) => toast({
    title,
    description: error instanceof Error ? error.message : "Unable to complete this booking action.",
    variant: "destructive",
  })

  const openPendingQueue = () => {
    setQueueMode("pending")
    setQueueOpen(true)
  }

  const openRequestQueue = () => {
    setQueueMode("requests")
    setQueueOpen(true)
  }

  const openPaymentReviewQueue = () => {
    setPaymentReviewOpen(true)
  }

  const openBooking = (booking: Booking) => {
    setQueueOpen(false)
    setSelectedBooking(booking)
  }

  const handleMarkCompleted = (id: string) => {
    if (!canManageBookings || actionPending) return
    setMarkCompletedTarget(id)
    setShowMarkCompletedConfirm(true)
  }

  const confirmMarkCompleted = async () => {
    const id = markCompletedTarget
    if (!id || !canManageBookings || actionPending) return
    setActionPending("complete")
    try {
      const updated = await bookingCtx.updateBookingStatus(id, "completed")
      if (!updated) return
      setShowMarkCompletedConfirm(false)
      setMarkCompletedTarget(null)
      toastSuccess("Booking Completed", `Booking ${id} has been marked as completed.`)
    } finally {
      setActionPending(null)
    }
  }

  const handleMarkContractSigned = () => {
    if (!canManageBookings || actionPending || !selectedBooking) return
    setShowContractConfirm(true)
  }

  const confirmMarkContractSigned = async () => {
    const id = selectedBooking?.id
    if (!id || !canManageBookings || actionPending) return
    setActionPending("contract")
    try {
      await bookingCtx.markContractSigned(id, "Administrator")
      setShowContractConfirm(false)
      toastSuccess("Contract Signed", `Contract for booking ${id} has been marked as signed.`)
    } catch (error) {
      toastError("Contract Update Failed", error)
    } finally {
      setActionPending(null)
    }
  }

  const handleApproveCancellation = (id: string) => {
    if (!canManageBookings || actionPending) return
    setApproveCancellationTarget(id)
    setShowApproveCancellationConfirm(true)
  }

  const confirmApproveCancellation = async () => {
    const id = approveCancellationTarget
    if (!id || !canManageBookings || actionPending) return
    setActionPending("approve-cancellation")
    try {
      await bookingCtx.approveCancellation(id)
      setShowApproveCancellationConfirm(false)
      setApproveCancellationTarget(null)
      toastSuccess("Cancellation Approved", `Booking ${id} has been cancelled.`)
    } catch (error) {
      toastError("Cancellation Approval Failed", error)
    } finally {
      setActionPending(null)
    }
  }

  const handleDeclineCancellation = (id: string) => {
    if (!canManageBookings || actionPending) return
    const target = findBooking(id)
    if (!target) return
    setDeclineCancellationTarget(target)
    setShowDeclineCancellationModal(true)
  }

  const confirmDeclineCancellation = async () => {
    const target = declineCancellationTarget
    const reason = declineCancellationReason.trim()
    if (!target || !reason || !canManageBookings || actionPending) return
    setActionPending("decline-cancellation")
    try {
      await bookingCtx.declineCancellation(target.id, reason)
      setShowDeclineCancellationModal(false)
      setDeclineCancellationTarget(null)
      setDeclineCancellationReason("")
      toastSuccess("Cancellation Declined", `Booking ${target.id} will continue.`)
    } catch (error) {
      toastError("Cancellation Rejection Failed", error)
    } finally {
      setActionPending(null)
    }
  }

  const handleApproveModification = (id: string) => {
    if (!canManageBookings || actionPending) return
    setApproveModificationTarget(id)
    setShowApproveModificationConfirm(true)
  }

  const confirmApproveModification = async () => {
    const id = approveModificationTarget
    if (!id || !canManageBookings || actionPending) return
    setActionPending("approve-modification")
    try {
      const updated = await bookingCtx.approveModification(id)
      setShowApproveModificationConfirm(false)
      setApproveModificationTarget(null)
      setSelectedBooking(updated)
      toastSuccess("Modification Approved", `Booking ${id} has been updated.`)
    } catch (error) {
      toastError("Modification Approval Failed", error)
    } finally {
      setActionPending(null)
    }
  }

  const handleDeclineModification = (id: string) => {
    if (!canManageBookings || actionPending) return
    const target = findBooking(id)
    if (!target) return
    setDeclineModificationTarget(target)
    setShowDeclineModificationModal(true)
  }

  const confirmDeclineModification = async () => {
    const target = declineModificationTarget
    const reason = declineModificationReason.trim()
    if (!target || !reason || !canManageBookings || actionPending) return
    setActionPending("decline-modification")
    try {
      const updated = await bookingCtx.declineModification(target.id, reason)
      setShowDeclineModificationModal(false)
      setDeclineModificationTarget(null)
      setDeclineModificationReason("")
      setSelectedBooking(updated)
      toastSuccess("Modification Declined", `Booking ${target.id} remains unchanged.`)
    } catch (error) {
      toastError("Modification Rejection Failed", error)
    } finally {
      setActionPending(null)
    }
  }

  const confirmBalanceReminder = async () => {
    const target = reminderTarget
    if (!target || !canManageBookings || actionPending) return
    setActionPending("balance-reminder")
    try {
      await bookingCtx.sendBalanceReminder(target.id)
      setReminderTarget(null)
      toastSuccess("Balance Reminder Sent", `Reminder recorded for booking ${target.id}.`)
    } catch (error) {
      toastError("Balance Reminder Failed", error)
    } finally {
      setActionPending(null)
    }
  }

  const handleMarkAsRefunded = async (id: string) => {
    if (!canManageBookings || actionPending) return
    setActionPending("refund")
    try {
      await bookingCtx.markAsRefunded(id)
    } finally {
      setActionPending(null)
    }
  }

  const handleEditBooking = (id: string) => {
    if (!canManageBookings || actionPending) return
    const target = findBooking(id)
    if (!target) return
    setSelectedBooking(null)
    setEditBookingTarget(target)
  }

  const saveEditedBooking = async (updatedBooking: Booking) => {
    if (isEditingBooking || !canManageBookings) return
    setIsEditingBooking(true)
    try {
      const updated = await bookingCtx.modifyBooking(updatedBooking.id, updatedBooking)
      setEditBookingTarget(null)
      setSelectedBooking(updated)
      toastSuccess("Booking Updated", `Booking ${updatedBooking.id} has been updated.`)
    } catch (error) {
      toastError("Booking Update Failed", error)
    } finally {
      setIsEditingBooking(false)
    }
  }

  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-x-hidden">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-orange-600" />
        </div>
      </div>
    )
  }

  return (
    <>
      <DashboardPaymentReviewQueueModal
        open={paymentReviewOpen}
        entries={paymentReviewQueue}
        onClose={() => setPaymentReviewOpen(false)}
      />
      <DashboardBookingQueue
        open={queueOpen}
        mode={queueMode}
        bookings={bookings}
        paymentRecords={bookingCtx.paymentRecords}
        onClose={() => setQueueOpen(false)}
        onReview={openBooking}
      />
      <BookingDetailsModal
        booking={selectedBooking}
        open={!!selectedBooking}
        onClose={() => { setSelectedBooking(null); setShowContractConfirm(false) }}
        onMarkCompleted={canManageBookings ? handleMarkCompleted : undefined}
        onMarkContractSigned={canManageBookings ? handleMarkContractSigned : undefined}
        onEditBooking={canManageBookings ? handleEditBooking : undefined}
        onSendReminder={canManageBookings ? (id) => {
          const target = findBooking(id)
          if (target) setReminderTarget(target)
        } : undefined}
        onRecordOnsitePayment={canManageBookings ? (id) => {
          const target = findBooking(id)
          if (target) setOnsitePaymentTarget(target)
        } : undefined}
        onApproveCancellation={canManageBookings ? handleApproveCancellation : undefined}
        onContinueBooking={canManageBookings ? handleDeclineCancellation : undefined}
        onApproveModification={canManageBookings ? handleApproveModification : undefined}
        onDeclineModification={canManageBookings ? handleDeclineModification : undefined}
        onMarkAsRefunded={canManageBookings ? handleMarkAsRefunded : undefined}
        paymentRecords={bookingCtx.paymentRecords}
        actionPending={Boolean(actionPending)}
      />
      {editBookingTarget && (
        <ModifyBookingDialog
          open={!!editBookingTarget}
          onOpenChange={(open) => { if (!open && !isEditingBooking) setEditBookingTarget(null) }}
          booking={editBookingTarget}
          isSaving={isEditingBooking}
          onSave={saveEditedBooking}
        />
      )}
      <RecordOnsitePaymentModal
        booking={onsitePaymentTarget}
        open={!!onsitePaymentTarget}
        onClose={() => setOnsitePaymentTarget(null)}
        paymentRecords={bookingCtx.paymentRecords}
        onRecorded={(updated) => {
          setSelectedBooking(updated)
          setOnsitePaymentTarget(null)
          toastSuccess("Onsite Payment Recorded", `Payment recorded for booking ${updated.id}.`)
        }}
      />
      <BalanceReminderModal
        booking={reminderTarget}
        remainingBalance={reminderTarget ? calculatePaymentSummary(reminderTarget, getRecordsForBooking(bookingCtx.paymentRecords, reminderTarget)).remainingBalance : undefined}
        open={!!reminderTarget}
        onCancel={() => setReminderTarget(null)}
        onConfirm={() => { void confirmBalanceReminder() }}
      />
      <ContractSigningConfirmModal
        booking={selectedBooking}
        open={showContractConfirm}
        onCancel={() => setShowContractConfirm(false)}
        onConfirm={() => { void confirmMarkContractSigned() }}
      />
      <ApproveCancellationConfirmModal
        booking={findBooking(approveCancellationTarget)}
        open={showApproveCancellationConfirm}
        onCancel={() => { setShowApproveCancellationConfirm(false); setApproveCancellationTarget(null) }}
        onConfirm={() => { void confirmApproveCancellation() }}
      />
      <DeclineCancellationModal
        booking={declineCancellationTarget}
        open={showDeclineCancellationModal}
        reason={declineCancellationReason}
        onReasonChange={setDeclineCancellationReason}
        onCancel={() => { setShowDeclineCancellationModal(false); setDeclineCancellationTarget(null); setDeclineCancellationReason("") }}
        onConfirm={() => { void confirmDeclineCancellation() }}
      />
      <ApproveModificationConfirmModal
        booking={findBooking(approveModificationTarget)}
        open={showApproveModificationConfirm}
        onCancel={() => { setShowApproveModificationConfirm(false); setApproveModificationTarget(null) }}
        onConfirm={() => { void confirmApproveModification() }}
      />
      <DeclineModificationModal
        booking={declineModificationTarget}
        open={showDeclineModificationModal}
        reason={declineModificationReason}
        onReasonChange={setDeclineModificationReason}
        onCancel={() => { setShowDeclineModificationModal(false); setDeclineModificationTarget(null); setDeclineModificationReason("") }}
        onConfirm={() => { void confirmDeclineModification() }}
      />
      <MarkCompletedConfirmModal
        booking={findBooking(markCompletedTarget)}
        open={showMarkCompletedConfirm}
        onCancel={() => { setShowMarkCompletedConfirm(false); setMarkCompletedTarget(null) }}
        onConfirm={() => { void confirmMarkCompleted() }}
      />

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-x-hidden">
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5 xl:gap-5 mb-6">
          <StatCard
            href={ROUTES.reports}
            icon={<TrendingUp className="h-4 w-4" />}
            label="Revenue"
            value={formatCurrency(stats.totalRevenue)}
            description="Reports"
            tone="orange"
          />
          <StatCard
            onClick={openPendingQueue}
            icon={<Clock className="h-4 w-4" />}
            label="Pending"
            value={stats.pending.toString()}
            description="Needs review"
            tone="amber"
          />
          <StatCard
            onClick={openPaymentReviewQueue}
            icon={<CreditCard className="h-4 w-4" />}
             label="Payment Review"
            value={stats.verifying.toString()}
            description="Payments awaiting verification"
            tone="purple"
          />
          <StatCard
            href={ROUTES.confirmedBookings}
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Confirmed"
            value={stats.confirmed.toString()}
            description="Approved bookings"
            tone="emerald"
          />
          <StatCard
            href={ROUTES.cancelledBookings}
            icon={<AlertCircle className="h-4 w-4" />}
            label="Cancelled"
            value={stats.cancelled.toString()}
            description="Declined or cancelled"
            tone="rose"
          />
        </section>

        <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">
                  Latest Activity
                </p>
                <h2 className="mt-0.5 text-base font-black tracking-tight text-slate-950 sm:text-lg">
                  Recent Bookings
                </h2>
                <p className="mt-0.5 text-[11px] leading-5 text-slate-500">
                  Showing the latest 4 reservation requests.
                </p>
              </div>
              <Link
                href={ROUTES.bookings}
                className="inline-flex h-8 w-fit items-center justify-center rounded-lg bg-orange-600 px-3 text-[11px] font-black text-white shadow-sm transition hover:bg-orange-700"
              >
                View All
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="p-4 sm:p-5">
              {recent.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="space-y-3">
                  {recent.map((booking) => (
                    <BookingRow
                      key={booking.id}
                      booking={booking}
                      statusBadge={getStatusBadge(booking.status)}
                      onOpen={() => openBooking(booking)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="grid h-fit gap-5 self-start">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">
                    Action Center
                  </p>
                  <h3 className="mt-0.5 text-base font-black text-slate-950 sm:text-lg">
                    Needs Attention
                  </h3>
                </div>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                  <Activity className="h-4 w-4" />
                </div>
              </div>

              <div className="space-y-3">
                <ActionItem
                  onClick={openPendingQueue}
                  icon={<Clock className="h-4 w-4" />}
                  label="Pending bookings"
                  value={stats.pending}
                  tone="orange"
                />
                <ActionItem
                  onClick={openPaymentReviewQueue}
                  icon={<CreditCard className="h-4 w-4" />}
                   label="Payments under review"
                  value={stats.verifying}
                  tone="purple"
                />
                <ActionItem
                  onClick={openRequestQueue}
                  icon={<AlertCircle className="h-4 w-4" />}
                  label="Cancellation / modification requests"
                  value={stats.cancellationRequests + stats.modificationRequests}
                  tone="rose"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 to-orange-100/60 p-4 shadow-sm sm:p-5">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-orange-600 shadow-sm">
                  <TrendingUp className="h-4 w-4" />
                </div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-700">
                  Total Records
                </p>
              </div>
              <p className="text-2xl font-black tabular-nums text-orange-900">
                {stats.total}
              </p>
              <p className="mt-1 text-[11px] font-semibold text-orange-800">
                All bookings in the system
              </p>
            </div>
          </aside>
        </section>
      </div>
    </>
  )
}

function getSafePrice(value: unknown) {
  if (typeof value === "number") return value
  const safePrice = String(value || "0").replace(/\D/g, "")
  return Number(safePrice) || 0
}

function getDateTime(value: unknown) {
  const raw = value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function"
    ? (value as { toDate: () => Date }).toDate()
    : value
  const time = new Date(String(raw || 0)).getTime()
  return Number.isFinite(time) ? time : 0
}

function formatCurrency(value: number) {
  return `₱${Number(value || 0).toLocaleString()}`
}

function DashboardBookingQueue({
  open,
  mode,
  bookings,
  paymentRecords,
  onClose,
  onReview,
}: {
  open: boolean
  mode: DashboardQueueMode
  bookings: Booking[]
  paymentRecords: PaymentRecordLike[]
  onClose: () => void
  onReview: (booking: Booking) => void
}) {
  const queuedBookings = useMemo(() => {
    return bookings
      .filter((booking) => {
        const status = String(booking.status || "").trim().toLowerCase()
        if (mode === "pending") return status === "pending" || status === "verifying"
        return status === "cancellation_requested" || status === "modification_under_review"
      })
      .sort((a, b) => getDateTime(b.createdAt) - getDateTime(a.createdAt))
  }, [bookings, mode])

  const isRequestQueue = mode === "requests"
  const title = isRequestQueue ? "Cancellation & Modification Requests" : "Pending Booking Queue"
  const description = isRequestQueue
    ? "Review customer requests without leaving the dashboard."
    : "Review pending and payment-verification bookings without leaving the dashboard."

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        plain
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[920px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">Dashboard Queue</p>
              <DialogTitle className="mt-1 text-lg font-black leading-snug text-slate-950 sm:text-xl">
                {title}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs font-medium leading-5 text-slate-500">
                {description}
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close dashboard booking queue"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2"
              >
                <X className="h-4 w-4" />
              </button>
            </DialogClose>
          </header>

          <div role="region" aria-label="Dashboard booking queue" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-600 sm:px-6">
            {queuedBookings.length === 0 ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <Inbox className="mb-3 h-9 w-9 text-slate-300" />
                <h3 className="text-sm font-black text-slate-900">
                  {isRequestQueue ? "No requests awaiting review" : "No pending bookings"}
                </h3>
                <p className="mt-1 max-w-sm text-xs font-medium leading-5 text-slate-500">
                  {isRequestQueue
                    ? "Cancellation and modification requests will appear here."
                    : "New pending reservations will appear here as they are submitted."}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {queuedBookings.map((booking) => {
                  const records = getRecordsForBooking(paymentRecords, booking)
                  const paymentSummary = calculatePaymentSummary(booking, records)
                  const paymentLabel = records.length > 0
                    ? getPaymentOverallStatusLabel(paymentSummary.overallStatus)
                    : getStoredPaymentStatusLabel(booking.paymentStatus)

                  return (
                    <article key={booking.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange-200 hover:shadow-md sm:p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                            isOfficeResourceBooking(booking) ? "bg-blue-50 text-blue-600" : "bg-orange-50 text-orange-600",
                          )}>
                            {isOfficeResourceBooking(booking)
                              ? <Building2 className="h-5 w-5" />
                              : <Tent className="h-5 w-5" />}
                          </div>
                          <div className="min-w-0">
                            <p className="break-words text-sm font-black leading-snug text-slate-950">
                              {booking.eventName || "Untitled Booking"}
                            </p>
                            <p className="mt-0.5 break-all text-[11px] font-bold text-orange-700">#{booking.id}</p>
                            <p className="mt-1 break-words text-xs font-semibold text-slate-500">
                              {booking.userInfo?.name || "Customer unavailable"}
                              {booking.userInfo?.email ? ` · ${booking.userInfo.email}` : ""}
                            </p>
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap gap-1.5 sm:max-w-[260px] sm:justify-end">
                          {getQueueStatusBadge(booking)}
                          <span className={cn(
                            "inline-flex items-center rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em]",
                            getQueuePaymentBadgeClass(records.length > 0 ? paymentSummary.overallStatus : (booking.paymentStatus || "unpaid")),
                          )}>
                            Payment: {paymentLabel}
                          </span>
                        </div>
                      </div>

                      <dl className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="min-w-0">
                          <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Schedule</dt>
                          <dd className="mt-1 break-words text-xs font-bold leading-5 text-slate-800">{getQueueSchedule(booking)}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Location</dt>
                          <dd className="mt-1 break-words text-xs font-bold leading-5 text-slate-800">{getQueueLocation(booking)}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Booking Total</dt>
                          <dd className="mt-1 text-xs font-black tabular-nums text-slate-900">{formatCurrency(paymentSummary.bookingTotal)}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Balance Due</dt>
                          <dd className="mt-1 text-xs font-black tabular-nums text-orange-700">{formatCurrency(paymentSummary.remainingBalance)}</dd>
                        </div>
                      </dl>

                      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-[11px] font-semibold text-slate-500">
                          Submitted {formatQueueDate(booking.createdAt)}
                        </p>
                        <Button
                          type="button"
                          onClick={() => onReview(booking)}
                          className="h-10 w-full rounded-xl bg-orange-600 px-4 text-xs font-black text-white hover:bg-orange-700 sm:w-auto"
                        >
                          Review Booking
                          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function getQueuePaymentBadgeClass(overallStatus: string, storedStatus?: unknown) {
  const status = String(storedStatus || overallStatus || "").trim().toLowerCase()
  if (["completed", "paid", "fully paid", "verified", "slot_verified"].includes(status)) {
    return "border-emerald-100 bg-emerald-50 text-emerald-700"
  }
  if (["rejected", "cancelled"].includes(status)) return "border-rose-100 bg-rose-50 text-rose-700"
  if (["partial", "incomplete", "for_review", "for review", "for verification", "awaiting onsite payment", "pending", "pending_verification", "pending verification", "cash_pending", "slot_pending"].includes(status)) {
    return "border-amber-100 bg-amber-50 text-amber-700"
  }
  return "border-slate-200 bg-slate-50 text-slate-600"
}

function getQueueStatusBadge(booking: Booking) {
  const status = String(booking.status || "").trim().toLowerCase()
  const classes = status === "pending"
    ? "border-orange-100 bg-orange-50 text-orange-700"
    : status === "verifying"
      ? "border-purple-100 bg-purple-50 text-purple-700"
      : status === "cancellation_requested"
        ? "border-amber-100 bg-amber-50 text-amber-700"
        : status === "modification_under_review"
          ? "border-purple-100 bg-purple-50 text-purple-700"
          : "border-slate-200 bg-slate-50 text-slate-600"

  return (
    <span className={cn("inline-flex items-center rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em]", classes)}>
      {getQueueBookingStatus(booking)}
    </span>
  )
}

function getBookingTime(booking: any) {
  if (booking.time) return booking.time
  return `${booking.startTime || "—"} - ${booking.endTime || "—"}`
}

function formatQueueDate(value?: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "2-digit", year: "numeric" }).format(date)
}

function getQueueSchedule(booking: Booking) {
  const start = formatQueueDate(booking.date)
  if (isOfficeResourceBooking(booking)) {
    const end = booking.endDate ? formatQueueDate(booking.endDate) : start
    return start === end ? start : `${start} – ${end}`
  }
  return `${start} · ${getBookingTime(booking)}`
}

function getQueueLocation(booking: Booking) {
  const venue = booking.venue || (isOfficeResourceBooking(booking) ? "Office rental" : "Venue unavailable")
  if (!isOfficeResourceBooking(booking)) return venue
  const room = (booking as any).roomName || (booking as any).spaceName || (booking as any).room || booking.spaceId
  return room ? `${venue} · ${room}` : venue
}

function getStoredPaymentStatusLabel(value: unknown) {
  const status = String(value || "unpaid").trim().toLowerCase()
  if (status === "unpaid") return "Unpaid"
  if (["for_review", "for review", "pending_verification", "pending verification", "for verification", "cash_pending", "slot_pending"].includes(status)) return "For Review"
  if (["paid", "fully paid", "completed", "verified", "slot_verified"].includes(status)) return "Paid"
  if (status === "partial") return "Partial Payment"
  if (status === "rejected") return "Rejected"
  return String(value || "Unpaid")
}

function getQueueBookingStatus(booking: Booking) {
  const status = String(booking.status || "").trim().toLowerCase()
  if (status === "verifying") return "Pending Verification"
  if (status === "cancellation_requested") return "Cancellation Requested"
  if (status === "modification_under_review") return "Modification Under Review"
  if (status === "reservation_secured") return "Slot Secured"
  if (status === "contract_signing_required") return "Contract Signing Required"
  if (status === "active_rental") return "Active Rental"
  if (status === "rental_expired") return "Rental Expired"
  if (status === "declined") return "Declined"
  if (status === "cancelled") return "Cancelled"
  if (status === "completed") return "Completed"
  if (status === "confirmed") return "Confirmed"
  return getBookingLifecycleStatus(booking as unknown as Record<string, unknown>) === "pending" ? "Pending" : "Confirmed"
}

function getStatusBadge(status: string) {
  const baseClass =
    "inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em]"

  switch (status) {
    case "pending":
      return (
        <span className={cn(baseClass, "bg-orange-100 text-orange-700")}>
          Pending
        </span>
      )
    case "verifying":
      return (
        <span className={cn(baseClass, "bg-purple-100 text-purple-700")}>
          Pending
        </span>
      )
    case "confirmed":
      return (
        <span className={cn(baseClass, "bg-emerald-100 text-emerald-700")}>
          Confirmed
        </span>
      )
    case "cancellation_requested":
      return (
        <span className={cn(baseClass, "bg-amber-100 text-amber-700")}>
          Cancel Req.
        </span>
      )
    case "modification_under_review":
      return (
        <span className={cn(baseClass, "bg-purple-100 text-purple-700")}>
          Modify Req.
        </span>
      )
    case "cancelled":
    case "declined":
      return (
        <span className={cn(baseClass, "bg-rose-100 text-rose-700")}>
          {status}
        </span>
      )
    case "completed":
      return (
        <span className={cn(baseClass, "bg-blue-100 text-blue-700")}>
          Completed
        </span>
      )
    case "contract_signing_required":
      return (
        <span className={cn(baseClass, "bg-yellow-100 text-yellow-700")}>
          Contract Signing
        </span>
      )
    case "active_rental":
      return (
        <span className={cn(baseClass, "bg-sky-100 text-sky-700")}>
          Active Rental
        </span>
      )
    case "rental_expired":
      return (
        <span className={cn(baseClass, "bg-rose-100 text-rose-700")}>
          Rental Expired
        </span>
      )
    default:
      return (
        <span className={cn(baseClass, "bg-slate-100 text-slate-700")}>
          {status || "Unknown"}
        </span>
      )
  }
}

function StatCard({
  href,
  onClick,
  icon,
  label,
  value,
  description,
  tone,
}: {
  href?: string
  onClick?: () => void
  icon: React.ReactNode
  label: string
  value: string
  description: string
  tone: "orange" | "amber" | "emerald" | "purple" | "rose"
}) {
  const tones = {
    orange: "bg-orange-50 text-orange-600",
    amber: "bg-amber-50 text-amber-600",
    emerald: "bg-emerald-50 text-emerald-600",
    purple: "bg-purple-50 text-purple-600",
    rose: "bg-rose-50 text-rose-600",
  }

  const content = (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            tones[tone],
          )}
        >
          {icon}
        </div>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-orange-600" />
      </div>

      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black">
        {label}
      </p>

      <h3 className="mt-0.5 truncate text-lg font-black tracking-tight text-slate-950 xl:text-xl 2xl:text-2xl">
        {value}
      </h3>

      <p className="mt-auto pt-1 text-[10px] font-medium leading-4 text-slate-500 sm:text-xs">
        {description}
      </p>
    </>
  )

  const className = "group flex min-h-[110px] cursor-pointer flex-col rounded-2xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:p-4"
  return onClick ? (
    <button type="button" onClick={onClick} className={className}>{content}</button>
  ) : (
    <Link href={href || ROUTES.bookings} className={className}>{content}</Link>
  )
}

function BookingRow({
  booking,
  statusBadge,
  onOpen,
}: {
  booking: any
  statusBadge: React.ReactNode
  onOpen: () => void
}) {
  const isOffice = isOfficeResourceBooking(booking)

  return (
    <button
      type="button"
      onClick={onOpen}
       className="group block w-full cursor-pointer text-left rounded-xl border border-slate-200 bg-white p-3.5 transition hover:border-orange-200 hover:bg-orange-50/30 sm:p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              isOffice ? "bg-blue-50 text-blue-600" : "bg-orange-50 text-orange-600",
            )}
          >
            {isOffice ? (
              <Building2 className="h-4 w-4" />
            ) : (
              <Tent className="h-4 w-4" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="break-words text-xs font-semibold leading-snug text-slate-950 sm:text-sm line-clamp-2 min-w-0">
              {booking.eventName || "Untitled Event"}
            </p>
            <p className="mt-0.5 break-words text-[10px] font-bold leading-snug text-slate-500 sm:text-[11px]">
              {booking.venue || "No venue"} · {formatCurrency(getSafePrice(booking.totalPrice))}
            </p>
          </div>
        </div>

        <div className="shrink-0">{statusBadge}</div>
      </div>
    </button>
  )
}

function ActionItem({
  href,
  onClick,
  icon,
  label,
  value,
  tone,
}: {
  href?: string
  onClick?: () => void
  icon: React.ReactNode
  label: string
  value: number
  tone: "orange" | "purple" | "rose"
}) {
  const tones = {
    orange: "bg-orange-50 text-orange-600",
    purple: "bg-purple-50 text-purple-600",
    rose: "bg-rose-50 text-rose-600",
  }

  const content = (
    <>
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            tones[tone],
          )}
        >
          {icon}
        </div>
        <p className="text-xs font-black text-slate-800 sm:text-sm">{label}</p>
      </div>
      <div className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-slate-950 px-2 text-[11px] font-black text-white">
        {value}
      </div>
    </>
  )

  const className = "flex min-h-[58px] w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-left transition hover:bg-slate-50 sm:p-3"
  return onClick ? (
    <button type="button" onClick={onClick} className={className}>{content}</button>
  ) : (
    <Link href={href || ROUTES.bookings} className={className}>{content}</Link>
  )
}

function EmptyState() {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <Inbox className="mb-2 h-8 w-8 text-slate-300" />
      <h3 className="text-sm font-black text-slate-900">No bookings available</h3>
      <p className="mt-1 max-w-sm text-[11px] leading-5 text-slate-500">
        Recent booking requests will appear here once clients start reserving spaces.
      </p>
    </div>
  )
}
