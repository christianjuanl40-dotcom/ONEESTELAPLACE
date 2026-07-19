"use client"

import type React from "react"
import { useEffect, useMemo } from "react"
import Link from "next/link"
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Banknote,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  Inbox,
  Tent,
  TrendingUp,
} from "lucide-react"

import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useBookings } from "@/src/modules/client/contexts/booking-context"
import { useRouter } from "next/navigation"
import { cn } from "@/src/modules/shared/lib/utils"

const ROUTES = {
  bookings: "/dashboard/bookings",
  payments: "/dashboard/payments",
  reports: "/dashboard/reports",
  pendingBookings: "/dashboard/bookings?status=pending",
  verifyingPayments: "/dashboard/payments?status=for_review",
  confirmedBookings: "/dashboard/bookings?status=confirmed",
  cancelledBookings: "/dashboard/bookings?status=cancelled",
}

export default function AdminDashboardPage() {
  const { user } = useAuth()
  const router = useRouter()
  const bookingCtx = useBookings()
  const bookings = bookingCtx?.bookings || []

  useEffect(() => {
    if (user && user.role === "staff" && !user.permissions?.dashboard) {
      router.replace("/dashboard")
    }
  }, [user, router])

  const stats = useMemo(() => {
    const totalRevenue = bookings
      .filter((b) => b.status === "completed" || b.status === "confirmed")
      .reduce((acc, curr) => acc + getSafePrice(curr.totalPrice), 0)

    return {
      totalRevenue,
      pending: bookings.filter((b) => b.status === "pending").length,
      verifying: bookings.filter((b) => b.status === "verifying").length,
      confirmed: bookings.filter((b) => b.status === "confirmed").length,
      cancelled: bookings.filter(
        (b) => b.status === "cancelled" || b.status === "declined",
      ).length,
      cancellationRequests: bookings.filter(
        (b) => b.status === "cancellation_requested",
      ).length,
      total: bookings.length,
    }
  }, [bookings])

  const recentBookings = useMemo(() => {
    return [...bookings]
      .sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime(),
      )
      .slice(0, 4)
  }, [bookings])

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-x-hidden">
      <div className="border-b border-slate-200 pb-6 mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-orange-600">
              Admin Dashboard
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
              Management Overview
            </h1>
            <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">
              Monitor bookings, payments, approvals, and venue activity.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              href={ROUTES.bookings}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-orange-600 px-3 text-xs font-black text-white shadow-sm transition hover:bg-orange-700"
            >
              Manage Bookings
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
            <Link
              href={ROUTES.payments}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Review Payments
            </Link>
          </div>
        </div>
      </div>

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
            href={ROUTES.pendingBookings}
            icon={<Clock className="h-4 w-4" />}
            label="Pending"
            value={stats.pending.toString()}
            description="Needs approval"
            tone="amber"
          />
          <StatCard
            href={ROUTES.verifyingPayments}
            icon={<CreditCard className="h-4 w-4" />}
            label="Verifying"
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
              {recentBookings.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="space-y-3">
                  {recentBookings.map((booking) => (
                    <BookingRow
                      key={booking.id}
                      booking={booking}
                      statusBadge={getStatusBadge(booking.status)}
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
                  href={ROUTES.pendingBookings}
                  icon={<Clock className="h-4 w-4" />}
                  label="Pending approval"
                  value={stats.pending}
                  tone="orange"
                />
                <ActionItem
                  href={ROUTES.verifyingPayments}
                  icon={<CreditCard className="h-4 w-4" />}
                  label="Payment verifying"
                  value={stats.verifying}
                  tone="purple"
                />
                <ActionItem
                  href={ROUTES.cancelledBookings}
                  icon={<AlertCircle className="h-4 w-4" />}
                  label="Cancel requests"
                  value={stats.cancellationRequests}
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
  )
}

function getSafePrice(value: unknown) {
  if (typeof value === "number") return value
  const safePrice = String(value || "0").replace(/\D/g, "")
  return Number(safePrice) || 0
}

function formatCurrency(value: number) {
  return `₱${Number(value || 0).toLocaleString()}`
}

function getBookingTime(booking: any) {
  if (booking.time) return booking.time
  return `${booking.startTime || "—"} - ${booking.endTime || "—"}`
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
          Verifying
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
  icon,
  label,
  value,
  description,
  tone,
}: {
  href: string
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

  return (
    <Link
      href={href}
      className="group flex min-h-[110px] flex-col rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:p-4"
    >
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

      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">
        {label}
      </p>

      <h3 className="mt-0.5 truncate text-lg font-black tracking-tight text-slate-950 xl:text-xl 2xl:text-2xl">
        {value}
      </h3>

      <p className="mt-auto pt-1 text-[10px] font-medium leading-4 text-slate-500 sm:text-xs">
        {description}
      </p>
    </Link>
  )
}

function BookingRow({
  booking,
  statusBadge,
}: {
  booking: any
  statusBadge: React.ReactNode
}) {
  const isOffice = String(booking.venue || "").toLowerCase().includes("office")

  return (
    <Link
      href={ROUTES.bookings}
      className="group block rounded-xl border border-slate-200 bg-white p-3.5 transition hover:border-orange-200 hover:bg-orange-50/30 sm:p-4"
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
    </Link>
  )
}

function ActionItem({
  href,
  icon,
  label,
  value,
  tone,
}: {
  href: string
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

  return (
    <Link
      href={href}
      className="flex min-h-[58px] items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-2.5 transition hover:bg-slate-50 sm:p-3"
    >
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
    </Link>
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
