"use client"

import { useRouter } from "next/navigation"
import { Bell, CheckCheck, Calendar, FileText, XCircle, AlertTriangle, RotateCcw } from "lucide-react"
import { Button } from "./ui/button"
import { cn } from "../lib/utils"
import { useNotifications } from "../contexts/notification-context"
import type { NotificationType } from "../lib/notifications"
import { useEffect, useRef } from "react"
import { formatManilaDateTime, toValidDate } from "../lib/time-format"

const typeIcons: Record<NotificationType, typeof Bell> = {
  booking_submitted: Calendar,
  booking_approved: Calendar,
  booking_rejected: XCircle,
  modification_requested: Calendar,
  modification_approved: Calendar,
  modification_declined: XCircle,
  cancellation_requested: Calendar,
  cancellation_approved: Calendar,
  cancellation_declined: XCircle,
  payment_submitted: FileText,
  payment_approved: FileText,
  payment_rejected: XCircle,
  payment_incomplete: AlertTriangle,
  remaining_balance_submitted: FileText,
  remaining_balance_approved: FileText,
  remaining_balance_rejected: XCircle,
  maintenance_conflict: AlertTriangle,
  balance_reminder: Bell,
  refund_requested: RotateCcw,
  refund_completed: CheckCheck,
}

// Fallback label formatter if a booking number isn't present
function formatNotificationLabel(type: string): string {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function getSafeInternalDestination(value: unknown): string | null {
  if (typeof value !== "string") return null
  const link = value.trim()
  if (!link || !link.startsWith("/") || link.startsWith("//")) return null
  try {
    const destination = new URL(link, window.location.origin)
    if (destination.origin !== window.location.origin) return null
    return `${destination.pathname}${destination.search}${destination.hash}`
  } catch {
    return null
  }
}

interface Props {
  id?: string
  open: boolean
  onClose: () => void
}

export function NotificationDropdown({ id, open, onClose }: Props) {
  const router = useRouter()
  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    retryNotifications,
    markAsRead,
    markAllAsRead,
  } = useNotifications()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        id={id}
        ref={ref}
        role="dialog"
        aria-label="Notifications"
        className="fixed left-2 right-2 top-[72px] z-50 mx-auto flex max-h-[70vh] w-auto max-w-[360px] flex-col border border-slate-200 bg-white shadow-2xl rounded-xl sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+12px)] sm:mx-0 sm:w-80 sm:max-w-none"
      >
        {/* Sticky Header */}
         <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur-sm z-10">
           <h3 className="text-sm font-bold text-slate-800">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1.5 px-2 text-[11px] font-bold text-slate-500 hover:text-slate-800"
              onClick={markAllAsRead}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Mark all read</span>
              <span className="sm:hidden">All read</span>
            </Button>
          )}
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {isLoading ? (
            <div className="flex min-h-40 items-center justify-center px-4 py-10 text-center" role="status">
              <p className="text-sm font-medium text-slate-500">Loading notifications…</p>
            </div>
          ) : error ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 py-10 text-center" role="alert">
              <p className="max-w-[260px] text-sm font-medium text-rose-700">{error}</p>
              <Button variant="outline" size="sm" onClick={retryNotifications}>
                Retry notifications
              </Button>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
              <div className="rounded-full bg-slate-50 p-4">
                <Bell className="h-8 w-8 text-slate-300" />
              </div>
              <p className="text-sm font-semibold text-slate-500">No notifications yet</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50/50">
              {notifications.map((n) => {
                const IconComponent = typeIcons[n.type] ?? Bell
                
                const notificationTitle = n.title || formatNotificationLabel(n.type)

                 const timestampLabel = formatManilaDateTime(n.createdAt)
                 const destination = getSafeInternalDestination(n.link)

                 return (
                    <button
                      type="button"
                      key={n.id}
                      onClick={() => {
                        if (n.bookingId && destination) {
                          const isPayment = destination.includes("/dashboard/payments")
                          if (isPayment) {
                           sessionStorage.setItem(
                             "admin_payment_highlight",
                             n.bookingId
                           )
                           window.dispatchEvent(
                             new CustomEvent("admin-payment-highlight", {
                               detail: { paymentId: n.bookingId },
                             })
                           )
                          } else if (destination.includes("/portal/payments")) {
                           sessionStorage.setItem(
                             "client_payment_highlight",
                             n.bookingId
                           )
                           window.dispatchEvent(
                             new CustomEvent("client-payment-highlight", {
                               detail: { bookingId: n.bookingId },
                             })
                           )
                          } else if (destination.includes("/dashboard")) {
                           sessionStorage.setItem(
                             "admin_booking_highlight",
                             n.bookingId
                           )
                           window.dispatchEvent(
                             new CustomEvent("admin-booking-highlight", {
                               detail: { bookingId: n.bookingId },
                             })
                           )
                         } else {
                           sessionStorage.setItem(
                             "client_booking_highlight",
                             n.bookingId
                           )
                           window.dispatchEvent(
                             new CustomEvent("client-booking-highlight", {
                               detail: { bookingId: n.bookingId },
                             })
                           )
                         }
                        }
                        if (n.id) void markAsRead(n.id)
                        if (destination) router.push(destination)
                        onClose()
                      }}
                    className={cn(
                      "group flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500 sm:py-3",
                      !n.isRead && "bg-blue-50/40"
                    )}
                   >
                    <div
                      className={cn(
                        "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
                        !n.isRead
                          ? "bg-blue-100 text-blue-600"
                          : "bg-slate-100 text-slate-500 group-hover:bg-slate-200"
                      )}
                    >
                      <IconComponent className="h-4 w-4" />
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p
                          className={cn(
                            "min-w-0 flex-1 truncate text-sm tracking-tight",
                            !n.isRead ? "font-bold text-slate-900" : "font-semibold text-slate-700"
                          )}
                        >
                          {notificationTitle}
                        </p>
                        <p className="shrink-0 whitespace-nowrap text-[10px] font-medium tabular-nums text-slate-400">
                           <time dateTime={toValidDate(n.createdAt)?.toISOString()} title={timestampLabel || "Timestamp unavailable"}>
                             {timestampLabel || "Time unavailable"}
                           </time>
                        </p>
                      </div>

                      <p
                        className={cn(
                          "line-clamp-2 text-xs leading-relaxed",
                          !n.isRead ? "font-medium text-slate-600" : "text-slate-500"
                        )}
                      >
                        {n.message}
                      </p>
                    </div>

                    <div className="flex h-9 shrink-0 items-center justify-center">
                      {!n.isRead ? (
                        <span className="h-2 w-2 rounded-full bg-blue-500 shadow-sm" />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-transparent" />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
