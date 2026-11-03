// app/layout.tsx
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { GlobalProvider } from "@/src/modules/shared/components/global-provider"

const inter = Inter({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-sans",
})

export const metadata: Metadata = {
  title: "One Estela Place",
  description: "One Estela Place Booking System",
  icons: {
    icon: "/images/Favicon.png",
    apple: "/images/Favicon.png",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="scroll-smooth" data-scroll-behavior="smooth">
      <body className={`${inter.variable} font-sans antialiased`}>
        <GlobalProvider>
          {children}
        </GlobalProvider>
      </body>
    </html>
  )
}
