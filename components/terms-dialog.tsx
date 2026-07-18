"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/modules/shared/components/ui/dialog"
import { ScrollArea } from "@/src/modules/shared/components/ui/scroll-area"
import { BOOKING_TERMS_SECTIONS } from "@/src/modules/shared/lib/policies"

interface TermsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TermsDialog({ open, onOpenChange }: TermsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[95vw] max-w-2xl flex-col gap-0 overflow-hidden overflow-y-auto max-h-[90dvh] rounded-2xl border-slate-200 p-0">
        <DialogHeader className="border-b border-slate-100 bg-gradient-to-r from-orange-50 to-amber-50 px-6 py-5">
          <DialogTitle className="text-xl font-black text-slate-900">
            Terms &amp; Conditions
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            Please read carefully before sending an inquiry or confirming a booking.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 py-5">
          <div className="space-y-5 text-sm leading-relaxed text-slate-700">
            <p className="rounded-2xl border border-orange-200 bg-orange-50/60 p-4 text-slate-700">
              These Terms &amp; Conditions govern your use of One Estela Place.
              By submitting a contact form or finalizing a booking, you accept
              the policies described below.
            </p>

            {BOOKING_TERMS_SECTIONS.map((section) => (
              <section key={section.title} className="space-y-1.5">
                <h3 className="text-sm font-bold text-slate-900">{section.title}</h3>
                {section.items.map((item, i) => (
                  <p key={i}>{item}</p>
                ))}
              </section>
            ))}
          </div>
        </ScrollArea>

        <div className="flex flex-col-reverse gap-2 sm:flex-row items-center justify-end border-t border-slate-100 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-11 w-full rounded-xl bg-orange-600 px-5 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-orange-700 sm:w-auto"
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
