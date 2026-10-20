import type { RequestOptions } from "../core.js";
import { APIResource, pathId } from "../resource.js";
import type {
  ListResponse,
  WebhookCreateParams,
  WebhookEndpoint,
  WebhookEvent,
  WebhookUpdateParams,
} from "../types.js";
import {
  computeWebhookSignature,
  constructWebhookEvent,
  verifyWebhookSignature,
} from "../webhook-signature.js";

/** Configuración de webhooks y verificación de las notificaciones entrantes. */
export class Webhooks extends APIResource {
  /** Crea un webhook (`POST /webhooks/`). Configura siempre un `secret` para poder verificar la firma. */
  create(params: WebhookCreateParams, options?: RequestOptions): Promise<WebhookEndpoint> {
    return this._client.post<WebhookEndpoint>("/webhooks/", params, options);
  }

  list(
    params: { master_entity_id?: string } = {},
    options?: RequestOptions,
  ): Promise<ListResponse<WebhookEndpoint>> {
    return this._client.get<ListResponse<WebhookEndpoint>>("/webhooks/", { ...params }, options);
  }

  retrieve(webhookId: string, options?: RequestOptions): Promise<WebhookEndpoint> {
    return this._client.get<WebhookEndpoint>(`/webhooks/${pathId(webhookId)}/`, undefined, options);
  }

  update(
    webhookId: string,
    params: WebhookUpdateParams,
    options?: RequestOptions,
  ): Promise<WebhookEndpoint> {
    return this._client.patch<WebhookEndpoint>(`/webhooks/${pathId(webhookId)}/`, params, options);
  }

  delete(webhookId: string, options?: RequestOptions): Promise<void> {
    return this._client.delete<void>(`/webhooks/${pathId(webhookId)}/`, undefined, options);
  }

  /**
   * Verifica `X-Pana-Signature` y devuelve el evento parseado.
   * `payload` debe ser el cuerpo crudo del request.
   */
  unwrap<TData = Record<string, unknown>>(
    payload: string | Uint8Array | ArrayBuffer,
    headers: Parameters<typeof constructWebhookEvent>[1],
    secret: string,
  ): Promise<WebhookEvent<TData>> {
    return constructWebhookEvent<TData>(payload, headers, secret);
  }

  /** `true` si la firma corresponde al cuerpo. */
  verifySignature(
    payload: string | Uint8Array | ArrayBuffer,
    signature: string | null | undefined,
    secret: string,
  ): Promise<boolean> {
    return verifyWebhookSignature(payload, signature, secret);
  }

  /** Firma un payload como lo hace Tupana (útil para tests de tu receptor). */
  sign(payload: string | Uint8Array | ArrayBuffer, secret: string): Promise<string> {
    return computeWebhookSignature(payload, secret);
  }
}
