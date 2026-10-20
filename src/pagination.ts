import type { ListResponse } from "./types.js";

/**
 * Recorre todas las páginas de una lista v2, ítem por ítem.
 *
 * ```ts
 * for await (const doc of tupana.documents.listAutoPaging({ master_entity_id })) { ... }
 * ```
 */
export async function* autoPaginate<T, P extends { page?: number }>(
  fetchPage: (params: P) => Promise<ListResponse<T>>,
  params: P,
): AsyncGenerator<T, void, undefined> {
  let page = params.page ?? 1;
  for (;;) {
    const res = await fetchPage({ ...params, page });
    for (const item of res.data) yield item;
    const totalPages = res.meta?.total_pages;
    const hasNext =
      res.data.length > 0 && (totalPages != null ? page < totalPages : Boolean(res.links?.next));
    if (!hasNext) return;
    page += 1;
  }
}
