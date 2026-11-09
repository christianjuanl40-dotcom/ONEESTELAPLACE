/** Stable empty-conversation guidance, not a fabricated/persisted chat message. */
export function ChatWelcome({ ready, empty, error }: { ready: boolean; empty: boolean; error: string | null }) {
  if (!ready || !empty || error) return null
  return (
    <section aria-label="Welcome to chat support" className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-slate-900">
      <h3 className="font-semibold">Welcome to One Estela Place!</h3>
      <p className="mt-1 leading-6">Send a message to our support team, or choose an available suggested question below.</p>
    </section>
  )
}
