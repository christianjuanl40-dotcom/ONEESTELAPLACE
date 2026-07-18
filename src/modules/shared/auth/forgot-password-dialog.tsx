"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/src/modules/shared/components/ui/dialog"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Label } from "@/src/modules/shared/components/ui/label"
import { ArrowLeft, Mail, Shield, Key, CheckCircle, Loader2 } from "lucide-react"
import { useToast } from "@/src/modules/shared/hooks/use-toast"

interface ForgotPasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onBackToLogin: () => void
}

type Step = "email" | "verify" | "reset" | "success"

export function ForgotPasswordDialog({ open, onOpenChange, onBackToLogin }: ForgotPasswordDialogProps) {
  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [resetCode, setResetCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    toast({
      title: "Feature not available",
      description: "Password reset is being configured. Please try again later.",
      variant: "destructive",
    })
  }

  const handleCodeVerification = async (e: React.FormEvent) => {
    e.preventDefault()
    toast({
      title: "Feature not available",
      description: "Password reset is being configured. Please try again later.",
      variant: "destructive",
    })
  }

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault()

    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please make sure both passwords are the same.",
        variant: "destructive",
      })
      return
    }

    if (newPassword.length < 6) {
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters long.",
        variant: "destructive",
      })
      return
    }

    toast({
      title: "Feature not available",
      description: "Password reset is being configured. Please try again later.",
      variant: "destructive",
    })
  }

  const handleClose = () => {
    setStep("email")
    setEmail("")
    setResetCode("")
    setNewPassword("")
    setConfirmPassword("")
    onOpenChange(false)
  }

  const handleBackToLogin = () => {
    handleClose()
    onBackToLogin()
  }

  const getStepIcon = (currentStep: Step) => {
    switch (currentStep) {
      case "email":
        return <Mail className="h-6 w-6 text-blue-600" />
      case "verify":
        return <Shield className="h-6 w-6 text-blue-600" />
      case "reset":
        return <Key className="h-6 w-6 text-blue-600" />
      case "success":
        return <CheckCircle className="h-6 w-6 text-green-600" />
    }
  }

  const getStepTitle = (currentStep: Step) => {
    switch (currentStep) {
      case "email":
        return "Reset Your Password"
      case "verify":
        return "Verify Reset Code"
      case "reset":
        return "Create New Password"
      case "success":
        return "Password Reset Complete"
    }
  }

  const getStepDescription = (currentStep: Step) => {
    switch (currentStep) {
      case "email":
        return "Enter your email address and we'll send you a reset code"
      case "verify":
        return "Enter the 6-digit code we sent to your email"
      case "reset":
        return "Choose a new password for your account"
      case "success":
        return "Your password has been successfully reset"
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-[425px] overflow-y-auto max-h-[90dvh] p-4 sm:p-6 rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {step !== "email" && step !== "success" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (step === "verify") setStep("email")
                  if (step === "reset") setStep("verify")
                }}
                className="p-1"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {getStepIcon(step)}
            <div>
              <DialogTitle>{getStepTitle(step)}</DialogTitle>
              <DialogDescription>{getStepDescription(step)}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {step === "email" && (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email" className="text-[10px] font-black uppercase tracking-[0.2em]">Email Address</Label>
              <Input
                id="reset-email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11 w-full"
              />
            </div>

            <Button type="submit" className="w-full h-11" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending code...
                </>
              ) : (
                "Send Reset Code"
              )}
            </Button>

            <div className="text-center">
              <Button type="button" variant="link" onClick={handleBackToLogin} className="text-sm">
                Back to Login
              </Button>
            </div>

          </form>
        )}

        {step === "verify" && (
          <form onSubmit={handleCodeVerification} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-code" className="text-[10px] font-black uppercase tracking-[0.2em]">Reset Code</Label>
              <Input
                id="reset-code"
                placeholder="Enter 6-digit code"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                maxLength={6}
                required
                className="h-11 w-full"
              />
            </div>

            <Button type="submit" className="w-full h-11" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Verify Code"
              )}
            </Button>

            <div className="text-center text-sm text-gray-600">
              <p>Didn't receive the code?</p>
              <Button type="button" variant="link" className="text-sm" onClick={() => setStep("email")}>
                Try a different email
              </Button>
            </div>

          </form>
        )}

        {step === "reset" && (
          <form onSubmit={handlePasswordReset} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-[10px] font-black uppercase tracking-[0.2em]">New Password</Label>
              <Input
                id="new-password"
                type="password"
                placeholder="Enter new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="h-11 w-full"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-new-password" className="text-[10px] font-black uppercase tracking-[0.2em]">Confirm New Password</Label>
              <Input
                id="confirm-new-password"
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="h-11 w-full"
              />
            </div>

            <Button type="submit" className="w-full h-11" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Resetting password...
                </>
              ) : (
                "Reset Password"
              )}
            </Button>
          </form>
        )}

        {step === "success" && (
          <div className="space-y-4 text-center">
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Password Reset Successful!</h3>
              <p className="text-sm text-gray-600">
                Your password has been successfully reset. You can now log in with your new password.
              </p>
            </div>

            <Button onClick={handleBackToLogin} className="w-full h-11">
              Back to Login
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
