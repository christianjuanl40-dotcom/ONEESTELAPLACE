"use client"

import { useRouter } from "next/navigation"
import { Bell, CheckCheck, Calendar, FileText, XCircle, AlertTriangle, RotateCcw } from "lucide-react"
import { Button } from "./ui/button"
import { cn } from "../lib/utils"
import { useNotifications } from "../contexts/notification-context"
import type { NotificationType } from "../lib/notifications"
import { useEffect, useRef, useState } from "react"
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
  booking_updated: Calendar,
  booking_cancelled: XCircle,
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
  const [expandedNotificationIds, setExpandedNotificationIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) setExpandedNotificationIds(new Set())
  }, [open])

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
        className="fixed left-2 right-2 top-[72px] z-50 mx-auto flex max-h-[70vh] w-auto max-w-[360px] min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+12px)] sm:mx-0 sm:w-96 sm:max-w-[calc(100vw-1rem)]"
      >
        {/* Sticky Header */}
        <div className="z-10 flex shrink-0 items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur-sm">
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
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
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
             <div className="divide-y divide-slate-100/80">
               {notifications.map((n) => {
                 const IconComponent = typeIcons[n.type] ?? Bell
                 const notificationTitle = n.title || formatNotificationLabel(n.type)
                 const notificationMessage = String(n.message || "")
                 const timestampDate = toValidDate(n.createdAt)
                 const timestampLabel = formatManilaDateTime(n.createdAt)
                 const timestampFallback = "Date not recorded"
                 const destination = getSafeInternalDestination(n.link)
                 const notificationKey = n.id || `${n.type}-${notificationTitle}`
                 const isExpanded = expandedNotificationIds.has(notificationKey)
                 const isLongMessage = notificationMessage.length > 180 || notificationMessage.includes("\n")

                 const openNotification = () => {
                   if (n.bookingId && destination) {
                     const isPayment = destination.includes("/dashboard/payments")
                     if (isPayment) {
                       sessionStorage.setItem("admin_payment_highlight", n.bookingId)
                       window.dispatchEvent(new CustomEvent("admin-payment-highlight", { detail: { paymentId: n.bookingId } }))
                     } else if (destination.includes("/portal/payments")) {
                       sessionStorage.setItem("client_payment_highlight", n.bookingId)
                       window.dispatchEvent(new CustomEvent("client-payment-highlight", { detail: { bookingId: n.bookingId } }))
                     } else if (destination.includes("/dashboard")) {
                       sessionStorage.setItem("admin_booking_highlight", n.bookingId)
                       window.dispatchEvent(new CustomEvent("admin-booking-highlight", { detail: { bookingId: n.bookingId } }))
                     } else {
                       sessionStorage.setItem("client_booking_highlight", n.bookingId)
                       window.dispatchEvent(new CustomEvent("client-booking-highlight", { detail: { bookingId: n.bookingId } }))
                     }
                   }
                   if (n.id) void markAsRead(n.id)
                   if (destination) router.push(destination)
                   onClose()
                 }

                 return (
                   <div
                     key={notificationKey}
                     className={cn(
                       "flex min-w-0 items-start gap-3 px-4 py-3.5 transition-colors sm:py-3",
                       !n.isRead ? "bg-blue-50/40" : "bg-white",
                     )}
                   >
                     <div
                       className={cn(
                         "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
                         !n.isRead ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500",
                       )}
                     >
                       <IconComponent className="h-4 w-4" aria-hidden="true" />
                     </div>

                     <div className="min-w-0 flex-1">
                       <button
                         type="button"
                         onClick={openNotification}
                         aria-label={`Open notification: ${notificationTitle}. ${notificationMessage}`}
                         className="group min-w-0 w-full rounded-md text-left transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500"
                       >
                         <span
                           className={cn(
                             "block break-words text-sm leading-5 tracking-tight",
                             !n.isRead ? "font-bold text-slate-900" : "font-semibold text-slate-700",
                           )}
                         >
                           {notificationTitle}
                         </span>
                         <time
                           dateTime={timestampDate?.toISOString()}
                           title={timestampLabel || timestampFallback}
                           className="mt-1 block text-[11px] font-medium tabular-nums leading-4 text-slate-500"
                         >
                           {timestampLabel || timestampFallback}
                         </time>
                         <span
                           className={cn(
                             "mt-1 block break-words text-xs leading-5",
                             isLongMessage && !isExpanded && "line-clamp-3",
                             !n.isRead ? "font-medium text-slate-600" : "text-slate-500",
                           )}
                         >
                           {notificationMessage || "No message provided."}
                         </span>
                       </button>
                       {isLongMessage && (
                         <button
                           type="button"
                           aria-expanded={isExpanded}
                           onClick={() => setExpandedNotificationIds((current) => {
                             const next = new Set(current)
                             if (next.has(notificationKey)) next.delete(notificationKey)
                             else next.add(notificationKey)
                             return next
                           })}
                           className="mt-1 rounded-sm text-[11px] font-bold text-orange-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                         >
                           {isExpanded ? "Show less" : "Read full message"}
                         </button>
                       )}
                     </div>

                     <div className="flex h-9 shrink-0 items-center justify-center" aria-label={n.isRead ? "Read notification" : "Unread notification"}>
                       {!n.isRead ? (
                         <span className="h-2 w-2 rounded-full bg-blue-500 shadow-sm" aria-hidden="true" />
                       ) : (
                         <span className="h-2 w-2 rounded-full bg-transparent" aria-hidden="true" />
                       )}
                     </div>
                   </div>
                 )
               })}
             </div>
          )}
        </div>
      </div>
    </>
  )
}
