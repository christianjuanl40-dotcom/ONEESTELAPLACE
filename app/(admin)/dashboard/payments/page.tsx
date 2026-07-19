"use client"

import type React from "react"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  Eye,
  FileImage,
  FileText,
  Filter,
  Inbox,
  Receipt,
  Search,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react"

import { useAuth } from "@/src/modules/shared/auth/auth-context"
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
import { useBookings } from "@/src/modules/client/contexts/booking-context"
import { db } from "@/lib/firebase"
import { collection, query, orderBy, getDocs, addDoc, where } from "firebase/firestore"

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
} | null

export default function AdminPaymentsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { toast } = useToast()
  const bookingCtx = useBookings()

  useEffect(() => {
    if (user && user.role === "staff" && !user.permissions?.payments) {
      router.replace("/dashboard")
    }
  }, [user, router])
  const [paymentRecords, setPaymentRecords] = useState<any[]>([])
  const [statusFilter, setStatusFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [venueFilter, setVenueFilter] = useState("all")
  const [selectedPayment, setSelectedPayment] = useState<BookingRecord | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingPaymentAction>(null)
  const [actionNote, setActionNote] = useState("")
  const [incompletePaymentTarget, setIncompletePaymentTarget] = useState<BookingRecord | null>(null)
  const [onsiteVerifyTarget, setOnsiteVerifyTarget] = useState<BookingRecord | null>(null)
  const [paymentPage, setPaymentPage] = useState(1)
  const PAYMENTS_PER_PAGE = 10

  useEffect(() => {
    if (!selectedPayment) return
    const found = bookingCtx.bookings.find((b: any) => b.id === selectedPayment.id)
    if (found && found !== selectedPayment) {
      setSelectedPayment(found)
    }
  }, [bookingCtx.bookings, selectedPayment?.id])

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

  useEffect(() => {
    const loadPaymentRecords = async () => {
      try {
        const q = query(collection(db, "paymentProofs"), orderBy("submittedAt", "desc"))
        const snapshot = await getDocs(q)
        const records: any[] = []
        snapshot.forEach((docSnap) => {
          const d = docSnap.data()
          records.push({ id: docSnap.id, ...d })
        })
        setPaymentRecords(records)
      } catch {
        // ignore
      }
    }

    loadPaymentRecords()
  }, [])

  const paymentBookings = useMemo(() => {
    const bookingRecords = (bookingCtx.bookings || []).filter((booking) => isPaymentRecord(booking))

    const paymentRecordsAsBookings = paymentRecords.map((pr: any) => ({
      id: pr.bookingId || pr.id,
      bookingId: pr.bookingId,
      bookingCode: pr.bookingCode,
      userInfo: undefined,
      eventName: pr.eventName || "",
      venue: pr.venueName || "",
      venueName: pr.venueName || "",
      paymentMethod: pr.paymentMethod === "bank" ? "bank" : pr.paymentMethod === "cash" ? "cash" : pr.method,
      actualPaymentMethod: pr.method,
      paymentType: pr.term === "Down Payment" ? "downpayment" : pr.term === "Full Payment" ? "full" : "slot_reservation",
      paymentStatus: pr.verificationStatus === "Pending" || pr.status === "For Verification" ? "for_review" : "verified",
      hasActivePaymentSubmission: true,
      paymentSubmittedAt: pr.submittedAt,
      paymentAmount: pr.amount,
      pendingPaymentAmount: pr.amount,
      amountPaid: pr.amountPaid,
      proofUrl: pr.proofUrl,
      bankReferenceNumber: pr.referenceNo,
      paymentReference: pr.referenceNo,
      paymentSubmissionType: pr.paymentMethod === "cash" ? "onsite" : "bank_transfer",
      isSlotSecured: false,
      verifiedByAdmin: false,
      status: pr.status === "For Verification" ? "verifying" : "pending",
      totalPrice: pr.amount,
      updatedAt: pr.updatedAt,
      createdAt: pr.submittedAt,
      latestPaymentMethod: pr.method,
      latestPaymentAmount: pr.amount,
      latestPaymentSubmittedAt: pr.submittedAt,
    }))

    const merged = [...bookingRecords, ...paymentRecordsAsBookings]
    const seen = new Set<string>()
    const allPaymentRecords = paymentRecords
    const deduped = merged.filter((item) => {
      const key = item.id || ""
      if (seen.has(key)) return false
      seen.add(key)

      const matchingPayment = allPaymentRecords.find(
        (pr: any) => (pr.bookingId === key || pr.id === key) && pr.proofUrl
      )

      if (matchingPayment && !item.proofUrl) {
        item.proofUrl = matchingPayment.proofUrl
      }

      const totalFromPaymentRecords = allPaymentRecords
        .filter((pr: any) => pr.bookingId === key || pr.id === key)
        .reduce((sum: number, pr: any) => sum + getSafePrice(pr.amountPaid || pr.amount), 0)

      if (getSafePrice(item.amountPaid) === 0 && totalFromPaymentRecords > 0) {
        item.amountPaid = totalFromPaymentRecords
      }

      return true
    })

    return deduped.sort((a, b) => {
      const getSortTime = (record: BookingRecord) => {
        const t = record?.lastActivityAt || record?.paymentSubmittedAt || record?.updatedAt || record?.createdAt || record?.bookingDate
        if (!t) return 0
        const d = new Date(t).getTime()
        return isNaN(d) ? 0 : d
      }
      return getSortTime(b) - getSortTime(a)
    })
  }, [bookingCtx.bookings, paymentRecords])

  const filteredPayments = useMemo(() => {
    return paymentBookings.filter((booking) => {
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

  const openActionModal = (payment: BookingRecord, type: PaymentAction) => {
    if (type === "incomplete") {
      setIncompletePaymentTarget(payment)
      return
    }
    if (type === "verify" && payment.paymentMethod === "cash") {
      setOnsiteVerifyTarget(payment)
      return
    }
    setPendingAction({ payment, type })
    setActionNote("")
  }

  const closeActionModal = () => {
    setPendingAction(null)
    setActionNote("")
  }

  const handleConfirmPaymentAction = async () => {
    if (!pendingAction) return

    const { payment, type } = pendingAction
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
        bookingCtx.verifyPayment(bookingId, { adminNote: note || undefined, adminName: reviewerName })
      } else if (type === "reject") {
        bookingCtx.rejectPayment(bookingId, note, reviewerName)
      } else if (type === "incomplete") {
        bookingCtx.markIncompletePayment(bookingId, { verifiedAmount: 0, adminNote: note, adminName: reviewerName })
      }

      let updatedBooking: BookingRecord
      if (type === "verify") {
        updatedBooking = buildVerifiedPaymentBooking(payment)
      } else if (type === "reject") {
        updatedBooking = buildRejectedPaymentBooking(payment, note)
      } else {
        updatedBooking = buildIncompletePaymentBooking(payment, note, 0)
      }
      if (updatedBooking && !updatedBooking.proofUrl) {
        const matchingPayment = paymentRecords.find(
          (pr: any) => updatedBooking && (pr.bookingId === updatedBooking.id || pr.id === updatedBooking.id) && pr.proofUrl
        )
        if (matchingPayment) {
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
            bookingCtx.verifyPayment(updatedBooking.id, {
              verifiedAmount: updatedBooking.lastPaymentAmount || updatedBooking.paymentVerifiedAmount,
              adminNote: updatedBooking.adminLogs?.[updatedBooking.adminLogs.length - 1]?.message || undefined,
              adminName: user?.name || "Administrator",
            })
            let updated = updatedBooking
            if (!updated.proofUrl) {
              const matchingPayment = paymentRecords.find(
                (pr: any) => updated && (pr.bookingId === updated.id || pr.id === updated.id) && pr.proofUrl
              )
              if (matchingPayment) {
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
            bookingCtx.markIncompletePayment(updatedBooking.id, {
              verifiedAmount: updatedBooking.lastPaymentAmount || updatedBooking.paymentVerifiedAmount || 0,
              adminNote: updatedBooking.incompletePaymentNote || updatedBooking.incompletePaymentReason || "",
              adminName: user?.name || "Administrator",
            })
            let updated = updatedBooking
            if (!updated.proofUrl) {
              const matchingPayment = paymentRecords.find(
                (pr: any) => updated && (pr.bookingId === updated.id || pr.id === updated.id) && pr.proofUrl
              )
              if (matchingPayment) {
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
        <section className="border-b border-slate-200 pb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-orange-600">
                Admin Payment Verification
              </p>

              <h1 className="mt-1 text-2xl font-black leading-tight tracking-tight text-slate-950 md:text-3xl">
                Payment Verification
              </h1>

              <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">
                Review client payment submissions. All payment actions require confirmation before updating LocalStorage.
              </p>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
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
          </div>
        </section>

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
                  onView={() => setSelectedPayment(payment)}
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
          <DialogContent aria-describedby={undefined} showCloseButton={false} className="w-[95vw] sm:max-w-2xl max-h-[90dvh] overflow-hidden rounded-3xl bg-white shadow-2xl">
            {selectedPayment && (
              <PaymentReviewModal
                payment={selectedPayment}
                onClose={() => setSelectedPayment(null)}
                onAction={(type) => openActionModal(selectedPayment, type)}
                childModalOpen={!!pendingAction || !!incompletePaymentTarget || !!onsiteVerifyTarget}
                paymentRecords={paymentRecords}
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
}: {
  payment: BookingRecord
  amountPaid: number
  onView: () => void
}) {
  return (
      <div className="group grid w-full max-w-full min-w-0 grid-cols-[1fr_1fr] gap-x-5 gap-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange-200 hover:shadow-md sm:grid-cols-[220px_220px_240px_200px] sm:items-center sm:gap-x-6">
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
          <PaymentBadge payment={payment} />
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
  paymentRecords,
}: {
  payment: BookingRecord
  onClose: () => void
  onAction: (type: PaymentAction) => void
  childModalOpen?: boolean
  paymentRecords?: any[]
}) {
  const totalAmount = getSafePrice(payment.totalPrice)
  const amountPaid = getAmountPaid(payment)
  const transactionAmount = getSafePrice(payment.pendingPaymentAmount || payment.paymentAmount || amountPaid)
  const remainingBalance = Math.max(totalAmount - amountPaid, 0)
  const dpTarget = getSafePrice(payment.selectedDownpaymentAmount) || (payment.paymentType === "downpayment" ? totalAmount * 0.5 : 0)
  const acceptedDPPaid = getSafePrice(payment.downpaymentPaid)
  const thisSubmission = getSafePrice(payment.pendingPaymentAmount || payment.paymentAmount)
  const isActionable = isForReviewPayment(payment)
  const isIncompletePayment =
    String(payment.paymentStatus || "").toLowerCase() === "incomplete" ||
    String(payment.verificationStatus || "").toLowerCase() === "incomplete"
  const displayAmount = isIncompletePayment
    ? getSafePrice(payment.paymentVerifiedAmount || payment.lastPaymentAmount || 0)
    : transactionAmount
  const displayLabel = isIncompletePayment ? "Amount Received" : "Amount Submitted"

  const paymentRecordProof = useMemo(() => {
    if (payment.proofUrl) return null
    if (!paymentRecords?.length) return null
    const key = payment.id || payment.bookingId || ""
    const match = paymentRecords.find(
      (pr: any) => (pr.bookingId === key || pr.id === key) && pr.proofUrl
    )
    return match?.proofUrl || null
  }, [payment, paymentRecords])

  const effectiveProof = payment.proofUrl || payment.paymentProof || payment.proofOfPayment || payment.proofImage || payment.receiptImage || paymentRecordProof
  const hasImageProof = isImageProof(effectiveProof)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-slate-100 px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                {payment.id || "No ID"}
              </span>

              <PaymentBadge payment={payment} />
            </div>

            <DialogTitle className="break-words text-xl font-black leading-tight text-slate-950 sm:text-2xl">
              Payment Verification
            </DialogTitle>

            <p className="mt-1 break-words text-sm font-bold text-orange-600">
              {payment.eventName || "Untitled Event"}
            </p>
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

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-5">
            <ModalSection title="Payment Proof">
              {payment.paymentMethod === "bank" ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  {hasImageProof ? (
                    <div className="mx-auto w-full max-w-[280px]">
                      <div className="aspect-[3/4] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <img
                          src={effectiveProof}
                          alt="Payment proof"
                          className="h-full w-full object-contain"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="mx-auto flex min-h-[250px] w-full max-w-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center">
                      <FileImage className="mb-3 h-10 w-10 text-slate-300" />

                      <p className="text-sm font-black text-slate-900">
                        No proof uploaded
                      </p>

                      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
                        The customer did not upload a proof image for this bank transfer payment.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5 text-center">
                  <Banknote className="mx-auto mb-3 h-10 w-10 text-emerald-500" />

                  <p className="text-sm font-black text-emerald-950">
                    Cash Payment at Office
                  </p>

                  <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-emerald-700">
                    Confirm this booking only after the physical cash payment is received.
                  </p>
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
          </div>

          <div className="space-y-5">
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
                <InfoLine label="Method" value={getPaymentMethodLabel(payment.paymentMethod)} />
                {payment.paymentMethod === "bank" && (
                  <InfoLine label="Bank Reference No." value={getBankReferenceNumber(payment)} />
                )}
                <InfoLine label="Type" value={getPaymentTypeLabel(payment.paymentType)} />
                <InfoLine label="Total Booking" value={formatCurrency(totalAmount)} />
                <InfoLine label="Status" value={getPaymentStatusText(payment)} />
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
          <div className={`grid gap-3 ${payment.paymentMethod === "cash" ? "sm:grid-cols-1" : "sm:grid-cols-3"}`}>
            {payment.paymentMethod !== "cash" && (
              <Button
                onClick={() => onAction("reject")}
                variant="outline"
                className="h-11 rounded-xl border-rose-200 text-sm font-black text-rose-500 hover:bg-rose-50"
              >
                Reject Payment
              </Button>
            )}

            {payment.paymentMethod !== "cash" && (
              <Button
                onClick={() => onAction("incomplete")}
                variant="outline"
                className="h-11 rounded-xl border-amber-200 text-sm font-black text-amber-600 hover:bg-amber-50"
              >
                Incomplete Payment
              </Button>
            )}

            <Button
              onClick={() => onAction("verify")}
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

function readStoredReceipts(): Promise<any[]> {
  return getDocs(query(collection(db, "receipts"), orderBy("dateGenerated", "desc"))).then(
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
  if (type === "downpayment") return "50% Downpayment"
  if (type === "slot_reservation") return "Slot Reservation Only"
  return "Payment Type"
}

function isImageProof(proof: unknown) {
  const value = String(proof || "")
  return (
    value.startsWith("data:image") ||
    value.startsWith("http://") ||
    value.startsWith("https://")
  )
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
  const selectedDP = getSafePrice(booking.selectedDownpaymentAmount) || (isDownpayment ? totalAmount * 0.5 : 0)

  if (office) {
    const officeNewPaid = currentAmountPaid + paymentAmount
    return {
      ...booking,
      status: "reservation_secured",
      bookingStatus: "Slot Secured",
      paymentStatus: "slot_verified",
      isSlotSecured: true,
      amountPaid: officeNewPaid,
      remainingBalance: Math.max(totalAmount - officeNewPaid, 0),
      paymentVerifiedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      verifiedByAdmin: true,
      contractStatus: "Pending Signature",
      hasActivePaymentSubmission: false,
      updatedAt: new Date().toISOString(),
      adminLogs: appendAdminLog(booking, "PAYMENT_VERIFIED", "Admin verified the office slot reservation payment. Succeeding payments are onsite check payments."),
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
  const selectedDP = getAmountValue(booking.selectedDownpaymentAmount) || (isDownpayment ? total * 0.5 : 0)
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
  readStoredReceipts().then((receipts) => {
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
      contractTerm: office ? booking.contractTerm || booking.rentalTerm || "N/A" : undefined,
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
  const selectedDP = getAmountValue(booking.selectedDownpaymentAmount) || (isDownpayment ? totalAmount * 0.5 : 0)
  const expectedAmount = office
    ? getAmountValue((booking as any).expectedAmount || (booking as any).paymentAmount || (booking as any).amount || (booking as any).amountPaid || totalAmount)
    : isDownpayment ? selectedDP : totalAmount
  const currentAmountPaid = typeof (booking as any).amountPaid === "number" ? (booking as any).amountPaid : 0
  const currentDownpaymentPaid = getAmountValue(booking.downpaymentPaid)
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
                      Amount equals or exceeds the expected amount. Use Verify Payment instead.
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
      const defaultAmount = getAmountValue((booking as any).paymentAmount || (booking as any).pendingPaymentAmount || 0)
      setAmountReceived(defaultAmount > 0 ? String(defaultAmount) : "")
      setAdminNote("")
      setConfirmStep(false)
    }
  }, [booking])

  if (!booking) return null

  const totalAmount = getAmountValue(booking.totalAmount || booking.totalPrice || booking.amount || booking.price)
  const currentAmountPaid = typeof booking.amountPaid === "number" ? booking.amountPaid : 0
  const enteredAmount = getAmountValue(amountReceived)
  const newAmountPaid = currentAmountPaid + enteredAmount
  const newRemainingBalance = Math.max(totalAmount - newAmountPaid, 0)
  const isDownpayment = String(booking.paymentType || "").toLowerCase() === "downpayment"
  const currentDownpaymentPaid = getAmountValue(booking.downpaymentPaid)
  const selectedDP = getAmountValue(booking.selectedDownpaymentAmount) || (isDownpayment ? totalAmount * 0.5 : 0)

  const isFullyPaidAfter = newAmountPaid >= totalAmount

  const handleConfirm = () => {
    if (enteredAmount <= 0) return

    const office = isOfficeRental(booking)
    const nextStatus = office ? "reservation_secured" : "confirmed"
    const newDownpaymentPaid = currentDownpaymentPaid + enteredAmount
    const newDPRemaining = isDownpayment ? Math.max(selectedDP - newDownpaymentPaid, 0) : 0

    const updatedBooking: BookingRecord = {
      ...booking,
      status: nextStatus,
      bookingStatus: office ? "Slot Secured" : "Confirmed",
      isSlotSecured: true,
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
                  {enteredAmount > 0 && (
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
                  disabled={enteredAmount <= 0}
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
