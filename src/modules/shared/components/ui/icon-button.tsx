import * as React from "react"

import { cn } from "@shared/lib/utils"

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  tone?: "default" | "danger"
}

/**
 * Compact action control for icon-only buttons. The label is required so a
 * new icon action cannot be added without an accessible name.
 */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  className,
  label,
  tone = "default",
  children,
  title,
  ...props
}, ref) {
  return (
    <button
      ref={ref}
      type={props.type || "button"}
      aria-label={label}
      title={title || label}
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40",
        tone === "danger"
          ? "text-rose-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:ring-rose-300"
          : "text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-orange-300",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
})

export { IconButton }
