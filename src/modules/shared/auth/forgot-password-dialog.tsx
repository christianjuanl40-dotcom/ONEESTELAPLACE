"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/modules/shared/components/ui/dialog"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Label } from "@/src/modules/shared/components/ui/label"
import { Mail, CheckCircle, Loader2 } from "lucide-react"
import { sendPasswordResetEmail } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { useToast } from "@/src/modules/shared/hooks/use-toast"

interface ForgotPasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onBackToLogin: () => void
}

type Step = "email" | "success"

const inputClass =
  "h-11 w-full rounded-md bg-slate-50 border-slate-200 focus-visible:ring-slate-900 px-4"
const primaryBtnClass =
  "w-full bg-slate-900 hover:bg-slate-800 text-white h-11 rounded-md font-bold"
const labelClass = "text-[10px] font-black uppercase tracking-[0.2em]"

export function ForgotPasswordDialog({ open, onOpenChange, onBackToLogin }: ForgotPasswordDialogProps) {
  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setIsLoading(true)
    try {
      await sendPasswordResetEmail(auth, email.trim())
      toast({
        title: "Password reset email sent",
        description: "Please check your inbox for the reset link.",
      })
      setStep("success")
    } catch (error: any) {
      const code = error?.code || ""
      let message = "Unable to send reset email. Please try again later."
      if (code === "auth/invalid-email") {
        message = "Invalid email address."
      } else if (code === "auth/user-not-found") {
        message = "No account exists with this email."
      } else if (code === "auth/too-many-requests") {
        message = "Too many attempts. Please try again later."
      } else if (code === "auth/network-request-failed") {
        message = "Unable to send reset email. Check your connection and try again."
      }
      toast({
        title: "Reset failed",
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setStep("email")
    setEmail("")
    onOpenChange(false)
  }

  const handleBackToLogin = () => {
    handleClose()
    onBackToLogin()
  }

  const getStepIcon = (currentStep: Step) => {
    switch (currentStep) {
      case "email":
        return <Mail className="h-6 w-6 text-slate-900" />
      case "success":
        return <CheckCircle className="h-6 w-6 text-green-600" />
    }
  }

  const getStepTitle = (currentStep: Step) => {
    switch (currentStep) {
      case "email":
        return "Forgot Password"
      case "success":
        return "Password Reset Link Sent"
    }
  }

  const getStepDescription = (currentStep: Step) => {
    switch (currentStep) {
      case "email":
        return "Enter your registered email address and we'll send you a password reset link."
      case "success":
        return "Check your inbox to create your new password."
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] sm:max-w-[440px] overflow-y-auto max-h-[90dvh] p-0 rounded-2xl">
        <div className="overflow-y-auto min-h-0 p-4 sm:p-6 pt-8 sm:pt-10 pb-6 sm:pb-8">
          <DialogHeader className="mb-5 text-center sm:text-center">
            {step !== "success" && (
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                {getStepIcon(step)}
              </div>
            )}
            <DialogTitle className="text-2xl font-black text-slate-900">
              {getStepTitle(step)}
            </DialogTitle>
            <DialogDescription className="text-slate-500 font-medium">
              {getStepDescription(step)}
            </DialogDescription>
          </DialogHeader>

          {step === "email" && (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email" className={labelClass}>Email Address</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className={`${inputClass} pl-10`}
                  />
                </div>
              </div>

              <Button type="submit" className={primaryBtnClass} disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending link...
                  </>
                ) : (
                  "Send Reset Link"
                )}
              </Button>

              <div className="text-center">
                <Button type="button" variant="link" onClick={handleBackToLogin} className="text-sm text-slate-600 hover:text-slate-900">
                  Back to Login
                </Button>
              </div>
            </form>
          )}

          {step === "success" && (
            <div className="space-y-4 text-center">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Check your email</h3>
                <p className="text-sm text-gray-600">
                  We've sent a password reset link to <span className="font-medium text-slate-900">{email}</span>. Click the link to continue.
                </p>
              </div>

              <Button onClick={handleBackToLogin} className={primaryBtnClass}>
                Back to Login
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}