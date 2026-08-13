"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { Button } from "@/src/modules/shared/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/src/modules/shared/components/ui/dialog"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Label } from "@/src/modules/shared/components/ui/label"
import { Eye, EyeOff, Loader2, AlertCircle } from "lucide-react"
import { useToast } from "@/src/modules/shared/hooks/use-toast"

interface SignupDialogProps {
  className?: string
  children?: React.ReactNode
}

export function SignupDialog({ className, children }: SignupDialogProps) {
  const [open, setOpen] = useState(false)
  const [firstName, setFirstName] = useState("")
  const [middleName, setMiddleName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [phoneNumber, setPhoneNumber] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")

  const { signup, isLoading } = useAuth()
  const { toast } = useToast()

  useEffect(() => {
    const handleOpen = () => setOpen(true)
    window.addEventListener("openSignupDialog", handleOpen)
    return () => window.removeEventListener("openSignupDialog", handleOpen)
  }, [])

  useEffect(() => {
    if (!open) {
      setFirstName("")
      setMiddleName("")
      setLastName("")
      setEmail("")
      setPhoneNumber("")
      setPassword("")
      setConfirmPassword("")
      setErrorMsg("")
      setIsSubmitting(false)
    }
  }, [open])

  const handleSwitchToLogin = () => {
    setOpen(false)
    setTimeout(() => {
      window.dispatchEvent(new Event("openLoginDialog"))
    }, 150)
  }

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    const numbersOnly = value.replace(/[^0-9]/g, "")
    if (numbersOnly.length <= 10) {
      setPhoneNumber(numbersOnly)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg("")

    if (!firstName || !lastName || !email || !phoneNumber || !password || !confirmPassword) {
      setErrorMsg("Please fill in all required fields.")
      return
    }

    if (phoneNumber.length !== 10) {
      setErrorMsg("Phone number must be exactly 10 digits (e.g. 9123456789)")
      return
    }

    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match!")
      return
    }

    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters long.")
      return
    }

    const formattedPhone = `+63${phoneNumber}`

    setIsSubmitting(true)
    try {
      const result = await signup({
        firstName,
        middleName,
        lastName,
        email,
        phone: formattedPhone,
        password,
      })

      if (result.success) {
        setOpen(false)
        toast({
          title: "Account created",
          description: "Welcome to One Estela Place! Taking you to your portal...",
        })
        window.location.replace("/portal")
      } else {
        setErrorMsg(result.message || "Email is already taken. Please use a different one.")
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Sign up failed. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val) => {
      setOpen(val)
      if (!val) setErrorMsg("")
    }}>
      <DialogTrigger asChild>
        {children ?? (
          <Button className={`bg-slate-900 text-white hover:bg-slate-800 rounded-md px-6 ${className}`}>
            Sign Up
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="w-[95vw] sm:max-w-[720px] overflow-y-auto max-h-[90dvh] p-0 rounded-2xl">
        <DialogHeader className="border-b border-slate-100 shrink-0 p-4 sm:p-6 pb-4 sm:pb-5 text-center sm:text-center">
          <DialogTitle className="text-2xl font-black text-slate-900">Create Account</DialogTitle>
          <DialogDescription className="text-slate-500 font-medium">
            Sign up to start booking events at One Estela Place
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 max-h-[90dvh] px-4 sm:px-6 pb-6 pt-4">
          {errorMsg && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium p-3 rounded-md flex items-center gap-2 animate-in zoom-in-95 mb-4">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p>{errorMsg}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName" className="text-[10px] font-black uppercase tracking-[0.2em]">First Name *</Label>
                <Input id="firstName" placeholder="Juan" value={firstName} onChange={(e) => setFirstName(e.target.value)} required className="h-11 w-full rounded-md bg-slate-50 border-slate-200 focus-visible:ring-slate-900 px-4" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="middleName" className="text-[10px] font-black uppercase tracking-[0.2em]">Middle Name</Label>
                <Input id="middleName" placeholder="Optional" value={middleName} onChange={(e) => setMiddleName(e.target.value)} className="h-11 w-full rounded-md bg-slate-50 border-slate-200 focus-visible:ring-slate-900 px-4" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName" className="text-[10px] font-black uppercase tracking-[0.2em]">Last Name *</Label>
                <Input id="lastName" placeholder="Dela Cruz" value={lastName} onChange={(e) => setLastName(e.target.value)} required className="h-11 w-full rounded-md bg-slate-50 border-slate-200 focus-visible:ring-slate-900 px-4" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="signup-email" className="text-[10px] font-black uppercase tracking-[0.2em]">Email Address *</Label>
                <Input id="signup-email" type="email" placeholder="juan@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11 w-full rounded-md bg-slate-50 border-slate-200 focus-visible:ring-slate-900 px-4" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phoneNumber" className="text-[10px] font-black uppercase tracking-[0.2em]">Phone Number *</Label>
                <div className="relative flex items-center">
                  <span className="absolute left-3 text-slate-500 font-bold text-sm select-none pointer-events-none">+63</span>
                  <Input id="phoneNumber" type="text" inputMode="numeric" placeholder="912 345 6789" value={phoneNumber} onChange={handlePhoneChange} required className="h-11 w-full rounded-md bg-slate-50 border-slate-200 focus-visible:ring-slate-900 pl-11 font-mono text-sm tracking-[0.2em]" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="signup-password" className="text-[10px] font-black uppercase tracking-[0.2em]">Create Password *</Label>
                <div className="relative">
                  <Input id="signup-password" type={showPassword ? "text" : "password"} placeholder="Min. 6 chars" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-11 w-full rounded-md bg-slate-50 border-slate-200 focus-visible:ring-slate-900 px-4 pr-10" />
                  <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3 hover:bg-transparent text-slate-400 hover:text-slate-600" onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-[10px] font-black uppercase tracking-[0.2em]">Confirm Password *</Label>
                <div className="relative">
                  <Input id="confirmPassword" type={showConfirmPassword ? "text" : "password"} placeholder="Re-type password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="h-11 w-full rounded-md bg-slate-50 border-slate-200 focus-visible:ring-slate-900 px-4 pr-10" />
                  <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3 hover:bg-transparent text-slate-400 hover:text-slate-600" onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-slate-900 hover:bg-slate-800 text-white h-11 rounded-md font-bold mt-2"
              disabled={isLoading || isSubmitting}
            >
              {isLoading || isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating your account...
                </>
              ) : (
                "Complete Sign Up"
              )}
            </Button>

            <div className="text-center text-sm text-slate-500 pt-2">
              Already have an account?{" "}
              <button
                type="button"
                onClick={handleSwitchToLogin}
                className="font-bold text-slate-900 hover:underline hover:text-slate-700 transition-colors"
              >
                Login
              </button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
