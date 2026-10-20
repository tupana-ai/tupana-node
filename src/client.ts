import { APIClient, type ClientOptions, type Query, type RequestOptions } from "./core.js";
import { Cessions } from "./resources/cessions.js";
import { Connections, MasterEntities } from "./resources/connections.js";
import { Documents } from "./resources/documents.js";
import { PaymentRequests } from "./resources/payment-requests.js";
import { Webhooks } from "./resources/webhooks.js";

/**
 * Cliente de la API v2 de Tupana.
 *
 * ```ts
 * import Tupana from "tupana";
 * const tupana = new Tupana({ apiKey: process.env.TUPANA_API_KEY });
 * const batch = await tupana.documents.createBatch({ documents: [...] }, { useDefaults: true });
 * ```
 */
export class Tupana extends APIClient {
  /** Emisión en lote, consulta y listado de DTEs. */
  readonly documents: Documents;
  /** Cobros / links de pago (recaudación). */
  readonly paymentRequests: PaymentRequests;
  /** Cesiones de facturas. */
  readonly cessions: Cessions;
  /** Webhooks: configuración y verificación de firmas. */
  readonly webhooks: Webhooks;
  /** Empresas conectadas a tu integración. */
  readonly connections: Connections;
  /** Búsqueda de contribuyentes por RUT. */
  readonly masterEntities: MasterEntities;

  constructor(options: ClientOptions = {}) {
    super(options);
    this.documents = new Documents(this);
    this.paymentRequests = new PaymentRequests(this);
    this.cessions = new Cessions(this);
    this.webhooks = new Webhooks(this);
    this.connections = new Connections(this);
    this.masterEntities = new MasterEntities(this);
  }

  /**
   * Llama cualquier endpoint de la API v2 que todavía no tenga un método
   * propio (folios, libros, sincronización, nómina…), con la misma auth,
   * reintentos y manejo de errores.
   *
   * ```ts
   * const folios = await tupana.raw("GET", "/folios/", { query: { master_entity_id } });
   * ```
   */
  raw<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    options: RequestOptions & { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    const { query, body, ...rest } = options;
    return this.request<T>({ ...rest, method, path, query, body });
  }
}
