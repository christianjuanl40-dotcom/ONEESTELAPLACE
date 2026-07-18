"use client"

import type React from "react"
import { AuthProvider } from "@/src/modules/shared/auth/auth-context"
import { ChatProvider } from "@/src/modules/shared/contexts/chat-context"
import { BookingProvider } from "@/src/modules/client/contexts/booking-context"
import { CMSProvider } from "@/src/modules/admin/contexts/cms-context"
import { NotificationProvider } from "@/src/modules/shared/contexts/notification-context"
import { Toaster } from "@/src/modules/shared/components/ui/toaster"

export function GlobalProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ChatProvider>
        <BookingProvider>
          <NotificationProvider>
            <CMSProvider>
              {children}
              <Toaster />
            </CMSProvider>
          </NotificationProvider>
        </BookingProvider>
      </ChatProvider>
    </AuthProvider>
  )
}