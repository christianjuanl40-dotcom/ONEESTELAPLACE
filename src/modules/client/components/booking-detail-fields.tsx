import type { ReactNode } from "react"
import { cn } from "@/src/modules/shared/lib/utils"

export function BookingDetailField({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <dt className="text-xs font-medium leading-5 text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm font-bold leading-5 text-black [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

export function BookingDetailSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 space-y-3"><h3 className="text-sm font-semibold text-slate-700">{title}</h3>{children}</section>
}
