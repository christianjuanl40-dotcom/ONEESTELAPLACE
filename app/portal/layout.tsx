"use client"

import type React from "react"
import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  Calendar,
  FileText,
  MessageSquare,
  User,
  LogOut,
  Menu,
  Bell,
} from "lucide-react"

import { Button } from "@/src/modules/shared/components/ui/button"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useChat } from "@/src/modules/shared/contexts/chat-context"
import { ClientChatWidget } from "@/src/modules/shared/components/chat-widget"
import { getUnreadCount, subscribeScopeUnread } from "@/src/modules/shared/lib/chat-unread"
import { CHAT_LABELS } from "@/src/modules/shared/lib/labels"
import { cn } from "@/src/modules/shared/lib/utils"
import { LogoutConfirmDialog } from "@/src/modules/shared/components/logout-confirm-dialog"
import { UserAvatar } from "@/src/modules/shared/components/user-avatar"
import { useNotifications } from "@/src/modules/shared/contexts/notification-context"
import { NotificationDropdown } from "@/src/modules/shared/components/notification-dropdown"

const CLIENT_MENU = [
  { name: "Dashboard", href: "/portal", icon: LayoutDashboard, key: "dashboard" },
  { name: "My Bookings", href: "/portal/bookings", icon: Calendar, key: "bookings" },
  { name: "My Transactions", href: "/portal/payments", icon: FileText, key: "transactions" },
  { name: "Chat Support", href: "/portal/chat", icon: MessageSquare, key: "chat" },
]

const BOTTOM_MENU = [
  { name: "Profile", href: "/portal/profile", icon: User, key: "profile" },
]

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { toast } = useToast()

  const { user, isLoading, logout } = useAuth()
  const { messages } = useChat()
  const { unreadCount: notificationUnread } = useNotifications()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [chatUnread, setChatUnread] = useState(0)
  const [showNotifications, setShowNotifications] = useState(false)

  useEffect(() => {
    if (!user) return
    getUnreadCount("client").then(setChatUnread)
    return subscribeScopeUnread("client", setChatUnread)
  }, [user])

  useEffect(() => {
    if (!user?.id) return
    const unreadFromMessages =
      messages?.filter(
        (m: any) =>
          m.clientId === user.id && m.sender === "admin" && !m.isReadByClient,
      ).length || 0
    if (unreadFromMessages > 0 && chatUnread === 0) {
      setChatUnread(unreadFromMessages)
    }
  }, [messages, user?.id, chatUnread])

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      console.log("[PortalLayout] No user, redirecting to /")
      router.push("/")
      return
    }
    const role = user.role?.toLowerCase() ?? ""
    console.log("[PortalLayout] Route guard check — role:", role)
    if (role === "admin") {
      console.log("[PortalLayout] Admin role detected, redirecting to /dashboard")
      router.push("/dashboard")
    } else if (role !== "client") {
      console.log("[PortalLayout] Invalid/missing role:", role, "redirecting to /")
      router.push("/")
    } else {
      console.log("[PortalLayout] Auth OK", { userId: user.id, role })
    }
  }, [user, isLoading, router])

  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [pathname])

  const handleConfirmLogout = () => {
    setShowLogoutConfirm(false)
    toast({
      title: "Logged out",
      description: "See you next time!",
    })
    logout()
  }

  if (isLoading || !user) return null

  const profilePicture = user.profilePicture

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-slate-50">
      <header className="z-50 flex h-16 shrink-0 items-center justify-between bg-gradient-to-r from-orange-600 via-orange-600 to-orange-700 text-white shadow-lg">
        <div className="flex h-full shrink-0 items-center gap-3 px-3 sm:px-4 lg:w-64 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2 shrink-0 text-white hover:bg-white/15 lg:hidden"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            <Menu className="h-5 w-5 shrink-0 overflow-hidden" />
          </Button>

          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 backdrop-blur">
              <span className="text-base font-black text-white">O</span>
            </div>
            <h1 className="hidden sm:inline text-lg font-black tracking-tight text-white whitespace-nowrap">
              One Estela Place
            </h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 px-2 sm:gap-3 sm:px-3 lg:px-6">
          <div className="relative shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="relative h-9 w-9 shrink-0 rounded-full text-white hover:bg-white/15"
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5 shrink-0" />
              {notificationUnread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black tabular-nums text-white shadow-md ring-2 ring-orange-700">
                  {notificationUnread > 99 ? "99+" : notificationUnread}
                </span>
              )}
            </Button>
            <NotificationDropdown
              open={showNotifications}
              onClose={() => setShowNotifications(false)}
            />
          </div>

          <Link
            href="/portal/profile"
            className="flex shrink-0 items-center gap-2 sm:gap-3 rounded-full p-1 pr-1 sm:pr-3 transition hover:bg-white/10"
          >
            <div className="hidden text-right md:block">
              <p className="text-[13px] font-bold capitalize leading-tight text-white">
                {user.name}
              </p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-100">
                Client
              </p>
            </div>

            <UserAvatar
              name={user.name}
              picture={profilePicture}
              className="h-9 w-9"
            />
          </Link>
        </div>
      </header>

      <div className="relative flex min-w-0 flex-1 overflow-hidden">
        {isMobileMenuOpen && (
          <div
            className="absolute inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        <aside
          className={`absolute inset-y-0 left-0 z-50 flex h-full w-64 flex-col border-r border-slate-200 bg-white shadow-2xl transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 lg:shadow-none ${
            isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {/* Scrollable navigation */}
          <nav className="flex-1 space-y-1 overflow-y-auto p-3 pt-6">
            {CLIENT_MENU.map((item) => {
              const isActive =
                item.href === "/portal"
                  ? pathname === "/portal"
                  : pathname.startsWith(item.href)
              const showChatBadge = item.key === "chat" && chatUnread > 0

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "group relative flex items-center justify-between rounded-lg px-3 py-2.5 text-[14px] font-bold transition-all",
                    isActive
                      ? "bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-md shadow-orange-500/20"
                      : "text-slate-600 hover:bg-orange-50/60 hover:text-orange-700",
                  )}
                >
                  {isActive && (
                    <span className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-orange-700" />
                  )}
                  <div className="flex items-center">
                    <item.icon
                      className={cn(
                        "mr-3 h-4 w-4 shrink-0 overflow-hidden transition-colors",
                        isActive ? "text-white" : "text-slate-400 group-hover:text-orange-500",
                      )}
                    />
                    {item.name}
                  </div>

                  {showChatBadge && (
                    <span
                      className={cn(
                        "flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-black tabular-nums",
                        isActive
                          ? "bg-white text-orange-700"
                          : "bg-rose-500 text-white",
                      )}
                    >
                      {chatUnread > 99 ? "99+" : chatUnread}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>

          {/* Fixed bottom section: Profile + Logout */}
          <div className="shrink-0 border-t border-slate-100 p-3">
            {BOTTOM_MENU.map((item) => {
              const isActive =
                item.href === "/portal"
                  ? pathname === "/portal"
                  : pathname.startsWith(item.href)

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "group relative flex items-center rounded-lg px-3 py-2.5 text-[14px] font-bold transition-all",
                    isActive
                      ? "bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-md shadow-orange-500/20"
                      : "text-slate-600 hover:bg-orange-50/60 hover:text-orange-700",
                  )}
                >
                  {isActive && (
                    <span className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-orange-700" />
                  )}
                  <item.icon
                    className={cn(
                      "mr-3 h-4 w-4 shrink-0 overflow-hidden transition-colors",
                      isActive ? "text-white" : "text-slate-400 group-hover:text-orange-500",
                    )}
                  />
                  {item.name}
                </Link>
              )
            })}

            <button
              type="button"
              className="group relative flex w-full items-center rounded-lg px-3 py-2.5 text-[14px] font-bold text-rose-600 transition-all hover:bg-rose-50 hover:text-rose-700"
              onClick={() => setShowLogoutConfirm(true)}
            >
              <LogOut className="mr-3 h-4 w-4 shrink-0 overflow-hidden" />
              Logout
            </button>
          </div>
        </aside>

        <main
          className={`min-w-0 flex-1 overflow-y-auto ${
            pathname === "/portal/chat" ? "p-0" : "p-3 pb-28 sm:p-4 sm:pb-8 md:p-6 md:pb-10 lg:p-8"
          }`}
        >
          {children}
        </main>
      </div>

      <ClientChatWidget />

      <LogoutConfirmDialog
        open={showLogoutConfirm}
        onOpenChange={setShowLogoutConfirm}
        onConfirm={handleConfirmLogout}
        description="Are you sure you want to log out of your account? You will need to log in again to access your bookings."
      />
    </div>
  )
}
