/**
 * Errores tipados del SDK.
 *
 * La API v2 responde los errores con un envelope estilo Stripe:
 *
 *   { "error": { "type", "code", "message", "param?", "resource?", "doc_url?", "request_id" } }
 *
 * Algunos endpoints todavía responden formatos planos (`{ "error": "..." }`,
 * `{ "error_code", "message" }` o el diccionario de validación de DRF). El SDK
 * normaliza todos esos formatos en {@link APIError}.
 */

export interface APIErrorBody {
  type?: string;
  code?: string;
  message?: string;
  param?: string;
  resource?: string;
  doc_url?: string;
  request_id?: string;
  [key: string]: unknown;
}

/** Base de todos los errores lanzados por el SDK. */
export class TupanaError extends Error {
  override name = "TupanaError";
}

/** La API respondió con un status HTTP no exitoso. */
export class APIError extends TupanaError {
  override name = "APIError";
  /** Status HTTP de la respuesta. */
  readonly status: number;
  /** Categoría amplia del error (`validation_error`, `rate_limit_error`, `sii_error`…). */
  readonly type: string | undefined;
  /** Código estable y accionable (`no_active_credentials`, `folios_exhausted`…). */
  readonly code: string | undefined;
  /** Campo del request que causó el error, si aplica. */
  readonly param: string | undefined;
  /** Link a la documentación del código de error. */
  readonly docUrl: string | undefined;
  /** Identificador del request; inclúyelo al reportar un problema a soporte. */
  readonly requestId: string | undefined;
  /** Headers de la respuesta. */
  readonly headers: Headers;
  /** Cuerpo de la respuesta tal como llegó (JSON parseado o texto). */
  readonly body: unknown;

  constructor(status: number, body: unknown, headers: Headers, fallbackMessage?: string) {
    const parsed = normalizeErrorBody(body);
    const message = parsed.message || fallbackMessage || `La API respondió ${status}`;
    super(message);
    this.status = status;
    this.type = parsed.type;
    this.code = parsed.code;
    this.param = parsed.param;
    this.docUrl = parsed.doc_url;
    this.requestId = parsed.request_id ?? headers.get("x-request-id") ?? undefined;
    this.headers = headers;
    this.body = body;
  }

  /** Construye la subclase adecuada para el status HTTP. */
  static fromResponse(status: number, body: unknown, headers: Headers): APIError {
    switch (status) {
      case 400:
        return new BadRequestError(status, body, headers);
      case 401:
        return new AuthenticationError(status, body, headers);
      case 403:
        return new PermissionDeniedError(status, body, headers);
      case 404:
        return new NotFoundError(status, body, headers);
      case 409:
        return new ConflictError(status, body, headers);
      case 413:
        return new PayloadTooLargeError(status, body, headers);
      case 422:
        return new UnprocessableEntityError(status, body, headers);
      case 429:
        return new RateLimitError(status, body, headers);
      default:
        if (status >= 500) return new InternalServerError(status, body, headers);
        return new APIError(status, body, headers);
    }
  }
}

export class BadRequestError extends APIError {
  override name = "BadRequestError";
}
export class AuthenticationError extends APIError {
  override name = "AuthenticationError";
}
export class PermissionDeniedError extends APIError {
  override name = "PermissionDeniedError";
}
export class NotFoundError extends APIError {
  override name = "NotFoundError";
}
export class ConflictError extends APIError {
  override name = "ConflictError";
}
export class PayloadTooLargeError extends APIError {
  override name = "PayloadTooLargeError";
}
export class UnprocessableEntityError extends APIError {
  override name = "UnprocessableEntityError";
}
export class RateLimitError extends APIError {
  override name = "RateLimitError";
}
export class InternalServerError extends APIError {
  override name = "InternalServerError";
}

/** No se pudo conectar con la API (DNS, TLS, conexión cortada…). */
export class APIConnectionError extends TupanaError {
  override name = "APIConnectionError";
  constructor(message = "No se pudo conectar con la API de Tupana", options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** El request superó el timeout configurado. */
export class APITimeoutError extends APIConnectionError {
  override name = "APITimeoutError";
  constructor(message = "El request a la API de Tupana superó el timeout") {
    super(message);
  }
}

/** La firma del webhook no coincide o el payload no es válido. */
export class WebhookVerificationError extends TupanaError {
  override name = "WebhookVerificationError";
}

/** `waitForBatch` superó su tiempo máximo de espera. */
export class BatchTimeoutError extends TupanaError {
  override name = "BatchTimeoutError";
  readonly batchId: string;
  readonly lastStatus: unknown;
  constructor(batchId: string, lastStatus: unknown) {
    super(`El lote ${batchId} no terminó dentro del tiempo de espera`);
    this.batchId = batchId;
    this.lastStatus = lastStatus;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Normaliza cualquiera de los formatos de error de la API a {@link APIErrorBody}. */
export function normalizeErrorBody(body: unknown): APIErrorBody {
  if (typeof body === "string") return { message: body || undefined };
  if (!body || typeof body !== "object") return {};
  const obj = body as Record<string, unknown>;

  // v2: { error: { type, code, message, ... } }
  if (obj.error && typeof obj.error === "object" && !Array.isArray(obj.error)) {
    return obj.error as APIErrorBody;
  }

  // v1 / plano: { error: "...", code?, detail? } o { error_code, message }
  const message = asString(obj.error) ?? asString(obj.message) ?? asString(obj.detail) ?? undefined;
  const code = asString(obj.code) ?? asString(obj.error_code);
  if (message || code) return { message, code };

  // Validación DRF: { campo: ["mensaje"] }
  const entries = Object.entries(obj);
  const first = entries[0];
  if (first) {
    const [field, value] = first;
    const text = Array.isArray(value) ? value.map(String).join(" ") : JSON.stringify(value);
    return { message: `${field}: ${text}`, param: field, type: "validation_error" };
  }
  return {};
}
