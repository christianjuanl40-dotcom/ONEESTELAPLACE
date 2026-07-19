"use client"

import type React from "react"
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useChat } from "@/src/modules/shared/contexts/chat-context"
import { StaffProvider } from "@/src/modules/admin/contexts/staff-context"

import {
  LayoutDashboard,
  BookOpen,
  MessageSquare,
  CreditCard,
  BarChart,
  Users,
  Settings,
  UserCheck,
  LogOut,
  Bell,
  Menu,
} from "lucide-react"

import { Button } from "@/src/modules/shared/components/ui/button"

import { cn } from "@/src/modules/shared/lib/utils"
import { LogoutConfirmDialog } from "@/src/modules/shared/components/logout-confirm-dialog"
import { UserAvatar } from "@/src/modules/shared/components/user-avatar"
import { useNotifications } from "@/src/modules/shared/contexts/notification-context"
import { NotificationDropdown } from "@/src/modules/shared/components/notification-dropdown"

import type { StaffPermissions } from "@/src/modules/shared/types/permissions"

const PERMISSION_MAP: Record<string, keyof StaffPermissions> = {
  dashboard: "dashboard",
  bookings: "bookings",
  chat: "chat",
  payments: "payments",
  reports: "reports",
  cms: "cms",
  users: "users",
}

const ADMIN_MENU = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, key: "dashboard", exact: true },
  { name: "Booking Management", href: "/dashboard/bookings", icon: BookOpen, key: "bookings" },
  { name: "Payment Verification", href: "/dashboard/payments", icon: CreditCard, key: "payments" },
  { name: "Chat Support", href: "/dashboard/chat", icon: MessageSquare, key: "chat" },
  { name: "Reports", href: "/dashboard/reports", icon: BarChart, key: "reports" },
  { name: "Staff Management", href: "/dashboard/staff", icon: Users, key: "staff" },
  { name: "CMS Settings", href: "/dashboard/cms", icon: Settings, key: "cms" },
  { name: "Users Information", href: "/users", icon: UserCheck, key: "users" },
]


export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { logout, user, isLoading } = useAuth()
  const { messages } = useChat()
  const { unreadCount: notificationUnread } = useNotifications()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [chatUnread, setChatUnread] = useState(0)
  const [showNotifications, setShowNotifications] = useState(false)

  const visibleMenu = useMemo(() => {
    if (!user) return []
    if (user.role === "admin") return ADMIN_MENU
    const perms = user.permissions
    if (!perms) return []
    return ADMIN_MENU.filter((item) => {
      const permKey = PERMISSION_MAP[item.key]
      return permKey ? perms[permKey] === true : false
    })
  }, [user])

  useEffect(() => {
    const count = messages?.filter((m) => m.sender === "client" && !m.isRead).length || 0
    setChatUnread(count)
  }, [messages])

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      router.replace("/")
      return
    }
    const role = user.role?.toLowerCase() ?? ""
    console.log("[AdminLayout] Route guard check — role:", role)
    if (role !== "admin" && role !== "staff") {
      console.log("[AdminLayout] Non-admin/staff role:", role, "redirecting to /")
      router.replace("/")
    } else {
      console.log("[AdminLayout] Auth OK", { userId: user.id, role })
    }
  }, [user, isLoading, router])

  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [pathname])

  const handleConfirmLogout = () => {
    setShowLogoutConfirm(false)
    logout()
  }

  if (isLoading || !user) return null

  const profilePicture = user.profilePicture

  return (
      <div className="relative flex h-screen w-full flex-col overflow-hidden bg-slate-50">
        {/* ORANGE HEADER matching client portal */}
        <header className="z-50 flex h-16 shrink-0 items-center justify-between bg-gradient-to-r from-orange-600 via-orange-600 to-orange-700 text-white shadow-lg">
          <div className="flex h-full shrink-0 items-center gap-3 px-3 sm:px-4 lg:px-0 lg:w-64">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-2 text-white hover:bg-white/15 lg:hidden"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              <Menu className="h-5 w-5 shrink-0 overflow-hidden" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg bg-white/15 backdrop-blur">
                <span className="text-base font-black text-white">O</span>
              </div>
              <h1 className="text-lg font-black tracking-tight text-white hidden sm:inline">
                One Estela Place
              </h1>
              <h1 className="sm:hidden text-base font-black tracking-tight text-white">
                OEP
              </h1>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-end gap-3 px-3 sm:px-4 lg:px-0">
            <div className="flex items-center gap-3 pl-2 lg:pl-4">
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="relative shrink-0 rounded-full text-white hover:bg-white/15"
                onClick={() => setShowNotifications(!showNotifications)}
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5 shrink-0 overflow-hidden" />
                {notificationUnread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black tabular-nums text-white shadow-md ring-2 ring-orange-700">
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
                href="/dashboard"
                className="flex items-center gap-3 rounded-full p-1 pr-3 transition hover:bg-white/10"
              >
                <div className="hidden text-right md:block">
                  <p className="text-[13px] font-bold capitalize leading-tight text-white">
                    {user.name}
                  </p>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-100">
                    Admin
                  </p>
                </div>
                <UserAvatar
                  name={user.name}
                  picture={profilePicture}
                  className="h-8 w-8 sm:h-9 sm:w-9"
                />
              </Link>
            </div>
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
            {/* Scrollable navigation - no admin user block at top */}
            <nav className="flex-1 space-y-1 overflow-y-auto p-3 pt-6">
              {visibleMenu.map((item) => {
                const isActive = item.exact
                  ? pathname === item.href
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

            {/* Fixed bottom section: Logout */}
            <div className="shrink-0 border-t border-slate-100 p-3">
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

          <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50">
            <StaffProvider>
              {children}
            </StaffProvider>
          </main>
        </div>

        <LogoutConfirmDialog
          open={showLogoutConfirm}
          onOpenChange={setShowLogoutConfirm}
          onConfirm={handleConfirmLogout}
          description="Are you sure you want to log out of the admin console? You will be returned to the home page."
        />
      </div>
  )
}

