import { WebhookVerificationError } from "./errors.js";
import type { WebhookEvent } from "./types.js";

/**
 * Verificación de webhooks de Tupana.
 *
 * Cada entrega trae los headers `X-Pana-Event-Id`, `X-Pana-Event-Type`,
 * `X-Pana-Timestamp`, `X-Pana-Delivery` y, si el webhook tiene `secret`,
 * `X-Pana-Signature`: el HMAC SHA-256 en hexadecimal del cuerpo exacto del
 * request, firmado con el `secret`. Verifica siempre contra el cuerpo crudo
 * (bytes tal como llegaron), nunca contra un JSON re-serializado.
 *
 * La firma no incluye el timestamp: para descartar entregas repetidas usa
 * `X-Pana-Event-Id` (idempotencia de tu lado).
 */

export const SIGNATURE_HEADER = "x-pana-signature";
export const EVENT_ID_HEADER = "x-pana-event-id";
export const EVENT_TYPE_HEADER = "x-pana-event-type";
export const TIMESTAMP_HEADER = "x-pana-timestamp";
export const DELIVERY_HEADER = "x-pana-delivery";

type HeaderBag =
  | Headers
  | Record<string, string | string[] | undefined>
  | { get(name: string): string | null };

type SubtleLike = {
  importKey(...args: unknown[]): Promise<unknown>;
  sign(algorithm: string, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
};

let subtlePromise: Promise<SubtleLike> | undefined;

async function getSubtle(): Promise<SubtleLike> {
  const globalSubtle = (globalThis as { crypto?: { subtle?: SubtleLike } }).crypto?.subtle;
  if (globalSubtle) return globalSubtle;
  // Node 18 no expone `crypto` global por defecto.
  subtlePromise ??= import("node:crypto").then(
    (mod) => (mod.webcrypto as unknown as { subtle: SubtleLike }).subtle,
  );
  return subtlePromise;
}

const encoder = new TextEncoder();

function toBytes(payload: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof payload === "string") return encoder.encode(payload);
  if (payload instanceof Uint8Array) return payload;
  return new Uint8Array(payload);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Lee un header de cualquier formato (Fetch `Headers`, objeto de Node/Express). */
export function readHeader(headers: HeaderBag, name: string): string | undefined {
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get(n: string): string | null }).get(name) ?? undefined;
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name.toLowerCase());
  const value = key ? record[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** Calcula la firma (HMAC SHA-256 en hex) de un payload. */
export async function computeWebhookSignature(
  payload: string | Uint8Array | ArrayBuffer,
  secret: string,
): Promise<string> {
  const subtle = await getSubtle();
  const key = await subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await subtle.sign("HMAC", key, toBytes(payload)));
}

/**
 * `true` si `signature` corresponde al payload. Acepta la firma con o sin el
 * prefijo `sha256=` y compara en tiempo constante.
 */
export async function verifyWebhookSignature(
  payload: string | Uint8Array | ArrayBuffer,
  signature: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;
  const received = signature
    .trim()
    .replace(/^sha256=/i, "")
    .toLowerCase();
  const expected = await computeWebhookSignature(payload, secret);
  return timingSafeEqual(expected, received);
}

/**
 * Verifica la firma y devuelve el evento parseado. Lanza
 * {@link WebhookVerificationError} si la firma falta, no coincide o el cuerpo
 * no es JSON.
 *
 * ```ts
 * const event = await constructWebhookEvent(rawBody, req.headers, process.env.TUPANA_WEBHOOK_SECRET!);
 * if (event.event === "document.issued") { ... }
 * ```
 */
export async function constructWebhookEvent<TData = Record<string, unknown>>(
  payload: string | Uint8Array | ArrayBuffer,
  headers: HeaderBag,
  secret: string,
): Promise<WebhookEvent<TData>> {
  const signature = readHeader(headers, SIGNATURE_HEADER);
  if (!signature) {
    throw new WebhookVerificationError(
      "Falta el header X-Pana-Signature. ¿Configuraste un `secret` en el webhook?",
    );
  }
  if (!(await verifyWebhookSignature(payload, signature, secret))) {
    throw new WebhookVerificationError("La firma del webhook no coincide");
  }
  const text = typeof payload === "string" ? payload : new TextDecoder().decode(toBytes(payload));
  try {
    return JSON.parse(text) as WebhookEvent<TData>;
  } catch {
    throw new WebhookVerificationError("El cuerpo del webhook no es JSON válido");
  }
}
