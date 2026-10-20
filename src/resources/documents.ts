import { type Query, type RequestOptions, randomIdempotencyKey } from "../core.js";
import { BatchTimeoutError, TupanaError } from "../errors.js";
import { autoPaginate } from "../pagination.js";
import { APIResource, pathId } from "../resource.js";
import type {
  Batch,
  BatchCreateResponse,
  CreateBatchParams,
  Document,
  DocumentListParams,
  DocumentState,
  ListResponse,
} from "../types.js";

/** Máximo de documentos por llamada a `createBatch`. */
export const MAX_BATCH_SIZE = 500;

const FINAL_BATCH_STATUSES = new Set(["completed", "failed"]);

export interface WaitForBatchOptions {
  /** Intervalo entre consultas, en ms. Por defecto 2 000. */
  interval?: number;
  /** Tiempo máximo de espera, en ms. Por defecto 120 000. */
  timeout?: number;
  /** Se llama con cada estado intermedio. */
  onPoll?: (batch: Batch) => void;
  signal?: AbortSignal;
}

function documentListQuery(params: DocumentListParams): Query {
  const { json_param, ...rest } = params;
  const query: Query = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === null) continue;
    query[key] = Array.isArray(value) ? value.map(String) : (value as string | number | boolean);
  }
  for (const [key, value] of Object.entries(json_param ?? {})) {
    query[`json_param__${key}`] = value;
  }
  return query;
}

export class Documents extends APIResource {
  /**
   * Emite hasta 500 DTEs en una sola llamada (`POST /documents/batch/`).
   *
   * La emisión al SII es asíncrona: la respuesta trae el `batch_id`; consulta
   * el resultado con {@link retrieveBatch} / {@link waitForBatch} o espera el
   * webhook `document.issued`.
   *
   * Si no pasas `idempotencyKey`, el SDK genera una, de modo que los reintentos
   * automáticos ante errores de red o 5xx nunca emiten dos veces. Pasa tu propia
   * key (por ejemplo el id de tu pedido) para que también sean seguros los
   * reintentos entre procesos.
   */
  createBatch(
    params: CreateBatchParams,
    options: RequestOptions = {},
  ): Promise<BatchCreateResponse> {
    if (!Array.isArray(params.documents) || params.documents.length === 0) {
      throw new TupanaError("`documents` debe traer al menos un documento");
    }
    if (params.documents.length > MAX_BATCH_SIZE) {
      throw new TupanaError(
        `Máximo ${MAX_BATCH_SIZE} documentos por lote (recibí ${params.documents.length}). Divide el envío en varios lotes.`,
      );
    }
    return this._client.post<BatchCreateResponse>("/documents/batch/", params, {
      ...options,
      idempotencyKey: options.idempotencyKey ?? randomIdempotencyKey(),
    });
  }

  /** Estado de un lote y de cada uno de sus documentos (`GET /documents/batch/{batch_id}/`). */
  retrieveBatch(batchId: string, options?: RequestOptions): Promise<Batch> {
    return this._client.get<Batch>(`/documents/batch/${pathId(batchId)}/`, undefined, options);
  }

  /**
   * Consulta el lote hasta que llegue a un estado final (`completed` o `failed`).
   * Para producción prefiere webhooks; esto sirve para scripts y pruebas.
   */
  async waitForBatch(batchId: string, options: WaitForBatchOptions = {}): Promise<Batch> {
    const interval = options.interval ?? 2_000;
    const deadline = Date.now() + (options.timeout ?? 120_000);
    let last: Batch | undefined;
    for (;;) {
      last = await this.retrieveBatch(batchId, { signal: options.signal });
      if (FINAL_BATCH_STATUSES.has(String(last.status))) return last;
      options.onPoll?.(last);
      if (Date.now() + interval > deadline) throw new BatchTimeoutError(batchId, last);
      await new Promise((r) => setTimeout(r, interval));
      if (options.signal?.aborted) throw options.signal.reason;
    }
  }

  /** Lista documentos emitidos o recibidos por una empresa (`GET /documents/`). */
  list(params: DocumentListParams, options?: RequestOptions): Promise<ListResponse<Document>> {
    return this._client.get<ListResponse<Document>>(
      "/documents/",
      documentListQuery(params),
      options,
    );
  }

  /** Itera todos los documentos de todas las páginas. */
  listAutoPaging(params: DocumentListParams, options?: RequestOptions): AsyncGenerator<Document> {
    return autoPaginate((p) => this.list(p, options), params);
  }

  /** Detalle de un documento, con PDF, XML y trazas del SII (`GET /documents/{id}/`). */
  retrieve(documentId: string, options?: RequestOptions): Promise<Document> {
    return this._client.get<Document>(`/documents/${pathId(documentId)}/`, undefined, options);
  }

  /** Historial de estados de un documento (`GET /documents/{id}/states/`). */
  listStates(documentId: string, options?: RequestOptions): Promise<unknown> {
    return this._client.get(`/documents/${pathId(documentId)}/states/`, undefined, options);
  }

  /**
   * Registra un estado en el documento (`POST /documents/{id}/states/`), por
   * ejemplo `{ event_code: "ANNULLED" }` para anular una guía de despacho.
   */
  createState(
    documentId: string,
    body: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<DocumentState> {
    return this._client.post<DocumentState>(
      `/documents/${pathId(documentId)}/states/`,
      body,
      options,
    );
  }
}
