import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const MAX_HTML_BYTES = 1_500_000;
const MAX_IMAGE_BYTES = 3_000_000;
const REQUEST_TIMEOUT_MS = 7_000;
const MAX_REDIRECTS = 4;
const PREVIEW_REQUEST_HEADER = "x-telegram-history-viewer";
const IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

function blockedIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 168))
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

export function blockedIpAddress(address) {
  const normalized = address.toLowerCase().split("%")[0];
  const family = isIP(normalized);
  if (family === 4) return blockedIpv4(normalized);
  if (family !== 6) return true;

  const mappedIpv4 = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return blockedIpv4(mappedIpv4);
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("::ffff:")
    || /^f[cd]/.test(normalized)
    || /^fe[89ab]/.test(normalized)
    || /^ff/.test(normalized)
    || /^2001:db8(?::|$)/.test(normalized);
}

export function blockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host.length > 253) return true;
  if (isIP(host)) return blockedIpAddress(host);
  if (!host.includes(".")) return true;
  return host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host.endsWith(".home.arpa");
}

export function supportedTarget(url) {
  if (!(url instanceof URL) || !["http:", "https:"].includes(url.protocol)) return false;
  if (url.username || url.password || blockedHostname(url.hostname)) return false;
  if (!url.port) return true;
  return (url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443");
}

async function publicAddressFor(target) {
  if (!supportedTarget(target)) throw new Error("Unsupported URL");
  const hostname = target.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (blockedIpAddress(hostname)) throw new Error("Private network targets are blocked");
    return { address: hostname, family: isIP(hostname) };
  }

  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => blockedIpAddress(address))) {
    throw new Error("Private network targets are blocked");
  }
  return addresses[0];
}

function headerValue(headers, name) {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

async function requestOnce(target, byteLimit) {
  const address = await publicAddressFor(target);
  const requester = target.protocol === "https:" ? httpsRequest : httpRequest;

  return await new Promise((resolve, reject) => {
    const request = requester(target, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8",
        "Accept-Encoding": "identity",
        "User-Agent": "TelegramHistoryViewerLinkPreview/1.0",
      },
      lookup(_hostname, options, callback) {
        if (options?.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, (response) => {
      const chunks = [];
      let received = 0;
      response.on("data", (chunk) => {
        received += chunk.length;
        if (received > byteLimit) {
          response.destroy(new Error("Preview response is too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        body: Buffer.concat(chunks),
        headers: response.headers,
        status: response.statusCode ?? 502,
        url: target.href,
      }));
      response.on("error", reject);
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("Preview request timed out")));
    request.on("error", reject);
    request.end();
  });
}

async function fetchWithSafeRedirects(initialUrl, byteLimit) {
  let target = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await requestOnce(target, byteLimit);
    if (response.status < 300 || response.status >= 400) return response;
    const location = headerValue(response.headers, "location");
    if (!location || redirectCount === MAX_REDIRECTS) throw new Error("Too many redirects");
    target = new URL(location, target);
  }
  throw new Error("Preview unavailable");
}

function decodeEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html, keys) {
  const tags = html.match(/<meta\s+[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (!key || !keys.includes(key)) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) return decodeEntities(content);
  }
  return undefined;
}

function titleContent(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "");
  return title ? decodeEntities(title) : undefined;
}

function absoluteUrl(value, base) {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return supportedTarget(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

async function safePreviewImageData(value, base) {
  const imageUrl = absoluteUrl(value, base);
  if (!imageUrl) return undefined;
  try {
    const response = await fetchWithSafeRedirects(imageUrl, MAX_IMAGE_BYTES);
    const contentType = headerValue(response.headers, "content-type").split(";", 1)[0].toLowerCase();
    if (response.status < 200 || response.status >= 300 || !IMAGE_TYPES.has(contentType)) return undefined;
    return `data:${contentType};base64,${response.body.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export async function handleLinkPreviewRequest(request) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
  if (request.headers.get(PREVIEW_REQUEST_HEADER) !== "1") return json({ error: "Preview request denied" }, 403);

  const value = new URL(request.url).searchParams.get("url");
  if (!value || value.length > 4_096) return json({ error: "Invalid URL" }, 400);

  let target;
  try {
    target = new URL(value);
  } catch {
    return json({ error: "Invalid URL" }, 400);
  }
  if (!supportedTarget(target)) return json({ error: "Unsupported URL" }, 400);

  try {
    const response = await fetchWithSafeRedirects(target, MAX_HTML_BYTES);
    if (response.status < 200 || response.status >= 300) return json({ error: "Preview unavailable" }, 502);

    const contentEncoding = headerValue(response.headers, "content-encoding").toLowerCase();
    if (contentEncoding && contentEncoding !== "identity") return json({ error: "Preview encoding is unsupported" }, 415);
    const contentType = headerValue(response.headers, "content-type").split(";", 1)[0].toLowerCase();
    const finalUrl = response.url;
    const finalHost = new URL(finalUrl).hostname.replace(/^www\./, "");

    if (IMAGE_TYPES.has(contentType)) {
      return json({
        url: finalUrl,
        image: `data:${contentType};base64,${response.body.toString("base64")}`,
        title: finalHost,
        siteName: finalHost,
      }, 200, { "Cache-Control": "private, max-age=86400" });
    }
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return json({ error: "Preview unavailable" }, 415);
    }

    const html = response.body.toString("utf8");
    const title = metaContent(html, ["og:title", "twitter:title"]) || titleContent(html) || finalHost;
    const description = metaContent(html, ["og:description", "twitter:description", "description"]);
    const siteName = metaContent(html, ["og:site_name"]) || finalHost;
    const image = await safePreviewImageData(
      metaContent(html, ["og:image", "twitter:image", "twitter:image:src"]),
      finalUrl,
    );

    return json({ url: finalUrl, title, description, siteName, image }, 200, {
      "Cache-Control": "private, max-age=86400",
    });
  } catch {
    return json({ error: "Preview unavailable" }, 502);
  }
}
