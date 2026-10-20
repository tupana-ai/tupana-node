import type { RequestOptions } from "../core.js";
import { autoPaginate } from "../pagination.js";
import { APIResource, pathId } from "../resource.js";
import type {
  Cession,
  CessionBatch,
  CessionBatchCreateParams,
  CessionBatchCreateResponse,
  CessionListParams,
  ListResponse,
} from "../types.js";

/** Cesiones de facturas (AEC) a un cesionario, por ejemplo una empresa de factoring. */
export class Cessions extends APIResource {
  /**
   * Cede varias facturas en una llamada (`POST /cessions/batch/`). La respuesta
   * (202) solo confirma que el lote se aceptó: consulta el resultado con
   * {@link retrieveBatch}.
   */
  createBatch(
    params: CessionBatchCreateParams,
    options?: RequestOptions,
  ): Promise<CessionBatchCreateResponse> {
    return this._client.post<CessionBatchCreateResponse>("/cessions/batch/", params, options);
  }

  /** Resultado de un lote de cesión, con el error real del SII por documento. */
  retrieveBatch(cessionBatchId: string, options?: RequestOptions): Promise<CessionBatch> {
    return this._client.get<CessionBatch>(
      `/cessions/batch/${pathId(cessionBatchId)}/`,
      undefined,
      options,
    );
  }

  /** Cesiones emitidas (o recibidas) por una empresa. */
  list(params: CessionListParams, options?: RequestOptions): Promise<ListResponse<Cession>> {
    return this._client.get<ListResponse<Cession>>("/cessions/", { ...params }, options);
  }

  listAutoPaging(params: CessionListParams, options?: RequestOptions): AsyncGenerator<Cession> {
    return autoPaginate((p) => this.list(p, options), params);
  }

  retrieve(cessionId: string, options?: RequestOptions): Promise<Cession> {
    return this._client.get<Cession>(`/cessions/${pathId(cessionId)}/`, undefined, options);
  }
}
