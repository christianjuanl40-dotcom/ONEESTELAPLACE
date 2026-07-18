// app/layout.tsx
import type { Metadata } from "next"
import { Montserrat } from "next/font/google"
import "./globals.css"
import { GlobalProvider } from "@/src/modules/shared/components/global-provider"

// ✨ GINAMIT NATIN ANG MONTSERRAT PARA KUHANG-KUHA YUNG NASA PICTURE ✨
const montserrat = Montserrat({ 
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  subsets: ["latin"],
  variable: "--font-sans", 
})

export const metadata: Metadata = {
  title: "One Estela Place",
  description: "One Estela Place Booking System",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className={`${montserrat.variable} font-sans antialiased`}>
        <GlobalProvider>
          {children}
        </GlobalProvider>
      </body>
    </html>
  )
}