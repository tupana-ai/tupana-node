# Changelog

## 0.1.0 (2026-10-20)

Primera versión pública.

- Cliente `Tupana` para la API v2 (`https://api.tupana.ai/v2`) con autenticación `Api-Key`.
- Recursos: `documents` (emisión en lote, estado del lote, `waitForBatch`, listado con auto-paginación, detalle, estados), `paymentRequests`, `cessions`, `webhooks`, `connections`, `masterEntities` y `raw` para el resto de los endpoints.
- Reintentos con backoff exponencial y `Retry-After`; `Idempotency-Key` automático en `documents.createBatch`.
- Errores tipados con el envelope v2 (`type`, `code`, `param`, `requestId`, `docUrl`).
- Verificación de webhooks (`X-Pana-Signature`, HMAC SHA-256).
- Tipos generados desde el OpenAPI v2 en `@tupana-ai/sdk/openapi`.
