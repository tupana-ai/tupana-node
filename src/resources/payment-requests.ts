import type { RequestOptions } from "../core.js";
import { APIResource, pathId } from "../resource.js";
import type {
  ListResponse,
  PaymentRequest,
  PaymentRequestCreateParams,
  PaymentRequestStatus,
} from "../types.js";

/** Cobros: links de pago que, al pagarse, emiten el DTE o saldan documentos existentes. */
export class PaymentRequests extends APIResource {
  /**
   * Crea una sesión de cobro (`POST /payment-requests/`) y devuelve el
   * `payment_url` al que debes redirigir a tu cliente.
   *
   * Usa `external_id` como llave de idempotencia: si ya existe una sesión con
   * ese `external_id` para tu API key, la API devuelve la original.
   */
  create(params: PaymentRequestCreateParams, options?: RequestOptions): Promise<PaymentRequest> {
    return this._client.post<PaymentRequest>("/payment-requests/", params, options);
  }

  /** Lista tus cobros (`GET /payment-requests/`), opcionalmente por estado. */
  list(
    params: { status?: PaymentRequestStatus } = {},
    options?: RequestOptions,
  ): Promise<ListResponse<PaymentRequest>> {
    return this._client.get<ListResponse<PaymentRequest>>(
      "/payment-requests/",
      { status: params.status },
      options,
    );
  }

  /** Estado de un cobro (`GET /payment-requests/{id}/`). */
  retrieve(paymentRequestId: string | number, options?: RequestOptions): Promise<PaymentRequest> {
    return this._client.get<PaymentRequest>(
      `/payment-requests/${pathId(paymentRequestId)}/`,
      undefined,
      options,
    );
  }

  /**
   * Emite manualmente el DTE de un cobro pagado que se creó con
   * `auto_issue: false` (`PATCH /payment-requests/{id}/` con `{ status: "issued" }`).
   */
  issue(paymentRequestId: string | number, options?: RequestOptions): Promise<PaymentRequest> {
    return this._client.patch<PaymentRequest>(
      `/payment-requests/${pathId(paymentRequestId)}/`,
      { status: "issued" },
      options,
    );
  }
}
