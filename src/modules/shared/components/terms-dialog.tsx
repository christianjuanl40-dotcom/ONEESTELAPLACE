"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/modules/shared/components/ui/dialog"
import { ScrollArea } from "@/src/modules/shared/components/ui/scroll-area"
import { BOOKING_TERMS_SECTIONS } from "@/src/modules/shared/lib/policies"

interface TermsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TermsDialog({ open, onOpenChange }: TermsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-4xl overflow-y-auto max-h-[90dvh]">
        <DialogHeader>
          <DialogTitle>Terms and Conditions</DialogTitle>
          <DialogDescription>One Estela Place - Event Venue Rental Agreement</DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-auto max-h-[60vh] pr-4">
          <div className="space-y-6 text-sm">
            <div className="text-center border-b pb-4">
              <p className="font-semibold">Effective Date: March 15, 2019</p>
              <p className="mt-2 text-gray-600">
                By proceeding with a booking at One Estela Place, you acknowledge that you have read, understood, and
                agreed to the following terms and regulations:
              </p>
            </div>

            <div className="space-y-4">
              {BOOKING_TERMS_SECTIONS.map((section) => (
                <div key={section.title}>
                  <h3 className="font-semibold text-lg mb-3">{section.title}</h3>
                  <ul className="space-y-2 text-gray-700 list-disc list-inside">
                    {section.items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}

              <div className="border-t pt-4">
                <h3 className="font-semibold text-lg mb-3 text-green-600">✓ Agreement Required</h3>
                <p className="text-gray-700 mb-2">
                  By checking the box during the reservation process, you confirm that you:
                </p>
                <ul className="space-y-1 text-gray-700 list-disc list-inside">
                  <li>Have read and agree to these terms</li>
                  <li>Understand the payment, cancellation, and usage policies</li>
                </ul>
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
