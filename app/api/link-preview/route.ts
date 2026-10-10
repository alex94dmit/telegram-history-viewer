const MAX_HTML_BYTES = 1_500_000;
const MAX_URL_CHARACTERS = 4_096;
const PREVIEW_REQUEST_HEADER = "x-telegram-history-viewer";

function blockedIpv4(host: string) {
  const parts = host.split(".").map(Number);
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

function blockedHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host.length > 253) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return blockedIpv4(host);
  const mappedIpv4 = host.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4 && blockedIpv4(mappedIpv4)) return true;
  if (host.includes(":")) {
    return host === "::"
      || host === "::1"
      || host.startsWith("::ffff:")
      || /^f[cd]/.test(host)
      || /^fe[89ab]/.test(host)
      || /^ff/.test(host)
      || /^2001:db8(?::|$)/.test(host);
  }
  if (!host.includes(".")) return true;
  return host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host.endsWith(".home.arpa");
}

function supportedTarget(url: URL) {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || blockedHostname(url.hostname)) return false;
  if (!url.port) return true;
  return (url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443");
}

async function fetchWithSafeRedirects(initialUrl: URL) {
  let target = initialUrl;
  for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
    if (!supportedTarget(target)) throw new Error("Unsupported URL");
    const response = await fetch(target, {
      headers: {
        Accept: "text/html,application/xhtml+xml,image/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; TelegramHistoryViewerLinkPreview/1.0)",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(7000),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location || redirectCount === 4) throw new Error("Too many redirects");
    target = new URL(location, target);
  }
  throw new Error("Preview unavailable");
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, keys: string[]) {
  const tags = html.match(/<meta\s+[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (!key || !keys.includes(key)) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) return decodeEntities(content);
  }
  return undefined;
}

function titleContent(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "");
  return title ? decodeEntities(title) : undefined;
}

async function responseTextWithinLimit(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_HTML_BYTES) {
        await reader.cancel();
        throw new Error("Preview is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(received);
  let offset = 0;
  chunks.forEach((chunk) => {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder().decode(body);
}

export async function GET(request: Request) {
  if (request.headers.get(PREVIEW_REQUEST_HEADER) !== "1") {
    return Response.json({ error: "Preview request denied" }, { status: 403 });
  }
  const value = new URL(request.url).searchParams.get("url");
  if (!value || value.length > MAX_URL_CHARACTERS) return Response.json({ error: "Invalid URL" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return Response.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (!supportedTarget(target)) {
    return Response.json({ error: "Unsupported URL" }, { status: 400 });
  }

  try {
    const response = await fetchWithSafeRedirects(target);
    if (!response.ok) return Response.json({ error: "Preview unavailable" }, { status: 502 });

    const contentType = response.headers.get("content-type") ?? "";
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_HTML_BYTES) return Response.json({ error: "Preview is too large" }, { status: 413 });
    if (contentType.startsWith("image/")) {
      const host = target.hostname.replace(/^www\./, "");
      return Response.json({ url: response.url, title: host, siteName: host });
    }
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return Response.json({ error: "Preview unavailable" }, { status: 415 });
    }

    const html = await responseTextWithinLimit(response);
    const finalUrl = response.url || target.href;
    const finalHost = new URL(finalUrl).hostname.replace(/^www\./, "");
    const title = metaContent(html, ["og:title", "twitter:title"]) || titleContent(html) || finalHost;
    const description = metaContent(html, ["og:description", "twitter:description", "description"]);
    const siteName = metaContent(html, ["og:site_name"]) || finalHost;

    return Response.json(
      { url: finalUrl, title, description, siteName },
      { headers: { "Cache-Control": "private, max-age=86400" } },
    );
  } catch {
    return Response.json({ error: "Preview unavailable" }, { status: 502 });
  }
}
