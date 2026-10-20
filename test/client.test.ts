import { afterEach, describe, expect, it, vi } from "vitest";
import { buildQuery, retryDelayMs } from "../src/core.js";
import Tupana, {
  APIConnectionError,
  AuthenticationError,
  InternalServerError,
  NotFoundError,
  RateLimitError,
  TupanaError,
  UnprocessableEntityError,
} from "../src/index.js";
import { json, mockFetch } from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("configuración", () => {
  it("exige API key", () => {
    vi.stubEnv("TUPANA_API_KEY", "");
    expect(() => new Tupana({ fetch: mockFetch().fetch })).toThrow(TupanaError);
  });

  it("lee TUPANA_API_KEY y TUPANA_BASE_URL del entorno", async () => {
    vi.stubEnv("TUPANA_API_KEY", "env_key");
    vi.stubEnv("TUPANA_BASE_URL", "https://sandbox.example.test/v2/");
    const { fetch, calls } = mockFetch(json(200, { id: "docu_1" }));
    const tupana = new Tupana({ fetch });
    await tupana.documents.retrieve("docu_1");
    expect(calls[0]?.url).toBe("https://sandbox.example.test/v2/documents/docu_1/");
    expect(calls[0]?.headers.authorization).toBe("Api-Key env_key");
  });

  it("envía auth, user-agent y headers por defecto", async () => {
    const { fetch, calls } = mockFetch(json(200, {}));
    const tupana = new Tupana({ apiKey: "k", fetch, defaultHeaders: { "X-Extra": "1" } });
    await tupana.documents.retrieve("docu_1");
    const h = calls[0]!.headers;
    expect(h.authorization).toBe("Api-Key k");
    expect(h["user-agent"]).toMatch(/^tupana-node\//);
    expect(h["x-extra"]).toBe("1");
    expect(calls[0]!.url).toBe("https://api.tupana.ai/v2/documents/docu_1/");
  });
});

describe("query strings", () => {
  it("omite nulos y une arreglos con coma", () => {
    expect(buildQuery({ a: 1, b: undefined, c: null, d: ["33", "34"], e: true })).toBe(
      "?a=1&d=33%2C34&e=true",
    );
    expect(buildQuery({})).toBe("");
  });
});

describe("errores", () => {
  it("parsea el envelope v2", async () => {
    const { fetch } = mockFetch(
      json(422, {
        error: {
          type: "validation_error",
          code: "parameter_invalid",
          message: "RUT inválido",
          param: "documents[0].document_receiver.rut",
          doc_url: "https://docs.tupana.ai/v2/errors#parameter_invalid",
          request_id: "req_abc",
        },
      }),
    );
    const tupana = new Tupana({ apiKey: "k", fetch, maxRetries: 0 });
    const err = await tupana.documents.retrieve("docu_1").catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityError);
    expect(err.status).toBe(422);
    expect(err.code).toBe("parameter_invalid");
    expect(err.type).toBe("validation_error");
    expect(err.param).toBe("documents[0].document_receiver.rut");
    expect(err.requestId).toBe("req_abc");
    expect(err.message).toBe("RUT inválido");
  });

  it("parsea errores planos y de validación DRF", async () => {
    const { fetch } = mockFetch(
      json(404, { error: "Batch no encontrado" }),
      json(401, { error_code: "INVALID_API_KEY", message: "API key inválida" }),
    );
    const tupana = new Tupana({ apiKey: "k", fetch, maxRetries: 0 });
    const notFound = await tupana.documents.retrieveBatch("b1").catch((e) => e);
    expect(notFound).toBeInstanceOf(NotFoundError);
    expect(notFound.message).toBe("Batch no encontrado");
    const auth = await tupana.documents.retrieve("x").catch((e) => e);
    expect(auth).toBeInstanceOf(AuthenticationError);
    expect(auth.code).toBe("INVALID_API_KEY");
  });

  it("traduce errores de red a APIConnectionError", async () => {
    const { fetch } = mockFetch(new TypeError("fetch failed"));
    const tupana = new Tupana({ apiKey: "k", fetch, maxRetries: 0 });
    await expect(tupana.documents.retrieve("x")).rejects.toBeInstanceOf(APIConnectionError);
  });
});

describe("reintentos", () => {
  it("reintenta 429 respetando Retry-After", async () => {
    const { fetch, calls } = mockFetch(
      json(429, { error: { code: "rate_limited", message: "Calma" } }, { "retry-after": "0" }),
      json(200, { id: "docu_1" }),
    );
    const tupana = new Tupana({ apiKey: "k", fetch });
    const doc = await tupana.documents.retrieve("docu_1");
    expect(doc.id).toBe("docu_1");
    expect(calls).toHaveLength(2);
  });

  it("se rinde tras maxRetries y lanza RateLimitError", async () => {
    const { fetch, calls } = mockFetch(json(429, { error: "lento" }, { "retry-after": "0" }));
    const tupana = new Tupana({ apiKey: "k", fetch, maxRetries: 2 });
    await expect(tupana.documents.retrieve("x")).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toHaveLength(3);
  });

  it("reintenta 5xx en GET", async () => {
    const { fetch, calls } = mockFetch(
      json(502, "bad gateway", { "retry-after": "0" }),
      json(200, { id: "docu_1" }),
    );
    const tupana = new Tupana({ apiKey: "k", fetch });
    await tupana.documents.retrieve("docu_1");
    expect(calls).toHaveLength(2);
  });

  it("NO reintenta un POST sin Idempotency-Key ante un 500 (podría haberse procesado)", async () => {
    const { fetch, calls } = mockFetch(json(500, { error: "boom" }, { "retry-after": "0" }));
    const tupana = new Tupana({ apiKey: "k", fetch });
    await expect(
      tupana.paymentRequests.create({ recipient_id: "ment_1", amount: 1000 }),
    ).rejects.toBeInstanceOf(InternalServerError);
    expect(calls).toHaveLength(1);
  });

  it("sí reintenta un POST sin key ante 503 (el servidor no lo procesó)", async () => {
    const { fetch, calls } = mockFetch(
      json(503, { error: "ocupado", code: "server_busy" }, { "retry-after": "0" }),
      json(201, { payment_request_id: "pr_1", status: "pending" }),
    );
    const tupana = new Tupana({ apiKey: "k", fetch });
    const pr = await tupana.paymentRequests.create({ recipient_id: "ment_1", amount: 1000 });
    expect(pr.status).toBe("pending");
    expect(calls).toHaveLength(2);
  });

  it("calcula backoff exponencial acotado", () => {
    expect(retryDelayMs(0)).toBeGreaterThanOrEqual(500);
    expect(retryDelayMs(10)).toBeLessThanOrEqual(10_000);
    expect(retryDelayMs(0, new Headers({ "retry-after": "3" }))).toBe(3000);
  });
});

describe("raw", () => {
  it("permite llamar endpoints sin método propio", async () => {
    const { fetch, calls } = mockFetch(json(200, { data: [], meta: {}, links: {} }));
    const tupana = new Tupana({ apiKey: "k", fetch });
    await tupana.raw("GET", "/folios/", { query: { master_entity_id: "ment_1" } });
    expect(calls[0]!.url).toBe("https://api.tupana.ai/v2/folios/?master_entity_id=ment_1");
  });
});

describe("timeouts", () => {
  it("lanza APITimeoutError cuando el request excede el timeout", async () => {
    const { APITimeoutError } = await import("../src/index.js");
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const tupana = new Tupana({ apiKey: "k", fetch: hanging, timeout: 10, maxRetries: 0 });
    await expect(tupana.documents.retrieve("x")).rejects.toBeInstanceOf(APITimeoutError);
  });
});
