"use client"

import { useRouter } from "next/navigation"
import { Bell, CheckCheck, Calendar, FileText, XCircle, AlertTriangle } from "lucide-react"
import { Button } from "./ui/button"
import { cn } from "../lib/utils"
import { useNotifications } from "../contexts/notification-context"
import type { NotificationType } from "../lib/notifications"
import { useEffect, useRef } from "react"

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
}

// Fallback label formatter if a booking number isn't present
function formatNotificationLabel(type: string): string {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function formatTimestamp(ts: any): string {
  if (!ts) return ""
  const date = ts?.toDate ? ts.toDate() : new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

interface Props {
  open: boolean
  onClose: () => void
}

export function NotificationDropdown({ open, onClose }: Props) {
  const router = useRouter()
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications()
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

  function handleClick(n: { id?: string; isRead: boolean; link: string }) {
    if (n.id) markAsRead(n.id)
    router.push(n.link)
    onClose()
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={ref}
        className="fixed left-2 right-2 top-[72px] z-50 mx-auto flex max-h-[70vh] w-auto max-w-[360px] flex-col border border-slate-200 bg-white shadow-2xl rounded-xl sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+12px)] sm:mx-0 sm:w-80 sm:max-w-none"
      >
        {/* Sticky Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur-sm z-10">
          <h3 className="text-sm font-bold text-slate-800">Notifications</h3>
          {unreadCount > 0 && (
            <Button
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
          {notifications.length === 0 ? (
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
                
                // Use bookingNumber or bookingId if available, fallback to formatted event type
                const notificationTitle = (n as any).bookingNumber || (n as any).bookingId
                  ? `Booking #${(n as any).bookingNumber || (n as any).bookingId}`
                  : formatNotificationLabel(n.type)

                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={cn(
                      "group flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none sm:py-3",
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
                          {formatTimestamp(n.createdAt)}
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