import { describe, expect, it } from "vitest";
import Tupana from "../src/index.js";
import { json, mockFetch } from "./helpers.js";

describe("paymentRequests", () => {
  it("crea, consulta y emite manualmente", async () => {
    const pr = { payment_request_id: "pr_1", status: "pending", payment_url: "https://x/pagos/t" };
    const { fetch, calls } = mockFetch(
      json(201, pr),
      json(200, pr),
      json(200, { ...pr, status: "issued" }),
    );
    const tupana = new Tupana({ apiKey: "k", fetch });
    const created = await tupana.paymentRequests.create({
      recipient_id: "ment_1",
      amount: 50000,
      target_dte_type: 39,
      dte_recipient: { rut: "11111111-1", name: "Juan Soto" },
      items: [{ description: "Sesión", quantity: 1, unit_price: 50000 }],
      external_id: "booking_abc",
    });
    expect(created.payment_url).toBe("https://x/pagos/t");
    await tupana.paymentRequests.retrieve("pr_1");
    const issued = await tupana.paymentRequests.issue("pr_1");
    expect(issued.status).toBe("issued");
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "POST /v2/payment-requests/",
      "GET /v2/payment-requests/pr_1/",
      "PATCH /v2/payment-requests/pr_1/",
    ]);
    expect(calls[2]!.body).toEqual({ status: "issued" });
  });
});

describe("cessions", () => {
  it("crea un lote y consulta su estado", async () => {
    const { fetch, calls } = mockFetch(
      json(202, { success: true, status: "processing", total: 1, cession_batch_id: "cb_1" }),
      json(200, { id: "cb_1", status: "completed", batch_cessions: [] }),
    );
    const tupana = new Tupana({ apiKey: "k", fetch });
    const res = await tupana.cessions.createBatch({
      master_entity_id: "ment_1",
      document_ids: ["docu_1"],
      assignee_rut: "76798398",
      assignee_dv: "0",
      assignee_business_name: "Factoring SpA",
      assignee_address: "Av. Siempre Viva 123",
      assignee_email: "ops@factoring.cl",
    });
    const status = await tupana.cessions.retrieveBatch(res.cession_batch_id);
    expect(status.status).toBe("completed");
    expect(new URL(calls[1]!.url).pathname).toBe("/v2/cessions/batch/cb_1/");
  });
});

describe("webhooks, connections y masterEntities", () => {
  it("usa las rutas correctas", async () => {
    const { fetch, calls } = mockFetch(json(200, {}));
    const tupana = new Tupana({ apiKey: "k", fetch });
    await tupana.webhooks.create({
      master_entity_id: "ment_1",
      url: "https://example.com/hooks/tupana",
      events: ["document.issued", "payment_request.paid"],
      secret: "s3cr3t",
    });
    await tupana.webhooks.update("dowe_1", { is_active: false });
    await tupana.webhooks.delete("dowe_1");
    await tupana.connections.list({ search: "acme" });
    await tupana.masterEntities.lookup("76543210-K");
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.tupana.ai", "")}`)).toEqual([
      "POST /v2/webhooks/",
      "PATCH /v2/webhooks/dowe_1/",
      "DELETE /v2/webhooks/dowe_1/",
      "GET /v2/connections/?search=acme",
      "GET /v2/master-entities/?rut=76543210-K",
    ]);
  });
});
