"use client"

import { useState, useEffect } from "react"
import { Button } from "@/src/modules/shared/components/ui/button"
import { ReserveDialog } from "@/src/modules/client/components/reserve-dialog"
import { useAuth } from "@/src/modules/shared/auth/auth-context"

interface ReserveButtonProps {
  children?: React.ReactNode
  className?: string
  size?: "default" | "sm" | "lg" | "icon"
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  onClick?: React.MouseEventHandler<HTMLButtonElement>
}

export function ReserveButton({ children, className, size, variant, onClick }: ReserveButtonProps) {
  const { user } = useAuth()
  const [mounted, setMounted] = useState(false)

  // Hintayin muna natin mag-load ang system bago i-check ang user
  useEffect(() => {
    setMounted(true)
  }, [])

  const handleLoginTrigger = () => {
    // I-trigger ang Login Dialog global event
    window.dispatchEvent(new Event("openLoginDialog"))
  }

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <Button className={className} size={size} variant={variant} onClick={onClick}>
        {children || "Book Now"}
      </Button>
    )
  }

  // ✨ KAPAG NAKA-LOGIN NA SI CLIENT: Ibalot ang button sa ReserveDialog natin! ✨
  // Pag kinlick 'to, bubukas yung magandang booking modal (Phase 1, 2, 3)
  if (user) {
    return (
      <ReserveDialog>
        <Button className={className} size={size} variant={variant} onClick={onClick}>
          {children || "Book Now"}
        </Button>
      </ReserveDialog>
    )
  }

  // ✨ KAPAG WALANG NAKA-LOGIN: Bubuksan niya yung Login Dialog ✨
  return (
    <Button className={className} size={size} variant={variant} onClick={onClick ?? handleLoginTrigger}>
      {children || "Book Now"}
    </Button>
  )
}