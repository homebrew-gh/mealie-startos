import { config } from './config.js'

export class MealieError extends Error {}

/** Calls Mealie's REST API on the box with the configured API token. */
export async function mealie<T = any>(
  method: string,
  path: string,
  opts: {
    query?: Record<string, unknown>
    body?: unknown
    form?: FormData
    timeoutMs?: number
  } = {},
): Promise<T> {
  const url = new URL(config.mealieUrl + '/api' + path)
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v))
      v.forEach((x) => url.searchParams.append(k, String(x)))
    else url.searchParams.set(k, String(v))
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.mealieToken}`,
      Accept: 'application/json',
      ...(opts.body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
    },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  })
  const text = await res.text()
  if (!res.ok) {
    let detail = text.slice(0, 500)
    try {
      const j = JSON.parse(text)
      detail = JSON.stringify(j.detail ?? j).slice(0, 500)
    } catch {}
    if (res.status === 401) {
      detail += ' (the Mealie API token in StartOS may be wrong or revoked)'
    }
    throw new MealieError(
      `Mealie ${method} ${path} failed: HTTP ${res.status} ${detail}`,
    )
  }
  return (text ? JSON.parse(text) : null) as T
}

/**
 * Creates something by name, or, if that fails because a parallel save just
 * created the same thing, finds and returns that one instead.
 */
export async function createOrReuse<T>(
  create: () => Promise<T>,
  find: () => Promise<T | undefined>,
): Promise<{ value: T; created: boolean }> {
  try {
    return { value: await create(), created: true }
  } catch (err) {
    const existing = await find().catch(() => undefined)
    if (existing) return { value: existing, created: false }
    throw err
  }
}
