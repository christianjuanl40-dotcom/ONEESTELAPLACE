"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, Eye, EyeOff, Loader2, MailCheck, RefreshCw, ShieldAlert, LogOut } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/src/modules/shared/components/ui/button"
import { Input } from "@/src/modules/shared/components/ui/input"
import { Label } from "@/src/modules/shared/components/ui/label"
import { useAuth } from "@/src/modules/shared/auth/auth-context"

const CODE_LENGTH = 6

function VerifyEmailContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    user,
    isLoading,
    initializationError,
    pendingRegistration,
    restorePendingRegistration,
    verifyPendingRegistrationCode,
    resendPendingRegistrationCode,
    finalizePendingRegistration,
    clearPendingRegistration,
    refreshUser,
    requestEmailVerificationCode,
    verifyEmailCode,
    sendVerificationEmail,
    verificationLinkFallbackEnabled,
    logout,
  } = useAuth()
  const codeInputRef = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState("")
  const [isChecking, setIsChecking] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [message, setMessage] = useState("Enter the 6-digit verification code sent to your email address.")
  const [error, setError] = useState("")
  const [verificationSuccess, setVerificationSuccess] = useState(false)
  const [isCompletingVerification, setIsCompletingVerification] = useState(false)
  const [pendingPassword, setPendingPassword] = useState("")
  const [pendingPasswordConfirmation, setPendingPasswordConfirmation] = useState("")
  const [showPendingPassword, setShowPendingPassword] = useState(false)
  const [showPendingPasswordConfirmation, setShowPendingPasswordConfirmation] = useState(false)
  const handoffStartedRef = useRef(false)
  const registrationQuery = searchParams.get("registration")?.trim() || ""
  const pendingMode = Boolean(registrationQuery || pendingRegistration)
  const pendingEmail = pendingRegistration?.email || ""
  const pendingVerified = verificationSuccess

  const completeVerificationHandoff = useCallback(async () => {
    if (handoffStartedRef.current) return
    handoffStartedRef.current = true
    setVerificationSuccess(true)
    setIsCompletingVerification(true)
    setError("")
    setMessage("Email Verified Successfully! Your email has been verified. Please log in to continue.")
    const signedOut = await logout()
    if (signedOut) {
      router.replace("/?auth=login")
      return
    }
    handoffStartedRef.current = false
    setIsCompletingVerification(false)
    setError("Your email was verified, but sign out could not be completed. Please try again before continuing.")
  }, [logout, router])

  useEffect(() => {
    if (!registrationQuery || pendingRegistration?.registrationId === registrationQuery) return
    setIsRestoring(true)
    setError("")
    void restorePendingRegistration(registrationQuery).then((result) => {
      if (!result.success) setError(result.message || "This signup session has expired. Start signup again.")
      else if (result.status === "verified") {
        setVerificationSuccess(true)
        setMessage("Email verified. Re-enter your password to create your account.")
      } else if (result.status === "finalized") {
        setMessage("")
        setError("This signup session has already been completed. Please log in instead.")
      }
    }).finally(() => setIsRestoring(false))
  }, [pendingRegistration?.registrationId, registrationQuery, restorePendingRegistration])

  useEffect(() => {
    if (pendingMode) return
    if (!isLoading && !user && !initializationError && !isCompletingVerification) router.replace("/")
  }, [initializationError, isCompletingVerification, isLoading, pendingMode, router, user])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  useEffect(() => {
    if (pendingMode) return
    if (user?.emailVerified && user.emailVerificationRequired) void completeVerificationHandoff()
  }, [completeVerificationHandoff, pendingMode, user?.emailVerificationRequired, user?.emailVerified])

  useEffect(() => {
    if (!isLoading && user && !user.emailVerified && !verificationSuccess && !pendingMode) {
      window.setTimeout(() => codeInputRef.current?.focus(), 0)
    }
  }, [isLoading, pendingMode, user, verificationSuccess])

  const displayedEmail = pendingEmail || user?.email || ""
  const maskedEmail = useMemo(() => {
    const email = displayedEmail
    const [local, domain] = email.split("@")
    if (!local || !domain) return email
    if (local.length <= 2) return `${local[0] || "•"}••@${domain}`
    return `${local.slice(0, 2)}•••@${domain}`
  }, [displayedEmail])

  const handleCodeChange = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, CODE_LENGTH)
    setCode(digits)
    if (error) setError("")
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    handleCodeChange(event.clipboardData.getData("text"))
  }

  const handleVerify = async () => {
    if (isVerifying || code.length !== CODE_LENGTH) {
      if (code.length !== CODE_LENGTH) setError("Enter all 6 digits before verifying your email.")
      return
    }
    setIsVerifying(true)
    setError("")
    const result = pendingMode
      ? await verifyPendingRegistrationCode(code)
      : await verifyEmailCode(code)
    if (result.success) {
      setCode("")
      if (pendingMode) {
        setVerificationSuccess(true)
        setMessage("Email verified. Re-enter your password to create your account.")
      } else {
        await completeVerificationHandoff()
      }
    } else {
      setError(result.message || "We could not verify that code. Please try again.")
    }
    setIsVerifying(false)
  }

  const handleCheck = async () => {
    setIsChecking(true)
    setError("")
    try {
      await refreshUser()
      setMessage("Verification status refreshed from Firebase Authentication.")
    } catch {
      setError("We could not refresh your verification status. Check your connection and try again.")
    } finally {
      setIsChecking(false)
    }
  }

  const handleResend = async () => {
    if (isResending || cooldown > 0 || (pendingMode ? pendingVerified : user?.emailVerified)) return
    setIsResending(true)
    setError("")
    const result = pendingMode
      ? await resendPendingRegistrationCode()
      : await requestEmailVerificationCode()
    if (result.success) {
      setCooldown(result.retryAfterSeconds || 60)
      setMessage(result.message || "Your 6-digit verification code was sent. Check your inbox and spam folder.")
    } else {
      if (result.retryAfterSeconds) setCooldown(result.retryAfterSeconds)
      setError(result.message || "We could not send a verification code. Please try again later.")
    }
    setIsResending(false)
  }

  const handleFinalizePendingRegistration = async () => {
    if (isFinalizing) return
    if (pendingPassword.length < 6) {
      setError("Password must be at least 6 characters long.")
      return
    }
    if (pendingPassword !== pendingPasswordConfirmation) {
      setError("Passwords do not match.")
      return
    }
    setIsFinalizing(true)
    setError("")
    const result = await finalizePendingRegistration(pendingPassword)
    if (result.success) {
      setMessage(result.message || "Account created successfully. Please log in manually to continue.")
      setPendingPassword("")
      setPendingPasswordConfirmation("")
      router.replace("/?auth=login")
    } else {
      setError(result.message || "Your account could not be finalized. Keep this page open and try again.")
    }
    setIsFinalizing(false)
  }

  const handleSignOut = async () => {
    clearPendingRegistration()
    await logout()
    router.replace("/")
  }

  if (!pendingMode && isLoading) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-950"><Loader2 className="h-8 w-8 animate-spin text-orange-500" aria-label="Loading account" /></main>
  }

  if (pendingMode && (isRestoring || (!pendingRegistration && !error))) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-950"><Loader2 className="h-8 w-8 animate-spin text-orange-500" aria-label="Loading signup" /></main>
  }

  if (!pendingMode && initializationError) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><section className="max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm"><ShieldAlert className="mx-auto h-10 w-10 text-rose-600" aria-hidden="true" /><h1 className="mt-4 text-xl font-black text-slate-950">Account unavailable</h1><p role="alert" className="mt-2 text-sm leading-6 text-slate-600">{initializationError}</p><Button className="mt-5 w-full" variant="outline" onClick={() => void handleSignOut()}>Sign out</Button></section></main>
  }

  if (!pendingMode && isCompletingVerification) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4"><section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-2xl"><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" /><h1 className="mt-4 text-2xl font-black text-slate-950">Email Verified Successfully!</h1><p className="mt-3 text-sm leading-6 text-slate-600">Your email has been verified. Please log in to continue.</p><Loader2 className="mx-auto mt-5 h-5 w-5 animate-spin text-orange-600" aria-label="Signing out" /></section></main>
  }

  if (!pendingMode && !user) return null

  const verified = pendingMode ? pendingVerified : Boolean(user?.emailVerified || verificationSuccess)
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl sm:p-9" aria-labelledby="verify-email-title">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-orange-600">
          {verified ? <CheckCircle2 className="h-8 w-8" aria-hidden="true" /> : <MailCheck className="h-8 w-8" aria-hidden="true" />}
        </div>
        <h1 id="verify-email-title" className="mt-6 text-center text-2xl font-black tracking-tight text-slate-950">{pendingMode ? (verified ? "Email verified" : "Verify Your Email") : (verified ? "Email verified" : "Verify Your Email")}</h1>
        <p className="mx-auto mt-3 max-w-md text-center text-sm leading-6 text-slate-600">
          {pendingMode
            ? (verified ? "Your email is verified. Re-enter your password to create your Firebase account." : "Enter the 6-digit code sent before your Firebase account is created.")
            : (verified ? "Your Firebase Authentication email status is verified. Continue when you are ready." : "Enter the 6-digit verification code sent to your registered email address.")}
        </p>
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Signup email</p>
          <p className="mt-1 break-all text-sm font-bold text-slate-900" aria-label={`Signup email ${displayedEmail}`}>{maskedEmail}</p>
        </div>

        {!verified && (
          <div className="mt-6">
            <label htmlFor="email-otp-code" className="sr-only">6-digit verification code</label>
            <div className="relative rounded-2xl focus-within:ring-2 focus-within:ring-orange-300 focus-within:ring-offset-2" onClick={() => codeInputRef.current?.focus()}>
              <div className="grid grid-cols-6 gap-2" aria-hidden="true">
                {Array.from({ length: CODE_LENGTH }, (_, index) => (
                  <span key={index} className="flex h-14 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-2xl font-black tabular-nums text-slate-950 sm:h-16 sm:text-3xl">
                    {code[index] || <span className="text-slate-300">•</span>}
                  </span>
                ))}
              </div>
              <input ref={codeInputRef} id="email-otp-code" value={code} onChange={(event) => handleCodeChange(event.target.value)} onPaste={handlePaste} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={CODE_LENGTH} aria-describedby="email-otp-help" aria-invalid={Boolean(error)} className="absolute inset-0 h-full w-full cursor-text opacity-0" />
            </div>
            <p id="email-otp-help" className="mt-3 text-center text-xs text-slate-500">You can type or paste the complete code. It expires after 10 minutes.</p>
            <Button type="button" variant="brand" className="mt-4 h-11 w-full" disabled={isVerifying || code.length !== CODE_LENGTH} onClick={() => void handleVerify()}>
              {isVerifying ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Verifying…</> : <><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Verify Email</>}
            </Button>
          </div>
        )}

        {pendingMode && verified && (
          <div className="mt-6 space-y-4 rounded-2xl border border-orange-100 bg-orange-50/60 p-4">
            <div>
              <h2 className="text-sm font-black text-slate-900">Create your password</h2>
              <p className="mt-1 text-xs leading-5 text-slate-600">This password is sent directly to Firebase Authentication and is never stored in the pending verification record.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pending-password">Password</Label>
              <div className="relative">
                <Input id="pending-password" type={showPendingPassword ? "text" : "password"} value={pendingPassword} onChange={(event) => setPendingPassword(event.target.value)} autoComplete="new-password" className="h-11 pr-11" />
                <Button type="button" variant="ghost" size="sm" aria-label={showPendingPassword ? "Hide password" : "Show password"} className="absolute right-0 top-0 h-full px-3 text-slate-400 hover:bg-transparent" onClick={() => setShowPendingPassword((value) => !value)}>{showPendingPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pending-password-confirmation">Confirm password</Label>
              <div className="relative">
                <Input id="pending-password-confirmation" type={showPendingPasswordConfirmation ? "text" : "password"} value={pendingPasswordConfirmation} onChange={(event) => setPendingPasswordConfirmation(event.target.value)} autoComplete="new-password" className="h-11 pr-11" />
                <Button type="button" variant="ghost" size="sm" aria-label={showPendingPasswordConfirmation ? "Hide confirmation password" : "Show confirmation password"} className="absolute right-0 top-0 h-full px-3 text-slate-400 hover:bg-transparent" onClick={() => setShowPendingPasswordConfirmation((value) => !value)}>{showPendingPasswordConfirmation ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
              </div>
            </div>
            <Button type="button" variant="brand" className="h-11 w-full" disabled={isFinalizing} onClick={() => void handleFinalizePendingRegistration()}>
              {isFinalizing ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Creating account…</> : <><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Create Account</>}
            </Button>
          </div>
        )}

        <div className="mt-5 min-h-10" aria-live="polite" aria-atomic="true">
          {message && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm leading-5 text-emerald-800">{message}</p>}
          {error && <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-5 text-rose-800">{error}</p>}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Button type="button" variant="outline" className="h-11" disabled={isResending || cooldown > 0 || verified} onClick={() => void handleResend()}>
            {isResending ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Sending…</> : cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend Code"}
          </Button>
          {!pendingMode && <Button type="button" variant="outline" className="h-11" disabled={isChecking || verified} onClick={() => void handleCheck()}>{isChecking ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking…</> : <><RefreshCw className="h-4 w-4" aria-hidden="true" /> Check Status</>}</Button>}
        </div>

        {!pendingMode && verificationLinkFallbackEnabled && !verified && <Button type="button" variant="ghost" className="mt-3 h-10 w-full text-slate-600" onClick={async () => { setError(""); const result = await sendVerificationEmail(); if (result.success) setMessage(result.message || "Verification link sent. Check your inbox and spam folder."); else setError(result.message || "We could not send a verification link.") }}>Use verification link instead</Button>}
        {!pendingMode && verified && user?.emailVerificationRequired ? <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center text-sm font-semibold text-emerald-800" role="status">Email Verified Successfully! Please log in to continue.</div> : !pendingMode && verified ? <Button type="button" className="mt-3 h-11 w-full bg-slate-950 text-white hover:bg-slate-800" onClick={() => router.replace("/portal")}><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Continue to Client Portal</Button> : null}
        <Button type="button" variant="ghost" className="mt-4 h-10 w-full text-slate-600" onClick={() => void handleSignOut()}><LogOut className="h-4 w-4" aria-hidden="true" /> {pendingMode ? "Cancel Signup" : "Sign Out"}</Button>
        <p className="mt-5 text-center text-xs leading-5 text-slate-500">{pendingMode ? "Your Firebase account and Client profile are created only after the email code is accepted." : "If the code is invalid or expired, request a new code. Firebase Authentication remains the authoritative verification record."}</p>
      </section>
    </main>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-slate-950"><Loader2 className="h-8 w-8 animate-spin text-orange-500" aria-label="Loading verification" /></main>}>
      <VerifyEmailContent />
    </Suspense>
  )
}
