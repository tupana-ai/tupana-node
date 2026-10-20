import type { APIClient } from "./core.js";

export abstract class APIResource {
  protected readonly _client: APIClient;
  constructor(client: APIClient) {
    this._client = client;
  }
}

/** Codifica un id para usarlo en un path. */
export function pathId(id: string | number): string {
  const value = String(id).trim();
  if (!value) throw new TypeError("El id no puede estar vacío");
  return encodeURIComponent(value);
}
