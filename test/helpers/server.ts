import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type Route =
  | { status?: number; headers?: Record<string, string>; body?: string | Buffer }
  | ((req: IncomingMessage, res: ServerResponse) => void);

export async function startServer(
  routes: Record<string, Route>,
  fallback?: Route,
): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
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
