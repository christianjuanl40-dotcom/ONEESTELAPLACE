"use client"

import { useState, useEffect } from "react"
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
import { Checkbox } from "@/src/modules/shared/components/ui/checkbox"
import { Eye, EyeOff, Loader2 } from "lucide-react"

import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useToast } from "@/src/modules/shared/hooks/use-toast"
import { ForgotPasswordDialog } from "@/src/modules/shared/auth/forgot-password-dialog"

interface LoginDialogProps {
  className?: string
  children?: React.ReactNode
}

export function LoginDialog({ className, children }: LoginDialogProps) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  
  const { login, isLoading } = useAuth()
  const { toast } = useToast()

  // Listener para sa kapag pinindot galing Sign Up form
  useEffect(() => {
    const handleOpen = () => setOpen(true)
    window.addEventListener("openLoginDialog", handleOpen)
    return () => window.removeEventListener("openLoginDialog", handleOpen)
  }, [])

  // Function para lumipat sa Sign Up
  const handleSwitchToSignup = () => {
    setOpen(false)
    setTimeout(() => {
      window.dispatchEvent(new Event("openSignupDialog"))
    }, 150)
  }

  useEffect(() => {
    const rememberedEmail = window.localStorage.getItem("rememberedEmail")
    if (rememberedEmail) {
      setEmail(rememberedEmail)
      setRememberMe(true)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email || !password) {
      toast({ title: "Error", description: "Please fill in all fields", variant: "destructive" })
      return
    }

    try {
      const result = await login(email, password)
      if (!result.success) {
        toast({
          title: "Login failed",
          description: result.message || "Invalid credentials",
          variant: "destructive",
        })
        return
      }
      setOpen(false)

      const role = result.role

      if (!role) {
        console.error("[LoginDialog] No role returned from login")
        toast({ title: "Login Error", description: "No role assigned to your account.", variant: "destructive" })
        return
      }

      if (role === "admin" || role === "staff") {
        toast({ title: "Login Successful", description: "Redirecting to dashboard..." })
        window.location.replace("/dashboard")
      } else if (role === "client") {
        toast({ title: "Welcome back!", description: "Taking you to your portal..." })
        window.location.replace("/portal")
      } else {
        console.error("[LoginDialog] Unknown role:", role)
        toast({ title: "Login Error", description: "Invalid account role.", variant: "destructive" })
      }
    } catch (error) {
      console.error("[LoginDialog] Unexpected error", error)
      toast({ title: "Error", description: "Something went wrong", variant: "destructive" })
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          {children ?? (
            <Button variant="outline" className={`border-slate-200 text-slate-900 hover:bg-slate-50 rounded-md px-6 font-bold ${className}`}>
              Login
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="w-[95vw] sm:max-w-[440px] overflow-y-auto max-h-[90dvh] p-0 rounded-2xl">
          <div className="overflow-y-auto min-h-0 p-4 sm:p-6 pt-8 sm:pt-10 pb-6 sm:pb-8">
            <DialogHeader className="mb-5 text-center sm:text-center">
              <DialogTitle className="text-2xl font-black text-slate-900">Welcome Back</DialogTitle>
              <DialogDescription className="text-slate-500 font-medium">
                Enter your credentials to access your account
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email" className="text-[10px] font-black uppercase tracking-[0.2em]">Email Address</Label>
                <Input id="login-email" type="email" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11 w-full rounded-md bg-slate-50 border-slate-200 focus-visible:ring-slate-900 px-4" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="login-password" className="text-[10px] font-black uppercase tracking-[0.2em]">Password</Label>
                <div className="relative">
                  <Input id="login-password" type={showPassword ? "text" : "password"} placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-11 w-full rounded-md bg-slate-50 border-slate-200 focus-visible:ring-slate-900 px-4 pr-10" />
                  <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3 hover:bg-transparent text-slate-400 hover:text-slate-600" onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center space-x-2">
                  <Checkbox id="remember" checked={rememberMe} onCheckedChange={(checked) => setRememberMe(checked as boolean)} className="rounded border-slate-300 data-[state=checked]:bg-slate-900 data-[state=checked]:text-white" />
                  <Label htmlFor="remember" className="text-xs font-bold text-slate-600 cursor-pointer">Remember me</Label>
                </div>

                <Button type="button" variant="link" className="px-0 text-xs font-bold text-slate-600 hover:text-slate-900 h-auto" onClick={() => { setOpen(false); setShowForgotPassword(true); }}>
                  Forgot password?
                </Button>
              </div>

              <Button type="submit" className="w-full bg-slate-900 hover:bg-slate-800 text-white h-11 rounded-md font-bold mt-2" disabled={isLoading}>
                {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...</> : "Sign In"}
              </Button>

              <div className="text-center text-sm text-slate-500 pt-2">
                Don't have an account?{" "}
                <button 
                  type="button" 
                  onClick={handleSwitchToSignup} 
                  className="font-bold text-slate-900 hover:underline hover:text-slate-700 transition-colors"
                >
                  Sign up
                </button>
              </div>

            </form>
          </div>
        </DialogContent>
      </Dialog>

      <ForgotPasswordDialog
        open={showForgotPassword}
        onOpenChange={setShowForgotPassword}
        onBackToLogin={() => { setShowForgotPassword(false); setOpen(true); }}
      />
    </>
  )
}