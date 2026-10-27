"use client"

import { useAuth } from "./auth-context"
import { Button } from "@/src/modules/shared/components/ui/button"

export function SessionInitializationNotice() {
  const { authLoading, profileLoading, isLoading, initializationError, refreshUser, logout } = useAuth()
  return <section className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
    {initializationError && !isLoading ? <>
      <h1 className="text-lg font-bold text-slate-900">Unable to initialize your account</h1>
      <p role="alert" className="text-sm text-slate-600">{initializationError}</p>
      <div className="flex gap-3">
        <Button onClick={() => void refreshUser()} className="bg-orange-600 text-white hover:bg-orange-700">Retry account loading</Button>
        <Button variant="outline" onClick={() => void logout()}>Sign out</Button>
      </div>
    </> : <p role="status" className="text-sm font-semibold text-slate-600">
      {authLoading ? "Checking your sign-in session…" : profileLoading ? "Loading your profile and permissions…" : "Opening your account…"}
    </p>}
  </section>
}
