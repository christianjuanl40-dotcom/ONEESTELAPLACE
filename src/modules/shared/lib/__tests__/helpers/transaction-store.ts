type Data = Record<string, unknown>
type Filter = [string, string, unknown]

class Reference {
  constructor(readonly store: TransactionStore, readonly path: string) {}
  get id() { return this.path.split("/").at(-1)! }
  async get() { return this.store.document(this.path) }
}

class Query {
  constructor(readonly store: TransactionStore, readonly path: string, readonly filters: Filter[] = [], readonly fields?: string[]) {}
  where(field: string, operator: string, value: unknown): Query {
    return new Query(this.store, this.path, [...this.filters, [field, operator, value]], this.fields)
  }
  select(...fields: string[]) { return new Query(this.store, this.path, this.filters, fields) }
  doc(id: string) { return new Reference(this.store, `${this.path}/${id}`) }
  async add(data: Data) { this.store.seed(`${this.path}/notification-${this.store.notification++}`, data) }
  async get() { return this.store.query(this) }
}

/** Transaction boundary fixture: read-before-write enforcement, snapshot reads,
 * document-version conflicts, and optimistic retries (including absent locks).
 * Intentionally does not detect query phantoms, so the explicit lock is exercised.
 */
export class TransactionStore {
  data = new Map<string, Data>()
  versions = new Map<string, number>()
  notification = 0
  retries = 0
  collection(path: string) { return new Query(this, path) }
  seed(path: string, data: Data) {
    this.data.set(path, structuredClone(data))
    this.versions.set(path, (this.versions.get(path) || 0) + 1)
  }
  document(path: string, data = this.data) {
    return { id: path.split("/").at(-1)!, exists: data.has(path), data: () => structuredClone(data.get(path)) }
  }
  query(query: Query, data = this.data) {
    const entries = [...data].filter(([path, record]) => path.startsWith(`${query.path}/`)
      && query.filters.every(([field, operator, value]) => {
        const stored = record[field]
        if (stored === undefined) return false
        if (operator === "==") return stored === value
        if (operator === ">=") return String(stored) >= String(value)
        if (operator === "<=") return String(stored) <= String(value)
        throw new Error(`Unsupported fixture operator: ${operator}`)
      }))
    const docs = entries.map(([path]) => {
      const document = this.document(path, data)
      return query.fields ? { ...document, data: () => Object.fromEntries(Object.entries(document.data() || {}).filter(([key]) => query.fields!.includes(key))) } : document
    })
    return { docs, size: docs.length, forEach: (callback: (document: ReturnType<TransactionStore["document"]>) => void) => docs.forEach(callback) }
  }
  async runTransaction<T>(callback: (transaction: any) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const snapshot = structuredClone(this.data)
      const versions = new Map(this.versions)
      const reads = new Set<string>()
      const writes: Array<{ ref: Reference; data?: Data; merge?: boolean; remove?: boolean }> = []
      const transaction = {
        get: async (target: Reference | Query) => {
          if (writes.length) throw new Error("Transaction read after write")
          if (target instanceof Reference) {
            reads.add(target.path)
            return this.document(target.path, snapshot)
          }
          const result = this.query(target, snapshot)
          result.docs.forEach((document) => reads.add(`${target.path}/${document.id}`))
          return result
        },
        set: (ref: Reference, data: Data, options?: { merge: boolean }) => writes.push({ ref, data, merge: options?.merge }),
        create: (ref: Reference, data: Data) => writes.push({ ref, data }),
        update: (ref: Reference, data: Data) => writes.push({ ref, data, merge: true }),
        delete: (ref: Reference) => writes.push({ ref, remove: true }),
      }
      const result = await callback(transaction)
      if ([...reads].some((path) => (versions.get(path) || 0) !== (this.versions.get(path) || 0))) {
        this.retries++
        continue
      }
      writes.forEach(({ ref, data, merge, remove }) => {
        if (remove) {
          this.data.delete(ref.path)
          this.versions.set(ref.path, (this.versions.get(ref.path) || 0) + 1)
        } else {
          this.seed(ref.path, { ...(merge ? this.data.get(ref.path) : {}), ...data })
        }
      })
      return result
    }
    throw new Error("Fixture transaction retry limit")
  }
}
