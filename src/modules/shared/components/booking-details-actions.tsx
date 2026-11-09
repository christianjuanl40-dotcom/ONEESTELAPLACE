import { Children, Fragment, isValidElement, type ReactNode } from "react"
import { cn } from "@/src/modules/shared/lib/utils"

export const bookingDetailsActionClassName = "h-11 min-w-0 w-full gap-2 whitespace-normal rounded-md px-4 py-2 text-center text-sm font-semibold leading-5 [overflow-wrap:anywhere] shadow-none transition-colors duration-150 motion-reduce:transition-none focus-visible:border-orange-600 focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:bg-none disabled:text-slate-600 disabled:opacity-100"

export const bookingDetailsActionToneClassNames = {
  // A uniform orange-700 tint keeps white 14px labels above 4.5:1 on the
  // orange-600 base; the underlying color transitions to orange-700 on hover.
  primary: "border border-orange-700 bg-orange-600 bg-gradient-to-b from-orange-700/75 to-orange-700/75 text-white hover:border-orange-800 hover:bg-orange-700",
  orange: "border border-orange-200 bg-orange-50 text-orange-700 hover:border-orange-300 hover:bg-orange-100 hover:text-orange-800",
  slate: "border border-slate-300 bg-slate-50 text-slate-800 hover:border-slate-400 hover:bg-slate-100 hover:text-slate-900",
  destructive: "border border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100 hover:text-rose-800",
} as const

export const bookingDetailsActionRowClassName = "grid min-w-0 grid-cols-1 gap-3 md:auto-cols-fr md:grid-flow-col md:grid-cols-none"

export const bookingDetailsStackedActionClassName = cn(
  bookingDetailsActionClassName,
  "h-11 min-w-0 rounded-lg px-3 flex items-center justify-center gap-2 text-sm font-semibold [&_svg]:shrink-0",
)

function flattenActionChildren(children: ReactNode): ReactNode[] {
  const actions: ReactNode[] = []

  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type === Fragment) {
      actions.push(...flattenActionChildren(child.props.children))
      return
    }
    if (child !== null && child !== undefined && typeof child !== "boolean") {
      actions.push(child)
    }
  })

  return actions
}

function getFooterGridClassName(layout: "responsive" | "compact", count: number) {
  const responsive = {
    1: "grid min-w-0 grid-cols-1 gap-3",
    2: "grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2",
    3: "grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2",
    4: "grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2",
    5: "grid min-w-0 grid-cols-1 gap-3 md:grid-cols-6",
  } as const
  const compact = {
    1: "grid min-w-0 grid-cols-1 gap-2",
    2: "grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2",
    3: "grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2",
    4: "grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2",
    5: "grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-6",
  } as const

  if (layout === "compact") return compact[count as keyof typeof compact] || compact[1]
  return responsive[count as keyof typeof responsive] || responsive[1]
}

function getFooterActionClassName(layout: "responsive" | "compact", count: number, index: number) {
  if (count === 3 && index === 2) return layout === "compact" ? "sm:col-span-2" : "md:col-span-2"
  if (count === 5) {
    if (index < 3) return layout === "compact" ? "sm:col-span-2" : "md:col-span-2"
    return layout === "compact" ? "sm:col-span-3" : "md:col-span-3"
  }
  return ""
}

export function BookingDetailsFooter({ children, layout = "responsive" }: { children: ReactNode; layout?: "responsive" | "compact" }) {
  const actions = flattenActionChildren(children)
  if (!actions.length) return null

  return (
    <footer data-booking-details-footer className={cn("shrink-0 border-t border-slate-200 bg-white px-4 sm:px-6", layout === "compact" ? "py-2" : "py-3")}>
      <div data-booking-details-action-count={actions.length} className={getFooterGridClassName(layout, actions.length)}>
        {actions.map((action, index) => (
          <div key={`booking-details-action-${index}`} className={cn("min-w-0", getFooterActionClassName(layout, actions.length, index))}>
            {action}
          </div>
        ))}
      </div>
    </footer>
  )
}
