"use client"

import { useEffect, useMemo, useState } from "react"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { Card, CardContent } from "@/src/modules/shared/components/ui/card"
import { Badge } from "@/src/modules/shared/components/ui/badge"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Building2, Check, MapPin, ArrowRight, Clock, Plus, FileText, Calendar, CheckCircle2, XCircle } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/src/modules/shared/components/ui/tooltip"
import Link from "next/link"

import { useBookingData, type Booking } from "@/src/modules/client/contexts/booking-context"
import {
  getBookingLifecycleLabel,
  getBookingLifecycleStatus,
  getBookingScheduleClassification,
  formatBookingDate,
  getNextBooking,
} from "@/src/modules/shared/lib/booking-helpers"
import { getRemainingDurationFromDates } from "@/src/modules/shared/lib/date-utils"
import { isOfficeResourceBooking } from "@/src/modules/shared/lib/resource-identity"
import { cn } from "@/src/modules/shared/lib/utils"
import {
  calculatePaymentSummary,
  getPaymentOverallStatusLabel,
  getPendingPaymentTotal,
  getPaymentRecordTime,
  getRecordsForBooking,
} from "@/src/modules/shared/lib/payment-calculations"
import { getPaymentStatusPresentationClass } from "@/src/modules/shared/lib/status-presentation"

function isOfficeBooking(booking: Booking) {
  return isOfficeResourceBooking(booking as unknown as Record<string, unknown>)
}

function getBookingProgress(status?: string) {
  const s = String(status || "").toLowerCase()
  if (s === "verifying" || s === "for_review") return "verifying"
  return getBookingLifecycleStatus({ status })
}

const STAGES = [
  { key: "pending", label: "Pending" },
  { key: "verifying", label: "Payment Review" },
  { key: "confirmed", label: "Confirmed/Secured" },
  { key: "completed", label: "Completed" },
] as const

function BookingProgressIndicator({ status }: { status?: string }) {
  const progress = getBookingProgress(status)
  if (progress === "cancelled") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2">
        <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-rose-600">Cancelled</span>
      </div>
    )
  }
  const currentIdx = STAGES.findIndex(s => s.key === progress)
  const showCompletedOrange = currentIdx >= 2
  return (
    <>
      {/* Vertical timeline — mobile only */}
      <div className="flex flex-col md:hidden">
        {STAGES.map((stage, idx) => {
          const isDone = idx < currentIdx
          const isCurrent = idx === currentIdx
          const isCompletedStage = stage.key === "completed"
          return (
            <div key={stage.key} className="flex items-stretch gap-3">
              <div className="flex flex-col items-center">
                <div className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black",
                  isDone || (isCurrent && !isCompletedStage) ? "bg-emerald-500 text-white" :
                  isCompletedStage && showCompletedOrange ? "bg-orange-500 text-white" :
                  "bg-slate-200 text-slate-400"
                )}>
                  {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : idx + 1}
                </div>
                {idx < STAGES.length - 1 && (
                  <div className={cn(
                    "w-px flex-1 min-h-[1.5rem]",
                    isDone ? "bg-emerald-300" : "bg-slate-200"
                  )} />
                )}
              </div>
              <span className={cn(
                "text-[11px] font-bold leading-tight pt-0.5 pb-3",
                isCompletedStage && showCompletedOrange ? "text-orange-600" :
                isDone || isCurrent ? "text-emerald-600" :
                "text-slate-400"
              )}>
                {stage.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Horizontal stepper — desktop only */}
      <div className="hidden md:flex items-start w-full min-w-0">
        {STAGES.map((stage, idx) => {
          const isDone = idx < currentIdx
          const isCurrent = idx === currentIdx
          const isCompletedStage = stage.key === "completed"
          return (
            <div key={stage.key} className="flex-1 flex flex-col items-center gap-1">
              <div className="flex items-center w-full">
                <div className={cn(
                  "flex-1 h-px",
                  idx === 0 && "invisible",
                  idx - 1 < currentIdx ? "bg-emerald-300" : "bg-slate-200"
                )} />
                <div className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black",
                  isDone || (isCurrent && !isCompletedStage) ? "bg-emerald-500 text-white" :
                  isCompletedStage && showCompletedOrange ? "bg-orange-500 text-white" :
                  "bg-slate-200 text-slate-400"
                )}>
                  {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : idx + 1}
                </div>
                <div className={cn(
                  "flex-1 h-px",
                  idx === STAGES.length - 1 && "invisible",
                  idx < currentIdx ? "bg-emerald-300" : "bg-slate-200"
                )} />
              </div>
              <span className={cn(
                "text-[9px] font-bold leading-tight text-center px-0.5 break-words max-w-full min-w-0",
                isCompletedStage && showCompletedOrange ? "text-orange-600" :
                isDone || isCurrent ? "text-emerald-600" :
                "text-slate-400"
              )}>
                {stage.label}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

function getRemainingDuration(endDate?: string, startDate?: string) {
  return getRemainingDurationFromDates(endDate, startDate)
}

function formatDate(date?: string) {
  if (!date) return "No date"
  return formatBookingDate(date)
}

function getOfficeStatusDisplay(booking: Booking) {
  const s = String(booking.status || "").toLowerCase()
  const schedule = getBookingScheduleClassification(booking)
  if (s === "active_rental") {
    if (schedule === "upcoming") {
      return {
        badge: "UPCOMING",
        badgeClass: "border-blue-200 bg-blue-50 text-blue-700",
        icon: "🔵",
        remaining: null,
        endDate: (booking as any).endDate ? formatDate((booking as any).endDate) : null,
      }
    }
    const remaining = getRemainingDuration((booking as any).endDate, booking.date)
    return {
      badge: "ACTIVE RENTAL",
      badgeClass: "border-emerald-100 bg-emerald-50 text-emerald-700",
      icon: "🟢",
      remaining,
      endDate: (booking as any).endDate ? formatDate((booking as any).endDate) : null,
    }
  }
  if (s === "contract_signing_required") {
    return {
      badge: "CONTRACT SIGNING REQUIRED",
      badgeClass: "border-yellow-100 bg-yellow-50 text-yellow-700",
      icon: "🟡",
      remaining: null,
      endDate: null,
    }
  }
  if (s === "rental_expired") {
    return {
      badge: "RENTAL EXPIRED",
      badgeClass: "border-red-100 bg-red-50 text-red-700",
      icon: "🔴",
      remaining: null,
      endDate: null,
    }
  }
  if (schedule === "completed") {
    return {
      badge: "COMPLETED",
      badgeClass: "border-blue-100 bg-blue-50 text-blue-700",
      icon: "🔵",
      remaining: null,
      endDate: null,
    }
  }
  if (s === "pending") {
    return {
      badge: "PENDING",
      badgeClass: "border-orange-100 bg-orange-50 text-orange-700",
      icon: "🟠",
      remaining: null,
      endDate: null,
    }
  }
  if (s === "verifying" || s === "for_verification") {
    return {
      badge: "PENDING",
      badgeClass: "border-orange-100 bg-orange-50 text-orange-700",
      icon: "🟠",
      remaining: null,
      endDate: null,
    }
  }
  if (s === "reservation_secured") {
    if (schedule === "upcoming") {
      return {
        badge: "UPCOMING",
        badgeClass: "border-blue-200 bg-blue-50 text-blue-700",
        icon: "🔵",
        remaining: null,
        endDate: null,
      }
    }
    return {
      badge: "RESERVATION SECURED",
      badgeClass: "border-emerald-100 bg-emerald-50 text-emerald-700",
      icon: "🟢",
      remaining: null,
      endDate: null,
    }
  }
  if (s === "completed" || s === "complete") {
    return {
      badge: "COMPLETED",
      badgeClass: "border-blue-100 bg-blue-50 text-blue-700",
      icon: "🔵",
      remaining: null,
      endDate: null,
    }
  }
  if (schedule === "upcoming") {
    return {
      badge: "UPCOMING",
      badgeClass: "border-blue-200 bg-blue-50 text-blue-700",
      icon: "🔵",
      remaining: null,
      endDate: (booking as any).endDate ? formatDate((booking as any).endDate) : null,
    }
  }
  if (s === "cancelled" || s === "declined") {
    return {
      badge: "CANCELLED",
      badgeClass: "border-rose-100 bg-rose-50 text-rose-700",
      icon: "🔴",
      remaining: null,
      endDate: null,
    }
  }
  return {
    badge: String(booking.status || "UNKNOWN").replace(/_/g, " ").toUpperCase(),
    badgeClass: "border-slate-200 bg-slate-50 text-slate-600",
    icon: "⚪",
    remaining: null,
    endDate: null,
  }
}

export default function ClientDashboardPage() {
  const { user } = useAuth()
  const { getUserBookings, bookings, paymentRecords } = useBookingData({ bookings: true, payments: true })
  const [presentationNow, setPresentationNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setPresentationNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const myBookings = useMemo(() => {
    if (user?.id) return getUserBookings(user.id)
    return bookings
  }, [user?.id, getUserBookings, bookings])

  const officeBookings = useMemo(() => myBookings.filter(isOfficeBooking), [myBookings])

  const sortedBookings = useMemo(() => {
    return [...myBookings].sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    )
  }, [myBookings])

  const activeOfficeRental = useMemo(() => {
    const current = officeBookings.filter((booking) => getBookingScheduleClassification(booking, presentationNow) === "active")
      .sort((a, b) => new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime())[0]
    return current || null
  }, [officeBookings, presentationNow])

  const nextOfficeRental = useMemo(
    () => getNextBooking(officeBookings, presentationNow),
    [officeBookings, presentationNow],
  )
  const featuredOfficeRental = activeOfficeRental || nextOfficeRental

  const eventBookings = useMemo(
    () => myBookings.filter(b => !isOfficeBooking(b)),
    [myBookings],
  )

  const activeEventBooking = useMemo(() => {
    const current = getNextBooking(eventBookings, presentationNow)
    return current || null
  }, [eventBookings, presentationNow])

  const eventBookingClassification = activeEventBooking
    ? getBookingScheduleClassification(activeEventBooking)
    : null

  const activeRental = useMemo(
    () => (featuredOfficeRental && getBookingScheduleClassification(featuredOfficeRental) === "active" && featuredOfficeRental.status === "active_rental" ? featuredOfficeRental : null),
    [featuredOfficeRental],
  )
  const contractSigning = useMemo(
    () => (featuredOfficeRental && featuredOfficeRental.status === "contract_signing_required" ? featuredOfficeRental : null),
    [featuredOfficeRental],
  )
  const expiredRental = useMemo(
    () => officeBookings.find((booking) => String(booking.status || "").toLowerCase() === "rental_expired") || null,
    [officeBookings],
  )
  const earlyStageRental = useMemo(() => {
    if (!featuredOfficeRental) return null
    const classification = getBookingScheduleClassification(featuredOfficeRental)
    if (classification === "active") return null
    if (featuredOfficeRental.status === "active_rental") return null
    if (featuredOfficeRental.status === "contract_signing_required") return null
    if (featuredOfficeRental.status === "rental_expired") return null
    return featuredOfficeRental
  }, [featuredOfficeRental])

  const excludedIds = useMemo(() => {
    const ids = new Set<string>()
    if (featuredOfficeRental) ids.add(featuredOfficeRental.id)
    if (activeEventBooking) ids.add(activeEventBooking.id)
    return ids
  }, [featuredOfficeRental, activeEventBooking])

  const otherBookings = useMemo(() => {
    return sortedBookings
      .filter(b => !excludedIds.has(b.id))
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 5)
  }, [sortedBookings, excludedIds])

  const recentPayments = useMemo(() => {
    return [...myBookings]
      .map((booking) => {
        const records = getRecordsForBooking(paymentRecords, booking)
        const summary = calculatePaymentSummary(booking, records)
        const pendingReview = getPendingPaymentTotal(records)
        const latestRecordTime = records.reduce((latest, record) => Math.max(latest, getPaymentRecordTime(record)), 0)
        const storedStatus = String(booking.paymentStatus || "").trim().toLowerCase()
        const hasLegacyPaymentActivity = ["verified", "paid", "slot_verified", "partial", "incomplete", "for_review", "pending_verification", "rejected"].includes(storedStatus)
        return {
          booking,
          summary,
          pendingReview,
          activityTime: latestRecordTime || new Date(String(booking.createdAt || 0)).getTime(),
          hasActivity: records.length > 0 || hasLegacyPaymentActivity,
        }
      })
      .filter((entry) => entry.hasActivity)
      .sort((a, b) => b.activityTime - a.activityTime)
      .slice(0, 3)
  }, [myBookings, paymentRecords])

  return (
    <TooltipProvider delayDuration={400}>
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 animate-in fade-in duration-500">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="oe-page-kicker">Client Portal</p>
            <h1 className="oe-page-title mt-1">Dashboard</h1>
            <p className="oe-page-description mt-1 max-w-xl">
              A clear view of your current reservations and payment activity.
            </p>
          </div>
          <Button className="h-11 shrink-0 rounded-xl bg-orange-600 px-5 text-sm font-semibold text-white shadow-sm transition-transform hover:bg-orange-700 active:scale-[0.97]" asChild>
            <Link href="/portal/bookings"><Plus className="mr-1.5 h-4 w-4" /> New Booking</Link>
          </Button>
        </div>

        <div className="space-y-6">
          {activeRental && (
            <div>
              <h2 className="oe-section-heading mb-3">
                Active Office Rental
              </h2>
              <Card className="rounded-2xl border-emerald-200 bg-white shadow-sm overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <Badge variant="outline" className="uppercase text-[10px] font-black tracking-[0.2em] px-2.5 py-1 rounded-full mb-3 border-emerald-100 bg-emerald-50 text-emerald-700 shadow-none">
                        ACTIVE RENTAL
                      </Badge>
                      <h3 className="text-xl font-black text-slate-950 tracking-tight leading-snug mb-1 line-clamp-2">
                        {activeRental.eventName || "Office Rental"}
                      </h3>
                      <p className="text-sm font-bold text-slate-500 mb-3">{activeRental.venue || "Office Space"}</p>
                      <div className="flex flex-wrap gap-3 text-xs font-semibold text-slate-600 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                        {(() => {
                          const remaining = getRemainingDuration((activeRental as any).endDate, activeRental.date)
                          return remaining ? <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-emerald-500" /> {remaining}</span> : null
                        })()}
                        {(activeRental as any).endDate && (
                          <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-orange-500" /> Ends: {formatDate((activeRental as any).endDate)}</span>
                        )}
                      </div>
                    </div>
                    <Button variant="outline" className="h-9 shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-4 text-xs font-bold" asChild>
                      <Link href="/portal/bookings">View Details</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {contractSigning && (
            <div>
              <h2 className="oe-section-heading mb-3">
                Action Required
              </h2>
              <Card className="rounded-2xl border-yellow-200 bg-white shadow-sm overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <Badge variant="outline" className="uppercase text-[10px] font-black tracking-[0.2em] px-2.5 py-1 rounded-full mb-3 border-yellow-100 bg-yellow-50 text-yellow-700 shadow-none">
                        CONTRACT SIGNING REQUIRED
                      </Badge>
                      <h3 className="text-xl font-black text-slate-950 tracking-tight leading-snug mb-1 line-clamp-2">
                        {contractSigning.eventName || "Office Rental"}
                      </h3>
                      <p className="text-sm font-bold text-slate-500">{contractSigning.venue || "Office Space"}</p>
                    </div>
                    <Button variant="outline" className="h-9 shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-4 text-xs font-bold" asChild>
                      <Link href="/portal/bookings">View Details</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {expiredRental && (
            <div>
              <h2 className="oe-section-heading mb-3">
                Past Rental
              </h2>
              <Card className="rounded-2xl border-red-200 bg-white shadow-sm overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <Badge variant="outline" className="uppercase text-[10px] font-black tracking-[0.2em] px-2.5 py-1 rounded-full mb-3 border-red-100 bg-red-50 text-red-700 shadow-none">
                        RENTAL EXPIRED
                      </Badge>
                      <h3 className="text-xl font-black text-slate-950 tracking-tight leading-snug mb-1 line-clamp-2">
                        {expiredRental.eventName || "Office Rental"}
                      </h3>
                      <p className="text-sm font-bold text-slate-500">{expiredRental.venue || "Office Space"}</p>
                    </div>
                    <Button variant="outline" className="h-9 shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-4 text-xs font-bold" asChild>
                      <Link href="/portal/bookings">View Details</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {earlyStageRental && (() => {
            const display = getOfficeStatusDisplay(earlyStageRental)
            if (!display) return null
            return (
              <div>
                <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-black mb-3">
                  Office Rental
                </h2>
                <Card className="rounded-2xl border-slate-200 bg-white shadow-sm overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <Badge variant="outline" className={cn("uppercase text-[10px] font-black tracking-[0.2em] px-2.5 py-1 rounded-full mb-3 shadow-none", display.badgeClass)}>
                          {display.badge}
                        </Badge>
                        <h3 className="text-xl font-black text-slate-950 tracking-tight leading-snug mb-1 line-clamp-2">
                          {earlyStageRental.eventName || "Office Rental"}
                        </h3>
                        <p className="text-sm font-bold text-slate-500 mb-3">{earlyStageRental.venue || "Office Space"}</p>
                        <div className="flex flex-wrap gap-3 text-xs font-semibold text-slate-600 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                          {earlyStageRental.date && (
                            <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-orange-500" /> {formatDate(earlyStageRental.date)}</span>
                          )}
                        </div>
                      </div>
                      <Button variant="outline" className="h-9 shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-4 text-xs font-bold" asChild>
                        <Link href="/portal/bookings">View Details</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )
          })()}

          {activeEventBooking && (
            <div>
              <h2 className="oe-section-heading mb-3">
                {eventBookingClassification === "upcoming" ? "Next Event Booking" : "Active Event Booking"}
              </h2>
              <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden bg-white">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col sm:flex-row justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="uppercase text-[10px] font-black tracking-[0.2em] px-2.5 py-1 rounded-full border-emerald-100 bg-emerald-50 text-emerald-600 shadow-none">
                            {getBookingLifecycleLabel({ status: activeEventBooking.status })}
                          </Badge>
                          {eventBookingClassification && (
                            <Badge variant="outline" className="uppercase text-[10px] font-black tracking-[0.2em] px-2.5 py-1 rounded-full border-blue-200 bg-blue-50 text-blue-700 shadow-none">
                              {eventBookingClassification === "upcoming" ? "Upcoming" : "Active now"}
                            </Badge>
                          )}
                        </div>
                        <h3 className="text-xl font-black text-slate-950 tracking-tight leading-snug mb-3 line-clamp-2">
                          {activeEventBooking.eventName || "Event"}
                        </h3>
                        <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-slate-600 font-semibold bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                          {activeEventBooking.date && <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-orange-500 shrink-0" /> {formatDate(activeEventBooking.date)}</div>}
                          {activeEventBooking.time && <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-orange-500 shrink-0" /> {activeEventBooking.time}</div>}
                          {activeEventBooking.venue && <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-orange-500 shrink-0" /> {activeEventBooking.venue}</div>}
                        </div>
                      </div>
                      <Button variant="outline" className="h-9 shrink-0 whitespace-nowrap rounded-lg border-slate-200 px-4 text-xs font-bold" asChild>
                        <Link href="/portal/bookings">View Details</Link>
                      </Button>
                    </div>
                    <div className="border-t border-slate-100 pt-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-black mb-3">Progress</p>
                      <BookingProgressIndicator status={activeEventBooking.status} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {!activeRental && !contractSigning && !expiredRental && !earlyStageRental && !activeEventBooking && (
            <div>
                <h2 className="oe-section-heading mb-3">Your Next Event</h2>
              <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden bg-white">
                <CardContent className="p-4 sm:p-5 flex flex-col items-center text-center py-8">
                  <Calendar className="mb-3 h-10 w-10 text-slate-300" />
                  <h3 className="text-base font-black text-slate-900">No active bookings</h3>
                  <p className="mt-1 max-w-sm text-xs text-slate-500">
                    You don&apos;t have any upcoming reservations or rentals.
                  </p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button className="mt-4 h-9 rounded-xl bg-orange-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-orange-700 active:scale-[0.97] transition-transform" asChild>
                        <Link href="/portal/bookings"><Plus className="mr-1.5 h-3.5 w-3.5" /> Book Now</Link>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-[10px] font-semibold">
                      Browse available spaces
                    </TooltipContent>
                  </Tooltip>
                </CardContent>
              </Card>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="oe-section-heading">Other Bookings</h2>
              <Button variant="link" className="text-orange-600 text-xs font-bold h-auto p-0" asChild>
                <Link href="/portal/bookings">View All <ArrowRight className="w-3 h-3 ml-1" /></Link>
              </Button>
            </div>
            <Card className="rounded-2xl border-slate-200 shadow-sm bg-white overflow-hidden">
              <div className="divide-y divide-slate-100">
                {otherBookings.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className="text-xs text-slate-500">No other bookings found.</p>
                  </div>
                ) : (
                  otherBookings.map((booking) => {
                    const isOffice = isOfficeBooking(booking)
                    const officeStatus = isOffice ? getOfficeStatusDisplay(booking) : null
                    const normStatus = String(booking.status || "").toLowerCase()
                    const lifecycleStatus = getBookingLifecycleStatus(booking as unknown as Record<string, unknown>)
                    const scheduleClassification = getBookingScheduleClassification(booking)
                    const isTerminal = ["cancelled", "completed", "declined", "rejected", "rental_expired"].includes(normStatus) || scheduleClassification === "completed" || scheduleClassification === "cancelled" || scheduleClassification === "rejected"
                    return (
                      <Link href={`/portal/bookings?bookingId=${booking.id}${isTerminal ? '&history=true' : ''}`} key={booking.id} className="p-4 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors group">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-sm text-slate-900 truncate group-hover:text-orange-600 min-w-0">
                            {booking.eventName || "Untitled"}
                          </h4>
                          <div className="flex gap-3 text-xs text-slate-500 mt-1.5">
                            <span className="flex items-center gap-1 min-w-0 truncate">{isOffice ? <Building2 className="w-3.5 h-3.5 shrink-0" /> : <Calendar className="w-3.5 h-3.5 shrink-0" />}{booking.venue || "N/A"}</span>
                          </div>
                        </div>
                        {officeStatus ? (
                          <Badge variant="outline" className={cn("text-[9px] font-black uppercase px-2.5 py-1 rounded-full shadow-none whitespace-nowrap", officeStatus.badgeClass)}>
                            {officeStatus.badge}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className={cn(
                            "text-[9px] font-black uppercase px-2.5 py-1 rounded-full shadow-none whitespace-nowrap",
                             lifecycleStatus === "confirmed" ? "text-emerald-600 border-emerald-100 bg-emerald-50" :
                             lifecycleStatus === "completed" ? "text-blue-600 border-blue-100 bg-blue-50" :
                             lifecycleStatus === "pending" ? "text-orange-600 border-orange-100 bg-orange-50" :
                             lifecycleStatus === "cancelled" ? "text-rose-600 border-rose-100 bg-rose-50" :
                             "text-slate-600 border-slate-200 bg-slate-50"
                            )}>
                              {scheduleClassification === "upcoming"
                                ? "Upcoming"
                                : scheduleClassification === "active"
                                  ? "Active now"
                                  : scheduleClassification === "completed" && lifecycleStatus !== "completed"
                                    ? "Completed"
                                    : getBookingLifecycleLabel(booking as unknown as Record<string, unknown>)}
                          </Badge>
                        )}
                      </Link>
                    )
                  })
                )}
              </div>
            </Card>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="oe-section-heading">Recent Payments</h2>
              <Button variant="link" className="text-orange-600 text-xs font-bold h-auto p-0" asChild>
                <Link href="/portal/payments">Manage <ArrowRight className="w-3 h-3 ml-1" /></Link>
              </Button>
            </div>
            <Card className="rounded-2xl border-slate-200 shadow-sm bg-white overflow-hidden">
              <div className="divide-y divide-slate-100">
                {recentPayments.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className="text-xs text-slate-500">No payments yet.</p>
                  </div>
                ) : (
                  recentPayments.map(({ booking, summary, pendingReview, activityTime }) => {
                    const refundStatus = String((booking as any).refundStatus || "").toLowerCase()
                    let payLabel: string
                    if (refundStatus === "refunded") {
                      payLabel = "Refunded"
                    } else if (refundStatus === "requested") {
                      payLabel = "Refund Requested"
                    } else {
                      payLabel = pendingReview > 0 || summary.hasPendingSubmission || summary.overallStatus === "for_review"
                        ? "Pending Verification"
                        : getPaymentOverallStatusLabel(summary.overallStatus)
                    }
                    const amount = summary.moneyReceivedTotal > 0
                      ? summary.moneyReceivedTotal
                      : pendingReview || Number((booking as any).paymentAmount || 0)
                    const amountLabel = summary.moneyReceivedTotal > 0
                      ? "Received"
                      : pendingReview > 0 || summary.hasPendingSubmission || summary.overallStatus === "for_review"
                        ? "Submitted"
                        : "Payment"
                    const badgeClass = getPaymentStatusPresentationClass(
                      summary.overallStatus,
                      refundStatus,
                    )
                    return (
                      <Link href={`/portal/payments?view=${booking.id}`} key={booking.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors group">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-sm text-slate-900">
                            {amountLabel}: ₱{amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                          </h4>
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">{booking.eventName || "Payment"}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <Badge variant="outline" className={cn("text-[9px] font-black uppercase px-2.5 py-1 rounded-full shadow-none", badgeClass)}>
                            {payLabel}
                          </Badge>
                          <p className="text-[10px] text-slate-400 mt-1">{formatDate(activityTime ? new Date(activityTime).toISOString() : String(booking.createdAt || ""))}</p>
                        </div>
                      </Link>
                    )
                  })
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
    </TooltipProvider>
  )
}
