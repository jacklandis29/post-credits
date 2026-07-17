type Budget = {
  timestamps: number[];
  windowMs: number;
};

type LimiterState = {
  active: number;
  budgets: Map<string, Budget>;
  lastSweepAt: number;
};

const MAX_BUDGET_KEYS = 5_000;
const SWEEP_INTERVAL_MS = 30_000;

const globalLimiter = globalThis as typeof globalThis & {
  __afterCreditsTmdbLimiter?: LimiterState;
};

const state: LimiterState = globalLimiter.__afterCreditsTmdbLimiter ??= {
  active: 0,
  budgets: new Map<string, Budget>(),
  lastSweepAt: 0,
};

export function tmdbRequestIdentity(request: Request): string {
  const connectingIp = request.headers.get("cf-connecting-ip")?.trim();
  return connectingIp && connectingIp.length <= 64 && /^[0-9a-f:.]+$/i.test(connectingIp)
    ? connectingIp
    : "unknown";
}

function sweepExpiredBudgets(now: number): void {
  for (const [key, budget] of state.budgets) {
    const windowMs = budget.windowMs || 60_000;
    budget.timestamps = budget.timestamps.filter(
      (timestamp) => now - timestamp < windowMs,
    );
    if (budget.timestamps.length === 0) state.budgets.delete(key);
  }
  state.lastSweepAt = now;
}

export function beginTmdbRequest(
  key: string,
  options: {
    limit: number;
    windowMs?: number;
    maxConcurrent?: number;
  },
): (() => void) | null {
  if (!consumeTmdbBudget(key, options)) return null;
  return beginTmdbConcurrency(options.maxConcurrent);
}

export function consumeTmdbBudget(
  key: string,
  options: { limit: number; windowMs?: number },
): boolean {
  const now = Date.now();
  const windowMs = options.windowMs ?? 60_000;
  if (
    now - (state.lastSweepAt || 0) >= SWEEP_INTERVAL_MS ||
    state.budgets.size >= MAX_BUDGET_KEYS
  ) {
    sweepExpiredBudgets(now);
  }

  const existing = state.budgets.get(key);
  if (!existing && state.budgets.size >= MAX_BUDGET_KEYS) return false;
  const budget = existing ?? { timestamps: [], windowMs };
  budget.windowMs = windowMs;
  budget.timestamps = budget.timestamps.filter(
    (timestamp) => now - timestamp < windowMs,
  );
  if (budget.timestamps.length >= options.limit) {
    state.budgets.set(key, budget);
    return false;
  }
  budget.timestamps.push(now);
  state.budgets.set(key, budget);
  return true;
}

export function beginTmdbConcurrency(maxConcurrent = 6): (() => void) | null {
  if (state.active >= maxConcurrent) return null;
  state.active += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.active = Math.max(0, state.active - 1);
  };
}
