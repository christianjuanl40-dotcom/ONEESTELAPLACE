"use client"

import type React from "react"
import { useEffect, useState } from "react" 
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard, Users, LogOut, BookOpen, MessageSquare,
  CreditCard, BarChart3, Settings, UserCheck, Menu, Bell, Search, X
} from "lucide-react"

import { Button } from "@/src/modules/shared/components/ui/button"
import { Badge } from "@/src/modules/shared/components/ui/badge"
import { Input } from "@/src/modules/shared/components/ui/input"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { useBookings } from "@/src/modules/client/contexts/booking-context"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useChat } from "@/src/modules/shared/contexts/chat-context"

interface MainLayoutProps {
  children: React.ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { toast } = useToast()
  
  const { logout, user, isLoading } = useAuth() 
  const chat = useChat()
  const unreadCount = "getUnreadCount" in chat ? chat.getUnreadCount() : 0
  const { bookings } = useBookings()
  
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  const hasPendingBookings = bookings?.some((b) => b.status === "pending")
  const pendingPayments = bookings?.filter((b) => b.status === "verifying").length || 0

  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        router.push("/")
      } else if (user.role === "client" && pathname.startsWith("/dashboard")) {
        router.push("/portal")
      }
    }
  }, [user, isLoading, router, pathname])

  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [pathname])

  const menuItems = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Booking Management", href: "/dashboard/bookings", icon: BookOpen, hasPingBadge: hasPendingBookings },
    { name: "Customer Chat", href: "/dashboard/chat", icon: MessageSquare, hasDotBadge: unreadCount > 0 },
    { name: "Payment Verification", href: "/dashboard/payments", icon: CreditCard, badge: pendingPayments > 0 ? pendingPayments : undefined },
    { name: "Reports & Analytics", href: "/dashboard/reports", icon: BarChart3 },
    { name: "Staff Management", href: "/dashboard/staff", icon: UserCheck },
    { name: "CMS Settings", href: "/dashboard/cms", icon: Settings },
    { name: "Users Information", href: "/users", icon: Users },
  ]

  const handleLogout = () => {
    toast({ title: "Logged out", description: "You have been successfully logged out" })
    localStorage.removeItem("mock_client_id")
    localStorage.removeItem("mock_guest_id")
    logout()
    router.push("/")
  }

  if (isLoading || !user) return null

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 w-full">
      
      {/* SOLID SEAMLESS ORANGE TOP HEADER */}
      <header className="h-16 bg-orange-600 text-white flex items-center justify-between shrink-0 z-50 shadow-md px-3 sm:px-4 lg:px-0 overflow-hidden">
        
        <div className="flex items-center lg:w-60 lg:px-5 shrink-0 gap-3 min-w-0">
          <Button variant="ghost" size="icon" className="lg:hidden text-white hover:bg-orange-500 -ml-2 shrink-0" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
            <Menu className="h-5 w-5 shrink-0 overflow-hidden" />
          </Button>
          <h1 className="text-base sm:text-lg font-black tracking-tight text-white whitespace-nowrap truncate">One Estela Place</h1>
        </div>

        {/* HEADER ACTIONS (Search + Notif + Profile Magkakatabi) */}
        <div className="flex items-center justify-end lg:px-8 gap-3 sm:gap-4 lg:gap-6 shrink-0 min-w-0">
          
          <div className="hidden md:flex items-center relative">
              <Search className="h-4 w-4 absolute left-3 text-orange-200 shrink-0 overflow-hidden" />
             <Input 
               type="text" 
               placeholder="Search for bookings, users..." 
               className="w-[250px] pl-9 bg-white/20 border-transparent h-9 text-xs text-white placeholder:text-orange-100 rounded-full focus-visible:ring-2 focus-visible:ring-white transition-all focus:w-[350px]" 
             />
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
             <Button variant="ghost" size="icon" className="relative text-white hover:bg-orange-500 rounded-full shrink-0">
               <Bell className="h-5 w-5 shrink-0 overflow-hidden" />
               <span className="absolute top-1 right-1.5 w-2 h-2 bg-slate-900 rounded-full border border-orange-600"></span>
             </Button>
             
             <div className="flex items-center gap-2 sm:gap-3 shrink-0">
               <div className="hidden md:block text-right">
                 <p className="text-xs font-bold text-white leading-none">{user.name}</p>
                 <p className="text-[10px] text-orange-200 font-medium capitalize mt-1">{user.role}</p>
               </div>
               <div className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-full bg-white text-orange-600 flex items-center justify-center font-bold text-xs uppercase shadow-sm">
                 {user.name?.charAt(0) || "A"}
               </div>
             </div>
          </div>
          
        </div>
      </header>

      {/* LOWER SECTION (Sidebar & Content) */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {isMobileMenuOpen && (
          <div className="absolute inset-0 bg-slate-900/50 z-40 lg:hidden backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />
        )}

        <div className={`absolute inset-y-0 left-0 z-50 w-60 bg-white border-r border-slate-200 shadow-2xl lg:shadow-none transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 flex flex-col ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <nav className="flex-1 space-y-0.5 p-3 overflow-y-auto mt-2">
            {menuItems.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center justify-between rounded-md px-3 py-2 text-[13px] font-bold transition-all ${
                    isActive ? "bg-orange-50 text-orange-700 shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <div className="flex items-center">
                    <item.icon className={`mr-2.5 h-4 w-4 shrink-0 overflow-hidden ${isActive ? "text-orange-600" : "text-slate-400"}`} />
                    {item.name}
                  </div>
                  {item.hasPingBadge && (
                    <span className="relative flex h-2 w-2 ml-auto">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                    </span>
                  )}
                  {item.hasDotBadge && <span className="w-2 h-2 bg-rose-500 rounded-full shadow-sm ml-auto"></span>}
                  {item.badge && (
                    <Badge className="bg-rose-500 text-white border-none text-[9px] px-1.5 py-0 min-w-[18px] flex items-center justify-center ml-auto">
                      {item.badge}
                    </Badge>
                  )}
                </Link>
              )
            })}
          </nav>

          <div className="border-t border-slate-100 p-3 bg-slate-50/50">
            <Button variant="ghost" className="flex w-full items-center justify-start text-rose-600 hover:text-rose-700 hover:bg-rose-50 h-9 text-xs font-bold px-3" onClick={handleLogout}>
              <LogOut className="mr-3 h-4 w-4 shrink-0 overflow-hidden" /> Logout
            </Button>
          </div>
        </div>

        <main className={`flex-1 overflow-auto ${pathname === "/dashboard/chat" ? "p-0" : "p-3 sm:p-4 md:p-6 lg:p-8"}`}>
          {children}
        </main>
      </div>
    </div>
  )
}

export default MainLayout