import { createServer } from "node:http";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach } from "vitest";

export type Route =
  | { status?: number; headers?: Record<string, string>; body?: string | Buffer }
  | ((req: IncomingMessage, res: ServerResponse) => void);

export interface TestServer {
  /** "http://127.0.0.1:<port>", no trailing slash. */
  url: string;
  close(): Promise<void>;
}

/** Starts an HTTP server on a random 127.0.0.1 port. */
export async function listen(handler: RequestListener): Promise<TestServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** Serves `routes` by exact path (query ignored); anything else gets `fallback`, else a plain 404. */
export function startServer(routes: Record<string, Route>, fallback?: Route): Promise<TestServer> {
  return listen((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    const route: Route | undefined = Object.prototype.hasOwnProperty.call(routes, path) ? routes[path] : fallback;
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    if (typeof route === "function") {
      route(req, res);
      return;
    }
    res.writeHead(route.status ?? 200, route.headers ?? {});
    res.end(route.body ?? "");
  });
}

/** Call at module or describe level: returns `serve`, a startServer whose servers close after each test. */
export function useTestServers(): (...args: Parameters<typeof startServer>) => Promise<TestServer> {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((c) => c()));
  });
  return async (...args) => {
    const s = await startServer(...args);
    closers.push(s.close);
    return s;
  };
}
