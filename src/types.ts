/**
 * Tipos públicos del SDK.
 *
 * Las estructuras de entrada (documento, emisor, receptor, ítems, referencias,
 * datos de transporte y exportación, webhooks) se derivan directamente del
 * OpenAPI v2 (`src/generated/openapi-v2.ts`, regenerable con `npm run generate`).
 * Las respuestas se tipan según lo que devuelve el backend hoy y dejan una firma
 * de índice para que un campo nuevo de la API nunca rompa tu compilación.
 */
import type { components as PaymentComponents } from "./generated/openapi-payment-requests.js";
import type { components } from "./generated/openapi-v2.js";

type Schemas = components["schemas"];
type Open<T> = T & { [key: string]: unknown };

// ── Envelope de listas v2 ────────────────────────────────────────────────────

export interface ListMeta {
  page: number | null;
  page_size: number | null;
  total: number;
  total_pages: number | null;
  [key: string]: unknown;
}

/** Toda lista v2 responde `{ data, meta, links }`. */
export interface ListResponse<T> {
  data: T[];
  meta: ListMeta;
  links: { next: string | null; prev: string | null };
}

export interface PageParams {
  /** Página (desde 1). */
  page?: number;
  /** Tamaño de página. La API v2 lo acota a 200. */
  page_size?: number;
  /** Sparse fieldsets: `fields: "id,folio"` devuelve solo esos campos. */
  fields?: string;
}

// ── Documentos ───────────────────────────────────────────────────────────────

/** Códigos de tipo de DTE aceptados por la emisión en lote. */
export type DteTypeCode =
  | "33"
  | "34"
  | "39"
  | "41"
  | "46"
  | "52"
  | "56"
  | "61"
  | "80"
  | "90"
  | "110"
  | "111"
  | "112"
  | (string & {});

export type DocumentIssuer = Schemas["DocumentIssuer"];
export type DocumentReceiver = Schemas["DocumentReceiver"];
export type DocumentHeader = Schemas["DocumentHeader"];
export type DetailItem = Schemas["DetailItem"];
export type ReferenceItem = Schemas["ReferenceItem"];
export type TransportData = Schemas["TransportData"];
export type ExportData = Schemas["ExportData"];
export type BatchWarning = Schemas["BatchWarning"];
export type Trace = Schemas["Trace"];
export type TraceEvent = Schemas["TraceEvent"];

/** Un documento a emitir (o a crear como borrador). */
export type DocumentInput = Omit<Schemas["Document"], "dte_type"> & {
  dte_type: { code: DteTypeCode };
};

export interface CreateBatchParams {
  /** Hasta 200 documentos por llamada. */
  documents: DocumentInput[];
  /**
   * `issued` (por defecto) emite al SII en segundo plano.
   * `draft` crea borradores sin folio ni envío al SII (para previsualizar).
   */
  state?: "issued" | "draft";
  /** Con `state: "draft"`, además devuelve el PDF del borrador. */
  preview?: boolean;
}

/** Estado de cada documento dentro de un lote. */
export type BatchDocumentStatus =
  | "created"
  | "processing"
  | "success"
  | "invalid"
  | "temporary_error"
  | "permanent_error"
  | "incomplete"
  | (string & {});

/** Estado agregado de un lote: `completed` y `failed` son finales. */
export type BatchStatus = "created" | "processing" | "completed" | "failed" | (string & {});

export type BatchDocumentSummary = Open<{
  id: string;
  folio: string | null;
  date_issued: string;
  amount_with_iva: number;
  receiver_id?: string | null;
  is_draft?: boolean;
  can_be_issued?: boolean;
  dte_type?: { code: string; description?: string };
  sender?: { id: string; name: string; tax_id: string } | null;
  receiver?: { id: string; name: string; tax_id: string } | null;
  items?: Array<Record<string, unknown>>;
  document_total?: {
    net_amount: number | null;
    iva_rate: number | null;
    iva_amount: number | null;
    exempt_amount?: number | null;
    total_amount: number | null;
  } | null;
  /** URL presignada al PDF (válida por 2 horas). */
  pdf_url?: string | null;
  pdf_download_url?: string | null;
}>;

export type BatchDocumentResult = Open<{
  /** Posición del documento en el arreglo enviado (desde 0). */
  index: number;
  status: BatchDocumentStatus;
  /** Emitido, pero el SII todavía no entrega su veredicto. El PDF ya se puede descargar. */
  confirmation_pending?: boolean;
  document?: BatchDocumentSummary | null;
}>;

/** Respuesta de `POST /documents/batch/`. */
export type BatchCreateResponse = Open<{
  batch_id: string;
  status: BatchStatus;
  created_at: string;
  documents: BatchDocumentResult[];
  /** Avisos no bloqueantes (por ejemplo campos desconocidos que se ignoraron). */
  warnings?: BatchWarning[];
}>;

/** Respuesta de `GET /documents/batch/{batch_id}/`. */
export type Batch = Open<{
  id: string;
  status: BatchStatus;
  idempotency_key?: string | null;
  created_at: string;
  updated_at?: string;
  documents: BatchDocumentResult[];
}>;

/** Documento tal como lo devuelven `GET /documents/` y `GET /documents/{id}/`. */
export type Document = Open<Schemas["DocumentDetailWithFiles"]>;

export interface DocumentListParams extends PageParams {
  /** Empresa cuyos documentos quieres listar (`ment_…`). */
  master_entity_id: string;
  /** `issued` (por defecto) o `received`. */
  document_type?: "issued" | "received";
  folio?: number | string;
  search?: string;
  /** Códigos DTE, por ejemplo `["33", "34"]`. */
  dte_type__code__in?: string[];
  issuer_tax_id?: string;
  issue_date_gte?: string;
  issue_date_lte?: string;
  reception_date_from?: string;
  reception_date_to?: string;
  include_trace_events?: boolean;
  /** Filtros por `json_param`: `{ external_order_id: "PED-123" }` → `json_param__external_order_id=PED-123`. */
  json_param?: Record<string, string | number>;
  [key: string]: unknown;
}

export type DocumentState = Open<Schemas["DocumentState"]>;

// ── Cobros (payment requests) ────────────────────────────────────────────────

type PaymentSchemas = PaymentComponents["schemas"];

export type PaymentRequestItem = PaymentSchemas["PaymentRequestItem"];
export type DteRecipient = PaymentSchemas["DteRecipient"];

/**
 * Crea una sesión de cobro (link de pago).
 * - Modo emisión: `amount`, `target_dte_type`, `dte_recipient` e `items`; Tupana emite el DTE al pagarse.
 * - Modo cobro directo: `document_ids` de documentos ya emitidos.
 */
export type PaymentRequestCreateParams = Omit<
  PaymentSchemas["PaymentRequestCreate"],
  "recipient_id" | "document_ids"
> & {
  /** Destinatario de los fondos (debe tener cuenta bancaria registrada). */
  recipient_id: string | number;
  document_ids?: Array<string | number>;
};

export type PaymentRequestStatus =
  | "pending"
  | "paid"
  | "issued"
  | "failed"
  | "expired"
  | "refunded"
  | (string & {});

export type PaymentRequest = Open<{
  payment_request_id: string | number;
  status: PaymentRequestStatus;
  /** Redirige a tu cliente a esta URL para pagar. */
  payment_url: string;
  expires_at: string;
  created_at: string;
  amount: number;
  target_dte_type: string | number | null;
  auto_issue: boolean | null;
  external_id: string | null;
  metadata: Record<string, unknown> | null;
  issued_document_id: string | number | null;
  document_ids: Array<string | number>;
}>;

// ── Cesiones ─────────────────────────────────────────────────────────────────

export interface CessionBatchCreateParams {
  /** Empresa emisora de las facturas (`ment_…`). */
  master_entity_id: string | number;
  /** Facturas a ceder (`docu_…`). */
  document_ids: Array<string | number>;
  /** RUT del cesionario sin puntos ni guion ni DV, ej. `"76798398"`. */
  assignee_rut: string;
  /** Dígito verificador del cesionario. */
  assignee_dv: string;
  assignee_business_name: string;
  assignee_address: string;
  assignee_email: string;
  assignor_email?: string;
}

export type CessionBatchCreateResponse = Open<{
  success: boolean;
  status: string;
  total: number;
  message?: string;
  ws_channel?: string;
  cession_batch_id: string;
}>;

export type CessionBatch = Open<{
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "partial" | (string & {});
  total: number;
  success_count: number;
  failed_count: number;
  assignee_business_name?: string;
  assignee_rut?: string;
  created_at: string;
  error_message: string | null;
  batch_cessions: Array<
    Open<{
      document_id: string | number;
      folio: string;
      status: "pending" | "processing" | "success" | "failed" | (string & {});
      cession_id: string | number | null;
      error_message: string | null;
    }>
  >;
}>;

export type Cession = Open<Schemas["CessionListItem"]>;

export interface CessionListParams extends PageParams {
  master_entity_id: string;
  document_type?: "issued" | "received";
  date_from?: string;
  date_to?: string;
  status?: "processing" | "rejected" | "success";
  search?: string;
}

// ── Webhooks (configuración) ─────────────────────────────────────────────────

export type WebhookCreateParams = Omit<Schemas["WebhookCreate"], "events"> & {
  events: WebhookEventType[];
};
export type WebhookUpdateParams = Omit<Schemas["WebhookUpdate"], "events"> & {
  events?: WebhookEventType[];
};
export type WebhookEndpoint = Open<Schemas["Webhook"]>;

/** Todos los eventos que Tupana puede notificar. */
export type WebhookEventType =
  | "document.issued"
  | "document.issue_failed"
  | "document.updated"
  | "document.delivered"
  | "document.rejected"
  | "document.trace_updated"
  | "document.paid"
  | "document.unpaid"
  | "document.cancelled"
  | "scheduled_document.created"
  | "scheduled_document.updated"
  | "scheduled_document.run_started"
  | "scheduled_document.run_succeeded"
  | "scheduled_document.run_failed"
  | "payment_request.paid"
  | "payment_request.document_issued"
  | "payment_request.expired"
  | "credential.invalid"
  | "credential.validated"
  | "connection.active"
  | "connection.requires_action"
  | "folio_request.completed"
  | "folio_request.failed"
  | "folio_request.authorized_without_caf"
  | "batch.intake_failed"
  | "payroll_run.closed"
  | "payroll_run.reopened"
  | "payroll_termination.confirmed"
  | "payslip.signed"
  | "webhook.test"
  | (string & {});

/** Datos de un evento `document.*`. */
export type DocumentEventData = Open<{
  id: string;
  folio: string | null;
  date_issued: string;
  amount_with_iva: number | null;
  is_sandbox?: boolean;
  dte_type: { code: string; description?: string };
  sender: { id: string; name: string; tax_id: string; email?: string | null };
  receiver: { id: string; name: string; tax_id: string; email?: string | null } | null;
  document_total?: Record<string, unknown> | null;
  details?: Array<Record<string, unknown>>;
  references?: Array<Record<string, unknown>>;
  /** URL presignada del XML. */
  xml_file?: string | null;
  /** URL presignada del PDF (solo en `document.issued`). */
  pdf_file?: string | null;
  json_param?: Record<string, unknown> | null;
  /** En `document.trace_updated`: de qué lado está el suscriptor. */
  role?: string;
}>;

/** Notificación que Tupana envía a tu URL. */
export type WebhookEvent<TData = Record<string, unknown>> = Open<{
  event: WebhookEventType;
  created_at: string;
  data: TData;
}>;

// ── Conexiones y entidades ───────────────────────────────────────────────────

export type Connection = Open<{
  connection_id: string;
  company_id: string;
  provider: string;
  type: string;
  name: string;
  tax_id: string;
  environment: "sandbox" | "production" | (string & {});
  status: "active" | "requires_action" | (string & {});
  last_verified_at?: string;
  business_activity?: string;
  activity_code?: number | null;
  address?: string;
  district?: string;
  city?: string;
}>;

export interface ConnectionListParams {
  /** Filtra por nombre o RUT (mínimo 2 caracteres). */
  search?: string;
  /** Conexiones por página (máximo 100). */
  limit?: number;
}

export type ConnectionList = Open<{ data: Connection[]; total: number; limit: number }>;

export type MasterEntity = Open<Schemas["MasterEntity"]>;
