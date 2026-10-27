import type React from "react"
import { MessageProvider } from "@/components/message-context"

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <MessageProvider>{children}</MessageProvider>
}
