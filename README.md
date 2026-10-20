# Tupana para Node.js y TypeScript

[![CI](https://github.com/tupana-ai/tupana-node/actions/workflows/ci.yml/badge.svg)](https://github.com/tupana-ai/tupana-node/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/tupana.svg)](https://www.npmjs.com/package/tupana)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

SDK oficial de la [API v2 de Tupana](https://docs.tupana.ai): facturación electrónica ante el SII, links de pago (recaudación), cesión de facturas y webhooks, desde Node.js, Bun, Deno o cualquier runtime con `fetch`.

```bash
npm install tupana
```

- Tipado completo, derivado del OpenAPI v2 de Tupana.
- Cero dependencias en runtime (usa el `fetch` nativo). Node 18 o superior.
- Reintentos automáticos con backoff ante `429` y `5xx`, respetando `Retry-After`.
- Emisión idempotente: `documents.createBatch` envía un `Idempotency-Key` para que un reintento nunca emita dos veces.
- Errores tipados (`RateLimitError`, `UnprocessableEntityError`…) con `code`, `param` y `requestId`.
- Verificación de la firma de webhooks (`X-Pana-Signature`).
- ESM y CommonJS.

## Instalación

```bash
npm install tupana
# o: pnpm add tupana · yarn add tupana · bun add tupana
```

Paquete en npm: [npmjs.com/package/tupana](https://www.npmjs.com/package/tupana).

## Antes de empezar

1. Crea tu cuenta y tu API key en [developers.tupana.ai](https://developers.tupana.ai) (en la plataforma: **Configuración → Integraciones API**). Tienes una key de **sandbox** y una de **producción**: el código es el mismo, solo cambia la key.
2. Conecta la empresa emisora con sus credenciales del SII (Tupana Connect). Sin una conexión activa la API responde `no_active_credentials`.
3. Guarda la key en una variable de entorno:

```bash
export TUPANA_API_KEY="tu-api-key"
```

## Inicio rápido: emitir una factura

```ts
import Tupana from "tupana";

const tupana = new Tupana(); // lee TUPANA_API_KEY

const batch = await tupana.documents.createBatch(
  {
    documents: [
      {
        dte_type: { code: "33" }, // Factura electrónica
        document_issuer: { rut: "76543210-3" }, // tu empresa
        document_receiver: { rut: "77777777-7" }, // tu cliente
        details: [{ item_name: "Asesoría contable octubre", quantity: 1, unit_price: 150000 }],
      },
    ],
  },
  { useDefaults: true }, // X-Use-Defaults: la API completa razón social, giro, dirección, fecha y forma de pago
);

console.log(batch.batch_id); // la emisión al SII sigue en segundo plano

// En un script puedes esperar el resultado. En producción, usa webhooks.
const result = await tupana.documents.waitForBatch(batch.batch_id);
for (const doc of result.documents) {
  console.log(doc.index, doc.status, doc.document?.folio, doc.document?.pdf_url);
}
```

`createBatch` acepta hasta **200 documentos** por llamada. Para cargas más grandes, divide en lotes (mira el ejemplo de [emisión masiva desde CSV](https://github.com/tupana-ai/tupana-examples)).

### Borradores y vista previa

```ts
const draft = await tupana.documents.createBatch({
  documents: [invoice],
  state: "draft", // no pide folio ni envía nada al SII
  preview: true, // devuelve el PDF del borrador
});
```

### Idempotencia

Cada `createBatch` viaja con un header `Idempotency-Key`. Si no pasas uno, el SDK genera un UUID, así los reintentos automáticos del mismo proceso son seguros. Para que también sea seguro reintentar desde otro proceso (un worker que se cayó, un doble clic), usa una key tuya y estable:

```ts
await tupana.documents.createBatch({ documents: [invoice] }, { idempotencyKey: `pedido-${order.id}` });
```

Repetir la llamada con la misma key devuelve el lote original sin volver a emitir. Para reencontrar un documento aunque pierdas la respuesta, guarda tu propio id en `json_param` y búscalo después:

```ts
const { data } = await tupana.documents.list({
  master_entity_id: "ment_4829301923847",
  json_param: { external_order_id: "PED-123" },
});
```

## Documentos

```ts
// Listar (envelope v2: { data, meta, links })
const page = await tupana.documents.list({
  master_entity_id: "ment_4829301923847",
  document_type: "issued", // o "received"
  dte_type__code__in: ["33", "34"],
  issue_date_gte: "2026-10-01",
  page_size: 100,
});

// Recorrer todas las páginas
for await (const doc of tupana.documents.listAutoPaging({ master_entity_id: "ment_4829301923847" })) {
  console.log(doc.folio, doc.amount_with_iva);
}

// Detalle con PDF, XML y trazas del SII
const doc = await tupana.documents.retrieve("docu_9f2a7c1b8e4d0");
```

## Links de pago (recaudación)

```ts
const payment = await tupana.paymentRequests.create({
  recipient_id: "ment_4829301923847", // quien recibe los fondos (con cuenta bancaria registrada)
  amount: 50000,
  target_dte_type: 39, // boleta: se emite sola al confirmarse el pago
  dte_recipient: { rut: "11111111-1", name: "Juan Soto", email: "juan@ejemplo.com" },
  items: [{ description: "Sesión de psicoterapia", quantity: 1, unit_price: 50000 }],
  external_id: "booking_abc123", // idempotencia: repetir devuelve la misma sesión
  redirect_url: "https://tuapp.cl/gracias",
});

// Redirige a tu cliente a payment.payment_url y espera el webhook payment_request.paid
```

## Cesiones

```ts
const { cession_batch_id } = await tupana.cessions.createBatch({
  master_entity_id: "ment_4829301923847",
  document_ids: ["docu_9f2a7c1b8e4d0"],
  assignee_rut: "76798398",
  assignee_dv: "0",
  assignee_business_name: "Factoring SpA",
  assignee_address: "Av. Apoquindo 1234, Las Condes",
  assignee_email: "operaciones@factoring.cl",
});

const status = await tupana.cessions.retrieveBatch(cession_batch_id);
```

## Webhooks

Configura un webhook **con `secret`** y Tupana firmará cada entrega:

```ts
await tupana.webhooks.create({
  master_entity_id: "ment_4829301923847",
  url: "https://tuapp.cl/webhooks/tupana",
  events: ["document.issued", "document.rejected", "payment_request.paid"],
  secret: process.env.TUPANA_WEBHOOK_SECRET,
});
```

Cada notificación trae `X-Pana-Signature`: el HMAC SHA-256 (hex) del cuerpo crudo del request. Verifícalo **antes** de parsear el JSON:

```ts
import express from "express";
import { constructWebhookEvent, WebhookVerificationError } from "tupana";

const app = express();

app.post("/webhooks/tupana", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const event = await constructWebhookEvent(req.body, req.headers, process.env.TUPANA_WEBHOOK_SECRET!);
    // Deduplica por X-Pana-Event-Id: una entrega puede repetirse.
    if (event.event === "document.issued") {
      // event.data.folio, event.data.pdf_file …
    }
    res.sendStatus(200);
  } catch (err) {
    if (err instanceof WebhookVerificationError) return res.sendStatus(400);
    throw err;
  }
});
```

En Next.js (App Router) o cualquier runtime con `Request`, usa `await request.text()` como payload. La firma no incluye el timestamp, así que para descartar repeticiones guarda el `X-Pana-Event-Id` que ya procesaste.

## Errores

Todos los errores heredan de `TupanaError`. Los de la API son `APIError` (o una subclase según el status) y exponen el envelope v2:

```ts
import { APIError, RateLimitError, UnprocessableEntityError } from "tupana";

try {
  await tupana.documents.createBatch({ documents });
} catch (err) {
  if (err instanceof UnprocessableEntityError) {
    console.error(err.code, err.param, err.message); // ej. parameter_invalid, documents[0].document_receiver.rut
  } else if (err instanceof APIError) {
    console.error(err.status, err.type, err.code, err.requestId, err.docUrl);
  }
}
```

| Status | Clase |
| --- | --- |
| 400 | `BadRequestError` |
| 401 | `AuthenticationError` |
| 403 | `PermissionDeniedError` |
| 404 | `NotFoundError` |
| 409 | `ConflictError` |
| 413 | `PayloadTooLargeError` |
| 422 | `UnprocessableEntityError` |
| 429 | `RateLimitError` |
| 5xx | `InternalServerError` |
| red / timeout | `APIConnectionError` / `APITimeoutError` |

Cuando reportes un problema a soporte, incluye `err.requestId`. El catálogo de códigos está en [docs.tupana.ai/v2/errors](https://docs.tupana.ai/v2/errors).

## Reintentos y timeouts

Por defecto el SDK reintenta 2 veces con backoff exponencial y jitter, respetando `Retry-After`:

- `GET`, `PUT` y `DELETE`: ante errores de red, `408`, `429` y `5xx`.
- `POST` y `PATCH` **con** `Idempotency-Key`: igual que arriba.
- `POST` y `PATCH` **sin** `Idempotency-Key`: solo ante `429` y `503`, donde el servidor garantiza que no procesó el request. Así nunca se duplica una operación.

```ts
const tupana = new Tupana({ maxRetries: 4, timeout: 30_000 });
await tupana.documents.retrieve("docu_123", { maxRetries: 0, timeout: 5_000 });
```

## Otros endpoints

Para endpoints de la API v2 que todavía no tienen método propio (folios, libros del SII, sincronización, nómina…) usa `raw`, con la misma autenticación, reintentos y errores:

```ts
const folios = await tupana.raw("GET", "/folios/", { query: { master_entity_id: "ment_4829301923847" } });
```

Los tipos generados del OpenAPI completo están en `tupana/openapi`:

```ts
import type { components } from "tupana/openapi";
type FolioAvailability = components["schemas"]["FolioAvailability"];
```

## Configuración

| Opción | Variable de entorno | Por defecto |
| --- | --- | --- |
| `apiKey` | `TUPANA_API_KEY` | (obligatoria) |
| `baseURL` | `TUPANA_BASE_URL` | `https://api.tupana.ai/v2` |
| `timeout` | | `60000` ms por intento |
| `maxRetries` | | `2` |
| `fetch` | | `globalThis.fetch` |
| `defaultHeaders` | | `{}` |

CommonJS:

```js
const { Tupana } = require("tupana");
```

## Agentes de IA y MCP

Tupana también tiene un servidor MCP remoto en `https://mcp.tupana.ai/mcp` para conectar Claude, ChatGPT, Cursor y otros agentes a tu facturación. Instrucciones en [tupana-ai/tupana-mcp](https://github.com/tupana-ai/tupana-mcp) y un agente que factura con confirmación humana en [tupana-ai/tupana-examples](https://github.com/tupana-ai/tupana-examples).

## Recursos

- Paquete en npm: [npmjs.com/package/tupana](https://www.npmjs.com/package/tupana)
- Documentación: [docs.tupana.ai](https://docs.tupana.ai)
- Portal de desarrolladores y API keys: [developers.tupana.ai](https://developers.tupana.ai)
- Servidor MCP: [github.com/tupana-ai/tupana-mcp](https://github.com/tupana-ai/tupana-mcp)
- Ejemplos: [github.com/tupana-ai/tupana-examples](https://github.com/tupana-ai/tupana-examples)
- SDK de Python: `pip install tupana` ([PyPI](https://pypi.org/project/tupana/) · [GitHub](https://github.com/tupana-ai/tupana-python))

## Desarrollo

```bash
npm install
npm run lint && npm run typecheck && npm test && npm run build
npm run generate # regenera src/generated desde spec/*.json
```

## Licencia

[MIT](LICENSE)

---

## English summary

Official Node.js / TypeScript SDK for the [Tupana API v2](https://docs.tupana.ai) — Chilean electronic invoicing (SII DTEs), payment links, invoice factoring (cessions) and webhooks.

```bash
npm install tupana
```

```ts
import Tupana from "tupana";
const tupana = new Tupana({ apiKey: process.env.TUPANA_API_KEY });
const batch = await tupana.documents.createBatch({ documents: [invoice] }, { useDefaults: true });
const result = await tupana.documents.waitForBatch(batch.batch_id);
```

Zero runtime dependencies, Node 18+, ESM + CJS, typed from the OpenAPI v2 spec, automatic retries with backoff on 429/5xx (non-idempotent POSTs are only retried when the server guarantees they were not processed), automatic `Idempotency-Key` on batch issuing, typed errors, and webhook signature verification (`X-Pana-Signature`, hex HMAC-SHA256 of the raw body). Get an API key at [developers.tupana.ai](https://developers.tupana.ai). MIT licensed.
