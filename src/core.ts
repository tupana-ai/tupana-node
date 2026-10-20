import { APIConnectionError, APIError, APITimeoutError, TupanaError } from "./errors.js";
import { VERSION } from "./version.js";

export const DEFAULT_BASE_URL = "https://api.tupana.ai/v2";
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RETRIES = 2;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** API key de Tupana. Por defecto se lee de `TUPANA_API_KEY`. */
  apiKey?: string;
  /** URL base de la API. Por defecto `https://api.tupana.ai/v2` (o `TUPANA_BASE_URL`). */
  baseURL?: string;
  /** Timeout por intento, en milisegundos. Por defecto 60 000. */
  timeout?: number;
  /** Reintentos ante 429, 5xx y errores de red. Por defecto 2. */
  maxRetries?: number;
  /** Implementación de `fetch` alternativa (tests, proxies, runtimes sin fetch global). */
  fetch?: FetchLike;
  /** Headers que se agregan a todos los requests. */
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions {
  /**
   * Header `Idempotency-Key`. Reintentar con la misma key nunca duplica la
   * operación: la API devuelve el resultado original. `documents.createBatch`
   * genera una automáticamente si no envías la tuya.
   */
  idempotencyKey?: string;
  /** Header `X-Use-Defaults: true`: la API completa emisor, receptor, fecha y forma de pago. */
  useDefaults?: boolean;
  /** Timeout por intento, en milisegundos. */
  timeout?: number;
  /** Reintentos para este request. */
  maxRetries?: number;
  /** Headers adicionales. */
  headers?: Record<string, string>;
  /** Señal para cancelar el request. */
  signal?: AbortSignal;
}

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<string | number>;
export type Query = Record<string, QueryValue>;

export interface FinalRequestOptions extends RequestOptions {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  query?: Query | undefined;
  body?: unknown;
}

/** Status que justifican reintentar (el request no se procesó o puede repetirse). */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
/** Status donde el servidor garantiza que el request NO se procesó. */
const NOT_PROCESSED_STATUS = new Set([429, 503]);

function readEnv(name: string): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.[name]?.trim() || undefined;
}

export function buildQuery(query: Query | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.append(key, value.join(","));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** UUID v4 para `Idempotency-Key`, sin dependencias. */
export function randomIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback (Node 18 sin crypto global): suficientemente aleatorio para una idempotency key.
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new TupanaError("Request cancelado"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new TupanaError("Request cancelado"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Backoff exponencial con jitter; respeta `Retry-After` (segundos o fecha HTTP). */
export function retryDelayMs(attempt: number, headers?: Headers): number {
  const retryAfter = headers?.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), 60_000);
  }
  const base = Math.min(500 * 2 ** attempt, 8_000);
  const jitter = base * 0.25 * Math.random();
  return base + jitter;
}

/** Cliente HTTP base: auth, timeouts, reintentos y parseo de errores. */
export class APIClient {
  readonly apiKey: string;
  readonly baseURL: string;
  readonly timeout: number;
  readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey ?? readEnv("TUPANA_API_KEY");
    if (!apiKey) {
      throw new TupanaError(
        "Falta la API key: pásala como `new Tupana({ apiKey })` o define TUPANA_API_KEY.",
      );
    }
    this.apiKey = apiKey;
    this.baseURL = (options.baseURL ?? readEnv("TUPANA_BASE_URL") ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    );
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const f = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) {
      throw new TupanaError(
        "No hay `fetch` global. Usa Node 18+ o pasa una implementación en `new Tupana({ fetch })`.",
      );
    }
    this.fetchImpl = f;
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  buildURL(path: string, query?: Query): string {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `${this.baseURL}${normalized}${buildQuery(query)}`;
  }

  private buildHeaders(opts: FinalRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Api-Key ${this.apiKey}`,
      "User-Agent": `tupana-node/${VERSION}`,
      "X-Tupana-SDK": `node/${VERSION}`,
      ...this.defaultHeaders,
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    if (opts.useDefaults !== undefined) headers["X-Use-Defaults"] = String(opts.useDefaults);
    return { ...headers, ...(opts.headers ?? {}) };
  }

  private canRetry(opts: FinalRequestOptions, status: number | null): boolean {
    const safeMethod = opts.method === "GET" || opts.method === "DELETE" || opts.method === "PUT";
    const idempotent = safeMethod || Boolean(opts.idempotencyKey);
    if (status === null) return idempotent; // error de red: no sabemos si se procesó
    if (NOT_PROCESSED_STATUS.has(status)) return true;
    return idempotent && RETRYABLE_STATUS.has(status);
  }

  async request<T>(opts: FinalRequestOptions): Promise<T> {
    const url = this.buildURL(opts.path, opts.query);
    const headers = this.buildHeaders(opts);
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const maxRetries = opts.maxRetries ?? this.maxRetries;
    const timeout = opts.timeout ?? this.timeout;

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const onAbort = () => controller.abort(opts.signal?.reason);
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new APITimeoutError()), timeout);

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: opts.method,
          headers,
          body,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        if (opts.signal?.aborted) throw opts.signal.reason ?? err;
        const timedOut = controller.signal.reason instanceof APITimeoutError;
        if (attempt < maxRetries && this.canRetry(opts, null)) {
          await sleep(retryDelayMs(attempt), opts.signal);
          continue;
        }
        if (timedOut) throw new APITimeoutError();
        throw new APIConnectionError(undefined, { cause: err });
      }
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        const text = await response.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as T;
        }
      }

      if (attempt < maxRetries && this.canRetry(opts, response.status)) {
        void response.body?.cancel().catch(() => undefined);
        await sleep(retryDelayMs(attempt, response.headers), opts.signal);
        continue;
      }

      const raw = await response.text().catch(() => "");
      let parsed: unknown = raw;
      try {
        parsed = raw ? JSON.parse(raw) : undefined;
      } catch {
        // cuerpo no-JSON (por ejemplo un 502 del balanceador)
      }
      throw APIError.fromResponse(response.status, parsed, response.headers);
    }
  }

  get<T>(path: string, query?: Query, options?: RequestOptions): Promise<T> {
    return this.request<T>({ ...options, method: "GET", path, query });
  }
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>({ ...options, method: "POST", path, body });
  }
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>({ ...options, method: "PATCH", path, body });
  }
  delete<T>(path: string, query?: Query, options?: RequestOptions): Promise<T> {
    return this.request<T>({ ...options, method: "DELETE", path, query });
  }
}
