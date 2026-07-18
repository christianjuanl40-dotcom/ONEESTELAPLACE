export function toPrice(v: string | number | undefined) {
  const n = Number(v || 0)
  return Number.isFinite(n) ? n : 0
}
