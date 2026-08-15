const MAX_HTML_BYTES = 1_500_000;

function blockedHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d{1,3})\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  return /^0\./.test(host) || /^169\.254\./.test(host);
}

function supportedTarget(url: URL) {
  return ["http:", "https:"].includes(url.protocol) && !blockedHostname(url.hostname);
}

async function fetchWithSafeRedirects(initialUrl: URL) {
  let target = initialUrl;
  for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
    if (!supportedTarget(target)) throw new Error("Unsupported URL");
    const response = await fetch(target, {
      headers: {
        Accept: "text/html,application/xhtml+xml,image/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; StillgramLinkPreview/1.0)",
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

function absoluteUrl(value: string | undefined, base: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("url");
  if (!value) return Response.json({ error: "Missing URL" }, { status: 400 });

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
      return Response.json({ url: response.url, image: response.url, title: target.hostname.replace(/^www\./, "") });
    }
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return Response.json({ error: "Preview unavailable" }, { status: 415 });
    }

    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    const finalUrl = response.url || target.href;
    const finalHost = new URL(finalUrl).hostname.replace(/^www\./, "");
    const title = metaContent(html, ["og:title", "twitter:title"]) || titleContent(html) || finalHost;
    const description = metaContent(html, ["og:description", "twitter:description", "description"]);
    const siteName = metaContent(html, ["og:site_name"]) || finalHost;
    const image = absoluteUrl(metaContent(html, ["og:image", "twitter:image", "twitter:image:src"]), finalUrl);

    return Response.json(
      { url: finalUrl, title, description, siteName, image },
      { headers: { "Cache-Control": "private, max-age=86400" } },
    );
  } catch {
    return Response.json({ error: "Preview unavailable" }, { status: 502 });
  }
}
