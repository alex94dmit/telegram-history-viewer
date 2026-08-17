import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function localAssetPath(clientRoot, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidate = resolve(clientRoot, `.${decodedPath}`);
  const rootPrefix = clientRoot.endsWith(sep) ? clientRoot : `${clientRoot}${sep}`;
  return candidate === clientRoot || candidate.startsWith(rootPrefix) ? candidate : null;
}

async function assetResponse(clientRoot, request) {
  const pathname = new URL(request.url).pathname;
  const filePath = localAssetPath(clientRoot, pathname);
  if (!filePath) return new Response("Not found", { status: 404 });
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return new Response("Not found", { status: 404 });
    const body = await readFile(filePath);
    return new Response(body, {
      headers: {
        "cache-control": pathname.startsWith("/_next/static/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
        "content-length": String(body.byteLength),
        "content-type": MIME_TYPES.get(extname(filePath).toLowerCase()) ?? "application/octet-stream",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function requestBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function copyResponseHeaders(response, outgoing) {
  response.headers.forEach((value, name) => {
    if (name === "content-encoding" || name === "transfer-encoding") return;
    outgoing.setHeader(name, value);
  });
}

export async function startStillgramServer(appRoot) {
  const clientRoot = resolve(appRoot, "dist", "client");
  const workerEntry = resolve(appRoot, "dist", "server", "index.js");
  const { default: worker } = await import(pathToFileURL(workerEntry).href);

  const server = createServer(async (incoming, outgoing) => {
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Stillgram server is not ready.");
      const origin = `http://127.0.0.1:${address.port}`;
      const headers = new Headers();
      Object.entries(incoming.headers).forEach(([name, value]) => {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value != null) headers.set(name, value);
      });
      headers.set("x-forwarded-host", `127.0.0.1:${address.port}`);
      headers.set("x-forwarded-proto", "http");
      const body = await requestBody(incoming);
      const request = new Request(`${origin}${incoming.url ?? "/"}`, {
        method: incoming.method,
        headers,
        body,
        duplex: body ? "half" : undefined,
      });
      const directAsset = await assetResponse(clientRoot, request);
      const response = directAsset.status !== 404
        ? directAsset
        : await worker.fetch(
          request,
          { ASSETS: { fetch: (assetRequest) => assetResponse(clientRoot, assetRequest) } },
          { waitUntil() {}, passThroughOnException() {} },
        );

      outgoing.statusCode = response.status;
      outgoing.statusMessage = response.statusText;
      copyResponseHeaders(response, outgoing);
      outgoing.setHeader("connection", "close");
      if (incoming.method === "HEAD" || !response.body) {
        outgoing.end();
        return;
      }
      Readable.fromWeb(response.body).pipe(outgoing);
    } catch (error) {
      outgoing.statusCode = 500;
      outgoing.setHeader("content-type", "text/plain; charset=utf-8");
      outgoing.end(error instanceof Error ? error.message : "Stillgram could not start.");
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Stillgram could not reserve a local port.");

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}
