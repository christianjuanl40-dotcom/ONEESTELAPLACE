"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  Eye,
  FileImage,
  FileText,
  Filter,
  History,
  Inbox,
  Receipt,
  Search,
  ShieldCheck,
  X,
  XCircle,
  ZoomIn,
} from "lucide-react"

import {
  ReceiptPaper,
  type ReceiptPaperData,
} from "@/src/modules/shared/components/receipt-paper"

import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { perfMark } from "@/src/modules/shared/lib/perf-trace"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Textarea } from "@/src/modules/shared/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/src/modules/shared/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/modules/shared/components/ui/select"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { useBookingData } from "@/src/modules/client/contexts/booking-context"
import type { PaymentRecord } from "@/src/modules/client/contexts/booking-context"
import { cn } from "@/src/modules/shared/lib/utils"
import { useNotifications } from "@/src/modules/shared/contexts/notification-context"
import type { NotificationType } from "@/src/modules/shared/lib/notifications"
import { db } from "@/lib/firebase"
import { collection, query, orderBy, where, getDocs, addDoc } from "firebase/firestore"

const VENUE_OPTIONS = [
  "The Milestone Event",
  "The Moment Event",
  "Conference Room",
  "Business Room",
  "Office A",
  "Office B",
]

type PaymentAction = "verify" | "reject" | "incomplete"
type BookingRecord = any

type PendingPaymentAction = {
  type: PaymentAction
  payment: BookingRecord
  amount?: number
  note?: string
  paymentRecordId?: string
} | null

export default function AdminPaymentsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const { toast } = useToast()
  const bookingCtx = useBookingData({ bookings: true, payments: true })
  const { markByBookingId } = useNotifications()
  const ADMIN_PAYMENT_TYPES: NotificationType[] = ["payment_submitted", "remaining_balance_submitted"]

  useEffect(() => {
    perfMark("[ADMIN PAYMENTS] page mounted")
    console.log(
      `[DEBUG][ADMIN PAYMENTS] component mounted — auth uid: ${user?.id ?? "null"}, role: ${user?.role ?? "null"}, permissions: ${JSON.stringify(user?.permissions ?? "none")}`,
    )
  }, [user?.id, user?.role])

  useEffect(() => {
    if (!authLoading) perfMark("[ADMIN PAYMENTS] auth ready")
  }, [authLoading])

  useEffect(() => {
    if (!bookingCtx.isLoading) {
      perfMark(
        `[ADMIN PAYMENTS] payment data ready — payments: ${(bookingCtx.paymentRecords || []).length}, bookings: ${(bookingCtx.bookings || []).length}`,
      )
      console.log(
        `[DEBUG][ADMIN PAYMENTS] data ready — paymentRecords: ${(bookingCtx.paymentRecords || []).length}, bookings: ${(bookingCtx.bookings || []).length}, provider isLoading: ${bookingCtx.isLoading}, active filter: status=${statusFilter} venue=${venueFilter} search="${searchQuery}"`,
      )
    }
  }, [bookingCtx.isLoading, bookingCtx.paymentRecords, bookingCtx.bookings])

  useEffect(() => {
    if (user && user.role === "staff" && !user.permissions?.payments) {
      router.replace("/dashboard")
    }
  }, [user, router])
  const [paymentPage, setPaymentPage] = useState(1)
  const PAYMENTS_PER_PAGE = 10
  const [statusFilter, setStatusFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [venueFilter, setVenueFilter] = useState("all")
  const [selectedPayment, setSelectedPayment] = useState<BookingRecord | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingPaymentAction>(null)
  const [actionNote, setActionNote] = useState("")
  const [incompletePaymentTarget, setIncompletePaymentTarget] = useState<BookingRecord | null>(null)
  const [onsiteVerifyTarget, setOnsiteVerifyTarget] = useState<BookingRecord | null>(null)

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const searchId = urlParams.get("search")
    const statusParam = urlParams.get("status")

    if (searchId) {
      setSearchQuery(searchId)
      setStatusFilter("all")

      // Remove the URL query after using it once so the page does not stay locked
      // on the same booking ID after refresh/navigation.
      window.history.replaceState(null, "", window.location.pathname)
    } else if (statusParam) {
      setStatusFilter(statusParam)
      window.history.replaceState(null, "", window.location.pathname)
    }
  }, [])

  const paymentBookings = useMemo(() => {
    const allRecords: PaymentRecord[] = bookingCtx.paymentRecords || []
    const bookingById = new Map<string, BookingRecord>()
    ;(bookingCtx.bookings || []).forEach((b: BookingRecord) => bookingById.set(b.id, b))

    // Group individual payment submissions per booking. Every submission from
    // the client writes its own document in the `payments` collection, so
    // Payment 1, Payment 2, ... are preserved as separate records.
    const recordsByBooking = new Map<string, PaymentRecord[]>()
    for (const record of allRecords) {
      const key = record.bookingId || ""
      if (!key) continue
      const list = recordsByBooking.get(key) || []
      list.push(record)
      recordsByBooking.set(key, list)
    }

    const built: BookingRecord[] = []
    recordsByBooking.forEach((list, bookingId) => {
      // Newest submission first within a booking.
      list.sort((a, b) => getPaymentTime(b.submittedAt) - getPaymentTime(a.submittedAt))
      const latest = list[0]
      const base = bookingById.get(bookingId) || {}
      built.push(buildPaymentBookingEntry(base, list, latest, bookingId))
    })

    // Legacy bookings that carry payment info but have no individual
    // submission records yet (older single-payment bookings).
    const legacyBookings = (bookingCtx.bookings || [])
      .filter((booking: BookingRecord) => isPaymentRecord(booking) && !recordsByBooking.has(booking.id))
      .map((booking: BookingRecord) => buildLegacyPaymentBookingEntry(booking))

    const merged = [...built, ...legacyBookings]
    return merged.sort((a, b) => {
      const aTime = getPaymentTime(a.paymentSubmittedAt || a.latestPaymentSubmittedAt || a.createdAt)
      const bTime = getPaymentTime(b.paymentSubmittedAt || b.latestPaymentSubmittedAt || b.createdAt)
      return bTime - aTime
    })
  }, [bookingCtx.bookings, bookingCtx.paymentRecords])

  useEffect(() => {
    if (!selectedPayment) return
    const found = paymentBookings.find((b: any) => b.id === selectedPayment.id)
    if (found && found !== selectedPayment) {
      setSelectedPayment(found)
    }
  }, [paymentBookings, selectedPayment?.id])

  const filteredPayments = useMemo(() => {
    return paymentBookings.filter((booking) => {
      const submissionSearch = (booking?.incomingPayments || [])
        .map((pr: PaymentRecord) =>
          [
            pr.id,
            pr.referenceNo,
            pr.bookingId,
            String(pr.amount || pr.amountPaid || ""),
            pr.status,
            pr.verificationStatus,
            pr.submittedAt,
          ].join(" "),
        )
        .join(" ")

      const searchText = [
        booking?.id,
        booking?.eventName,
        booking?.venue,
        booking?.paymentMethod,
        booking?.paymentType,
        booking?.paymentStatus,
        booking?.bankReferenceNumber,
        booking?.userInfo?.name,
        booking?.userInfo?.email,
        submissionSearch,
      ]
        .join(" ")
        .toLowerCase()

      const matchesSearch = searchText.includes(searchQuery.toLowerCase())
      const matchesVenue =
        venueFilter === "all" ||
        String(booking?.venue || "").includes(venueFilter)

      let matchesStatus = true

      if (statusFilter === "for_review") matchesStatus = isForReviewPayment(booking)
      if (statusFilter === "verified") matchesStatus = isVerifiedPayment(booking)
      if (statusFilter === "rejected") matchesStatus = String(booking?.paymentStatus || "").toLowerCase() === "rejected"
      if (statusFilter === "incomplete") matchesStatus = String(booking?.paymentStatus || "").toLowerCase() === "incomplete"
      if (statusFilter === "partial") matchesStatus = String(booking?.paymentStatus || "").toLowerCase() === "partial"

      return matchesSearch && matchesVenue && matchesStatus
    })
  }, [paymentBookings, searchQuery, venueFilter, statusFilter])

  useEffect(() => {
    setPaymentPage(1)
  }, [searchQuery, venueFilter, statusFilter])

  const paymentTotalPages = Math.ceil(filteredPayments.length / PAYMENTS_PER_PAGE)
  const safePaymentPage = paymentPage > paymentTotalPages ? Math.max(paymentTotalPages, 1) : paymentPage
  const paginatedPayments = filteredPayments.slice(
    (safePaymentPage - 1) * PAYMENTS_PER_PAGE,
    safePaymentPage * PAYMENTS_PER_PAGE,
  )

  const uiReadyLoggedRef = useRef(false)
  useEffect(() => {
    if (uiReadyLoggedRef.current || bookingCtx.isLoading) return
    uiReadyLoggedRef.current = true
    perfMark(
      `[ADMIN PAYMENTS] UI ready — ${filteredPayments.length} payment row(s), ${paginatedPayments.length} row(s) on this page`,
    )
  }, [filteredPayments, paginatedPayments, bookingCtx.isLoading])

  useEffect(() => {
    if (bookingCtx.isLoading) return
    console.log(
      `[DEBUG][ADMIN PAYMENTS] pipeline — raw payments: ${(bookingCtx.paymentRecords || []).length}, grouped rows: ${paymentBookings.length}, after filters: ${filteredPayments.length}, UI rows on page: ${paginatedPayments.length} (status="${statusFilter}", venue="${venueFilter}", search="${searchQuery}")`,
    )
  }, [paymentBookings, filteredPayments, paginatedPayments, bookingCtx.isLoading, statusFilter, venueFilter, searchQuery])

  const [highlightedPaymentId, setHighlightedPaymentId] = useState<string | null>(null)
  const paymentHighlightHandledRef = useRef(false)
  const paymentHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const h = sessionStorage.getItem("admin_payment_highlight")
    if (h) {
      setHighlightedPaymentId(h)
      setSearchQuery("")
      setStatusFilter("all")
      setVenueFilter("all")
    }
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ paymentId: string }>
      const paymentId = customEvent.detail?.paymentId
      if (!paymentId) return
      if (paymentHighlightTimeoutRef.current) {
        clearTimeout(paymentHighlightTimeoutRef.current)
        paymentHighlightTimeoutRef.current = null
      }
      paymentHighlightHandledRef.current = false
      if (highlightedPaymentId === paymentId) {
        setHighlightedPaymentId(null)
        requestAnimationFrame(() => {
          paymentHighlightHandledRef.current = false
          setHighlightedPaymentId(paymentId)
        })
      } else {
        setHighlightedPaymentId(paymentId)
      }
      setSearchQuery("")
      setStatusFilter("all")
      setVenueFilter("all")
    }
    window.addEventListener("admin-payment-highlight", handler)
    return () => {
      window.removeEventListener("admin-payment-highlight", handler)
    }
  }, [highlightedPaymentId])

  useEffect(() => {
    if (!highlightedPaymentId || filteredPayments.length === 0) return
    if (paymentHighlightHandledRef.current) return
    const idx = filteredPayments.findIndex(
      (p) => p.id === highlightedPaymentId
    )
    if (idx === -1) return
    const page = Math.floor(idx / PAYMENTS_PER_PAGE) + 1
    if (page !== safePaymentPage) {
      setPaymentPage(page)
      return
    }
    paymentHighlightHandledRef.current = true
    sessionStorage.removeItem("admin_payment_highlight")
    paymentHighlightTimeoutRef.current = setTimeout(() => {
      setHighlightedPaymentId(null)
      paymentHighlightTimeoutRef.current = null
    }, 3000)
    return () => {
      if (paymentHighlightTimeoutRef.current) {
        clearTimeout(paymentHighlightTimeoutRef.current)
        paymentHighlightTimeoutRef.current = null
      }
    }
  }, [highlightedPaymentId, filteredPayments, safePaymentPage])

const openActionModal = (payment: BookingRecord, type: PaymentAction, submission?: PaymentRecord | null) => {
    const recordId = submission?.id
    const amount = getPaymentRecordAmount(submission)
    const isCashSubmission =
      submission?.paymentMethod === "cash" || String(submission?.method || "").toLowerCase().includes("office")
    const actionPayment = submission
      ? {
          ...payment,
          paymentAmount: amount,
          pendingPaymentAmount: amount,
          paymentMethod: isCashSubmission ? ("cash" as const) : ("bank" as const),
          bankReferenceNumber: submission.referenceNo || payment.bankReferenceNumber,
          paymentReference: submission.referenceNo || payment.paymentReference,
        }
      : payment
    if (type === "incomplete") {
      setIncompletePaymentTarget({ ...actionPayment, paymentRecordId: recordId, submissionAmount: amount })
      return
    }
    if (type === "verify" && actionPayment.paymentMethod === "cash") {
      setOnsiteVerifyTarget({ ...actionPayment, paymentRecordId: recordId, submissionAmount: amount })
      return
    }
    setPendingAction({ payment: actionPayment, type, paymentRecordId: recordId, amount: amount > 0 ? amount : undefined })
    setActionNote("")
  }

  const paymentSubmissionById = (recordId?: string | null): PaymentRecord | undefined => {
    if (!recordId) return undefined
    return (bookingCtx.paymentRecords || []).find((record) => record.id === recordId)
  }

  const submissionListFor = (bookingId: string): PaymentRecord[] => {
    return (bookingCtx.paymentRecords || [])
      .filter((record) => record.bookingId === bookingId)
      .sort((a, b) => getPaymentTime(b.submittedAt) - getPaymentTime(a.submittedAt))
  }

  const closeActionModal = () => {
    setPendingAction(null)
    setActionNote("")
  }

  const handleConfirmPaymentAction = async () => {
    if (!pendingAction) return

    const { payment, type, paymentRecordId, amount } = pendingAction
    const bookingId = payment.id
    const note = actionNote.trim()

    if ((type === "reject" || type === "incomplete") && !note) {
      toast({
        title: type === "reject" ? "Reason Required" : "Note Required",
        description:
          type === "reject"
            ? "Please provide a reason for rejecting this payment."
            : "Please provide a note explaining the missing or insufficient amount.",
        variant: "destructive",
      })
      return
    }

    try {
      // Use BookingContext as single source of truth for payment actions
      const reviewerName = user?.name || "Administrator"
      if (type === "verify") {
        bookingCtx.verifyPayment(bookingId, {
          verifiedAmount: amount,
          adminNote: note || undefined,
          adminName: reviewerName,
          paymentRecordId,
        })
      } else if (type === "reject") {
        bookingCtx.rejectPayment(bookingId, note, reviewerName, paymentRecordId)
      } else if (type === "incomplete") {
        bookingCtx.markIncompletePayment(bookingId, { verifiedAmount: 0, adminNote: note, adminName: reviewerName, paymentRecordId })
      }

      let updatedBooking: BookingRecord
      const paymentForAction = amount ? { ...payment, paymentAmount: amount, pendingPaymentAmount: amount } : payment
      if (type === "verify") {
        updatedBooking = buildVerifiedPaymentBooking(paymentForAction)
      } else if (type === "reject") {
        updatedBooking = buildRejectedPaymentBooking(paymentForAction, note)
      } else {
        updatedBooking = buildIncompletePaymentBooking(paymentForAction, note, 0)
      }
      if (updatedBooking && !updatedBooking.proofUrl) {
        const matchingPayment = paymentSubmissionById(paymentRecordId)
        if (matchingPayment?.proofUrl) {
          updatedBooking = { ...updatedBooking, proofUrl: matchingPayment.proofUrl }
        }
      }
      setSelectedPayment(updatedBooking)
      ensureReceiptForVerifiedBooking(updatedBooking)

      toast({
        title: getActionSuccessTitle(type),
        description: getActionSuccessDescription(type, bookingId),
        className:
          type === "reject"
            ? "border-none bg-rose-500 text-white"
            : type === "incomplete"
              ? "border-none bg-amber-500 text-white"
              : "border-none bg-emerald-500 text-white",
      })

      closeActionModal()
    } catch (error) {
      console.error("Payment action error:", error)
      toast({
        title: "Action Failed",
        description: "Something went wrong while updating the payment record.",
        variant: "destructive",
      })
    }
  }

  if (bookingCtx?.isLoading) {
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
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <PaymentActionConfirmModal
          pendingAction={pendingAction}
          note={actionNote}
          setNote={setActionNote}
          onCancel={closeActionModal}
          onConfirm={handleConfirmPaymentAction}
        />
        <OnsiteVerifyModal
          booking={onsiteVerifyTarget}
          onClose={() => setOnsiteVerifyTarget(null)}
          onConfirm={(updatedBooking) => {
            // Use BookingContext verifyPayment as single source of truth
            const paymentRecordId = (updatedBooking as BookingRecord).paymentRecordId
            bookingCtx.verifyPayment(updatedBooking.id, {
              verifiedAmount: updatedBooking.lastPaymentAmount || updatedBooking.paymentVerifiedAmount,
              adminNote: updatedBooking.adminLogs?.[updatedBooking.adminLogs.length - 1]?.message || undefined,
              adminName: user?.name || "Administrator",
              paymentRecordId,
            })
            let updated = updatedBooking
            if (!updated.proofUrl && updatedBooking.submissionAmount) {
              const matchingPayment = paymentSubmissionById(paymentRecordId)
              if (matchingPayment?.proofUrl) {
                updated = { ...updated, proofUrl: matchingPayment.proofUrl }
              }
            }
            setSelectedPayment(updated)
            ensureReceiptForVerifiedBooking(updated)
            setOnsiteVerifyTarget(null)
            toast({
              title: "Onsite Payment Verified",
              description: `Onsite payment verified for booking ${updatedBooking.id}.`,
              className: "border-none bg-emerald-500 text-white",
            })
          }}
        />
        <IncompletePaymentModal
          booking={incompletePaymentTarget}
          onClose={() => setIncompletePaymentTarget(null)}
          onConfirm={(updatedBooking) => {
            // Use BookingContext markIncompletePayment as single source of truth
            const paymentRecordId = (updatedBooking as BookingRecord).paymentRecordId
            bookingCtx.markIncompletePayment(updatedBooking.id, {
              verifiedAmount: updatedBooking.lastPaymentAmount || updatedBooking.paymentVerifiedAmount || 0,
              adminNote: updatedBooking.incompletePaymentNote || updatedBooking.incompletePaymentReason || "",
              adminName: user?.name || "Administrator",
              paymentRecordId,
            })
            let updated = updatedBooking
            if (!updated.proofUrl && updatedBooking.submissionAmount) {
              const matchingPayment = paymentSubmissionById(paymentRecordId)
              if (matchingPayment?.proofUrl) {
                updated = { ...updated, proofUrl: matchingPayment.proofUrl }
              }
            }
            setSelectedPayment(updated)
            ensureReceiptForVerifiedBooking(updated)
            setIncompletePaymentTarget(null)
            toast({
              title: "Incomplete Payment Recorded",
              description: `Booking ${updatedBooking.id} has been updated with partial payment.`,
              className: "border-none bg-amber-500 text-white",
            })
          }}
        />
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <Select value={venueFilter} onValueChange={setVenueFilter}>
                <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-orange-600 sm:w-[170px]">
                  <div className="flex items-center gap-2">
                    <Filter className="h-3.5 w-3.5 text-slate-400" />
                    <SelectValue placeholder="All Venues" />
                  </div>
                </SelectTrigger>

                <SelectContent className="rounded-xl border-slate-200 shadow-xl">
                  <SelectItem value="all" className="font-bold">
                    All Venues
                  </SelectItem>

                  {VENUE_OPTIONS.map((venue) => (
                    <SelectItem key={venue} value={venue}>
                      {venue}
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
                  <SelectItem value="all" className="font-bold">
                    All
                  </SelectItem>
                  <SelectItem value="for_review">For Review</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="incomplete">Incomplete</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>

              <div className="relative w-full sm:w-[300px]">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />

                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search payment..."
                  className="h-10 rounded-xl border-slate-200 bg-white pl-9 pr-16 text-xs focus-visible:ring-orange-600"
                />

                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("")
                      setStatusFilter("all")
                      window.history.replaceState(null, "", window.location.pathname)
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 transition hover:bg-slate-100 hover:text-orange-600"
                  >
                    Clear
                  </button>
                )}
              </div>
        </div>

        <section className="mt-4 space-y-3">
          {filteredPayments.length === 0 ? (
            <EmptyState />
          ) : (
            paginatedPayments.map((payment) => {
              const amountPaid = getAmountPaid(payment)
              return (
                <PaymentCard
                  key={payment.id}
                  payment={payment}
                  amountPaid={amountPaid}
                  onView={() => { setSelectedPayment(payment); const p = payment as any; markByBookingId(p.bookingId || p.id, ADMIN_PAYMENT_TYPES) }}
                  isHighlighted={highlightedPaymentId === payment.id}
                />
              )
            })
          )}
        </section>

        {paymentTotalPages > 1 && (
          <div className="flex items-center justify-center gap-4 pt-4 pb-2">
            <Button
              variant="outline"
              disabled={safePaymentPage <= 1}
              onClick={() => setPaymentPage((p) => Math.max(1, p - 1))}
              className="h-9 rounded-lg border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Previous
            </Button>
            <span className="text-xs font-semibold text-slate-500">
              Page {safePaymentPage} of {paymentTotalPages}
            </span>
            <Button
              variant="outline"
              disabled={safePaymentPage >= paymentTotalPages}
              onClick={() => setPaymentPage((p) => Math.min(paymentTotalPages, p + 1))}
              className="h-9 rounded-lg border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Next
            </Button>
          </div>
        )}

        <Dialog
          open={!!selectedPayment}
          onOpenChange={(open) => !open && setSelectedPayment(null)}
        >
          <DialogContent aria-describedby={undefined} showCloseButton={false} className="w-[95vw] sm:max-w-4xl lg:max-w-5xl max-h-[90dvh] overflow-hidden rounded-3xl bg-white shadow-2xl">
            {selectedPayment && (
              <PaymentReviewModal
                payment={selectedPayment}
                onClose={() => setSelectedPayment(null)}
                onAction={(type, submission) => openActionModal(selectedPayment, type, submission)}
                childModalOpen={!!pendingAction || !!incompletePaymentTarget || !!onsiteVerifyTarget}
                liveSubmissions={submissionListFor(selectedPayment.id)}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

function PaymentActionConfirmModal({
  pendingAction,
  note,
  setNote,
  onCancel,
  onConfirm,
}: {
  pendingAction: PendingPaymentAction
  note: string
  setNote: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const actionType = pendingAction?.type
  const payment = pendingAction?.payment

  const isReject = actionType === "reject"
  const isIncomplete = actionType === "incomplete"
  const isVerify = actionType === "verify"

  const title = isReject
    ? "Reject Payment?"
    : isIncomplete
      ? "Mark Payment as Incomplete?"
      : "Verify Payment?"

  const description = isReject
    ? "Are you sure you want to reject this payment? Please provide a reason for rejection."
    : isIncomplete
      ? "Are you sure you want to mark this payment as incomplete? Please provide a note for the customer."
      : "Are you sure you want to verify this payment? This action will secure the customer's slot and update the booking status."

  const confirmLabel = isReject
    ? "Reject Payment"
    : isIncomplete
      ? "Mark as Incomplete"
      : "Yes, Verify Payment"

  const confirmColor = isReject
    ? "bg-rose-600 hover:bg-rose-700"
    : isIncomplete
      ? "bg-amber-600 hover:bg-amber-700"
      : "bg-emerald-600 hover:bg-emerald-700"

  return (
    <Dialog open={!!pendingAction} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent aria-describedby={undefined} className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] overflow-hidden rounded-3xl bg-white shadow-2xl [&>button]:hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 flex items-center gap-3 border-b border-slate-100 px-5 py-4">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                isReject
                  ? "bg-rose-50 text-rose-600"
                  : isIncomplete
                    ? "bg-amber-50 text-amber-600"
                    : "bg-emerald-50 text-emerald-600"
              }`}
            >
              {isReject ? <XCircle className="h-5 w-5" /> : isIncomplete ? <AlertCircle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
            </div>
            <DialogTitle className="text-lg font-black text-slate-950">
              {title}
            </DialogTitle>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 space-y-4">
            <p className="text-sm leading-5 text-slate-500">
              {description}
            </p>

            {payment && (
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
                <ConfirmLine label="Customer" value={payment.userInfo?.name || "No Name"} />
                <ConfirmLine label="Booking ID" value={payment.id || "No ID"} />
                <ConfirmLine label="Payment Method" value={getPaymentMethodLabel(payment.paymentMethod)} />
                {payment.paymentMethod === "bank" && (
                  <ConfirmLine label="Bank Reference No." value={getBankReferenceNumber(payment)} />
                )}
                <ConfirmLine label="Amount Submitted" value={formatCurrency(getSafePrice(payment.pendingPaymentAmount || payment.paymentAmount || getAmountPaid(payment)))} />
                <ConfirmLine label="Current Status" value={getPaymentStatusText(payment)} />
                <ConfirmLine label="Action" value={getActionLabel(actionType || "verify")} />
              </div>
            )}

            {(isReject || isIncomplete) && (
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                  {isReject ? "Rejection Reason" : "Customer Note"}
                </label>
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={
                    isReject
                      ? "Enter reason for rejecting this payment..."
                      : "Enter note about missing or insufficient amount..."
                  }
                  className="min-h-[90px] w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm focus-visible:ring-orange-600"
                />
              </div>
            )}
          </div>

          <div className="shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t border-slate-100 bg-white px-5 py-5">
            <Button
              variant="outline"
              onClick={onCancel}
              className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700"
            >
              Cancel
            </Button>

            <Button
              disabled={(isReject || isIncomplete) && !note.trim()}
              onClick={onConfirm}
              className={`h-11 w-full sm:w-auto rounded-xl text-sm font-black text-white disabled:opacity-50 ${confirmColor}`}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200/70 pb-2 last:border-b-0 last:pb-0">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="text-right text-xs font-black text-slate-900">{value}</p>
    </div>
  )
}

function PaymentCard({
  payment,
  amountPaid,
  onView,
  isHighlighted,
}: {
  payment: BookingRecord
  amountPaid: number
  onView: () => void
  isHighlighted?: boolean
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef(false)
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!isHighlighted || !cardRef.current) return
    if (highlightRef.current) return
    highlightRef.current = true
    cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    sessionStorage.removeItem("admin_payment_highlight")
    highlightTimeoutRef.current = setTimeout(() => {
      highlightRef.current = false
    }, 3000)
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
        highlightTimeoutRef.current = null
      }
    }
  }, [isHighlighted])

  const innerCard = (
    <div
      ref={cardRef}
      className="group grid w-full max-w-full min-w-0 grid-cols-[1fr_1fr] gap-x-5 gap-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition sm:grid-cols-[220px_220px_240px_200px] sm:items-center sm:gap-x-6 hover:border-orange-200 hover:shadow-md"
    >
      <div className="flex min-w-0 items-center gap-3 sm:col-start-1">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
          <Receipt className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
            Payment
          </p>
          <p className="break-words whitespace-normal text-sm font-black leading-snug text-slate-900 line-clamp-2">
            {payment.eventName || "Untitled"}
          </p>
          <p className="break-words text-[11px] font-bold text-orange-600">
            {payment.id}
          </p>
          {(payment.paymentCount ?? 1) > 1 && (
            <p className="mt-0.5 truncate text-[10px] font-bold text-slate-500">
              Latest: {formatCurrency(getSafePrice(payment.latestPaymentAmount || payment.paymentAmount))} · {formatSubmittedAt(payment.latestPaymentSubmittedAt || payment.paymentSubmittedAt)}
            </p>
          )}
        </div>
      </div>

      <div className="min-w-0 sm:col-start-2">
        <p className="truncate text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Customer</p>
        <p className="truncate text-xs font-black text-slate-800">{payment.userInfo?.name || "—"}</p>
        <p className="truncate text-[10px] font-bold text-slate-500">{payment.userInfo?.email || "—"}</p>
      </div>

      <div className="min-w-0 sm:col-start-3">
        <p className="truncate text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Venue</p>
        <p className="truncate text-xs font-bold leading-snug text-slate-800">{payment.venue || "N/A"}</p>
      </div>

      <div className="col-span-2 flex shrink-0 items-center justify-between gap-3 sm:col-span-1 sm:col-start-4 sm:flex-col sm:items-end sm:gap-2.5">
        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:flex-col sm:items-end">
          <PaymentBadge payment={payment} />

          {(payment.paymentCount ?? 1) > 1 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
              <History className="h-3 w-3" />
              {payment.paymentCount} Payments
            </span>
          )}
        </div>
        <Button
          variant="outline"
          onClick={onView}
          className="h-9 w-full shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:w-auto"
        >
          <Eye className="mr-1.5 h-3.5 w-3.5" />
          Review
        </Button>
      </div>
    </div>
  )

  return (
    <div className={isHighlighted ? "notification-target-highlight" : undefined}>
      {innerCard}
    </div>
  )
}

function getContractStatusBadge(b: BookingRecord) {
  const status = b.contractStatus
  const baseClass =
    "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em]"

  if (status === "Signed") {
    return (
      <span className={`${baseClass} border-emerald-100 bg-emerald-50 text-emerald-600`}>
        <CheckCircle2 className="h-3 w-3" />
        Signed
      </span>
    )
  }

  if (status === "Pending Signature" || b.contractSigned) {
    return (
      <span className={`${baseClass} border-amber-100 bg-amber-50 text-amber-600`}>
        <FileText className="h-3 w-3" />
        Pending Signature
      </span>
    )
  }

  return (
    <span className={`${baseClass} border-slate-200 bg-slate-50 text-slate-500`}>
      <FileText className="h-3 w-3" />
      Not Available
    </span>
  )
}

function formatSubmittedAt(value?: string) {
  if (!value) return "—"
  try {
    const date = new Date(value)
    if (isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat("en-PH", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date)
  } catch {
    return value
  }
}

function getBookingTimeLabel(payment: BookingRecord) {
  if (payment.time) return payment.time
  if (payment.reservationTime) return payment.reservationTime
  const start = payment.startTime || payment.start || ""
  const end = payment.endTime || payment.end || ""
  if (start && end) return `${start} - ${end}`
  if (start) return start
  if (end) return end
  return "N/A"
}

function formatContractDate(date?: string) {
  if (!date) return ""
  try {
    return new Intl.DateTimeFormat("en-PH", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    }).format(new Date(date))
  } catch {
    return date
  }
}

function PaymentReviewModal({
  payment,
  onClose,
  onAction,
  childModalOpen,
  liveSubmissions,
}: {
  payment: BookingRecord
  onClose: () => void
  onAction: (type: PaymentAction, submission?: PaymentRecord | null) => void
  childModalOpen?: boolean
  liveSubmissions?: PaymentRecord[]
}) {
  const submissions: PaymentRecord[] =
    liveSubmissions && liveSubmissions.length > 0
      ? liveSubmissions
      : Array.isArray(payment.incomingPayments)
        ? payment.incomingPayments
        : []
  const [selectedSubmissionIndex, setSelectedSubmissionIndex] = useState(0)

  useEffect(() => {
    setSelectedSubmissionIndex(0)
  }, [payment.id, submissions.length])

  const safeIndex = Math.min(selectedSubmissionIndex, Math.max(submissions.length - 1, 0))
  const selected = submissions.length > 0 ? submissions[safeIndex] : null
  const submissionNumber = submissions.length > 0 ? submissions.length - safeIndex : 0
  const submissionLabel = selected
    ? `Payment #${submissionNumber} of ${submissions.length}`
    : "Payment"

  const [storedReceipts, setStoredReceipts] = useState<any[]>([])

  useEffect(() => {
    let mounted = true
    readStoredReceipts(payment.id).then((receipts) => {
      if (mounted) setStoredReceipts(receipts)
    })
    return () => {
      mounted = false
    }
  }, [payment.id])

  const receiptPool = useMemo(() => {
    const fromBooking = Array.isArray(payment.paymentReceipts)
      ? payment.paymentReceipts
      : payment.receipt
        ? [payment.receipt]
        : []
    const all = [...fromBooking, ...storedReceipts]
    const seen = new Set<string>()
    const unique: any[] = []
    for (const receiptEntry of all) {
      const key = receiptEntry.receiptNumber || ""
      if (!key || seen.has(key)) continue
      seen.add(key)
      unique.push(receiptEntry)
    }
    return unique
  }, [payment.paymentReceipts, payment.receipt, storedReceipts])

  const totalAmount = getSafePrice(payment.totalPrice)
  const amountPaid = getAmountPaid(payment)
  const selectedAmount = getPaymentRecordAmount(selected) || getSafePrice(payment.pendingPaymentAmount || payment.paymentAmount || amountPaid)
  const transactionAmount = getSafePrice(payment.pendingPaymentAmount || payment.paymentAmount || amountPaid)
  const remainingBalance = Math.max(totalAmount - amountPaid, 0)
  const dpTarget = getSafePrice(payment.selectedDownpaymentAmount) || (payment.paymentType === "downpayment" ? totalAmount * (Number(payment.downPaymentPercentage || 50) / 100) : 0)
  const acceptedDPPaid = getSafePrice(payment.downpaymentPaid)
  const thisSubmission = selectedAmount
  const submissionStatus = selected ? mapRecordStatus(selected, payment, receiptPool) : String(payment.paymentStatus || "for_review")
  const submissionStatusLabel = selected ? getPaymentRecordStatusLabel(selected, receiptPool) : getPaymentStatusText(payment)
  const submittedAt = selected?.submittedAt || payment.paymentSubmittedAt || ""
  const isActionable = selected
    ? isPendingPaymentRecord(selected) && !hasMatchingReceipt(selected, receiptPool)
    : isForReviewPayment(payment)
  const isIncompletePayment =
    (selected ? isIncompletePaymentRecord(selected) : false) ||
    String(payment.paymentStatus || "").toLowerCase() === "incomplete" ||
    String(payment.verificationStatus || "").toLowerCase() === "incomplete"
  const displayAmount = isIncompletePayment
    ? getSafePrice(payment.paymentVerifiedAmount || payment.lastPaymentAmount || 0)
    : selectedAmount
  const displayLabel = isIncompletePayment ? "Amount Received" : "Amount Submitted"
  const selectedMethod = selected?.paymentMethod || payment.paymentMethod
  const selectedBankReference = selected?.referenceNo || payment.bankReferenceNumber || payment.referenceNumber || payment.transactionReferenceNumber

  const effectiveProof = selected?.proofUrl || payment.proofUrl || payment.paymentProof || payment.proofOfPayment || payment.proofImage || payment.receiptImage
  const hasImageProof = isImageProof(effectiveProof)
  const hasPdfProof = isPdfProof(effectiveProof)
  const hasProof = !!effectiveProof

  const [proofPreviewOpen, setProofPreviewOpen] = useState(false)
  const [proofLoadError, setProofLoadError] = useState(false)
  const proofPreviewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setProofPreviewOpen(false)
    setProofLoadError(false)
  }, [selected?.id])

  useEffect(() => {
    if (proofPreviewOpen) {
      proofPreviewRef.current?.focus()
    }
  }, [proofPreviewOpen])

  const openProofInNewTab = () => {
    const url = effectiveProof
    if (!url) {
      console.warn("[Payment Proof] No proof URL available to open.")
      return
    }
    console.log("[Payment Proof] URL:", url.slice(0, 80) + (url.length > 80 ? "…" : ""))
    if (/^https?:\/\//i.test(url)) {
      window.open(url, "_blank", "noopener,noreferrer")
      return
    }
    if (url.startsWith("data:")) {
      fetch(url)
        .then((res) => res.blob())
        .then((blob) => {
          const objectUrl = URL.createObjectURL(blob)
          window.open(objectUrl, "_blank")
          setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
        })
        .catch((error) => {
          console.error("[Payment Proof] Failed to open data URL, falling back to in-app preview:", error)
          setProofPreviewOpen(true)
        })
      return
    }
    window.open(url, "_blank", "noopener,noreferrer")
  }

  const matchedReceipt = useMemo(() => {
    if (receiptPool.length === 0) return null
    if (!selected) return payment.receipt || null
    const exact = receiptPool.find(
      (receiptEntry) =>
        receiptEntry.paymentSubmittedAt && String(receiptEntry.paymentSubmittedAt) === String(selected.submittedAt),
    )
    if (exact) return exact
    const targetTime = getPaymentTime(selected.submittedAt)
    let best: any = null
    let bestDiff = Infinity
    for (const receiptEntry of receiptPool) {
      const diff = Math.abs(getPaymentTime(receiptEntry.dateGenerated || receiptEntry.dateIssued) - targetTime)
      if (diff < bestDiff) {
        bestDiff = diff
        best = receiptEntry
      }
    }
    return best || null
  }, [receiptPool, selected, payment.receipt])

  const paperData: ReceiptPaperData = {
    fullName:
      matchedReceipt?.fullName ||
      payment.userInfo?.name ||
      selected?.customerName ||
      "Client",
    email: payment.userInfo?.email || null,
    contactNumber: payment.userInfo?.phone || null,
    receiptNo:
      matchedReceipt?.receiptNumber ||
      matchedReceipt?.receiptNo ||
      payment.receiptNumber ||
      (selected ? "Pending Verification" : "—"),
    generatedAt:
      matchedReceipt?.dateGenerated ||
      matchedReceipt?.dateIssued ||
      submittedAt ||
      "",
    bookingId: payment.id || "",
    eventType: isOfficeRental(payment)
      ? "Office Space Rental"
      : matchedReceipt?.eventType ||
        payment.eventType ||
        payment.eventName ||
        "Event Venue Rental",
    venue:
      matchedReceipt?.venueReserved ||
      matchedReceipt?.venue ||
      payment.venueName ||
      payment.venue ||
      "N/A",
    eventDate: matchedReceipt?.startDate || payment.date || "Not set",
    reservationTime: isOfficeRental(payment)
      ? ""
      : getBookingTimeLabel(payment),
    paymentMethod:
      matchedReceipt?.paymentMethod || getPaymentMethodLabel(selectedMethod),
    bankReference:
      selectedMethod === "bank" ? selectedBankReference || null : null,
    paymentTypeLabel: isOfficeRental(payment)
      ? "Slot Reservation Only"
      : matchedReceipt?.paymentPurpose ||
        matchedReceipt?.paymentType ||
        getPaymentTypeLabel(payment.paymentType),
    totalAmount,
    amountPaid: getSafePrice(
      matchedReceipt?.amountPaid ??
        matchedReceipt?.paymentAmount ??
        displayAmount,
    ),
    remainingBalance: getSafePrice(
      matchedReceipt?.remainingBalance ?? remainingBalance,
    ),
    paymentStatus: matchedReceipt?.paymentStatus || submissionStatusLabel,
    isVerified: matchedReceipt
      ? [
          "verified",
          "paid",
          "slot_verified",
          "reservation secured",
          "reservation_secured",
        ].includes(String(matchedReceipt.paymentStatus || "").toLowerCase())
      : selected
        ? isVerifiedPaymentRecord(selected) || hasMatchingReceipt(selected, receiptPool)
        : isVerifiedPayment(payment),
    isOfficeRental: isOfficeRental(payment),
    contractTerm:
      matchedReceipt?.contractTerm ||
      payment.contractTerm ||
      payment.rentalTerm ||
      null,
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-slate-100 px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                {payment.id || "No ID"}
              </span>

              {selected && (
                <span className="rounded-full bg-orange-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-orange-700">
                  {submissionLabel}
                </span>
              )}

              <PaymentBadge payment={{ ...payment, paymentStatus: submissionStatus }} />
            </div>

            <DialogTitle className="break-words text-xl font-black leading-tight text-slate-950 sm:text-2xl">
              Payment Verification
            </DialogTitle>

            <p className="mt-1 break-words text-sm font-bold text-orange-600">
              {payment.eventName || "Untitled Event"}
            </p>

            {submittedAt && (
              <p className="mt-1 text-[11px] font-bold text-slate-400">
                Submitted {formatSubmittedAt(submittedAt)}
              </p>
            )}
          </div>

          {!childModalOpen && (
            <button
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 flex flex-col overflow-y-auto md:flex-row">
          {/* ── LEFT: PAYMENT HISTORY ── */}
          <aside className="flex shrink-0 flex-col border-b border-slate-100 md:w-[36%] md:min-h-0 md:border-b-0 md:border-r lg:w-[360px]">
            <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-100 px-4 py-3">
              <History className="h-3.5 w-3.5 text-slate-400" />
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                Payment History
              </p>
              {submissions.length > 0 && (
                <span className="ml-auto rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                  {submissions.length}
                </span>
              )}
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {submissions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center">
                  <p className="text-xs font-black text-slate-900">
                    No payment submissions
                  </p>
                  <p className="mt-1 text-[10px] font-semibold text-slate-500">
                    This booking has no individual payment records on file.
                  </p>
                </div>
              ) : (
                submissions.map((submission, index) => {
                  const isSelected = index === safeIndex
                  return (
                    <button
                      key={submission.id}
                      type="button"
                      onClick={() => setSelectedSubmissionIndex(index)}
                      className={cn(
                        "w-full rounded-2xl border p-3.5 text-left transition",
                        isSelected
                          ? "border-orange-200 bg-white shadow-md ring-1 ring-orange-200"
                          : "border-slate-200 bg-white/60 hover:border-orange-200 hover:bg-white hover:shadow-sm",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black text-slate-900">
                          Payment #{submissions.length - index}
                        </span>
                        {isSelected && <CheckCircle2 className="h-4 w-4 shrink-0 text-orange-600" />}
                      </div>
                      <span className="mt-1 block text-lg font-black tracking-tight text-slate-950">
                        {formatCurrency(getPaymentRecordAmount(submission))}
                      </span>
                      <span className="mt-0.5 block text-[10px] font-semibold text-slate-500">
                        Submitted {formatSubmittedAt(submission.submittedAt)}
                      </span>
                      <span
                        className={cn(
                          "mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-black uppercase tracking-[0.2em]",
                          isRejectedPaymentRecord(submission)
                            ? "bg-rose-50 text-rose-600"
                            : isIncompletePaymentRecord(submission)
                              ? "bg-amber-50 text-amber-600"
                              : isVerifiedPaymentRecord(submission) || hasMatchingReceipt(submission, receiptPool)
                                ? "bg-emerald-50 text-emerald-600"
                                : "bg-amber-50 text-amber-600",
                        )}
                      >
                        {isRejectedPaymentRecord(submission) && <XCircle className="h-3 w-3" />}
                        {(isVerifiedPaymentRecord(submission) || hasMatchingReceipt(submission, receiptPool)) && (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                        {getPaymentRecordStatusLabel(submission, receiptPool)}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </aside>

          {/* ── RIGHT: RECEIPT + DETAILS ── */}
          <div className="min-w-0 flex-1 px-4 py-5 sm:px-5 md:min-h-0 md:overflow-y-auto">
            <div className="space-y-5">
              <ModalSection title="Payment Receipt">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 sm:p-4">
                  <ReceiptPaper {...paperData} />
                </div>
              </ModalSection>

              <ModalSection title="Payment Proof">
                {selectedMethod === "cash" ? (
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5 text-center">
                    <Banknote className="mx-auto mb-3 h-10 w-10 text-emerald-500" />

                    <p className="text-sm font-black text-emerald-950">
                      Cash Payment at Office
                    </p>

                    <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-emerald-700">
                      No uploaded proof required. Confirm this booking only after the physical cash payment is received.
                    </p>
                  </div>
                ) : hasImageProof ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    {proofLoadError ? (
                      <div className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-rose-200 bg-white p-5 text-center">
                        <FileImage className="mb-3 h-10 w-10 text-rose-300" />
                        <p className="text-sm font-black text-rose-600">
                          Unable to load payment proof.
                        </p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setProofLoadError(false)
                          setProofPreviewOpen(true)
                        }}
                        className="mx-auto block w-full max-w-[320px] cursor-zoom-in"
                        aria-label="Open payment proof image in full view"
                      >
                        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-1 shadow-sm transition hover:opacity-90">
                          <img
                            src={effectiveProof}
                            alt="Uploaded payment proof"
                            onError={() => setProofLoadError(true)}
                            className="h-auto w-full max-w-full object-contain"
                          />
                        </div>
                        <span className="mt-2 inline-flex items-center justify-center gap-1 text-[10px] font-bold text-slate-500">
                          <ZoomIn className="h-3 w-3" />
                          Click to view full size
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={openProofInNewTab}
                      className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Open proof in new tab
                    </button>
                  </div>
                ) : hasPdfProof ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <iframe
                      src={effectiveProof}
                      title="Uploaded payment proof (PDF)"
                      className="h-[55vh] w-full rounded-xl border border-slate-200 bg-white"
                    />
                    <button
                      type="button"
                      onClick={openProofInNewTab}
                      className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Open proof in new tab
                    </button>
                  </div>
                ) : hasProof ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <button
                      type="button"
                      onClick={openProofInNewTab}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Open uploaded payment proof
                    </button>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mx-auto flex min-h-[200px] w-full max-w-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center">
                      <FileImage className="mb-3 h-10 w-10 text-slate-300" />

                      <p className="text-sm font-black text-slate-900">
                        No proof uploaded
                      </p>

                      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
                        The customer did not upload a proof image for this bank transfer payment.
                      </p>
                    </div>
                  </div>
                )}
              </ModalSection>

              <ModalSection title="Client Details">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-sm font-black text-slate-950">
                    {payment.userInfo?.name || "No Name"}
                  </p>

                  <p className="mt-1 break-all text-sm text-slate-500">
                    {payment.userInfo?.email || "No email"}
                  </p>
                </div>
              </ModalSection>

              <ModalSection title="Amount Summary">
                <div className="rounded-2xl border border-orange-100 bg-orange-50 p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">
                    {displayLabel}
                  </p>

                  <p className="mt-1 text-3xl font-black tracking-tight text-orange-600">
                    {formatCurrency(displayAmount)}
                  </p>

                  <p className="mt-2 text-xs font-semibold text-orange-700/70">
                    {getPaymentTypeLabel(payment.paymentType)}
                  </p>
                </div>
              </ModalSection>

              {payment.paymentType === "downpayment" && (acceptedDPPaid > 0 || thisSubmission > 0) ? (
                <div className="rounded-2xl bg-slate-950 p-4 text-white">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">
                    Downpayment Summary
                  </p>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="font-semibold text-slate-400">DP Target</span>
                      <span className="font-bold text-white">₱{dpTarget.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold text-slate-400">Accepted DP Paid</span>
                      <span className="font-bold text-white">₱{acceptedDPPaid.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold text-slate-400">{isIncompletePayment ? "This Payment Received" : "This Submission"}</span>
                      <span className="font-bold text-amber-300">₱{(isIncompletePayment ? displayAmount : thisSubmission).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between border-t border-white/10 pt-1.5">
                      <span className="font-semibold text-slate-400">{isIncompletePayment ? "Remaining DP" : "Remaining DP After Verification"}</span>
                      <span className="font-bold text-emerald-400">₱{(isIncompletePayment ? getSafePrice(payment.downpaymentRemaining || Math.max(dpTarget - acceptedDPPaid, 0)) : Math.max(dpTarget - (acceptedDPPaid + thisSubmission), 0)).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ) : payment.paymentType === "downpayment" ? (
                <div className="rounded-2xl bg-slate-950 p-4 text-white">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-amber-300">
                      <AlertCircle className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                        {payment.downpaymentRemaining && Number(payment.downpaymentRemaining) > 0
                          ? "Downpayment Remaining"
                          : acceptedDPPaid === 0 ? "Downpayment Target" : "Remaining Balance"}
                      </p>
                      <p className="mt-1 text-xl font-black">
                        {formatCurrency(acceptedDPPaid === 0 ? dpTarget : remainingBalance)}
                      </p>
                    </div>
                  </div>
                  {payment.downpaymentRemaining !== undefined && Number(payment.downpaymentRemaining) > 0 && (
                    <p className="mt-2 text-[10px] font-semibold text-amber-300">
                      Downpayment remaining: {formatCurrency(getSafePrice(payment.downpaymentRemaining))}
                    </p>
                  )}
                </div>
              ) : null}

              <ModalSection title="Payment Details">
                <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <InfoLine label="Method" value={getPaymentMethodLabel(selectedMethod)} />
                  {selectedMethod === "bank" && (
                    <InfoLine label="Bank Reference No." value={String(selectedBankReference || "No reference number")} />
                  )}
                  <InfoLine label="Type" value={getPaymentTypeLabel(payment.paymentType)} />
                  <InfoLine label="Total Booking" value={formatCurrency(totalAmount)} />
                  <InfoLine label="Status" value={submissionStatusLabel} />
                  {submittedAt && (
                    <InfoLine label="Submitted" value={formatSubmittedAt(submittedAt)} />
                  )}
                </div>
              </ModalSection>

              <ModalSection title="Contract Status">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center gap-2">
                    {getContractStatusBadge(payment)}
                  </div>
                  {payment.contractSignedDate && (
                    <p className="mt-2 text-[10px] font-semibold text-slate-500">
                      Signed on {formatContractDate(payment.contractSignedDate)}
                      {payment.contractSignedBy ? ` by ${payment.contractSignedBy}` : ""}
                    </p>
                  )}
                  {payment.contractStatus !== "Signed" && isVerifiedPayment(payment) && (
                    <p className="mt-2 text-[10px] font-semibold text-amber-600">
                      Customer must visit the office to sign the contract.
                    </p>
                  )}
                </div>
              </ModalSection>
            </div>
          </div>
      </div>

      <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-5">
        {isActionable ? (
          <div className={`grid gap-3 ${selectedMethod === "cash" ? "sm:grid-cols-1" : "sm:grid-cols-3"}`}>
            {selectedMethod !== "cash" && (
              <Button
                onClick={() => onAction("reject", selected)}
                variant="outline"
                className="h-11 rounded-xl border-rose-200 text-sm font-black text-rose-500 hover:bg-rose-50"
              >
                Reject Payment
              </Button>
            )}

            {selectedMethod !== "cash" && (
              <Button
                onClick={() => onAction("incomplete", selected)}
                variant="outline"
                className="h-11 rounded-xl border-amber-200 text-sm font-black text-amber-600 hover:bg-amber-50"
              >
                Incomplete Payment
              </Button>
            )}

            <Button
              onClick={() => onAction("verify", selected)}
              className="h-11 rounded-xl bg-emerald-500 text-sm font-black text-white hover:bg-emerald-600"
            >
              Verify Payment
            </Button>
          </div>
        ) : (
          <Button
            onClick={onClose}
            variant="outline"
            className="h-11 w-full rounded-xl border-slate-200 text-sm font-black text-slate-700 hover:bg-slate-50"
          >
            Close Window
          </Button>
        )}
      </div>

      {proofPreviewOpen && hasImageProof && (
        <div
          ref={proofPreviewRef}
          role="dialog"
          aria-modal="true"
          aria-label="Payment proof image preview"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation()
              setProofPreviewOpen(false)
            }
          }}
          className="fixed inset-0 z-[10003] flex items-center justify-center bg-black/85 p-4 sm:p-6"
          onClick={() => setProofPreviewOpen(false)}
        >
          <button
            type="button"
            aria-label="Close image preview"
            onClick={(e) => {
              e.stopPropagation()
              setProofPreviewOpen(false)
            }}
            className="absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/25"
          >
            <X className="h-5 w-5" />
          </button>
          {proofLoadError ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-slate-900 p-8 text-center">
              <FileImage className="h-10 w-10 text-slate-500" />
              <p className="text-sm font-black text-white">
                Unable to load payment proof.
              </p>
            </div>
          ) : (
            <img
              src={effectiveProof}
              alt="Payment proof (full view)"
              onClick={(e) => e.stopPropagation()}
              onError={() => setProofLoadError(true)}
              className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain shadow-2xl sm:max-w-[90vw]"
            />
          )}
        </div>
      )}
    </div>
  )
}

function PaymentMethodLabel({ payment }: { payment: BookingRecord }) {
  const isBank = payment.paymentMethod === "bank"

  return (
    <span className="inline-flex max-w-full items-center gap-1.5 text-xs font-black text-slate-800">
      {isBank ? (
        <FileImage className="h-3.5 w-3.5 shrink-0 text-blue-500" />
      ) : (
        <Banknote className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      )}
      <span className="truncate">{getPaymentMethodLabel(payment.paymentMethod)}</span>
    </span>
  )
}

function PaymentBadge({ payment }: { payment: BookingRecord }) {
  const paymentStatus = String(payment?.paymentStatus || "").toLowerCase()
  const balanceStatus = String(payment?.balanceStatus || "").toLowerCase()
  const paymentStage = String(payment?.paymentStage || "").toLowerCase()
  const totalAmount = getSafePrice(
    (payment as any).totalAmount || payment.totalPrice || (payment as any).amount || (payment as any).price
  )
  const amountPaid = getSafePrice(
    (payment as any).amountPaid || (payment as any).paymentAmount || (payment as any).paidAmount
  )
  const remainingBalance = getSafePrice(
    (payment as any).remainingBalance || Math.max(totalAmount - amountPaid, 0)
  )
  const baseClass = "inline-flex min-w-[140px] items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em]"

  if (paymentStatus === "rejected") {
    return <span className={`${baseClass} border-rose-100 bg-rose-50 text-rose-700`}><XCircle className="h-3 w-3" />Rejected</span>
  }

  if (isForReviewPayment(payment)) {
    return <span className={`${baseClass} border-amber-100 bg-amber-50 text-amber-700`}><ShieldCheck className="h-3 w-3" />For Review</span>
  }

  if (remainingBalance > 0 && amountPaid > 0) {
    return <span className={`${baseClass} border-amber-100 bg-amber-50 text-amber-700`}><AlertCircle className="h-3 w-3" />Partial Payment</span>
  }

  if (paymentStatus === "incomplete") {
    return <span className={`${baseClass} border-amber-100 bg-amber-50 text-amber-700`}><AlertCircle className="h-3 w-3" />Incomplete Payment</span>
  }

  const isRemainingZero = remainingBalance === 0
  const isAmountSufficient = totalAmount > 0 && amountPaid >= totalAmount

  if ((paymentStage === "fully paid" || paymentStatus === "paid" || paymentStatus === "completed") && isRemainingZero && isAmountSufficient) {
    return <span className={`${baseClass} border-emerald-100 bg-emerald-50 text-emerald-700`}><CheckCircle2 className="h-3 w-3" />Fully Paid</span>
  }

  if (isVerifiedPayment(payment)) {
    return <span className={`${baseClass} border-emerald-100 bg-emerald-50 text-emerald-700`}><CheckCircle2 className="h-3 w-3" />Verified</span>
  }

  if (amountPaid === 0) {
    return <span className={`${baseClass} border-slate-200 bg-slate-50 text-slate-700`}>Unpaid</span>
  }

  return <span className={`${baseClass} border-slate-200 bg-slate-50 text-slate-700`}>{paymentStatus || "Unknown"}</span>
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200/70 pb-3 last:border-b-0 last:pb-0">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="text-right text-xs font-black text-slate-900">{value}</p>
    </div>
  )
}

function ModalSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h4 className="border-b border-slate-100 pb-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
        {title}
      </h4>

      <div className="pt-4">{children}</div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex min-h-[230px] flex-col items-center justify-center px-6 py-10 text-center">
      <Inbox className="mb-3 h-10 w-10 text-slate-300" />

      <h3 className="text-base font-black text-slate-900">
        No payment records found
      </h3>

      <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
        No payments match your current filters or search keyword.
      </p>
    </div>
  )
}

function readStoredReceipts(bookingId?: string): Promise<any[]> {
  const constraints: any[] = bookingId
    ? [where("bookingId", "==", bookingId)]
    : [orderBy("dateGenerated", "desc")]
  return getDocs(query(collection(db, "receipts"), ...constraints)).then(
    (snapshot) => {
      const result: any[] = []
      snapshot.forEach((docSnap) => {
        const d = docSnap.data()
        result.push({ id: docSnap.id, ...d })
      })
      return result
    },
    () => []
  )
}

function getSafePrice(value: unknown) {
  if (typeof value === "number") return value

  const cleanedValue = String(value || "0").replace(/[^\d.]/g, "")
  return Number(cleanedValue) || 0
}

function getAmountPaid(payment: BookingRecord) {
  if (payment.amountPaid && Number(payment.amountPaid) > 0) {
    return getSafePrice(payment.amountPaid)
  }
  const totalPrice = getSafePrice(payment.totalPrice)
  // fallback: if downpayment type and no actual amountPaid yet, return 0 not 50%
  return 0
}

function formatCurrency(value: number) {
  return `₱${Number(value || 0).toLocaleString()}`
}

function getPaymentMethodLabel(method?: string) {
  if (method === "bank") return "Bank Transfer"
  if (method === "cash") return "Pay at the Office"
  return "Payment Method"
}

function getBankReferenceNumber(payment: BookingRecord) {
  const value =
    payment?.bankReferenceNumber ||
    payment?.referenceNumber ||
    payment?.transactionReferenceNumber

  const text = String(value || "").trim()
  return text || "No reference number"
}

function getPaymentTypeLabel(type?: string) {
  if (type === "full") return "Full Payment"
  if (type === "downpayment") return "Downpayment"
  if (type === "slot_reservation") return "Slot Reservation Only"
  return "Payment Type"
}

function isImageProof(proof: unknown) {
  const value = String(proof || "").toLowerCase()
  if (!value) return false
  if (value.startsWith("data:image")) return true
  return /\.(jpe?g|png|webp|gif|avif|bmp|svg|heic|heif)(\?|#|$)/.test(value)
}

function isPdfProof(proof: unknown) {
  const value = String(proof || "").toLowerCase()
  if (!value) return false
  if (value.startsWith("data:application/pdf")) return true
  return /\.pdf(\?|#|$)/.test(value)
}

function getPaymentTime(value?: string | number | Date | null) {
  if (!value) return 0
  const time = new Date(String(value)).getTime()
  return Number.isFinite(time) ? time : 0
}

function mapPaymentTerm(term?: string, fallback?: string) {
  const normalized = String(term || "").toLowerCase()
  if (normalized.includes("down payment") || normalized.includes("downpayment")) return "downpayment"
  if (normalized.includes("full")) return "full"
  if (normalized.includes("slot")) return "slot_reservation"
  return fallback || "full"
}

function isUnresolvedPaymentRecord(record: PaymentRecord | null | undefined, receipts?: any[]) {
  if (!record) return false
  if (isVerifiedPaymentRecord(record)) return false
  if (isRejectedPaymentRecord(record)) return false
  if (isIncompletePaymentRecord(record)) return false
  if (hasMatchingReceipt(record, receipts)) return false
  return true
}

function getOverallPaymentStatus(
  base: BookingRecord,
  submissions: PaymentRecord[],
  receipts?: any[],
) {
  if (submissions.length === 0) {
    return String(base.paymentStatus || (isVerifiedPayment(base) ? "verified" : "for_review"))
  }
  const anyRejected = submissions.some((record) => isRejectedPaymentRecord(record))
  if (anyRejected) return "rejected"
  const anyIncomplete = submissions.some((record) => isIncompletePaymentRecord(record))
  if (anyIncomplete) return "incomplete"
  const anyPending = submissions.some((record) => isUnresolvedPaymentRecord(record, receipts))
  if (anyPending) return "for_review"
  return String(base.paymentStatus || "verified")
}

function isPendingPaymentRecord(record: PaymentRecord | null | undefined) {
  if (!record) return false
  const status = String(record.status || "").toLowerCase()
  const verificationStatus = String(record.verificationStatus || "").toLowerCase()
  return (
    status === "for review" ||
    status === "for_review" ||
    status === "for verification" ||
    status === "awaiting onsite payment" ||
    status === "pending" ||
    verificationStatus === "for review" ||
    verificationStatus === "for_review" ||
    verificationStatus === "pending" ||
    verificationStatus === "pending onsite verification"
  )
}

function isVerifiedPaymentRecord(record: PaymentRecord | null | undefined) {
  if (!record) return false
  const status = String(record.status || "").toLowerCase()
  const verificationStatus = String(record.verificationStatus || "").toLowerCase()
  return status === "verified" || verificationStatus === "verified"
}

function isRejectedPaymentRecord(record: PaymentRecord | null | undefined) {
  if (!record) return false
  const status = String(record.status || "").toLowerCase()
  const verificationStatus = String(record.verificationStatus || "").toLowerCase()
  return status === "rejected" || verificationStatus === "rejected"
}

function isIncompletePaymentRecord(record: PaymentRecord | null | undefined) {
  if (!record) return false
  const status = String(record.status || "").toLowerCase()
  const verificationStatus = String(record.verificationStatus || "").toLowerCase()
  return status === "incomplete" || verificationStatus === "incomplete"
}

function hasMatchingReceipt(record: PaymentRecord | null | undefined, receipts?: any[]) {
  if (!record || !Array.isArray(receipts) || receipts.length === 0) return false
  const target = getPaymentTime(record.submittedAt)
  if (target === 0) return false
  const exact = receipts.some(
    (r) => r.paymentSubmittedAt && String(r.paymentSubmittedAt) === String(record.submittedAt),
  )
  if (exact) return true
  const windowMs = 10 * 60 * 1000
  return receipts.some((r) => {
    const t = getPaymentTime(r.dateGenerated || r.dateIssued)
    return t > 0 && Math.abs(t - target) <= windowMs
  })
}

function mapRecordStatus(record: PaymentRecord | null | undefined, base: BookingRecord, receipts?: any[]) {
  if (isRejectedPaymentRecord(record)) return "rejected"
  if (isIncompletePaymentRecord(record)) return "incomplete"
  if (isVerifiedPaymentRecord(record)) return "verified"
  if (isPendingPaymentRecord(record) && !hasMatchingReceipt(record, receipts)) return "for_review"
  if (isPendingPaymentRecord(record)) return "verified"
  if (hasMatchingReceipt(record, receipts)) return "verified"
  return String(base.paymentStatus || (isVerifiedPayment(base) ? "verified" : "for_review"))
}

function getPaymentRecordStatusLabel(record: PaymentRecord | null | undefined, receipts?: any[]) {
  if (record === null || record === undefined) return "For Review"
  if (isRejectedPaymentRecord(record)) return "Rejected"
  if (isIncompletePaymentRecord(record)) return "Incomplete Payment"
  if (isVerifiedPaymentRecord(record)) return "Verified"
  if (isPendingPaymentRecord(record)) return hasMatchingReceipt(record, receipts) ? "Verified" : "For Review"
  return "For Review"
}

function getPaymentRecordAmount(record: PaymentRecord | null | undefined) {
  return getSafePrice(record?.amount || record?.amountPaid || 0)
}

function buildPaymentBookingEntry(
  base: BookingRecord,
  submissions: PaymentRecord[],
  latest: PaymentRecord,
  bookingId: string,
): BookingRecord {
  const bank = latest.paymentMethod === "bank" || String(latest.method || "").toLowerCase().includes("bank")
  const cash = latest.paymentMethod === "cash" || String(latest.method || "").toLowerCase().includes("office")
  const method = bank ? "bank" : cash ? "cash" : latest.paymentMethod === "cash" ? "cash" : latest.paymentMethod === "bank" ? "bank" : base.paymentMethod
  const amount = getPaymentRecordAmount(latest)
  const proof = latest.proofUrl || base.proofUrl || base.paymentProof
  const receipts = Array.isArray(base.paymentReceipts)
    ? base.paymentReceipts
    : base.receipt
      ? [base.receipt]
      : []
  const hasAnyPendingSubmission = submissions.some((record) => isUnresolvedPaymentRecord(record, receipts))

  return {
    ...base,
    id: bookingId,
    bookingId,
    incomingPayments: submissions,
    paymentCount: submissions.length,
    latestPayment: latest,
    paymentRecordId: latest.id,
    userInfo: base.userInfo || (latest.customerName ? { name: latest.customerName, email: "", phone: "" } : undefined),
    eventName: base.eventName || latest.eventName || "",
    venue: base.venue || latest.venueName || "",
    venueName: base.venueName || latest.venueName || "",
    paymentMethod: method,
    actualPaymentMethod: latest.method || base.actualPaymentMethod,
    paymentType: mapPaymentTerm(latest.term, base.paymentType),
    paymentStatus: getOverallPaymentStatus(base, submissions, receipts),
    hasActivePaymentSubmission: hasAnyPendingSubmission,
    pendingPaymentAmount: amount,
    paymentAmount: amount,
    paymentVerifiedAmount: typeof base.paymentVerifiedAmount === "number" ? base.paymentVerifiedAmount : undefined,
    proofUrl: proof,
    paymentProof: proof,
    bankReferenceNumber: latest.referenceNo || base.bankReferenceNumber,
    paymentReference: latest.referenceNo || base.paymentReference,
    paymentSubmissionType: cash ? "onsite" : "bank_transfer",
    paymentSubmittedAt: latest.submittedAt,
    latestPaymentAmount: amount,
    latestPaymentMethod: latest.method,
    latestPaymentSubmittedAt: latest.submittedAt,
    totalPrice: base.totalPrice || latest.amount || 0,
    createdAt: base.createdAt || latest.submittedAt,
    updatedAt: latest.updatedAt || base.updatedAt,
    paymentReceipts: base.paymentReceipts,
    status: base.status || (isPendingPaymentRecord(latest) ? "verifying" : "confirmed"),
  }
}

function buildLegacyPaymentBookingEntry(booking: BookingRecord): BookingRecord {
  return {
    ...booking,
    incomingPayments: [],
    paymentCount: 1,
    latestPayment: null,
    paymentRecordId: null,
  }
}

function isPaymentRecord(booking: BookingRecord) {
  const normalizedStatus = String(
    booking?.paymentStatus || booking?.status || ""
  ).toLowerCase()

  const hasPaymentProof = Boolean(
    booking?.proofUrl ||
      booking?.paymentProof ||
      booking?.proofOfPayment ||
      booking?.paymentReference ||
      booking?.referenceNumber ||
      booking?.proofImage ||
      booking?.receiptImage
  )

  const hasActivePaymentSubmission =
    booking?.hasActivePaymentSubmission === true ||
    normalizedStatus === "for_review" ||
    normalizedStatus === "for review" ||
    normalizedStatus === "pending_verification" ||
    normalizedStatus === "pending verification" ||
    normalizedStatus === "incomplete" ||
    Boolean(booking?.paymentSubmittedAt)

  const hasOnsiteSubmission =
    booking?.paymentSubmissionType === "onsite" &&
    booking?.hasActivePaymentSubmission === true

  const hasPaymentAmount =
    Number(booking?.paymentAmount || 0) > 0 ||
    Number(booking?.pendingPaymentAmount || 0) > 0

  return hasActivePaymentSubmission || hasPaymentProof || hasOnsiteSubmission || hasPaymentAmount
}

function isForReviewPayment(booking: BookingRecord) {
  const paymentStatus = String(booking?.paymentStatus || "").toLowerCase()

  const isPending = (
    paymentStatus === "for_review" ||
    paymentStatus === "pending_verification" ||
    paymentStatus === "for verification" ||
    paymentStatus === "pending verification"
  )

  const hasActiveOnsite = (
    booking?.paymentSubmissionType === "onsite" &&
    booking?.hasActivePaymentSubmission === true
  )

  return isPending || hasActiveOnsite
}

function isVerifiedPayment(booking: BookingRecord) {
  const status = String(booking?.status || "").toLowerCase()
  const paymentStatus = String(booking?.paymentStatus || "").toLowerCase()

  return (
    ["confirmed", "completed", "reservation_secured", "slot_secured"].includes(status) ||
    ["verified", "paid", "partial", "slot_verified", "reservation secured"].includes(paymentStatus)
  )
}

function getPaymentStatusText(payment: BookingRecord) {
  const ps = String(payment.paymentStatus || "").toLowerCase()
  const stage = String(payment.paymentStage || "").toLowerCase()
  const totalAmount = getSafePrice(
    (payment as any).totalAmount || payment.totalPrice || (payment as any).amount || (payment as any).price
  )
  const amountPaid = getSafePrice(
    (payment as any).amountPaid || (payment as any).paymentAmount || (payment as any).paidAmount
  )
  const remainingBalance = getSafePrice(
    (payment as any).remainingBalance || Math.max(totalAmount - amountPaid, 0)
  )

  if (stage === "complete downpayment" || stage === "settle remaining balance") return "Partial Payment"
  if ((stage === "fully paid" || ps === "paid" || ps === "completed") && remainingBalance === 0 && amountPaid >= totalAmount) return "Fully Paid"
  if (ps === "for_review") return "For Review"
  if (ps === "cash_pending") return "Cash Pending"
  if (ps === "slot_pending") return "Slot Pending"
  if (ps === "incomplete") return "Incomplete Payment"
  if (ps === "rejected") return "Rejected"
  if (remainingBalance > 0 && amountPaid > 0) return "Partial Payment"
  if (isVerifiedPayment(payment)) return "Verified"
  if (isForReviewPayment(payment)) return "For Review"
  if (amountPaid === 0) return "Unpaid"
  return String(ps || String(payment.status || "Unknown"))
}

function isPaymentFullyPaid(booking: BookingRecord) {
  const totalAmount = getSafePrice(
    (booking as any).totalAmount || booking.totalPrice || (booking as any).amount || (booking as any).price
  )
  const amountPaid = getSafePrice(
    (booking as any).amountPaid || (booking as any).paymentAmount || (booking as any).paidAmount
  )
  const remainingBalance = getSafePrice(
    (booking as any).remainingBalance || Math.max(totalAmount - amountPaid, 0)
  )

  return remainingBalance === 0 && totalAmount > 0 && amountPaid >= totalAmount
}

function getActionLabel(action: PaymentAction) {
  if (action === "verify") return "Verify / Accept Payment"
  if (action === "reject") return "Reject Payment"
  if (action === "incomplete") return "Record Incomplete Payment"
  return "Verify Payment"
}

function getActionSuccessTitle(action: PaymentAction) {
  if (action === "verify") return "Payment Verified"
  if (action === "reject") return "Payment Rejected"
  if (action === "incomplete") return "Payment Marked Incomplete"
  return "Payment Updated"
}

function getActionSuccessDescription(action: PaymentAction, bookingId: string) {
  if (action === "verify") {
    return `Booking ${bookingId} has been verified and the customer's slot has been secured.`
  }

  if (action === "reject") {
    return `Booking ${bookingId} payment was rejected with admin reason.`
  }

  if (action === "incomplete") {
    return `Booking ${bookingId} payment was recorded as incomplete with partial amount.`
  }

  return `Booking ${bookingId} payment record was updated.`
}

function isOfficeRental(booking: BookingRecord) {
  return (
    String(booking?.bookingType || "").toLowerCase().includes("office") ||
    String(booking?.rentalType || "").toLowerCase().includes("office") ||
    String(booking?.venue || "").toLowerCase().includes("office") ||
    Boolean(booking?.isOfficeRental)
  )
}

function appendAdminLog(booking: BookingRecord, action: string, message: string) {
  return [
    ...(Array.isArray(booking.adminLogs) ? booking.adminLogs : []),
    {
      action,
      message,
      createdAt: new Date().toISOString(),
    },
  ]
}

function buildVerifiedPaymentBooking(booking: BookingRecord) {
  const office = isOfficeRental(booking)
  const totalAmount = getSafePrice(booking.totalPrice)
  const isDownpayment = String(booking.paymentType || "").toLowerCase() === "downpayment"
  const paymentAmount = getSafePrice(booking.paymentAmount || totalAmount)
  const currentAmountPaid = getSafePrice(booking.amountPaid)
  const currentDownpaymentPaid = getSafePrice(booking.downpaymentPaid)
  const newAmountPaid = currentAmountPaid + paymentAmount
  const selectedDP = getSafePrice(booking.selectedDownpaymentAmount) || (isDownpayment ? totalAmount * (Number(booking.downPaymentPercentage || 50) / 100) : 0)

  if (office) {
    const officeNewPaid = currentAmountPaid + paymentAmount
    const officeFullyPaid = officeNewPaid >= totalAmount
    return {
      ...booking,
      status: officeFullyPaid ? "reservation_secured" : "verifying",
      bookingStatus: officeFullyPaid ? "Slot Secured" : "Pending Verification",
      paymentStatus: officeFullyPaid ? "slot_verified" : "partial",
      isSlotSecured: officeFullyPaid,
      amountPaid: officeNewPaid,
      remainingBalance: Math.max(totalAmount - officeNewPaid, 0),
      paymentVerifiedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      verifiedByAdmin: true,
      contractStatus: officeFullyPaid ? "Pending Signature" : undefined,
      hasActivePaymentSubmission: false,
      updatedAt: new Date().toISOString(),
      adminLogs: appendAdminLog(booking, "PAYMENT_VERIFIED",
        officeFullyPaid
          ? "Admin verified the office slot reservation payment. Succeeding payments are onsite check payments."
          : `Admin verified office payment. Remaining reservation fee: ₱${Math.max(totalAmount - officeNewPaid, 0).toLocaleString()}.`
      ),
    }
  }

  if (isDownpayment) {
    const newDownpaymentPaid = currentDownpaymentPaid + paymentAmount
    let paymentStatus = "partial"
    let balanceStatus = "With Remaining Balance"
    let remainingBalance = Math.max(totalAmount - newAmountPaid, 0)
    let downpaymentRemaining = Math.max(selectedDP - newDownpaymentPaid, 0)
    let status = "confirmed"

    if (newAmountPaid >= totalAmount) {
      paymentStatus = "paid"
      balanceStatus = "Settled"
      remainingBalance = 0
      downpaymentRemaining = 0
    } else if (newDownpaymentPaid >= selectedDP) {
      downpaymentRemaining = 0
    }

    return {
      ...booking,
      status,
      bookingStatus: "Confirmed",
      paymentStatus,
      balanceStatus,
      isSlotSecured: true,
      amountPaid: newAmountPaid,
      downpaymentPaid: newDownpaymentPaid,
      downpaymentRemaining,
      selectedDownpaymentAmount: selectedDP,
      remainingBalance,
      paymentVerifiedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      verifiedByAdmin: true,
      contractStatus: "Pending Signature",
      hasActivePaymentSubmission: false,
      updatedAt: new Date().toISOString(),
      adminLogs: appendAdminLog(booking, "PAYMENT_VERIFIED",
        newDownpaymentPaid < selectedDP
          ? `Admin verified downpayment. Downpayment remaining: ₱${downpaymentRemaining.toLocaleString()}.`
          : remainingBalance > 0
            ? `Admin verified payment. Downpayment complete. Remaining balance: ₱${remainingBalance.toLocaleString()}.`
            : "Admin verified full payment and secured the customer slot."
      ),
    }
  }

  // Full payment
  const newAmtPaid = currentAmountPaid + paymentAmount
  const isFullyPaid = newAmtPaid >= totalAmount

  return {
    ...booking,
    status: "confirmed",
    bookingStatus: "Confirmed",
    paymentStatus: isFullyPaid ? "paid" : "partial",
    balanceStatus: isFullyPaid ? "Settled" : "With Remaining Balance",
    isSlotSecured: true,
    amountPaid: newAmtPaid,
    downpaymentPaid: 0,
    downpaymentRemaining: 0,
    remainingBalance: Math.max(totalAmount - newAmtPaid, 0),
    paymentVerifiedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    verifiedByAdmin: true,
    contractStatus: "Pending Signature",
    hasActivePaymentSubmission: false,
    updatedAt: new Date().toISOString(),
    adminLogs: appendAdminLog(booking, "PAYMENT_VERIFIED",
      isFullyPaid
        ? "Admin verified the booking payment and secured the customer slot."
        : `Admin verified payment. Remaining: ₱${Math.max(totalAmount - newAmtPaid, 0).toLocaleString()}.`
    ),
  }
}

function buildRejectedPaymentBooking(booking: BookingRecord, reason: string) {
  const total = getAmountValue(booking.totalAmount || booking.totalPrice || booking.amount || booking.price)
  const amountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0
  const downpaymentPaid = typeof booking.downpaymentPaid === "number" ? booking.downpaymentPaid : 0
  const hasApprovedDownpayment = downpaymentPaid > 0

  if (hasApprovedDownpayment) {
    const remaining = Math.max(total - amountPaid, 0)
    return {
      ...booking,
      status: "confirmed",
      bookingStatus: "Confirmed",
      paymentStatus: "partial",
      isSlotSecured: true,
      paymentRejectedReason: reason,
      paymentRejectionReason: reason,
      paymentRejectedAt: new Date().toISOString(),
      hasActivePaymentSubmission: false,
      proofUrl: null,
      bankReferenceNumber: null,
      paymentReference: null,
      paymentAmount: 0,
      pendingPaymentAmount: 0,
      paymentSubmittedAt: null,
      remainingBalance: remaining,
      updatedAt: new Date().toISOString(),
      adminLogs: appendAdminLog(
        booking,
        "REMAINING_BALANCE_REJECTED",
        `Admin rejected remaining balance payment. Reason: ${reason}. Approved down payment of ₱${amountPaid.toLocaleString()} is preserved.`
      ),
    }
  }

  return {
    ...booking,
    status: "pending",
    bookingStatus: "Pending Verification",
    paymentStatus: "rejected",
    isSlotSecured: false,
    paymentRejectedReason: reason,
    paymentRejectionReason: reason,
    paymentRejectedAt: new Date().toISOString(),
    hasActivePaymentSubmission: false,
    updatedAt: new Date().toISOString(),
    adminLogs: appendAdminLog(
      booking,
      "PAYMENT_REJECTED",
      `Admin rejected the payment. Reason: ${reason}`
    ),
  }
}

function buildIncompletePaymentBooking(booking: BookingRecord, note: string, verifiedAmount?: number) {
  const total = getAmountValue(booking.totalAmount || booking.totalPrice || booking.amount || booking.price)
  const currentPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0
  const newPaid = verifiedAmount ? currentPaid + verifiedAmount : currentPaid
  const remaining = Math.max(total - newPaid, 0)
  const isDownpayment = String(booking.paymentType || "").toLowerCase() === "downpayment"
  const currentDpPaid = getAmountValue(booking.downpaymentPaid)
  const newDpPaid = isDownpayment && verifiedAmount ? currentDpPaid + verifiedAmount : currentDpPaid
  const selectedDP = getAmountValue(booking.selectedDownpaymentAmount) || (isDownpayment ? total * (Number(booking.downPaymentPercentage || 50) / 100) : 0)
  const newDPRemaining = isDownpayment ? Math.max(selectedDP - newDpPaid, 0) : 0

  return {
    ...booking,
    status: "verifying",
    bookingStatus: "Pending Verification",
    paymentStatus: "incomplete",
    isSlotSecured: false,
    amountPaid: verifiedAmount ? newPaid : booking.amountPaid,
    downpaymentPaid: isDownpayment ? newDpPaid : booking.downpaymentPaid,
    downpaymentRemaining: newDPRemaining,
    lastPaymentAmount: verifiedAmount || booking.lastPaymentAmount,
    remainingBalance: isDownpayment ? newDPRemaining : remaining,
    balanceStatus: "With Remaining Balance",
    incompletePaymentNote: note,
    incompletePaymentReason: note,
    incompletePaymentAt: new Date().toISOString(),
    hasActivePaymentSubmission: false,
    updatedAt: new Date().toISOString(),
    adminLogs: appendAdminLog(booking, "PAYMENT_INCOMPLETE", `Admin marked payment as incomplete. Note: ${note}${verifiedAmount ? `. Verified amount received: ₱${verifiedAmount.toLocaleString()}.` : ""}`),
  }
}

function ensureReceiptForVerifiedBooking(booking: BookingRecord) {
  // The BookingContext already generates and persists a receipt per verified
  // payment (paymentReceipts / receipts collection). Only fall back to the
  // legacy single-receipt flow when the booking has no receipt history yet.
  if (
    (Array.isArray(booking.paymentReceipts) && booking.paymentReceipts.length > 0) ||
    booking.receipt ||
    booking.receiptIssued
  ) {
    return
  }
  readStoredReceipts(booking.id).then((receipts) => {
    const existingReceipt = receipts.find((receipt) => receipt.bookingId === booking.id)
    if (existingReceipt || booking.receipt || booking.receiptIssued) return

    const office = isOfficeRental(booking)
    const receiptData = {
      receiptNumber: `ER-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
      bookingId: booking.id,
      fullName: booking.userInfo?.name || "Client",
      bookingDate: booking.createdAt || new Date().toISOString(),
      startDate: booking.date,
      endDate: office ? booking.endDate || booking.contractEndDate || booking.date : booking.date,
      rentalType: office ? "Office Space Rental" : "Event Venue Booking",
      contractTerm: office ? (booking.contractTerm || booking.rentalTerm || "N/A") : null,
      paymentPurpose: office ? "Slot Reservation Only" : getPaymentTypeLabel(booking.paymentType),
      paymentMethod: getPaymentMethodLabel(booking.paymentMethod),
      amountPaid: formatCurrency(getAmountPaid(booking)),
      paymentStatus: office ? "Reservation Secured" : "Payment Verified",
      dateGenerated: new Date().toISOString(),
    }

    addDoc(collection(db, "receipts"), receiptData).then(() => {
      window.dispatchEvent(new Event("oneestela_receipts_updated"))
    })
  })
}

function IncompletePaymentModal({
  booking,
  onClose,
  onConfirm,
}: {
  booking: BookingRecord | null
  onClose: () => void
  onConfirm: (updated: BookingRecord) => void
}) {
  const [verifiedAmount, setVerifiedAmount] = useState("")
  const [adminReason, setAdminReason] = useState("")
  const [confirmStep, setConfirmStep] = useState(false)

  useEffect(() => {
    if (booking) {
      setVerifiedAmount("")
      setAdminReason("")
      setConfirmStep(false)
    }
  }, [booking])

  if (!booking) return null

  const office = isOfficeRental(booking)
  const isDownpayment = String(booking.paymentType || "").toLowerCase() === "downpayment"
  const totalAmount = getAmountValue(
    (booking as any).totalAmount || booking.totalPrice || (booking as any).amount || (booking as any).price
  )
  const selectedDP = getAmountValue(booking.selectedDownpaymentAmount) || (isDownpayment ? totalAmount * (Number(booking.downPaymentPercentage || 50) / 100) : 0)
  const currentAmountPaid = typeof (booking as any).amountPaid === "number" ? (booking as any).amountPaid : 0
  const currentDownpaymentPaid = getAmountValue(booking.downpaymentPaid)
  const isDownpaymentStage = isDownpayment && currentDownpaymentPaid < selectedDP
  const expectedAmount = isDownpaymentStage
    ? Math.max(selectedDP - currentDownpaymentPaid, 0)
    : Math.max(totalAmount - currentAmountPaid, 0)
  const enteredAmount = getAmountValue(verifiedAmount)
  const newAmountPaid = currentAmountPaid + enteredAmount
  const newDownpaymentPaid = isDownpayment ? currentDownpaymentPaid + enteredAmount : 0
  const newRemainingBalance = Math.max(totalAmount - newAmountPaid, 0)
  const expectedRemaining = Math.max(totalAmount - currentAmountPaid, 0)
  const remainingAfterInput = Math.max(expectedAmount - enteredAmount, 0)
  const isEmpty = verifiedAmount.trim() === ""
  const isZeroOrNegative = enteredAmount <= 0
  const isEqualOrOver = enteredAmount >= expectedAmount
  const isValidIncompleteAmount = !isEmpty && enteredAmount > 0 && enteredAmount < expectedAmount

  const handleConfirm = () => {
    if (enteredAmount <= 0) return

    const latestStatus = isDownpayment ? "verifying" : (office ? "reservation_secured" : "confirmed")
    const latestBookingStatus = isDownpayment ? "Pending Verification" : (office ? "Slot Secured" : "Confirmed")
    const newDownpaymentPaid = currentDownpaymentPaid + enteredAmount
    const newDPRemaining = isDownpayment ? Math.max(selectedDP - newDownpaymentPaid, 0) : 0

    const updatedBooking: BookingRecord = {
      ...booking,
      status: latestStatus,
      bookingStatus: latestBookingStatus,
      isSlotSecured: !isDownpayment,
      amountPaid: newAmountPaid,
      paidAmount: office ? enteredAmount : undefined,
      downpaymentPaid: isDownpayment ? newDownpaymentPaid : 0,
      downpaymentRemaining: newDPRemaining,
      selectedDownpaymentAmount: isDownpayment ? selectedDP : 0,
      lastPaymentAmount: enteredAmount,
      paymentStatus: "incomplete",
      remainingBalance: office ? newRemainingBalance : (isDownpayment ? newDPRemaining : newRemainingBalance),
      balanceStatus: "With Remaining Balance",
      contractStatus: "Pending Signature",
      hasActivePaymentSubmission: false,
      incompletePaymentReason: adminReason.trim(),
      incompletePaymentNote: adminReason.trim(),
      verifiedAmount: office ? enteredAmount : undefined,
      remainingAmount: office ? remainingAfterInput : undefined,
      paymentVerifiedAt: new Date().toISOString(),
      paymentReviewedAt: new Date().toISOString(),
      paymentReviewedBy: "Administrator",
      paymentVerifiedBy: "Administrator",
      verifiedByAdmin: true,
      verifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      adminLogs: appendAdminLog(
        booking,
        "INCOMPLETE_PAYMENT_RECORDED",
        `Admin recorded incomplete payment. Amount received: ₱${enteredAmount.toLocaleString()}.${isDownpayment ? ` Downpayment remaining: ₱${newDPRemaining.toLocaleString()}.` : ` Remaining: ₱${remainingAfterInput.toLocaleString()}.`} Note: ${adminReason.trim() || "N/A"}.`
      ),
    }

    onConfirm(updatedBooking)
    setConfirmStep(false)
  }

  const iconBlock = (color: string) => (
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}>
      <AlertCircle className="h-5 w-5" />
    </div>
  )

  return (
    <Dialog open={!!booking} onOpenChange={(open) => !open && onClose()}>
        <DialogContent aria-describedby={undefined} className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] overflow-hidden rounded-3xl bg-white shadow-2xl [&>button]:hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!confirmStep ? (
            <>
              <div className="shrink-0 flex items-center gap-3 border-b border-slate-100 px-5 py-4">
                {iconBlock("bg-amber-50 text-amber-600")}
                <DialogTitle className="text-lg font-black text-slate-950">
                  Incomplete Payment
                </DialogTitle>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 space-y-4">
                <p className="text-sm leading-5 text-slate-500">
                  Enter the verified amount actually received from the customer. The system will calculate the remaining amount.
                </p>

                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Booking ID</span>
                    <span className="font-bold text-slate-900">{booking.id}</span>
                  </p>
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Customer</span>
                    <span className="font-bold text-slate-900">{booking.userInfo?.name || "No Name"}</span>
                  </p>
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Expected Amount</span>
                    <span className="font-bold text-slate-900">₱{expectedAmount.toLocaleString()}</span>
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                    Verified Amount Received *
                  </label>
                  <Input
                    value={verifiedAmount}
                    onChange={(e) => {
                      const digitsOnly = e.target.value.replace(/[^0-9.]/g, "")
                      setVerifiedAmount(digitsOnly)
                    }}
                    placeholder="Enter actual amount received"
                    className="h-10 rounded-xl border-slate-200 text-xs font-bold focus-visible:ring-amber-600"
                  />
                  {isEmpty ? (
                    <p className="mt-1.5 text-[11px] font-semibold text-slate-500">
                      Enter the amount actually received.
                    </p>
                  ) : isZeroOrNegative ? (
                    <p className="mt-1.5 text-[11px] font-semibold text-rose-600">
                      Amount must be greater than ₱0.
                    </p>
                  ) : isEqualOrOver ? (
                    <p className="mt-1.5 text-[11px] font-semibold text-rose-600">
                      Amount received cannot exceed the remaining balance of ₱{expectedAmount.toLocaleString()}.
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[11px] font-semibold text-amber-700">
                      Remaining Balance After This Payment: ₱{remainingAfterInput.toLocaleString()}
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                    Admin Note / Reason *
                  </label>
                  <Textarea
                    value={adminReason}
                    onChange={(e) => setAdminReason(e.target.value)}
                    placeholder="Example: Proof is valid, but amount received is only ₱5,000."
                    className="min-h-[80px] w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-xs focus-visible:ring-amber-600"
                  />
                </div>
              </div>

              <div className="shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t border-slate-100 bg-white px-5 py-5">
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700"
                >
                  Cancel
                </Button>
                <Button
                  disabled={!isValidIncompleteAmount || !adminReason.trim()}
                  onClick={() => setConfirmStep(true)}
                  className="h-11 w-full sm:w-auto rounded-xl bg-amber-600 text-sm font-black text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Continue
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="shrink-0 flex items-center gap-3 border-b border-slate-100 px-5 py-4">
                {iconBlock("bg-amber-50 text-amber-600")}
                <DialogTitle className="text-lg font-black text-slate-950">
                  Confirm Incomplete Payment
                </DialogTitle>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 space-y-4">
                <p className="text-sm leading-5 text-slate-500">
                  Are you sure you want to record this as an incomplete payment?
                </p>

                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Booking ID</span>
                    <span className="font-bold text-slate-900">{booking.id}</span>
                  </p>
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Customer</span>
                    <span className="font-bold text-slate-900">{booking.userInfo?.name || "No Name"}</span>
                  </p>
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Amount Received</span>
                    <span className="font-bold text-amber-700">₱{enteredAmount.toLocaleString()}</span>
                  </p>
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">{isDownpayment ? "Downpayment Remaining" : "Remaining Balance"}</span>
                    <span className="font-bold text-amber-700">₱{(office ? remainingAfterInput : (isDownpayment ? Math.max(selectedDP - newDownpaymentPaid, 0) : newRemainingBalance)).toLocaleString()}</span>
                  </p>
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">New Status</span>
                    <span className="font-bold text-amber-700">Incomplete Payment</span>
                  </p>
                  {adminReason.trim() && (
                    <p className="flex justify-between text-xs">
                      <span className="font-semibold text-slate-400">Note</span>
                      <span className="font-bold text-slate-900">{adminReason.trim()}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t border-slate-100 bg-white px-5 py-5">
                <Button
                  variant="outline"
                  onClick={() => setConfirmStep(false)}
                  className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700"
                >
                  Back
                </Button>
                <Button
                  onClick={handleConfirm}
                  className="h-11 w-full sm:w-auto rounded-xl bg-amber-600 text-sm font-black text-white hover:bg-amber-700"
                >
                  Confirm Incomplete Payment
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function OnsiteVerifyModal({
  booking,
  onClose,
  onConfirm,
}: {
  booking: BookingRecord | null
  onClose: () => void
  onConfirm: (updated: BookingRecord) => void
}) {
  const [amountReceived, setAmountReceived] = useState("")
  const [adminNote, setAdminNote] = useState("")
  const [confirmStep, setConfirmStep] = useState(false)

  useEffect(() => {
    if (booking) {
      const totalAmt = getAmountValue(booking.totalAmount || booking.totalPrice || booking.amount || booking.price)
      const paidAmt = typeof booking.amountPaid === "number" ? booking.amountPaid : 0
      const remaining = Math.max(totalAmt - paidAmt, 0)
      setAmountReceived(remaining > 0 ? String(remaining) : "")
      setAdminNote("")
      setConfirmStep(false)
    }
  }, [booking])

  if (!booking) return null

  const totalAmount = getAmountValue(booking.totalAmount || booking.totalPrice || booking.amount || booking.price)
  const currentAmountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0
  const remainingBefore = Math.max(totalAmount - currentAmountPaid, 0)
  const enteredAmount = getAmountValue(amountReceived)
  const newAmountPaid = currentAmountPaid + enteredAmount
  const newRemainingBalance = Math.max(totalAmount - newAmountPaid, 0)
  const isOverPayment = enteredAmount > remainingBefore
  const isDownpayment = String(booking.paymentType || "").toLowerCase() === "downpayment"
  const currentDownpaymentPaid = getAmountValue(booking.downpaymentPaid)
  const selectedDP = getAmountValue(booking.selectedDownpaymentAmount) || (isDownpayment ? totalAmount * (Number(booking.downPaymentPercentage || 50) / 100) : 0)

  const isFullyPaidAfter = newAmountPaid >= totalAmount

  const handleConfirm = () => {
    if (enteredAmount <= 0) return

    const office = isOfficeRental(booking)
    const nextStatus = office
      ? (isFullyPaidAfter ? "reservation_secured" : "verifying")
      : "confirmed"
    const nextBookingStatus = office
      ? (isFullyPaidAfter ? "Slot Secured" : "Pending Verification")
      : "Confirmed"
    const newDownpaymentPaid = currentDownpaymentPaid + enteredAmount
    const newDPRemaining = isDownpayment ? Math.max(selectedDP - newDownpaymentPaid, 0) : 0

    const updatedBooking: BookingRecord = {
      ...booking,
      status: nextStatus,
      bookingStatus: nextBookingStatus,
      isSlotSecured: office ? isFullyPaidAfter : true,
      amountPaid: newAmountPaid,
      downpaymentPaid: isDownpayment ? newDownpaymentPaid : 0,
      downpaymentRemaining: newDPRemaining,
      selectedDownpaymentAmount: isDownpayment ? selectedDP : 0,
      lastPaymentAmount: enteredAmount,
      paymentStatus: isFullyPaidAfter ? "paid" : "partial",
      remainingBalance: newRemainingBalance,
      balanceStatus: isFullyPaidAfter ? "Settled" : "With Remaining Balance",
      contractStatus: "Pending Signature",
      hasActivePaymentSubmission: false,
      paymentVerifiedAt: new Date().toISOString(),
      paymentReviewedAt: new Date().toISOString(),
      paymentReviewedBy: "Administrator",
      paymentVerifiedBy: "Administrator",
      verifiedByAdmin: true,
      verifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      adminLogs: appendAdminLog(
        booking,
        "ONSITE_PAYMENT_VERIFIED",
        `Admin verified onsite payment. Amount received: ₱${enteredAmount.toLocaleString()}. Total paid: ₱${newAmountPaid.toLocaleString()}. Remaining: ₱${newRemainingBalance.toLocaleString()}.${adminNote.trim() ? ` Note: ${adminNote.trim()}` : ""}`,
      ),
    }

    onConfirm(updatedBooking)
    setConfirmStep(false)
  }

  return (
    <Dialog open={!!booking} onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[95vw] sm:max-w-[520px] max-h-[90dvh] overflow-hidden rounded-3xl bg-white shadow-2xl [&>button]:hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!confirmStep ? (
            <>
              <div className="shrink-0 flex items-center gap-3 border-b border-slate-100 px-5 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <Banknote className="h-5 w-5" />
                </div>
                <DialogTitle className="text-lg font-black text-slate-950">
                  Verify Onsite Payment
                </DialogTitle>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 space-y-4">
                <p className="text-sm leading-5 text-slate-500">
                  The customer selected Pay at the Office. Enter the actual amount received at the office.
                </p>

                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Booking ID</span>
                    <span className="font-bold text-slate-900">{booking.id}</span>
                  </p>
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Customer</span>
                    <span className="font-bold text-slate-900">{booking.userInfo?.name || "No Name"}</span>
                  </p>
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Total Amount</span>
                    <span className="font-bold text-slate-900">₱{totalAmount.toLocaleString()}</span>
                  </p>
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Current Paid</span>
                    <span className="font-bold text-slate-900">₱{currentAmountPaid.toLocaleString()}</span>
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                    Amount Received *
                  </label>
                  <Input
                    value={amountReceived}
                    onChange={(e) => {
                      const digitsOnly = e.target.value.replace(/[^0-9.]/g, "")
                      setAmountReceived(digitsOnly)
                    }}
                    placeholder="Enter amount received"
                    className="h-10 rounded-xl border-slate-200 text-xs font-bold focus-visible:ring-emerald-600"
                  />
                  {isOverPayment ? (
                    <p className="mt-1.5 text-[11px] font-semibold text-rose-600">
                      Amount received cannot exceed the remaining balance of ₱{remainingBefore.toLocaleString()}.
                    </p>
                  ) : enteredAmount > 0 && (
                    <p className="mt-1.5 text-[11px] font-semibold text-emerald-700">
                      Remaining balance after this: ₱{newRemainingBalance.toLocaleString()}
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                    Admin Note (optional)
                  </label>
                  <Textarea
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Optional note about the onsite payment"
                    className="min-h-[80px] w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-xs focus-visible:ring-emerald-600"
                  />
                </div>
              </div>

              <div className="shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t border-slate-100 bg-white px-5 py-5">
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700"
                >
                  Cancel
                </Button>
                <Button
                  disabled={enteredAmount <= 0 || isOverPayment}
                  onClick={() => setConfirmStep(true)}
                  className="h-11 w-full sm:w-auto rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Continue
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="shrink-0 flex items-center gap-3 border-b border-slate-100 px-5 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <Banknote className="h-5 w-5" />
                </div>
                <DialogTitle className="text-lg font-black text-slate-950">
                  Confirm Onsite Payment
                </DialogTitle>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 space-y-4">
                <p className="text-sm leading-5 text-slate-500">
                  Confirm the onsite payment amount received from the customer.
                </p>

                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Booking ID</span>
                    <span className="font-bold text-slate-900">{booking.id}</span>
                  </p>
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Customer</span>
                    <span className="font-bold text-slate-900">{booking.userInfo?.name || "No Name"}</span>
                  </p>
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Amount Received</span>
                    <span className="font-bold text-emerald-700">₱{enteredAmount.toLocaleString()}</span>
                  </p>
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Remaining Balance</span>
                    <span className="font-bold text-emerald-700">₱{newRemainingBalance.toLocaleString()}</span>
                  </p>
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">New Status</span>
                    <span className="font-bold text-emerald-700">{isFullyPaidAfter ? "Fully Paid" : "Partial Payment"}</span>
                  </p>
                  {adminNote.trim() && (
                    <p className="flex justify-between text-xs">
                      <span className="font-semibold text-slate-400">Note</span>
                      <span className="font-bold text-slate-900">{adminNote.trim()}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t border-slate-100 bg-white px-5 py-5">
                <Button
                  variant="outline"
                  onClick={() => setConfirmStep(false)}
                  className="h-11 w-full sm:w-auto rounded-xl border-slate-200 text-sm font-black text-slate-700"
                >
                  Back
                </Button>
                <Button
                  onClick={handleConfirm}
                  className="h-11 w-full sm:w-auto rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700"
                >
                  Confirm Verification
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function getAmountValue(value: any) {
  const num = Number(String(value || 0).replace(/[^0-9.-]+/g, ""))
  return Number.isFinite(num) ? num : 0
}
