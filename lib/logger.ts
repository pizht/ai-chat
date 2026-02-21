type LogEvent = 
  | 'USER_LOGIN'
  | 'USER_REGISTER'
  | 'CHAT_REQUEST'
  | 'RATE_LIMITED'
  | 'DAILY_LIMITED'
  | 'REQUEST_REJECTED';

interface LogEntry {
  timestamp: string;
  event: LogEvent;
  userId?: string;
  email?: string;
  details?: Record<string, unknown>;
}

const logs: LogEntry[] = [];

function formatTimestamp(): string {
  return new Date().toISOString();
}

export function log(event: LogEvent, data?: { userId?: string; email?: string; details?: Record<string, unknown> }) {
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    event,
    ...data,
  };

  logs.push(entry);

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[${entry.timestamp}] ${event}`, data || '');
  }
}

export function logLogin(userId: string, email: string) {
  log('USER_LOGIN', { userId, email });
}

export function logRegister(userId: string, email: string) {
  log('USER_REGISTER', { userId, email });
}

export function logChatRequest(userId: string, details: { 
  messageCount: number; 
  totalChars: number;
  estimatedTokens: number;
}) {
  log('CHAT_REQUEST', { 
    userId, 
    details: {
      messageCount: details.messageCount,
      totalChars: details.totalChars,
      estimatedTokens: details.estimatedTokens,
    }
  });
}

export function logRateLimited(userId: string, details: { remainingTime: number }) {
  log('RATE_LIMITED', { userId, details });
}

export function logDailyLimited(userId: string, details: { dailyCount: number }) {
  log('DAILY_LIMITED', { userId, details });
}

export function logRequestRejected(userId: string, details: { reason: string; error: string }) {
  log('REQUEST_REJECTED', { userId, details });
}

export function getLogs(limit: number = 100): LogEntry[] {
  return logs.slice(-limit);
}

export function getStats() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  const todayLogs = logs.filter(log => log.timestamp.startsWith(today));

  return {
    total: logs.length,
    today: {
      logins: todayLogs.filter(l => l.event === 'USER_LOGIN').length,
      registers: todayLogs.filter(l => l.event === 'USER_REGISTER').length,
      chatRequests: todayLogs.filter(l => l.event === 'CHAT_REQUEST').length,
      rateLimited: todayLogs.filter(l => l.event === 'RATE_LIMITED').length,
      dailyLimited: todayLogs.filter(l => l.event === 'DAILY_LIMITED').length,
      rejected: todayLogs.filter(l => l.event === 'REQUEST_REJECTED').length,
    },
  };
}
