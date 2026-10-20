import type { RequestOptions } from "../core.js";
import { APIResource, pathId } from "../resource.js";
import type { ConnectionList, ConnectionListParams, MasterEntity } from "../types.js";

/** Empresas conectadas a tu integración (Tupana Connect). */
export class Connections extends APIResource {
  /** Lista las conexiones (`GET /connections/`). */
  list(params: ConnectionListParams = {}, options?: RequestOptions): Promise<ConnectionList> {
    return this._client.get<ConnectionList>("/connections/", { ...params }, options);
  }

  /** Desactiva una conexión (`DELETE /connections/{connection_id}/`). */
  deactivate(connectionId: string, options?: RequestOptions): Promise<unknown> {
    return this._client.delete(`/connections/${pathId(connectionId)}/`, undefined, options);
  }
}

/** Contribuyentes (empresas y personas) por RUT. */
export class MasterEntities extends APIResource {
  /**
   * Busca un contribuyente por RUT (`GET /master-entities/?rut=`): razón social,
   * direcciones y actividades económicas registradas en el SII.
   */
  lookup(rut: string, options?: RequestOptions): Promise<MasterEntity> {
    return this._client.get<MasterEntity>("/master-entities/", { rut }, options);
  }
}
