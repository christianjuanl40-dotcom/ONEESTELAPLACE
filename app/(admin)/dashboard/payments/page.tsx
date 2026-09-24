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
} from "lucide-react"

import {
  ReceiptPaper,
  type ReceiptPaperData,
} from "@/src/modules/shared/components/receipt-paper"
import {
  isPaymentProofImage,
  PaymentProofPreview,
  PaymentProofRow,
} from "@/src/modules/shared/components/payment-proof-preview"

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
import { normalizeBookingLifecycleStatus } from "@/src/modules/shared/lib/booking-helpers"
import { useNotifications } from "@/src/modules/shared/contexts/notification-context"
import type { NotificationType } from "@/src/modules/shared/lib/notifications"
import { db } from "@/lib/firebase"
import { collection, query, orderBy, where, getDocs } from "firebase/firestore"
import {
  isAcceptedPaymentRecord,
  isIncompletePaymentRecord,
  isPendingPaymentRecord,
  isRejectedPaymentRecord,
  isUnresolvedPaymentRecord,
  isVerifiedPaymentRecord,
  getPaymentRecordAmount,
  getPaymentRecordCreditedAmount,
  getPaymentRecordStatusLabel,
  getPaymentDisplayModel,
  calculatePaymentSummary,
  getRecordsForBooking,
  type PaymentRecordLike,
  type BookingLike,
} from "@/src/modules/shared/lib/payment-calculations"

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
    // Canonical record→booking association (same rule as getRecordsForBooking):
    // a record belongs to the booking when its bookingId OR bookingCode
    // matches — older records carry only one of the two, or padded casing.
    const normalizeKey = (value: unknown) => String(value || "").trim().toLowerCase()
    const bookingById = new Map<string, BookingRecord>()
    ;(bookingCtx.bookings || []).forEach((b: BookingRecord) => {
      const idKey = normalizeKey(b.id)
      if (idKey) bookingById.set(idKey, b)
      const codeKey = normalizeKey((b as any).bookingCode)
      if (codeKey && !bookingById.has(codeKey)) bookingById.set(codeKey, b)
    })

    // Group individual payment submissions per booking. Every submission from
    // the client writes its own document in the `payments` collection, so
    // Payment 1, Payment 2, ... are preserved as separate records.
    const recordsByBooking = new Map<string, PaymentRecord[]>()
    for (const record of allRecords) {
      // Resolve the canonical booking first. Historical records may carry an
      // id while others carry only the booking code; grouping by the first
      // populated field would split those records into separate rows.
      const matchedBooking =
        bookingById.get(normalizeKey(record.bookingId)) ||
        bookingById.get(normalizeKey(record.bookingCode))
      const key = normalizeKey(matchedBooking?.id || record.bookingId || record.bookingCode)
      if (!key) continue
      const list = recordsByBooking.get(key) || []
      list.push(record)
      recordsByBooking.set(key, list)
    }

    const built: BookingRecord[] = []
    recordsByBooking.forEach((list, bookingKey) => {
      // Newest submission first within a booking.
      list.sort((a, b) => getPaymentTime(b.submittedAt) - getPaymentTime(a.submittedAt))
      const latest = list[0]
      const base = bookingById.get(bookingKey) || {}
      built.push(buildPaymentBookingEntry(base, list, latest, latest.bookingId || base.id || bookingKey))
    })

    // Legacy bookings that carry payment info but have no individual
    // submission records yet (older single-payment bookings).
    const legacyBookings = (bookingCtx.bookings || [])
      .filter((booking: BookingRecord) => {
        const hasGroupedRecords =
          recordsByBooking.has(normalizeKey(booking.id)) ||
          recordsByBooking.has(normalizeKey((booking as any).bookingCode))
        return isPaymentRecord(booking) && !hasGroupedRecords
      })
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

      if (statusFilter === "for_review") matchesStatus = String(booking?.paymentStatus || "").toLowerCase() === "for_review"
      if (statusFilter === "rejected") matchesStatus = String(booking?.paymentStatus || "").toLowerCase() === "rejected"
      if (statusFilter === "incomplete") matchesStatus = String(booking?.paymentStatus || "").toLowerCase() === "incomplete"
      if (statusFilter === "partial") matchesStatus = String(booking?.paymentStatus || "").toLowerCase() === "partial"
      if (statusFilter === "completed") matchesStatus = String(booking?.paymentStatus || "").toLowerCase() === "completed"

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
    return getRecordsForBooking(bookingCtx.paymentRecords || [], bookingId)
      .slice()
      .sort((a, b) =>
        getPaymentTime(b.submittedAt as string | undefined) - getPaymentTime(a.submittedAt as string | undefined)
      ) as PaymentRecord[]
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
      let updatedBooking: BookingRecord
      if (type === "verify") {
        const result = await bookingCtx.reviewPayment(bookingId, {
          verifiedAmount: amount,
          adminNote: note || undefined,
          adminName: reviewerName,
          paymentRecordId,
        })
        updatedBooking = {
          ...payment,
          ...result.booking,
          paymentRecordId: result.payment.id,
          incomingPayments: (payment.incomingPayments || []).map((record: PaymentRecord) =>
            record.id === result.payment.id ? result.payment : record,
          ),
        }
      } else if (type === "reject") {
        const result = await bookingCtx.rejectPayment(bookingId, note, reviewerName, paymentRecordId)
        updatedBooking = {
          ...payment,
          ...result.booking,
          paymentRecordId: result.payment.id,
          incomingPayments: (payment.incomingPayments || []).map((record: PaymentRecord) =>
            record.id === result.payment.id ? result.payment : record,
          ),
        }
      } else if (type === "incomplete") {
        // verifiedAmount = the money actually received on this attempt (the
        // record's submitted amount when no other figure was captured). It
        // must NEVER be 0 — an INCOMPLETE payment keeps its real amount and
        // stays credited toward completing the required downpayment.
        const result = await bookingCtx.markIncompletePayment(bookingId, {
          verifiedAmount: amount || getPaymentRecordAmount(paymentSubmissionById(paymentRecordId)),
          adminNote: note,
          adminName: reviewerName,
          paymentRecordId,
        })
        updatedBooking = {
          ...payment,
          ...result.booking,
          paymentRecordId: result.payment.id,
          incomingPayments: (payment.incomingPayments || []).map((record: PaymentRecord) =>
            record.id === result.payment.id ? result.payment : record,
          ),
        }
      }

      if (updatedBooking && !updatedBooking.proofUrl) {
        const matchingPayment = paymentSubmissionById(paymentRecordId)
        if (matchingPayment?.proofUrl) {
          updatedBooking = { ...updatedBooking, proofUrl: matchingPayment.proofUrl }
        }
      }
      setSelectedPayment(updatedBooking)
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
          paymentRecords={
            onsiteVerifyTarget
              ? getRecordsForBooking(bookingCtx.paymentRecords || [], onsiteVerifyTarget)
              : []
           }
          onClose={() => setOnsiteVerifyTarget(null)}
          onConfirm={async (updatedBooking, adminNote) => {
            try {
              const paymentRecordId = (updatedBooking as BookingRecord).paymentRecordId
              const result = await bookingCtx.reviewPayment(updatedBooking.id, {
                verifiedAmount: updatedBooking.lastPaymentAmount || updatedBooking.paymentVerifiedAmount,
                adminNote: adminNote || undefined,
                adminName: user?.name || "Administrator",
                paymentRecordId,
              })
              let updated = { ...updatedBooking, ...result.booking, paymentRecordId: result.payment.id }
              if (!updated.proofUrl && updatedBooking.submissionAmount) {
                const matchingPayment = paymentSubmissionById(paymentRecordId)
                if (matchingPayment?.proofUrl) {
                  updated = { ...updated, proofUrl: matchingPayment.proofUrl }
                }
              }
              setSelectedPayment(updated)
              setOnsiteVerifyTarget(null)
              toast({
                title: "Onsite Payment Verified",
                description: `Onsite payment verified for booking ${updatedBooking.id}.`,
                className: "border-none bg-emerald-500 text-white",
              })
            } catch (error) {
              console.error("Onsite payment verification error:", error)
              toast({
                title: "Action Failed",
                description: error instanceof Error ? error.message : "Something went wrong while verifying the payment.",
                variant: "destructive",
              })
            }
          }}
        />
        <IncompletePaymentModal
          booking={incompletePaymentTarget}
          paymentRecords={incompletePaymentTarget ? getRecordsForBooking(bookingCtx.paymentRecords || [], incompletePaymentTarget) : []}
          onClose={() => setIncompletePaymentTarget(null)}
          onConfirm={async (updatedBooking) => {
             // Use BookingContext markIncompletePayment as single source of truth
             const paymentRecordId = (updatedBooking as BookingRecord).paymentRecordId
             const result = await bookingCtx.markIncompletePayment(updatedBooking.id, {
               verifiedAmount: updatedBooking.lastPaymentAmount || updatedBooking.paymentVerifiedAmount || 0,
               adminNote: updatedBooking.incompletePaymentNote || updatedBooking.incompletePaymentReason || "",
               adminName: user?.name || "Administrator",
               paymentRecordId,
             })
             let updated = { ...updatedBooking, ...result.booking, paymentRecordId: result.payment.id }
            if (!updated.proofUrl && updatedBooking.submissionAmount) {
              const matchingPayment = paymentSubmissionById(paymentRecordId)
              if (matchingPayment?.proofUrl) {
                updated = { ...updated, proofUrl: matchingPayment.proofUrl }
              }
            }
            setSelectedPayment(updated)
            // INCOMPLETE action: BookingContext updates THIS payment's own
            // transaction receipt to INCOMPLETE — no acceptance implied.
            setIncompletePaymentTarget(null)
            toast({
              title: "Incomplete Payment Recorded",
              description: `Booking ${updatedBooking.id} has been updated with partial payment.`,
              className: "border-none bg-amber-500 text-white",
            })
          }}
        />
        <div className="mb-3 flex w-full flex-col items-stretch gap-2 sm:ml-auto sm:w-fit sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
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
                  <SelectItem value="incomplete">Incomplete</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="completed">Fully Paid</SelectItem>
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

        <section className="mt-2 space-y-2">
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
      <p className="text-xs font-bold text-slate-500 shrink-0">{label}</p>
      <p className="text-right text-xs font-black text-slate-900 break-words min-w-0">{value}</p>
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
      className="group grid w-full max-w-full min-w-0 grid-cols-1 gap-x-5 gap-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:bg-slate-50/70 md:grid-cols-2 md:items-center lg:min-h-[120px] lg:grid-cols-[minmax(0,24fr)_minmax(0,22fr)_minmax(0,24fr)_minmax(156px,30fr)] lg:gap-y-0"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
          <Receipt className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
            Payment
          </p>
          <p className="truncate text-sm font-black leading-snug text-slate-900">
            {payment.eventName || "Untitled"}
          </p>
          <p className="truncate text-[11px] font-bold text-orange-600">
            {payment.id}
          </p>
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Customer</p>
        <p className="truncate text-xs font-black text-slate-800">{payment.userInfo?.name || "—"}</p>
      </div>

      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Venue</p>
        <p className="truncate text-xs font-bold leading-snug text-slate-800">{payment.venue || "N/A"}</p>
      </div>

      <div className="flex w-full min-w-0 flex-col gap-1.5 md:col-span-1 md:ml-auto md:w-[156px] lg:col-span-1">
        <div className="flex justify-end">
          <PaymentBadge payment={payment} />
        </div>
        <Button
          variant="outline"
          onClick={onView}
          className="h-8 w-full shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          <Eye className="mr-1.5 h-3.5 w-3.5" />
          Review
        </Button>
        <div className="flex justify-end">
          <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
            <History className="h-3 w-3" />
            {payment.paymentCount ?? 1} {(payment.paymentCount ?? 1) === 1 ? "Payment" : "Payments"}
          </span>
        </div>
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

  const selectedPaymentType = selected
    ? mapPaymentTerm(selected.term, payment.paymentType)
    : payment.paymentType
  // A selected older Down Payment can belong to a booking whose newest
  // submission is a balance/full payment. Keep the shared helper aware of the
  // booking's DP requirement while still showing the selected record's type.
  const summaryBase =
    selectedPaymentType === "downpayment" && payment.paymentType !== "downpayment"
      ? { ...payment, paymentType: "downpayment" }
      : payment
  // Canonical money ledger / remaining balance — derived from the booking's
  // complete payment history, never from the stored booking fields, so Admin
  // and Client always agree. amountPaid shows ALL valid money received
  // (verified payments + received amounts of incomplete payments).
  const paymentSummary = calculatePaymentSummary(summaryBase, submissions)
  const displayModel = getPaymentDisplayModel(summaryBase, selected, paymentSummary)
  const totalAmount = paymentSummary.totalBookingAmount
  const selectedAmount = selected
    ? getPaymentRecordAmount(selected)
    : getSafePrice(payment.pendingPaymentAmount || payment.paymentAmount || paymentSummary.moneyReceivedTotal)
  const paymentUnderReviewAmount = selected
    ? selectedAmount
    : getSafePrice(payment.pendingPaymentAmount || payment.paymentAmount || 0)
  const remainingBalance = paymentSummary.remainingBalance
  const submissionStatusLabel = selected ? displayModel.statusLabel : getPaymentStatusText(payment)
  const submittedAt = selected?.submittedAt || payment.paymentSubmittedAt || ""
  const isDownpaymentPayment = selectedPaymentType === "downpayment"
  const isPaymentUnderReview = selected
    ? isPendingPaymentRecord(selected)
    : isForReviewPayment(payment)
  const isActionable = selected
    ? isPendingPaymentRecord(selected)
    : isForReviewPayment(payment)
  const isIncompletePayment =
    (selected ? isIncompletePaymentRecord(selected) : false) ||
    String(payment.paymentStatus || "").toLowerCase() === "incomplete" ||
    String(payment.verificationStatus || "").toLowerCase() === "incomplete"
  const displayAmount = selected
    ? displayModel.amount
    : isIncompletePayment
      ? getSafePrice(payment.paymentVerifiedAmount || payment.lastPaymentAmount || 0)
      : selectedAmount
  const displayLabel = selected
    ? displayModel.amountLabel
    : isIncompletePayment
      ? "Amount Received"
      : "Amount Submitted"
  const selectedMethod = selected?.paymentMethod || payment.paymentMethod
  const selectedBankReference = selected?.referenceNo || payment.bankReferenceNumber || payment.referenceNumber || payment.transactionReferenceNumber
  const reviewNote = String(
    selected?.adminNote ||
    selected?.rejectionReason ||
    payment.incompletePaymentNote ||
    payment.incompletePaymentReason ||
    payment.paymentRejectedReason ||
    "",
  ).trim()

  const selectedProof = selected
    ? selected.proofUrl || (selected as any).paymentProof || (selected as any).proofOfPayment || (selected as any).proofImage || (selected as any).receiptImage
    : ""
  const bookingProof = payment.proofUrl || payment.paymentProof || payment.proofOfPayment || payment.proofImage || payment.receiptImage
  const effectiveProof = selected ? selectedProof : bookingProof
  const proofFileName = (selected as any)?.fileName || payment.proofFileName || "Payment proof"
  const hasImageProof = isPaymentProofImage(effectiveProof)
  const hasProof = !!effectiveProof

  const [proofPreviewOpen, setProofPreviewOpen] = useState(false)

  useEffect(() => {
    setProofPreviewOpen(false)
  }, [selected?.id])

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
    // A receipt is shown ONLY when it explicitly belongs to THIS payment:
    // an exact paymentId tie or the pinned exact paymentSubmittedAt written
    // when the transaction receipt was created for this submission. There is
    // NO timestamp-window / nearest-receipt fallback — a payment without its
    // own receipt record must show "No Receipt Record" and must NEVER inherit
    // another payment's receipt.
    const exact = receiptPool.find(
      (receiptEntry) =>
        String(receiptEntry.paymentId || "") === String(selected.id) ||
        (receiptEntry.paymentSubmittedAt && String(receiptEntry.paymentSubmittedAt) === String(selected.submittedAt)),
    )
    return exact || null
  }, [receiptPool, selected, payment.receipt])
  const receiptHasDownpaymentBreakdown = isDownpaymentPayment && Boolean(matchedReceipt || !selected)

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
        getPaymentTypeLabel(selectedPaymentType),
    totalAmount,
    amountPaid: getSafePrice(
      matchedReceipt?.amountPaid ??
        matchedReceipt?.paymentAmount ??
        displayAmount,
    ),
    amountLabel: displayModel.amountLabel,
    acceptedAmountLabel: displayModel.acceptedLabel,
    remainingBalanceLabel: displayModel.remainingLabel,
    remainingBalance: getSafePrice(
      matchedReceipt?.remainingBalance ?? remainingBalance,
    ),
    downpaymentBreakdown: isDownpaymentPayment
      ? {
          totalAmount: paymentSummary.requiredDpAmount,
          totalPaid: paymentSummary.verifiedDownpaymentPaid,
          paymentUnderReview: isPaymentUnderReview ? paymentUnderReviewAmount : null,
          remainingBalance: paymentSummary.remainingDpBalance,
        }
      : undefined,
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

              {/* Individual payment record status — consistent with the
                  selected record's own status shown in the history list.
                  Falls back to the booking's overall status when no
                  individual payment is selected. */}
              {selected ? (
                <PaymentRecordBadge record={selected} />
              ) : (
                <PaymentBadge payment={payment} />
              )}
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
                  const submissionDisplay = getPaymentDisplayModel(summaryBase, submission, paymentSummary)
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
                        {formatCurrency(submissionDisplay.amount)}
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
                              : isVerifiedPaymentRecord(submission)
                                ? "bg-emerald-50 text-emerald-600"
                                : "bg-amber-50 text-amber-600",
                        )}
                      >
                        {isRejectedPaymentRecord(submission) && <XCircle className="h-3 w-3" />}
                        {isVerifiedPaymentRecord(submission) && (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                         {submissionDisplay.statusLabel}
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
              <ModalSection title="Payment Transaction Receipt">
                {matchedReceipt ? (
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 sm:p-4">
                    <ReceiptPaper {...paperData} />
                  </div>
                ) : selected ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
                    <FileText className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                    <p className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">
                      No Receipt Record
                    </p>
                    <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">
                      The database has no transaction receipt for this exact
                      payment (receipt.paymentId = {selected.id || "—"}).
                      Payments submitted before transaction receipts existed
                      may lack one.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 sm:p-4">
                    <ReceiptPaper {...paperData} />
                  </div>
                )}
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
                    <PaymentProofRow
                      proofUrl={String(effectiveProof)}
                      fileName={proofFileName}
                      onPreview={() => setProofPreviewOpen(true)}
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
                    <div className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-amber-200 bg-amber-50 p-5 text-center">
                      <FileText className="mb-2 h-8 w-8 text-amber-400" />
                      <p className="text-sm font-black text-amber-900">Unsupported proof format</p>
                      <p className="mt-1 text-xs leading-5 text-amber-700">
                        Payment proof must be a JPG, JPEG, PNG, or WEBP image.
                      </p>
                    </div>
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
                      {getPaymentTypeLabel(selectedPaymentType)}
                    </p>
                  </div>
              </ModalSection>

              <ModalSection title="Payment Details">
                <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <InfoLine label="Payment Method" value={getPaymentMethodLabel(selectedMethod)} />
                  {selectedMethod === "bank" && (
                    <InfoLine label="Bank Reference No." value={String(selectedBankReference || "No reference number")} />
                  )}
                  <InfoLine label="Payment Type" value={getPaymentTypeLabel(selectedPaymentType)} />
                    <InfoLine label="Total Booking Amount" value={formatCurrency(paymentSummary.totalBookingAmount)} />
                    {isDownpaymentPayment && !receiptHasDownpaymentBreakdown ? (
                      <>
                      <InfoLine label="Total DP Amount" value={formatCurrency(paymentSummary.requiredDpAmount)} />
                      <InfoLine label={displayModel.acceptedLabel} value={formatCurrency(displayModel.acceptedAmount)} />
                      {isPaymentUnderReview && (
                        <InfoLine
                          label="Payment Under Review"
                          value={formatCurrency(paymentUnderReviewAmount)}
                          valueClassName="text-orange-600"
                        />
                      )}
                      <InfoLine
                        label={displayModel.remainingLabel}
                        value={formatCurrency(displayModel.remainingAmount)}
                      />
                   </>
                  ) : null}
                   <InfoLine label={displayLabel} value={formatCurrency(displayAmount)} />
                   <InfoLine label={displayModel.acceptedLabel} value={formatCurrency(displayModel.acceptedAmount)} />
                   <InfoLine label={displayModel.remainingLabel} value={formatCurrency(displayModel.remainingAmount)} />
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
              {reviewNote && (
                <ModalSection title="Review Note">
                  <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                    <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-amber-950">
                      {reviewNote}
                    </p>
                  </div>
                </ModalSection>
              )}
            </div>
          </div>
      </div>

      <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-5">
        {isActionable ? (
          // ALL THREE decisions are always available for a payment that is
          // FOR REVIEW, regardless of payment method (bank or cash/onsite).
          // Actions apply to the SELECTED PAYMENT RECORD only — the booking's
          // overall status never hides them.
          <div className="grid gap-3 sm:grid-cols-3">
            <Button
              onClick={() => onAction("reject", selected)}
              variant="outline"
              className="h-11 rounded-xl border-rose-200 text-sm font-black text-rose-500 hover:bg-rose-50"
            >
              Reject Payment
            </Button>

            <Button
              onClick={() => onAction("incomplete", selected)}
              variant="outline"
              className="h-11 rounded-xl border-amber-200 text-sm font-black text-amber-600 hover:bg-amber-50"
            >
              Mark as Incomplete
            </Button>

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

      <PaymentProofPreview
        open={proofPreviewOpen && hasImageProof}
        onOpenChange={setProofPreviewOpen}
        proofUrl={String(effectiveProof || "")}
        fileName={proofFileName}
      />
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
  const submissions = Array.isArray(payment?.incomingPayments)
    ? payment.incomingPayments
    : []
  const paymentSummary = calculatePaymentSummary(payment, submissions)
  const hasRecordHistory = submissions.length > 0
  const paymentStatus = hasRecordHistory
    ? paymentSummary.overallStatus
    : String(payment?.paymentStatus || "").toLowerCase()
  const totalAmount = paymentSummary.bookingTotal
  const amountPaid = paymentSummary.moneyReceivedTotal
  const remainingBalance = paymentSummary.remainingBalance
  const baseClass = "inline-flex items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap"

  // Canonical: the badge renders EXACTLY the same overall status that the
  // status filter matches (payment.paymentStatus, set by getOverallPaymentStatus
  // from the complete payment history). No latest-payment / payment-record /
  // receipt / stored-field signals are consulted here, so a verified booking
  // with older incomplete/rejected attempts can never be shown as such.
  // Order follows the canonical priority: completed → partial → for_review →
  // rejected → incomplete.
  if (paymentStatus === "completed") {
    return <span className={`${baseClass} border-emerald-100 bg-emerald-50 text-emerald-700`}><CheckCircle2 className="h-3 w-3" />Fully Paid</span>
  }

  if (paymentStatus === "partial") {
    return <span className={`${baseClass} border-amber-100 bg-amber-50 text-amber-700`}><AlertCircle className="h-3 w-3" />Partial Payment</span>
  }

  if (paymentStatus === "for_review") {
    return <span className={`${baseClass} border-amber-100 bg-amber-50 text-amber-700`}><ShieldCheck className="h-3 w-3" />For Review</span>
  }

  if (paymentStatus === "rejected") {
    return <span className={`${baseClass} border-rose-100 bg-rose-50 text-rose-700`}><XCircle className="h-3 w-3" />Rejected</span>
  }

  if (paymentStatus === "incomplete") {
    return <span className={`${baseClass} border-amber-100 bg-amber-50 text-amber-700`}><AlertCircle className="h-3 w-3" />Incomplete Payment</span>
  }

  // Legacy-only fallbacks (bookings without payment records whose stored
  // fields were never canonicalized to one of the five overall statuses).
  const isRemainingZero = remainingBalance === 0
  const isAmountSufficient = totalAmount > 0 && amountPaid >= totalAmount

  if (paymentStatus === "paid" && isRemainingZero && isAmountSufficient) {
    return <span className={`${baseClass} border-emerald-100 bg-emerald-50 text-emerald-700`}><CheckCircle2 className="h-3 w-3" />Fully Paid</span>
  }

  if (amountPaid === 0) {
    return <span className={`${baseClass} border-slate-200 bg-slate-50 text-slate-700`}>Unpaid</span>
  }

  return <span className={`${baseClass} border-slate-200 bg-slate-50 text-slate-700`}>{paymentStatus || "Unknown"}</span>
}

/** Individual payment record badge — shows the status of a SINGLE payment
 *  record (Verified / Rejected / Incomplete / For Review), consistent with
 *  the status shown in the payment history list. */
function PaymentRecordBadge({ record }: { record: PaymentRecord }) {
  const baseClass = "inline-flex items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap"
  const label = getPaymentRecordStatusLabel(record)

  if (isRejectedPaymentRecord(record)) {
    return <span className={`${baseClass} border-rose-100 bg-rose-50 text-rose-700`}><XCircle className="h-3 w-3" />{label}</span>
  }
  if (isIncompletePaymentRecord(record)) {
    return <span className={`${baseClass} border-amber-100 bg-amber-50 text-amber-700`}><AlertCircle className="h-3 w-3" />{label}</span>
  }
  if (isVerifiedPaymentRecord(record)) {
    return <span className={`${baseClass} border-emerald-100 bg-emerald-50 text-emerald-700`}><CheckCircle2 className="h-3 w-3" />{label}</span>
  }
  // Pending / For Review
  return <span className={`${baseClass} border-amber-100 bg-amber-50 text-amber-700`}><ShieldCheck className="h-3 w-3" />{label}</span>
}

function InfoLine({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200/70 pb-3 last:border-b-0 last:pb-0">
      <p className="text-xs font-bold text-slate-500 shrink-0">{label}</p>
      <p className={cn("text-right text-xs font-black text-slate-900 break-words min-w-0", valueClassName)}>{value}</p>
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
  if (type === "downpayment") return "Down Payment"
  if (type === "remaining_balance") return "Remaining Balance"
  if (type === "slot_reservation") return "Slot Reservation Only"
  return "Payment Type"
}

function getPaymentTime(value?: string | number | Date | null) {
  if (!value) return 0
  const time = new Date(String(value)).getTime()
  return Number.isFinite(time) ? time : 0
}

function mapPaymentTerm(term?: string, fallback?: string) {
  const normalized = String(term || "").toLowerCase()
  if (normalized.includes("down payment") || normalized.includes("downpayment")) return "downpayment"
  if (normalized.includes("remaining") || normalized.includes("balance") || normalized.includes("settle")) return "remaining_balance"
  if (normalized.includes("full")) return "full"
  if (normalized.includes("slot")) return "slot_reservation"
  return fallback || "full"
}

// Cache for receipt-matching results so an unchanged payment is not re-scanned
// on every render. Keyed by the payment id plus a signature of the receipt
// pool; a new/changed receipt produces a new key and re-computes normally.
const matchingReceiptCache = new Map<string, boolean>()
// Payments already reported as "pending with a matching receipt". The
// diagnostic is emitted at most ONCE per payment id — never per render and
// never again across page loads (persisted in localStorage), because the
// existence of a receipt is informational only and performs NO status change.
const warnedMatchingReceiptPaymentIds = new Set<string>()
const MATCHING_RECEIPT_WARNED_KEY = "nyerk:warnedMatchingReceiptPayments"
const MATCHING_RECEIPT_WARNED_CAP = 1000

function reportMatchingReceiptDiagnostic(record: PaymentRecord) {
  const paymentId = record.id || ""
  if (warnedMatchingReceiptPaymentIds.has(paymentId)) return
  warnedMatchingReceiptPaymentIds.add(paymentId)
  try {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(MATCHING_RECEIPT_WARNED_KEY)
      const warned: string[] = stored ? (JSON.parse(stored) as string[]) : []
      if (warned.includes(paymentId)) return
      warned.push(paymentId)
      if (warned.length > MATCHING_RECEIPT_WARNED_CAP) {
        warned.splice(0, warned.length - MATCHING_RECEIPT_WARNED_CAP)
      }
      window.localStorage.setItem(MATCHING_RECEIPT_WARNED_KEY, JSON.stringify(warned))
    }
  } catch {
    // storage unavailable — the in-memory Set still dedupes this session
  }
  console.warn(
    "[PAYMENT] INFO — pending payment has a matching receipt; the receipt is informational only and NO status change is performed. The payment remains FOR REVIEW until Admin clicks Verify Payment.",
    {
      paymentId,
      currentStatus: record.status || record.verificationStatus || "for_review",
      receiptMatched: true,
      autoVerified: false,
      source: "hasMatchingReceipt",
    },
  )
}

function hasMatchingReceipt(record: PaymentRecord | null | undefined, receipts?: any[]) {
  if (!record || !Array.isArray(receipts) || receipts.length === 0) return false
  const target = String(record.submittedAt || "")
  if (!target) return false
  // A receipt only counts as matching when it was explicitly generated for
  // THIS payment submission (exact same submittedAt timestamp). Receipts that
  // belong to other payments (e.g. Payment #1's receipt) must NEVER mark this
  // payment (Payment #2) as verified — each payment is an independent record
  // awaiting its own admin verification. Matching is informational only.
  const cacheKey = `${record.id}|${receipts
    .map((r) => `${r.receiptNumber || r.id || ""}:${r.paymentSubmittedAt || ""}`)
    .sort()
    .join(",")}`
  const cached = matchingReceiptCache.get(cacheKey)
  if (cached !== undefined) return cached
  const exact = receipts.some(
    (r) => r.paymentSubmittedAt && String(r.paymentSubmittedAt) === target,
  )
  matchingReceiptCache.set(cacheKey, exact)
  if (exact && isPendingPaymentRecord(record)) {
    reportMatchingReceiptDiagnostic(record)
  }
  return exact
}

function mapRecordStatus(record: PaymentRecord | null | undefined, base: BookingRecord, _receipts?: any[]) {
  if (isRejectedPaymentRecord(record)) return "rejected"
  if (isIncompletePaymentRecord(record)) return "incomplete"
  if (isVerifiedPaymentRecord(record)) return "verified"
  if (isPendingPaymentRecord(record)) return "for_review"
  return String(base.paymentStatus || (isVerifiedPayment(base) ? "verified" : "for_review"))
}

// Keep the helper above available for callers that need a single record's
// status, but the PAYMENT BADGE always renders the booking's canonical OVERALL
// status (payment.paymentStatus, set by getOverallPaymentStatus).

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
  const proof = latest.proofUrl || (submissions.length === 1 ? base.proofUrl || base.paymentProof : "")
  const receipts = Array.isArray(base.paymentReceipts)
    ? base.paymentReceipts
    : base.receipt
      ? [base.receipt]
      : []
  const hasAnyPendingSubmission = submissions.some((record) => isUnresolvedPaymentRecord(record, receipts))
  const paymentSummary = calculatePaymentSummary(base, submissions)

  return {
    ...base,
    id: bookingId,
    bookingId,
    bookingCode: base.bookingCode ?? latest.bookingCode,
    incomingPayments: submissions,
    paymentCount: submissions.length,
    latestPayment: latest,
    // Raw paymentStatus as stored on the booking document BEFORE canonical
    // derivation — debug/diagnostics only, never rendered.
    storedPaymentStatus: base.paymentStatus,
    paymentRecordId: latest.id,
    userInfo: base.userInfo || (latest.customerName ? { name: latest.customerName, email: "", phone: "" } : undefined),
    eventName: base.eventName || latest.eventName || "",
    venue: base.venue || latest.venueName || "",
    venueName: base.venueName || latest.venueName || "",
    paymentMethod: method,
    actualPaymentMethod: latest.method || base.actualPaymentMethod,
    paymentType: mapPaymentTerm(latest.term, base.paymentType),
     paymentStatus: paymentSummary.overallStatus,
     amountPaid: paymentSummary.moneyReceivedTotal,
     remainingBalance: paymentSummary.remainingBalance,
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
     // A payment record is not a booking-price source. If the booking document
     // is unavailable, show an unknown total rather than turning the submitted
     // amount into a fabricated booking total.
     totalPrice: base.totalPrice || base.totalAmount || 0,
    createdAt: base.createdAt || latest.submittedAt,
    updatedAt: latest.updatedAt || base.updatedAt,
    paymentReceipts: base.paymentReceipts,
     status: normalizeBookingLifecycleStatus(
       base.status || (isPendingPaymentRecord(latest) ? "pending" : "confirmed"),
     ),
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
  switch (ps) {
    case "completed":
      return "Fully Paid"
    case "partial":
      return "Partial Payment"
    case "for_review":
      return "For Review"
    case "rejected":
      return "Rejected"
    case "incomplete":
      return "Incomplete Payment"
  }
  // Legacy stored-field fallback (bookings without payment records). A
  // "verified"/"paid" raw value is never mapped to "Incomplete Payment" here —
  // the booking's overall status always comes from the canonical summary.
  const totalAmount = getSafePrice(
    (payment as any).totalAmount || payment.totalPrice || (payment as any).amount || (payment as any).price,
  )
  const amountPaid = getSafePrice(
    (payment as any).amountPaid || (payment as any).paymentAmount || (payment as any).paidAmount,
  )
  if (ps === "paid" && totalAmount > 0 && amountPaid >= totalAmount) return "Fully Paid"
  if (amountPaid > 0 && amountPaid < totalAmount) return "Partial Payment"
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
      status: officeFullyPaid ? "reservation_secured" : "pending",
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
    const dpComplete = newDownpaymentPaid >= selectedDP
    let paymentStatus = "partial"
    let balanceStatus = "With Remaining Balance"
    let remainingBalance = Math.max(totalAmount - newAmountPaid, 0)
    let downpaymentRemaining = Math.max(selectedDP - newDownpaymentPaid, 0)
    let status = dpComplete ? "confirmed" : "pending"

    if (newAmountPaid >= totalAmount) {
      paymentStatus = "paid"
      balanceStatus = "Settled"
      remainingBalance = 0
      downpaymentRemaining = 0
    } else if (dpComplete) {
      downpaymentRemaining = 0
    }

    return {
      ...booking,
      status,
      bookingStatus: dpComplete ? "Confirmed" : "Pending Verification",
      paymentStatus,
      balanceStatus,
      isSlotSecured: dpComplete,
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

function buildIncompletePaymentBooking(booking: BookingRecord, note: string, _verifiedAmount?: number) {
  const total = getAmountValue(booking.totalAmount || booking.totalPrice || booking.amount || booking.price)
  const currentPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0
  const remaining = Math.max(total - currentPaid, 0)
  const isDownpayment = String(booking.paymentType || "").toLowerCase() === "downpayment"
  const currentDpPaid = getAmountValue(booking.downpaymentPaid)
  const selectedDP = getAmountValue(booking.selectedDownpaymentAmount) || (isDownpayment ? total * (Number(booking.downPaymentPercentage || 50) / 100) : 0)
  const dpRemaining = isDownpayment ? Math.max(selectedDP - currentDpPaid, 0) : 0
  const office = isOfficeRental(booking)
  const isFullyPaidAfter = total > 0 && currentPaid >= total
  const hasPriorVerifiedPayment = currentPaid > 0

  return {
    ...booking,
    status: office
      ? (isFullyPaidAfter ? "reservation_secured" : (hasPriorVerifiedPayment ? booking.status : "pending"))
      : (isFullyPaidAfter ? "confirmed" : (hasPriorVerifiedPayment ? booking.status : "pending")),
    bookingStatus: office
      ? (isFullyPaidAfter ? "Slot Secured" : (hasPriorVerifiedPayment ? booking.bookingStatus : "Pending Verification"))
      : (isFullyPaidAfter ? "Confirmed" : (hasPriorVerifiedPayment ? booking.bookingStatus : "Pending Verification")),
    paymentStatus: isFullyPaidAfter ? "paid" : "incomplete",
    isSlotSecured: isFullyPaidAfter || (hasPriorVerifiedPayment ? booking.isSlotSecured === true : false),
    amountPaid: currentPaid,
    downpaymentPaid: currentDpPaid,
    downpaymentRemaining: dpRemaining,
    lastPaymentAmount: _verifiedAmount || booking.lastPaymentAmount,
    remainingBalance: isDownpayment ? dpRemaining : remaining,
    balanceStatus: isFullyPaidAfter ? "Settled" : "With Remaining Balance",
    incompletePaymentNote: note,
    incompletePaymentReason: note,
    incompletePaymentAt: new Date().toISOString(),
    hasActivePaymentSubmission: false,
    updatedAt: new Date().toISOString(),
    adminLogs: appendAdminLog(booking, "PAYMENT_INCOMPLETE", `Admin marked payment as incomplete. Note: ${note}${_verifiedAmount ? `. Verified amount received: ₱${_verifiedAmount.toLocaleString()}.` : ""}`),
  }
}

function IncompletePaymentModal({
  booking,
  paymentRecords,
  onClose,
  onConfirm,
}: {
  booking: BookingRecord | null
  paymentRecords?: PaymentRecordLike[] | null
  onClose: () => void
  onConfirm: (updated: BookingRecord) => void | Promise<void>
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

  const records = paymentRecords || []
  const summary = calculatePaymentSummary(booking as unknown as Parameters<typeof calculatePaymentSummary>[0], records)

  const currentAmountPaid = typeof (booking as any).amountPaid === "number" ? (booking as any).amountPaid : 0
  const currentDownpaymentPaid = getAmountValue(booking.downpaymentPaid)

  const submissionAmount = (booking as any).submissionAmount || booking.paymentAmount || 0
  const expectedAmount = submissionAmount > 0 ? submissionAmount : (isDownpayment ? summary.remainingDownpayment : summary.remainingBalance)
  const enteredAmount = getAmountValue(verifiedAmount)
  const remainingAfterInput = Math.max(expectedAmount - enteredAmount, 0)
  const isEmpty = verifiedAmount.trim() === ""
  const isZeroOrNegative = enteredAmount <= 0
  const isEqualOrOver = enteredAmount >= expectedAmount
  const isValidIncompleteAmount = !isEmpty && enteredAmount > 0 && enteredAmount < expectedAmount

  const handleConfirm = () => {
    if (enteredAmount <= 0) return

    const hasPriorVerifiedPayment = currentAmountPaid > 0
    const latestStatus = isDownpayment
      ? "pending"
      : (office
        ? (hasPriorVerifiedPayment ? booking.status : "pending")
        : (hasPriorVerifiedPayment ? "confirmed" : "pending"))
    const latestBookingStatus = isDownpayment
      ? "Pending Verification"
      : (office
        ? (hasPriorVerifiedPayment ? booking.bookingStatus : "Pending Verification")
        : (hasPriorVerifiedPayment ? "Confirmed" : "Pending Verification"))

    const updatedBooking: BookingRecord = {
      ...booking,
      status: latestStatus,
      bookingStatus: latestBookingStatus,
      isSlotSecured: hasPriorVerifiedPayment ? (booking.isSlotSecured === true) : false,
      amountPaid: currentAmountPaid,
      paidAmount: office ? enteredAmount : undefined,
      downpaymentPaid: currentDownpaymentPaid,
      downpaymentRemaining: summary.remainingDownpayment,
      selectedDownpaymentAmount: isDownpayment ? (getAmountValue(booking.selectedDownpaymentAmount) || (isDownpayment ? totalAmount * (Number(booking.downPaymentPercentage || 50) / 100) : 0)) : 0,
      lastPaymentAmount: enteredAmount,
      paymentStatus: "incomplete",
      remainingBalance: summary.remainingBalance,
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
        `Admin recorded incomplete payment. Amount received: ₱${enteredAmount.toLocaleString()}.${isDownpayment ? ` Downpayment remaining: ₱${summary.remainingDownpayment.toLocaleString()}.` : ` Remaining: ₱${summary.remainingBalance.toLocaleString()}.`} Note: ${adminReason.trim() || "N/A"}.`
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
                    <span className="font-bold text-amber-700">₱{(isDownpayment ? summary.remainingDownpayment : summary.remainingBalance).toLocaleString()}</span>
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
  paymentRecords,
  onClose,
  onConfirm,
}: {
  booking: BookingRecord | null
  // THIS booking's complete payment-record history. All displayed amounts
  // derive from the canonical credited ledger so previously submitted
  // INCOMPLETE money is always respected.
  paymentRecords?: PaymentRecordLike[] | null
  onClose: () => void
  onConfirm: (updated: BookingRecord, adminNote: string) => void | Promise<void>
}) {
  const [amountReceived, setAmountReceived] = useState("")
  const [adminNote, setAdminNote] = useState("")
  const [confirmStep, setConfirmStep] = useState(false)

  useEffect(() => {
    if (booking) {
      // CANONICAL CREDITED LEDGER — money already received for THIS booking
      // across its complete history: verified payments plus the received
      // amounts of short (INCOMPLETE) payments. The pending onsite record
      // being verified credits ₱0 until admin verifies it, so it never
      // double-counts here.
      const records = paymentRecords || []
      const summary = calculatePaymentSummary(booking as unknown as Parameters<typeof calculatePaymentSummary>[0], records)
      const outstanding = summary.remainingBookingBalance
      // Prefill the amount needed for the CURRENT stage: the remaining
      // downpayment while it is still incomplete, otherwise the booking's
      // true outstanding balance. Admin can always edit the value.
      const suggested =
        summary.requiredDownpayment > 0 && summary.remainingDownpayment > 0
          ? summary.remainingDownpayment
          : outstanding
      setAmountReceived(suggested > 0 ? String(suggested) : "")
      setAdminNote("")
      setConfirmStep(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking])

  if (!booking) return null

  // Same canonical ledger for every displayed/derived figure below.
  const records = paymentRecords || []
  const summary = calculatePaymentSummary(booking as unknown as Parameters<typeof calculatePaymentSummary>[0], records)
  const totalAmount = summary.totalBookingAmount
  const previouslySubmitted = summary.acceptedTotalPaid
  const currentPaymentAmount = getSafePrice(
    (booking as any).pendingPaymentAmount ||
      (booking as any).paymentAmount ||
      (booking as any).submissionAmount ||
      (booking as any).lastPaymentAmount ||
      0,
  )
  const remainingBefore = Math.max(totalAmount - previouslySubmitted, 0)
  const enteredAmount = getAmountValue(amountReceived)
  const newAmountPaid = previouslySubmitted + enteredAmount
  const newRemainingBalance = Math.max(totalAmount - newAmountPaid, 0)
  const isOverPayment = enteredAmount > remainingBefore
  const isDownpayment = String(booking.paymentType || "").toLowerCase() === "downpayment"
  const selectedDP = getAmountValue(booking.selectedDownpaymentAmount) || (isDownpayment ? totalAmount * (Number(booking.downPaymentPercentage || 50) / 100) : 0)
  const dpRemainingAfter = isDownpayment
    ? Math.max(selectedDP - newAmountPaid, 0)
    : 0
  const dpCompleteAfter = !isDownpayment || dpRemainingAfter <= 0

  const isFullyPaidAfter = newAmountPaid >= totalAmount

  const handleConfirm = () => {
    if (enteredAmount <= 0) return

    const office = isOfficeRental(booking)
    const nextStatus = office
      ? (isFullyPaidAfter ? "reservation_secured" : "verifying")
      : (isDownpayment ? (dpCompleteAfter ? "confirmed" : "verifying") : "confirmed")
    const nextBookingStatus = office
      ? (isFullyPaidAfter ? "Slot Secured" : "Pending Verification")
      : (isDownpayment ? (dpCompleteAfter ? "Confirmed" : "Pending Verification") : "Confirmed")
    // Credited-ledger mirror: the money held for this booking after this
    // verification, attributed to the downpayment while that stage is open.
    const newDownpaymentPaid = isDownpayment ? Math.min(newAmountPaid, selectedDP) : 0
    const newDPRemaining = dpRemainingAfter

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
      paymentStatus: isFullyPaidAfter ? "paid" : (!isDownpayment || dpCompleteAfter) ? "partial" : "incomplete",
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

    onConfirm(updatedBooking, adminNote.trim())
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
                  {/* Canonical credited ledger — includes verified payments AND
                      received amounts of previously INCOMPLETE payments. */}
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Previously Submitted</span>
                    <span className="font-bold text-slate-900">₱{previouslySubmitted.toLocaleString()}</span>
                  </p>
                  <p className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-400">Current Payment</span>
                    <span className="font-bold text-slate-900">₱{currentPaymentAmount.toLocaleString()}</span>
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
                    <>
                      {isDownpayment && (
                        <p className="mt-1.5 text-[11px] font-semibold text-emerald-700">
                          Downpayment remaining after this: ₱{dpRemainingAfter.toLocaleString()}
                        </p>
                      )}
                      <p className="mt-1.5 text-[11px] font-semibold text-emerald-700">
                        Remaining balance after this: ₱{newRemainingBalance.toLocaleString()}
                      </p>
                    </>
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
                    <span className="font-bold text-emerald-700">
                      {isFullyPaidAfter
                        ? "Fully Paid"
                        : dpCompleteAfter
                          ? "Partial Payment"
                          : "Incomplete Payment"}
                    </span>
                  </p>
                  {isDownpayment && enteredAmount > 0 && (
                    <p className="flex justify-between text-xs">
                      <span className="font-semibold text-slate-400">Downpayment Remaining</span>
                      <span className="font-bold text-emerald-700">₱{dpRemainingAfter.toLocaleString()}</span>
                    </p>
                  )}
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
