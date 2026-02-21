interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface DailyLimitEntry {
  count: number;
  date: string;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const dailyLimitStore = new Map<string, DailyLimitEntry>();

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const DAILY_LIMIT_MAX_REQUESTS = 100;

function getDateString(): string {
  return new Date().toISOString().split('T')[0];
}

function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

export function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetTime: number } {
  cleanupExpiredEntries();

  const now = Date.now();
  const entry = rateLimitStore.get(userId);

  if (!entry || now > entry.resetTime) {
    const newEntry: RateLimitEntry = {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW_MS,
    };
    rateLimitStore.set(userId, newEntry);
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      resetTime: newEntry.resetTime,
    };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.resetTime,
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - entry.count,
    resetTime: entry.resetTime,
  };
}

export function checkDailyLimit(userId: string): { allowed: boolean; count: number; remaining: number; limit: number } {
  const today = getDateString();
  const entry = dailyLimitStore.get(userId);

  if (!entry || entry.date !== today) {
    const newEntry: DailyLimitEntry = {
      count: 1,
      date: today,
    };
    dailyLimitStore.set(userId, newEntry);
    return {
      allowed: true,
      count: 1,
      remaining: DAILY_LIMIT_MAX_REQUESTS - 1,
      limit: DAILY_LIMIT_MAX_REQUESTS,
    };
  }

  if (entry.count >= DAILY_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      count: entry.count,
      remaining: 0,
      limit: DAILY_LIMIT_MAX_REQUESTS,
    };
  }

  entry.count++;
  return {
    allowed: true,
    count: entry.count,
    remaining: DAILY_LIMIT_MAX_REQUESTS - entry.count,
    limit: DAILY_LIMIT_MAX_REQUESTS,
  };
}
