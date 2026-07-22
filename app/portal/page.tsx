"use client"

import { useMemo } from "react"
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

import { UserAvatar } from "@/src/modules/shared/components/user-avatar"
import { useBookings, type Booking } from "@/src/modules/client/contexts/booking-context"
import { getCurrentBooking } from "@/src/modules/shared/lib/booking-helpers"
import { getRemainingDurationFromDates } from "@/src/modules/shared/lib/date-utils"
import { cn } from "@/src/modules/shared/lib/utils"

function isOfficeBooking(booking: Booking) {
  const text = [(booking as any)?.bookingType, (booking as any)?.rentalType, booking?.venue, booking?.eventType]
    .join(" ")
    .toLowerCase()
  return text.includes("office")
}

function getBookingProgress(status?: string) {
  const s = String(status || "").toLowerCase()
  if (s === "cancelled" || s === "declined") return "cancelled"
  if (s === "completed" || s === "complete") return "completed"
  if (
    s === "confirmed" ||
    s === "reservation_secured" ||
    s === "slot_secured" ||
    s === "active_rental" ||
    s === "contract_signing_required"
  ) return "confirmed"
  if (s === "verifying" || s === "for_review") return "verifying"
  return "pending"
}

const STAGES = [
  { key: "pending", label: "Pending" },
  { key: "verifying", label: "For Verification" },
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
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat("en-PH", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  }).format(parsed)
}

function getOfficeStatusDisplay(booking: Booking) {
  const s = String(booking.status || "").toLowerCase()
  if (s === "active_rental") {
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
      badge: "FOR VERIFICATION",
      badgeClass: "border-orange-100 bg-orange-50 text-orange-700",
      icon: "🟠",
      remaining: null,
      endDate: null,
    }
  }
  if (s === "reservation_secured") {
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
  const { getUserBookings, bookings } = useBookings()
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
    const current = getCurrentBooking(officeBookings)
    return current || null
  }, [officeBookings])

  const eventBookings = useMemo(
    () => myBookings.filter(b => !isOfficeBooking(b)),
    [myBookings],
  )

  const activeEventBooking = useMemo(() => {
    const current = getCurrentBooking(eventBookings)
    return current || null
  }, [eventBookings])

  const activeRental = useMemo(
    () => (activeOfficeRental && activeOfficeRental.status === "active_rental" ? activeOfficeRental : null),
    [activeOfficeRental],
  )
  const contractSigning = useMemo(
    () => (activeOfficeRental && activeOfficeRental.status === "contract_signing_required" ? activeOfficeRental : null),
    [activeOfficeRental],
  )
  const expiredRental = useMemo(
    () => (activeOfficeRental && activeOfficeRental.status === "rental_expired" ? activeOfficeRental : null),
    [activeOfficeRental],
  )
  const earlyStageRental = useMemo(() => {
    if (!activeOfficeRental) return null
    if (activeOfficeRental.status === "active_rental") return null
    if (activeOfficeRental.status === "contract_signing_required") return null
    if (activeOfficeRental.status === "rental_expired") return null
    return activeOfficeRental
  }, [activeOfficeRental])

  const excludedIds = useMemo(() => {
    const ids = new Set<string>()
    if (activeOfficeRental) ids.add(activeOfficeRental.id)
    if (activeEventBooking) ids.add(activeEventBooking.id)
    return ids
  }, [activeOfficeRental, activeEventBooking])

  const otherBookings = useMemo(() => {
    return sortedBookings
      .filter(b => !excludedIds.has(b.id))
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 5)
  }, [sortedBookings, excludedIds])

  const recentPayments = useMemo(() => {
    return [...myBookings]
      .filter(b => {
        const ps = String(b.paymentStatus || "").toLowerCase()
        return ["verified", "paid", "slot_verified", "partial"].includes(ps)
      })
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 3)
  }, [myBookings])

  return (
    <TooltipProvider delayDuration={400}>
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 animate-in fade-in duration-500">
        <section className="border-b border-slate-200 pb-5 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <UserAvatar
                name={user?.name}
                picture={user?.profilePicture}
                className="h-12 w-12"
                ringClassName="ring-2 ring-white"
                fallbackClassName="bg-gradient-to-br from-orange-100 to-orange-200 text-orange-700"
                textClassName="text-lg font-black uppercase"
              />
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-orange-600">
                  Client Dashboard
                </p>
                <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 md:text-3xl leading-tight">
                  Welcome back, {user?.name?.split(" ")[0] || "Client"}
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  Here is an overview of your reservations and payments.
                </p>
              </div>
            </div>
            <Button className="h-11 rounded-xl bg-orange-600 px-5 text-sm font-black text-white shadow-sm hover:bg-orange-700 shrink-0 active:scale-[0.97] transition-transform" asChild>
              <Link href="/portal/bookings"><Plus className="w-4 h-4 mr-1.5" /> New Booking</Link>
            </Button>
          </div>
        </section>

        <div className="space-y-6">
          {activeRental && (
            <div>
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">
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
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">
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
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">
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
                <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">
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
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">
                Active Event Booking
              </h2>
              <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden bg-white">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col sm:flex-row justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <Badge variant="outline" className="uppercase text-[10px] font-black tracking-[0.2em] px-2.5 py-1 rounded-full mb-3 border-emerald-100 bg-emerald-50 text-emerald-600 shadow-none">
                          {activeEventBooking.status}
                        </Badge>
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
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">Progress</p>
                      <BookingProgressIndicator status={activeEventBooking.status} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {!activeRental && !contractSigning && !expiredRental && !earlyStageRental && !activeEventBooking && (
            <div>
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">Your Next Event</h2>
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
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Other Bookings</h2>
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
                    return (
                      <Link href="/portal/bookings" key={booking.id} className="p-4 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors group">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-sm text-slate-900 truncate group-hover:text-orange-600 min-w-0">
                            {booking.eventName || "Untitled"}
                          </h4>
                          <div className="flex gap-3 text-xs text-slate-500 mt-1.5">
                            <span className="flex items-center gap-1">{isOffice ? <Building2 className="w-3.5 h-3.5" /> : <Calendar className="w-3.5 h-3.5" />}{booking.venue || "N/A"}</span>
                          </div>
                        </div>
                        {officeStatus ? (
                          <Badge variant="outline" className={cn("text-[9px] font-black uppercase px-2.5 py-1 rounded-full shadow-none whitespace-nowrap", officeStatus.badgeClass)}>
                            {officeStatus.badge}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className={cn(
                            "text-[9px] font-black uppercase px-2.5 py-1 rounded-full shadow-none whitespace-nowrap",
                            booking.status === "pending" || booking.status === "verifying" ? "text-orange-600 border-orange-100 bg-orange-50" :
                            booking.status === "confirmed" ? "text-emerald-600 border-emerald-100 bg-emerald-50" :
                            booking.status === "completed" ? "text-blue-600 border-blue-100 bg-blue-50" :
                            "text-slate-600 border-slate-200 bg-slate-50"
                          )}>
                            {String(booking.status || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
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
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Recent Payments</h2>
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
                  recentPayments.map((payment) => (
                    <div key={payment.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-sm text-slate-900">
                          ₱{Number((payment as any).amountPaid || 0).toLocaleString()}
                        </h4>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">{payment.eventName || "Payment"}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="outline" className="text-[9px] font-black uppercase px-2.5 py-1 rounded-full shadow-none text-emerald-600 border-emerald-100 bg-emerald-50">
                          Paid
                        </Badge>
                        <p className="text-[10px] text-slate-400 mt-1">{formatDate(payment.createdAt)}</p>
                      </div>
                    </div>
                  ))
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
