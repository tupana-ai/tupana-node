import { vi } from "vitest";

export interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = Response | ((req: Recorded) => Response | Promise<Response>) | Error;

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** fetch falso: responde en orden y registra cada request. */
export function mockFetch(...replies: Reply[]) {
  const calls: Recorded[] = [];
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const rec: Recorded = {
      url: input,
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(rec);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    if (typeof reply === "function") return reply(rec);
    if (!reply) throw new Error("sin respuesta configurada");
    return reply.clone();
  });
  return { fetch: fn, calls };
}
