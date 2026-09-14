"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/modules/shared/components/ui/dialog"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Checkbox } from "@/src/modules/shared/components/ui/checkbox"
import { Label } from "@/src/modules/shared/components/ui/label"
import { AlertTriangle } from "lucide-react"
import { type Booking } from "@/src/modules/client/contexts/booking-context"

interface CancellationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  booking: Booking
  onConfirm: () => void
}

export function CancellationDialog({ open, onOpenChange, booking, onConfirm }: CancellationDialogProps) {
  const [agreedToTerms, setAgreedToTerms] = useState(false)

  // Calculate days until event
  const daysUntilEvent = booking
    ? Math.ceil((new Date(booking.date).getTime() - new Date().getTime()) / (1000 * 3600 * 24))
    : 0

  // Determine refund policy based on days until event
  const getRefundPolicy = () => {
    if (daysUntilEvent >= 90) {
      return {
        policy: "Full refund of any payments made (excluding non-refundable deposit)",
        class: "text-green-600",
      }
    } else if (daysUntilEvent >= 30) {
      return {
        policy: "50% refund of total rental fee",
        class: "text-yellow-600",
      }
    } else {
      return {
        policy: "No refund available (full amount will be charged)",
        class: "text-red-600",
      }
    }
  }

  const refundPolicy = getRefundPolicy()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-md overflow-y-auto max-h-[90dvh] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <AlertTriangle className="mr-2 h-5 w-5 text-red-500" />
            Cancel Booking
          </DialogTitle>
          <DialogDescription>Are you sure you want to cancel your booking for {booking?.eventName}?</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md bg-amber-50 p-4">
            <h4 className="font-medium mb-2">Cancellation Policy</h4>
            <ul className="space-y-2 text-sm">
              <li>• Cancellations made 90+ days before: Full refund (excluding deposit)</li>
              <li>• Cancellations made 30-89 days before: 50% refund</li>
              <li>• Cancellations made less than 30 days before: No refund</li>
            </ul>

            <div className="mt-4">
              <p className="font-medium">Your booking is {daysUntilEvent} days away</p>
              <p className={`font-medium ${refundPolicy.class}`}>Refund status: {refundPolicy.policy}</p>
            </div>
          </div>

          <div className="flex items-start space-x-2">
            <Checkbox
              id="terms"
              checked={agreedToTerms}
              onCheckedChange={(checked) => setAgreedToTerms(checked === true)}
              className="mt-1"
            />
            <div>
              <Label htmlFor="terms" className="text-sm text-[10px] font-black uppercase tracking-[0.2em]">
                I understand and agree to the cancellation policy. I understand this action cannot be undone.
              </Label>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" className="w-full sm:w-auto h-11" onClick={() => onOpenChange(false)}>
            Keep Booking
          </Button>
          <Button variant="destructive" className="w-full sm:w-auto h-11" onClick={onConfirm} disabled={!agreedToTerms}>
            Cancel Booking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
