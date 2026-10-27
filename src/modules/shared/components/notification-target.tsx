"use client"

import { useEffect, useRef, type ReactNode } from "react"

interface NotificationTargetWrapperProps {
  bookingTarget?: string
  transactionTarget?: string
  isHighlighted: boolean
  storageKey?: string
  children: ReactNode
}

export function NotificationTargetWrapper({
  bookingTarget,
  transactionTarget,
  isHighlighted,
  storageKey,
  children,
}: NotificationTargetWrapperProps) {
  const ref = useRef<HTMLDivElement>(null)
  const handledRef = useRef(false)

  useEffect(() => {
    if (!isHighlighted || !ref.current) return
    if (handledRef.current) return
    handledRef.current = true
    ref.current.scrollIntoView({ behavior: "smooth", block: "center" })
    if (storageKey) sessionStorage.removeItem(storageKey)
    const timer = setTimeout(() => {
      handledRef.current = false
    }, 3000)
    return () => clearTimeout(timer)
  }, [isHighlighted, storageKey])

  if (bookingTarget !== undefined) {
    return (
      <div
        ref={ref}
        data-booking-target={bookingTarget}
        className={isHighlighted ? "notification-target-highlight" : undefined}
      >
        {children}
      </div>
    )
  }

  return (
    <div
      ref={ref}
      data-transaction-target={transactionTarget}
      className={isHighlighted ? "notification-target-highlight" : undefined}
    >
      {children}
    </div>
  )
}
