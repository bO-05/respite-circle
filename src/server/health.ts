/**
 * Health-check helpers.
 *
 * `/api/health` performs exactly one `SELECT 1`. Neon suspends an idle compute
 * and the first query after a suspend measured 5.4-5.6 s on this project,
 * against 264-358 ms warm. A cold wake is slow, not broken, so the budget sits
 * above the six-second floor and below the host's function ceiling.
 */
export const HEALTH_DB_TIMEOUT_MS = 8_000;

export type HealthDatabase = "ok" | "down";
export type HealthProvider = "configured" | "unconfigured";

export type HealthPayload = {
  ok: boolean;
  db: HealthDatabase;
  provider: HealthProvider;
  version: string;
};

export type HealthEnv = Record<string, string | undefined>;

/** A postgres.js pending query: promise-like, with a best-effort `cancel()`. */
export type HealthQuery = PromiseLike<unknown> & { cancel?: () => void };

/**
 * Boolean only. The health route never echoes a key, a token, or a connection
 * string; it says whether a provider is configured, never which one.
 */
export function isProviderConfigured(env: HealthEnv = process.env): boolean {
  return Boolean(
    env.MISTRAL_API_KEY || env.HF_TOKEN || env.OPENROUTER_API_KEY,
  );
}

/** The deployed commit when Vercel provides it, else the deployment id. */
export function resolveVersion(env: HealthEnv = process.env): string {
  const raw =
    env.VERCEL_GIT_COMMIT_SHA || env.VERCEL_DEPLOYMENT_ID || "local";
  return raw.slice(0, 7);
}

export function buildHealthPayload(input: {
  db: HealthDatabase;
  providerConfigured: boolean;
  version?: string;
}): HealthPayload {
  return {
    ok: input.db === "ok",
    db: input.db,
    provider: input.providerConfigured ? "configured" : "unconfigured",
    version: input.version ?? "local",
  };
}

/**
 * Resolve `work` within a hard budget. `onTimeout` runs exactly once when the
 * budget elapses, so a pending postgres.js query can be cancelled instead of
 * left to finish against a waking compute.
 */
export function withTimeout<T>(
  work: PromiseLike<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive number.");
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        onTimeout?.();
      } catch {
        // Cancelling is best effort; the timeout still decides the result.
      }
      reject(new Error(`Timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    Promise.resolve(work).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Run the health probe and collapse every failure mode to `"down"`, so the
 * route answers with a JSON body instead of throwing.
 */
export async function probeDatabase(
  run: () => HealthQuery,
  timeoutMs: number = HEALTH_DB_TIMEOUT_MS,
): Promise<HealthDatabase> {
  const query = run();
  try {
    await withTimeout(query, timeoutMs, () => query.cancel?.());
    return "ok";
  } catch {
    return "down";
  }
}
