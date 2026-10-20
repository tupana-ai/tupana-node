import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import Tupana, {
  constructWebhookEvent,
  verifyWebhookSignature,
  WebhookVerificationError,
} from "../src/index.js";

const secret = "whsec_test";
const body = JSON.stringify({
  event: "document.issued",
  created_at: "2026-10-20T10:00:00Z",
  data: { id: "docu_1", folio: "1234" },
});
// Así firma el backend: hmac.new(secret, body, sha256).hexdigest()
const signature = createHmac("sha256", secret).update(body).digest("hex");

describe("verificación de webhooks", () => {
  it("acepta la firma correcta (string, bytes y prefijo sha256=)", async () => {
    expect(await verifyWebhookSignature(body, signature, secret)).toBe(true);
    expect(await verifyWebhookSignature(new TextEncoder().encode(body), signature, secret)).toBe(
      true,
    );
    expect(await verifyWebhookSignature(body, `sha256=${signature}`, secret)).toBe(true);
    expect(await verifyWebhookSignature(body, signature.toUpperCase(), secret)).toBe(true);
  });

  it("rechaza firmas incorrectas, vacías o con otro secret", async () => {
    expect(await verifyWebhookSignature(`${body} `, signature, secret)).toBe(false);
    expect(await verifyWebhookSignature(body, "", secret)).toBe(false);
    expect(await verifyWebhookSignature(body, signature, "otro")).toBe(false);
    expect(await verifyWebhookSignature(body, "abc", secret)).toBe(false);
  });

  it("constructWebhookEvent devuelve el evento con headers de Node o Fetch", async () => {
    const fromNode = await constructWebhookEvent(body, { "x-pana-signature": signature }, secret);
    expect(fromNode.event).toBe("document.issued");
    const fromFetch = await constructWebhookEvent(
      body,
      new Headers({ "X-Pana-Signature": signature }),
      secret,
    );
    expect(fromFetch.data).toEqual({ id: "docu_1", folio: "1234" });
  });

  it("constructWebhookEvent lanza si falta o no coincide la firma", async () => {
    await expect(constructWebhookEvent(body, {}, secret)).rejects.toBeInstanceOf(
      WebhookVerificationError,
    );
    await expect(
      constructWebhookEvent(body, { "X-Pana-Signature": "00" }, secret),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it("client.webhooks.sign y unwrap son simétricos", async () => {
    const tupana = new Tupana({ apiKey: "k", fetch: async () => new Response() });
    const sig = await tupana.webhooks.sign(body, secret);
    expect(sig).toBe(signature);
    const event = await tupana.webhooks.unwrap(body, { "x-pana-signature": sig }, secret);
    expect(event.created_at).toBe("2026-10-20T10:00:00Z");
  });
});
