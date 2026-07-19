"use client"

import type React from "react"
import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Bell,
  Calendar,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  Star,
  User,
  Users,
  X,
} from "lucide-react"

import { Button } from "@/src/modules/shared/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/src/modules/shared/components/ui/dropdown-menu"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/src/modules/shared/components/ui/avatar"
import { Badge } from "@/src/modules/shared/components/ui/badge"

import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { cn } from "@/src/modules/shared/lib/utils"

interface MainLayoutProps {
  children: React.ReactNode
}

const MENU_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Booking Management", href: "/dashboard/bookings", icon: Calendar },
  { label: "Chat Support", href: "/dashboard/chat", icon: MessageSquare },
  { label: "Payment Verification", href: "/dashboard/payments", icon: CreditCard },
  { label: "Reports", href: "/dashboard/reports", icon: FileText },
  { label: "Staff Management", href: "/dashboard/staff", icon: Users },
  { label: "Content Management", href: "/content", icon: Settings },
  { label: "Customer Reviews", href: "/reviews", icon: Star },
  { label: "Users Information", href: "/dashboard/users", icon: User },
]

export function MainLayout({ children }: MainLayoutProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  const handleLogout = () => {
    logout()
    router.push("/")
  }

  const userName = user?.name ?? "Admin User"
  const userEmail = user?.email ?? "admin@oneestela.com"
  const userInitial = userName.charAt(0).toUpperCase()

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 font-sans text-slate-900">
      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white shadow-sm">
        <div className="flex h-16 items-center justify-between px-3 sm:px-4 lg:px-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setIsMobileMenuOpen((current) => !current)}
            >
              {isMobileMenuOpen ? <X className="h-5 w-5 shrink-0 overflow-hidden" /> : <Menu className="h-5 w-5 shrink-0 overflow-hidden" />}
            </Button>

            <Link href="/dashboard" className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-600 text-base font-black text-white shadow-sm">
                E
              </div>
              <div className="flex flex-col">
                <span className="text-base font-black leading-none tracking-tight text-slate-900">
                  One Estela Place
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-600">
                  Admin Console
                </span>
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="relative h-10 w-10 rounded-xl text-slate-500 hover:bg-slate-100"
            >
              <Bell className="h-5 w-5 shrink-0 overflow-hidden" />
              <Badge className="absolute right-2 top-2 h-2 w-2 rounded-full bg-orange-600 p-0 ring-2 ring-white" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative h-10 w-10 rounded-full p-0 hover:bg-slate-100"
                >
                  <Avatar className="h-8 w-8 sm:h-9 sm:w-9 border-2 border-orange-200">
                    <AvatarImage src="/placeholder-user.jpg" alt={userName} />
                    <AvatarFallback className="bg-orange-600 text-sm font-black text-white">
                      {userInitial}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent className="mt-2 w-56 rounded-2xl border-slate-200" align="end" forceMount>
                <div className="flex items-center gap-2 p-3">
                  <div className="flex min-w-0 flex-col space-y-1 leading-none">
                    <p className="truncate text-sm font-bold">{userName}</p>
                    <p className="truncate text-xs text-slate-500">{userEmail}</p>
                  </div>
                </div>

                <DropdownMenuSeparator />

                <DropdownMenuItem asChild className="cursor-pointer">
                  <Link href="/dashboard">
                    <LayoutDashboard className="mr-2 h-4 w-4 shrink-0 overflow-hidden" />
                    Dashboard
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuItem asChild className="cursor-pointer">
                  <Link href="/profile">
                    <User className="mr-2 h-4 w-4 shrink-0 overflow-hidden" />
                    Profile
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  className="cursor-pointer text-red-600 focus:text-red-600"
                  onClick={handleLogout}
                >
                  <LogOut className="mr-2 h-4 w-4 shrink-0 overflow-hidden" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 top-16 z-30 w-64 -translate-x-full border-r border-slate-200 bg-white transition-transform duration-200 md:sticky md:translate-x-0",
            isMobileMenuOpen && "translate-x-0"
          )}
        >
          <nav className="flex h-[calc(100vh-4rem)] h-[calc(100dvh-4rem)] flex-col gap-1 overflow-y-auto p-4">
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Admin Menu
            </p>

            {MENU_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                    isActive
                      ? "bg-gradient-to-r from-orange-50 to-amber-50 text-orange-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  )}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {isActive && (
                    <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-orange-600" />
                  )}
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 overflow-hidden",                      isActive ? "text-orange-600" : "text-slate-500 group-hover:text-slate-700"
                    )}
                  />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>
        </aside>

        {isMobileMenuOpen && (
          <div
            className="fixed inset-0 top-16 z-40 bg-slate-900/40 md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        <main className="flex-1 p-3 sm:p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
