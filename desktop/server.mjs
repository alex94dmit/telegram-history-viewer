import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { handleLinkPreviewRequest } from "./link-preview.mjs";

const MAX_REQUEST_BODY_BYTES = 1_000_000;
const SECURITY_HEADERS = new Map([
  ["content-security-policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' blob: data:; media-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self' blob:"],
  ["cross-origin-opener-policy", "same-origin"],
  ["cross-origin-resource-policy", "same-origin"],
  ["permissions-policy", "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()"],
  ["referrer-policy", "no-referrer"],
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
]);

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
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (declaredLength > MAX_REQUEST_BODY_BYTES) throw new Error("Request body is too large.");
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > MAX_REQUEST_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function copyResponseHeaders(response, outgoing) {
  response.headers.forEach((value, name) => {
    if (name === "content-encoding" || name === "transfer-encoding") return;
    outgoing.setHeader(name, value);
  });
}

function applySecurityHeaders(outgoing) {
  SECURITY_HEADERS.forEach((value, name) => outgoing.setHeader(name, value));
}

export async function startTelegramHistoryViewerServer(appRoot) {
  const clientRoot = resolve(appRoot, "dist", "client");
  const workerEntry = resolve(appRoot, "dist", "server", "index.js");
  const { default: worker } = await import(pathToFileURL(workerEntry).href);
  const renderRequest = typeof worker === "function"
    ? worker
    : worker.fetch.bind(worker);
  const sessionToken = randomBytes(32).toString("base64url");

  const server = createServer(async (incoming, outgoing) => {
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Telegram History Viewer server is not ready.");
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
      const pathname = new URL(request.url).pathname;
      const cookie = request.headers.get("cookie") ?? "";
      const sessionIsValid = cookie.split(";").some((part) => part.trim() === `telegram_history_viewer_session=${sessionToken}`);
      const response = pathname === "/api/link-preview"
        ? sessionIsValid
          ? await handleLinkPreviewRequest(request)
          : Response.json({ error: "Preview request denied" }, { status: 403 })
        : directAsset.status !== 404
          ? directAsset
          : await renderRequest(request);

      outgoing.statusCode = response.status;
      outgoing.statusMessage = response.statusText;
      copyResponseHeaders(response, outgoing);
      applySecurityHeaders(outgoing);
      outgoing.setHeader("set-cookie", `telegram_history_viewer_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`);
      outgoing.setHeader("connection", "close");
      if (incoming.method === "HEAD" || !response.body) {
        outgoing.end();
        return;
      }
      Readable.fromWeb(response.body).pipe(outgoing);
    } catch (error) {
      outgoing.statusCode = error instanceof Error && error.message === "Request body is too large." ? 413 : 500;
      outgoing.setHeader("content-type", "text/plain; charset=utf-8");
      applySecurityHeaders(outgoing);
      outgoing.end(outgoing.statusCode === 413 ? "Request body is too large." : "Telegram History Viewer could not complete the request.");
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
  if (!address || typeof address === "string") throw new Error("Telegram History Viewer could not reserve a local port.");

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}
