"use client"

import { cn } from "@/src/modules/shared/lib/utils"

interface UserAvatarProps {
  name?: string
  picture?: string | null
  className?: string
  ringClassName?: string
  fallbackClassName?: string
  textClassName?: string
  alt?: string
}

export function UserAvatar({
  name,
  picture,
  className = "h-9 w-9",
  ringClassName = "ring-2 ring-white",
  fallbackClassName = "bg-gradient-to-br from-orange-500 to-orange-600 text-white",
  textClassName = "font-black uppercase",
  alt,
}: UserAvatarProps) {
  if (picture) {
    return (
      <img
        src={picture}
        alt={alt || name || "Profile"}
        className={cn(
          "shrink-0 rounded-full object-cover shadow-sm",
          ringClassName,
          className,
        )}
      />
    )
  }
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full text-sm shadow-sm",
        fallbackClassName,
        textClassName,
        ringClassName,
        className,
      )}
      aria-hidden
    >
      {name?.charAt(0) || "U"}
    </div>
  )
}
