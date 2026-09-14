"use client"

import type { ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/modules/shared/components/ui/dialog"
import { Button } from "@/src/modules/shared/components/ui/button"
import { LogOut } from "lucide-react"

interface LogoutConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  description?: string
  trigger?: ReactNode
}

export function LogoutConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  description = "Are you sure you want to log out of your account?",
  trigger,
}: LogoutConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent className="w-[95vw] max-w-md overflow-y-auto max-h-[90dvh] rounded-2xl border-0 bg-white p-0 shadow-2xl sm:max-w-md">
        <div className="p-6 sm:p-7">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-orange-600 ring-1 ring-orange-100">
              <LogOut className="h-5 w-5" />
            </div>
            <DialogTitle className="text-2xl font-black tracking-tight text-slate-950">
              Confirm Logout
            </DialogTitle>
            <DialogDescription className="max-w-md text-sm font-semibold leading-6 text-slate-500">
              {description}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-11 w-full rounded-xl border-slate-200 px-5 font-bold text-slate-700 hover:bg-slate-50 sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onConfirm}
              className="h-11 w-full rounded-xl bg-orange-600 px-5 font-bold text-white shadow-sm hover:bg-orange-700 sm:w-auto"
            >
              Yes, Log Out
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
