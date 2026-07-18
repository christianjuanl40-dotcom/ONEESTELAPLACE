"use client"

import type React from "react"
import { useState } from "react"
import Link from "next/link"
import {
  Facebook,
  FileText,
  Instagram,
  LayoutDashboard,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  Phone,
  User,
} from "lucide-react"

import { Button } from "@shared/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@shared/components/ui/avatar"

import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useCMS } from "@/src/modules/admin/contexts/cms-context"
import { LoginDialog } from "@shared/auth/login-dialog"
import { SignupDialog } from "@shared/auth/signup-dialog"
import { UnifiedChatWidget } from "@shared/components/unified-chat-widget"
import { LogoutConfirmDialog } from "@shared/components/logout-confirm-dialog"

interface PublicLayoutProps {
  children: React.ReactNode
}

export function PublicLayout({ children }: PublicLayoutProps) {
  const { user, logout, isLoading } = useAuth()
  const { cmsData } = useCMS()
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  const handleLogout = () => {
    setShowLogoutConfirm(true)
  }

  const handleConfirmLogout = () => {
    setShowLogoutConfirm(false)
    logout()
  }

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" })
    } else {
      window.location.hash = ""
      window.location.hash = id
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen w-full max-w-full overflow-x-hidden flex-col font-sans">
        <header className="fixed top-0 left-0 right-0 z-[9999] bg-gradient-to-r from-orange-600 via-orange-600 to-orange-700 shadow-lg overflow-hidden">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-3 sm:px-4">
            <Link href="/" className="group flex items-center gap-3 shrink-0 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-xl font-black text-orange-600 shadow-sm">
                {(cmsData?.footer?.brandName || "One Estela Place").charAt(0)}
              </div>
              {(() => {
                const brand = cmsData?.footer?.brandName || "One Estela Place"
                const words = brand.split(" ")
                const last = words.length > 1 ? words.pop() : ""
                const rest = words.join(" ")
                return (
                  <span className="hidden sm:inline text-xl font-black tracking-tight text-white">
                    {rest} {last ? <span className="text-orange-100">{last}</span> : null}
                  </span>
                )
              })()}
            </Link>
          </div>
        </header>
      <main className="flex-1 pt-16 w-full max-w-full">{children}</main>
      <footer className="mt-auto w-full border-t border-slate-800 bg-slate-900 py-16 text-slate-300">
          <div className="container mx-auto max-w-7xl px-4 text-center text-sm text-slate-500">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
          </div>
        </footer>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen w-full max-w-full overflow-x-hidden flex-col font-sans">
        <header className="fixed top-0 left-0 right-0 z-[9999] bg-gradient-to-r from-orange-600 via-orange-600 to-orange-700 shadow-lg overflow-hidden">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-3 sm:px-4">
          <Link href="/" className="group flex items-center gap-3 shrink-0 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-xl font-black text-orange-600 shadow-sm transition-transform group-hover:scale-105">
              {(cmsData?.footer?.brandName || "One Estela Place").charAt(0)}
            </div>

            {(() => {
              const brand = cmsData?.footer?.brandName || "One Estela Place"
              const words = brand.split(" ")
              const last = words.length > 1 ? words.pop() : ""
              const rest = words.join(" ")
              return (
                <span className="hidden sm:inline text-xl font-black tracking-tight text-white">
                  {rest} {last ? <span className="text-orange-100">{last}</span> : null}
                </span>
              )
            })()}
          </Link>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="relative h-10 w-10 sm:h-11 sm:w-11 rounded-full border-2 border-white/50 p-0 hover:border-white hover:bg-white/10 shrink-0"
                  >
                    <Avatar className="h-8 w-8 sm:h-9 sm:w-9">
                      <AvatarImage src={user.profilePicture || "/placeholder-user.jpg"} alt={user.name} />
                      <AvatarFallback className="bg-white font-black text-orange-600">
                        {user.name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent
                  className="mt-2 w-56 rounded-2xl border-slate-200"
                  align="end"
                  forceMount
                >
                  <div className="flex items-center justify-start gap-2 p-3">
                    <div className="flex min-w-0 flex-col space-y-1 leading-none">
                      <p className="truncate font-bold">{user.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                  </div>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem asChild className="cursor-pointer">
                    <Link href="/portal">
                      <LayoutDashboard className="mr-2 h-4 w-4" />
                      Dashboard
                    </Link>
                  </DropdownMenuItem>

                  <DropdownMenuItem asChild className="cursor-pointer">
                    <Link href="/portal/bookings">
                      <FileText className="mr-2 h-4 w-4" />
                      My Bookings
                    </Link>
                  </DropdownMenuItem>

                  <DropdownMenuItem asChild className="cursor-pointer">
                    <Link href="/portal/profile">
                      <User className="mr-2 h-4 w-4" />
                      Profile Details
                    </Link>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    className="cursor-pointer text-red-600 focus:text-red-600"
                    onClick={handleLogout}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <div className="flex items-center gap-2 sm:gap-3">
                  <LoginDialog>
                    <Button className="h-9 rounded-xl bg-white px-4 text-xs font-black text-orange-600 shadow-sm hover:bg-orange-50 sm:h-10 sm:px-6 sm:text-sm">
                      Login
                    </Button>
                  </LoginDialog>

                  <SignupDialog>
                    <Button className="h-9 rounded-xl bg-slate-950 px-4 text-xs font-black text-white shadow-sm hover:bg-slate-900 sm:h-10 sm:px-6 sm:text-sm">
                      Sign Up
                    </Button>
                  </SignupDialog>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 pt-16 w-full max-w-full">{children}</main>

      <footer className="mt-auto border-t border-slate-800 bg-slate-900 py-16 text-slate-300">
        <div className="container mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 md:grid-cols-4">
          <div className="space-y-4">
            <h3 className="text-xl font-bold tracking-tight text-white">
              {cmsData?.footer?.brandName || "One Estela Place"}
            </h3>
            <p className="text-sm leading-relaxed text-slate-400">
              {cmsData?.footer?.footerDescription || "Creating unforgettable moments for your special events. The perfect place for weddings, birthdays, and corporate gatherings."}
            </p>
          </div>

          <div>
            <h4 className="mb-6 text-sm font-semibold uppercase tracking-wider text-white">
              Quick Links
            </h4>

            <ul className="flex flex-col items-start space-y-3 text-sm">
              <li>
                <button
                  type="button"
                  onClick={() => scrollToSection("home")}
                  className="transition-colors hover:text-orange-500"
                >
                  Home
                </button>
              </li>

              <li>
                <button
                  type="button"
                  onClick={() => scrollToSection("booking")}
                  className="transition-colors hover:text-orange-500"
                >
                  Book an Event
                </button>
              </li>

              <li>
                <button
                  type="button"
                  onClick={() => scrollToSection("gallery")}
                  className="transition-colors hover:text-orange-500"
                >
                  Client Gallery
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-6 text-sm font-semibold uppercase tracking-wider text-white">
              Contact Us
            </h4>

            <ul className="space-y-4 text-sm text-slate-400">
              <li className="flex items-start gap-3">
                <MapPin className="h-5 w-5 shrink-0 text-orange-500" />
                <span>
                  {cmsData?.footer?.address || "Carmona, Calabarzon, Philippines"}
                </span>
              </li>

              <li className="flex items-center gap-3">
                <Phone className="h-5 w-5 shrink-0 text-orange-500" />
                <span>{cmsData?.footer?.phone || "+63 917 123 4567"}</span>
              </li>

              <li className="flex items-center gap-3">
                <Mail className="h-5 w-5 shrink-0 text-orange-500" />
                <span className="break-all">{cmsData?.footer?.email || "inquiries@oneestelaplace.com"}</span>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-6 text-sm font-semibold uppercase tracking-wider text-white">
              Connect With Us
            </h4>

            <div className="flex gap-4">
              <a
                href={cmsData?.footer?.facebook || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 transition-colors hover:bg-orange-600 hover:text-white"
              >
                <Facebook className="h-5 w-5" />
              </a>

              <a
                href={cmsData?.footer?.instagram || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 transition-colors hover:bg-orange-600 hover:text-white"
              >
                <Instagram className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>

        <div className="container mx-auto mt-12 flex max-w-7xl flex-col items-center justify-between gap-4 border-t border-slate-800 px-4 pt-8 text-xs text-slate-500 md:flex-row">
          <p className="text-center md:text-left">© {new Date().getFullYear()} {cmsData?.footer?.copyrightText || "One Estela Place. All rights reserved."}</p>

          <div className="flex gap-6">
            <Link href="#" className="transition-colors hover:text-white">
              Privacy Policy
            </Link>

            <Link href="#" className="transition-colors hover:text-white">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>

      {user && user.role === "client" && <UnifiedChatWidget />}

      <LogoutConfirmDialog
        open={showLogoutConfirm}
        onOpenChange={setShowLogoutConfirm}
        onConfirm={handleConfirmLogout}
        description="Are you sure you want to log out of your account? You will be returned to the home page."
      />
    </div>
  )
}