type Budget = {
  timestamps: number[];
};

type LimiterState = {
  active: number;
  budgets: Map<string, Budget>;
};

const globalLimiter = globalThis as typeof globalThis & {
  __afterCreditsTmdbLimiter?: LimiterState;
};

const state: LimiterState = globalLimiter.__afterCreditsTmdbLimiter ??= {
  active: 0,
  budgets: new Map<string, Budget>(),
};

export function tmdbRequestIdentity(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
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
  const budget = state.budgets.get(key) ?? { timestamps: [] };
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
