import { describe, expect, it } from "vitest";
import type { DocumentInput } from "../src/index.js";
import Tupana, { BatchTimeoutError, MAX_BATCH_SIZE, TupanaError } from "../src/index.js";
import { json, mockFetch } from "./helpers.js";

const invoice: DocumentInput = {
  dte_type: { code: "33" },
  document_issuer: { rut: "76543210-K" },
  document_receiver: { rut: "77777777-7" },
  details: [{ item_name: "Asesoría", quantity: 1, unit_price: 100000 }],
};

const created = {
  batch_id: "550e8400-e29b-41d4-a716-446655440000",
  status: "processing",
  created_at: "2026-10-20T10:00:00Z",
  documents: [{ index: 0, status: "created", document: { id: "docu_1", folio: null } }],
};

describe("documents.createBatch", () => {
  it("envía el lote con X-Use-Defaults e Idempotency-Key", async () => {
    const { fetch, calls } = mockFetch(json(201, created));
    const tupana = new Tupana({ apiKey: "k", fetch });
    const res = await tupana.documents.createBatch(
      { documents: [invoice] },
      { useDefaults: true, idempotencyKey: "pedido-123" },
    );
    expect(res.batch_id).toBe(created.batch_id);
    const call = calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api.tupana.ai/v2/documents/batch/");
    expect(call.headers["x-use-defaults"]).toBe("true");
    expect(call.headers["idempotency-key"]).toBe("pedido-123");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.body).toEqual({ documents: [invoice] });
  });

  it("genera Idempotency-Key y reintenta con la MISMA key ante un 500", async () => {
    const { fetch, calls } = mockFetch(
      json(500, { error: "boom" }, { "retry-after": "0" }),
      json(202, created),
    );
    const tupana = new Tupana({ apiKey: "k", fetch });
    await tupana.documents.createBatch({ documents: [invoice] });
    expect(calls).toHaveLength(2);
    const key = calls[0]!.headers["idempotency-key"];
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[1]!.headers["idempotency-key"]).toBe(key);
  });

  it("acepta borradores con preview", async () => {
    const { fetch, calls } = mockFetch(json(201, { documents: [] }));
    const tupana = new Tupana({ apiKey: "k", fetch });
    await tupana.documents.createBatch({ documents: [invoice], state: "draft", preview: true });
    expect(calls[0]!.body).toMatchObject({ state: "draft", preview: true });
  });

  it(`rechaza más de ${MAX_BATCH_SIZE} documentos sin llamar a la API`, () => {
    const { fetch, calls } = mockFetch(json(201, created));
    const tupana = new Tupana({ apiKey: "k", fetch });
    const docs = Array.from({ length: MAX_BATCH_SIZE + 1 }, () => invoice);
    expect(() => tupana.documents.createBatch({ documents: docs })).toThrow(TupanaError);
    expect(() => tupana.documents.createBatch({ documents: [] })).toThrow(TupanaError);
    expect(calls).toHaveLength(0);
  });
});

describe("documents.retrieveBatch / waitForBatch", () => {
  it("consulta hasta que el lote termina", async () => {
    const processing = { id: created.batch_id, status: "processing", documents: [] };
    const done = {
      id: created.batch_id,
      status: "completed",
      documents: [{ index: 0, status: "success", document: { id: "docu_1", folio: "1234" } }],
    };
    const { fetch, calls } = mockFetch(
      json(200, processing),
      json(200, processing),
      json(200, done),
    );
    const tupana = new Tupana({ apiKey: "k", fetch });
    const polled: string[] = [];
    const batch = await tupana.documents.waitForBatch(created.batch_id, {
      interval: 1,
      onPoll: (b) => polled.push(String(b.status)),
    });
    expect(batch.status).toBe("completed");
    expect(batch.documents[0]?.document?.folio).toBe("1234");
    expect(polled).toEqual(["processing", "processing"]);
    expect(calls[0]!.url).toBe(`https://api.tupana.ai/v2/documents/batch/${created.batch_id}/`);
  });

  it("lanza BatchTimeoutError si no termina a tiempo", async () => {
    const { fetch } = mockFetch(json(200, { id: "b", status: "processing", documents: [] }));
    const tupana = new Tupana({ apiKey: "k", fetch });
    await expect(
      tupana.documents.waitForBatch("b", { interval: 5, timeout: 1 }),
    ).rejects.toBeInstanceOf(BatchTimeoutError);
  });
});

describe("documents.list", () => {
  it("arma filtros, dte_type__code__in y json_param", async () => {
    const { fetch, calls } = mockFetch(
      json(200, {
        data: [],
        meta: { page: 1, page_size: 20, total: 0, total_pages: 0 },
        links: {},
      }),
    );
    const tupana = new Tupana({ apiKey: "k", fetch });
    await tupana.documents.list({
      master_entity_id: "ment_1",
      document_type: "issued",
      dte_type__code__in: ["33", "34"],
      issue_date_gte: "2026-01-01",
      json_param: { external_order_id: "PED-123" },
    });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v2/documents/");
    expect(url.searchParams.get("master_entity_id")).toBe("ment_1");
    expect(url.searchParams.get("dte_type__code__in")).toBe("33,34");
    expect(url.searchParams.get("json_param__external_order_id")).toBe("PED-123");
    expect(url.searchParams.get("issue_date_gte")).toBe("2026-01-01");
  });

  it("recorre todas las páginas con listAutoPaging", async () => {
    const page = (n: number, ids: string[]) =>
      json(200, {
        data: ids.map((id) => ({ id })),
        meta: { page: n, page_size: 2, total: 3, total_pages: 2 },
        links: { next: n < 2 ? "next" : null, prev: null },
      });
    const { fetch, calls } = mockFetch(page(1, ["a", "b"]), page(2, ["c"]));
    const tupana = new Tupana({ apiKey: "k", fetch });
    const ids: string[] = [];
    for await (const doc of tupana.documents.listAutoPaging({
      master_entity_id: "m",
      page_size: 2,
    })) {
      ids.push(String(doc.id));
    }
    expect(ids).toEqual(["a", "b", "c"]);
    expect(new URL(calls[1]!.url).searchParams.get("page")).toBe("2");
  });
});
