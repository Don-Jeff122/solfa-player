export class FixedWindowRateLimiter {
  constructor({ limit = 10, windowMs = 60 * 60 * 1000, now = () => Date.now() } = {}) {
    this.limit = Math.max(1, limit)
    this.windowMs = Math.max(1, windowMs)
    this.now = now
    this.buckets = new Map()
  }

  take(key) {
    const now = this.now()
    const bucket = this.buckets.get(key)
    if (!bucket || now - bucket.startedAt >= this.windowMs) {
      this.buckets.set(key, { startedAt: now, count: 1 })
      return { allowed: true, remaining: this.limit - 1, retryAfterMs: 0 }
    }

    if (bucket.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, this.windowMs - (now - bucket.startedAt)),
      }
    }

    bucket.count += 1
    return { allowed: true, remaining: this.limit - bucket.count, retryAfterMs: 0 }
  }

  cleanup(now = this.now()) {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.startedAt >= this.windowMs) this.buckets.delete(key)
    }
  }
}

export function requestClientKey(req) {
  const forwarded = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}
