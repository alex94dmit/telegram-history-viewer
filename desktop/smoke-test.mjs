import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startTelegramHistoryViewerServer } from "./server.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await startTelegramHistoryViewerServer(appRoot);

try {
  const page = await fetch(server.url);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Telegram History Viewer/);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  const sessionCookie = page.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(sessionCookie?.startsWith("telegram_history_viewer_session="));

  const cssPath = html.match(/href="([^"]+\.css[^"]*)"/)?.[1];
  assert.ok(cssPath, "The desktop page should reference its compiled stylesheet.");
  const stylesheet = await fetch(new URL(cssPath, server.url));
  assert.equal(stylesheet.status, 200, `Compiled stylesheet was not served: ${cssPath}`);
  assert.match(stylesheet.headers.get("content-type") ?? "", /^text\/css\b/);

  const previewWithoutSession = await fetch(new URL("/api/link-preview?url=https://example.com", server.url), {
    headers: { "X-Telegram-History-Viewer": "1" },
  });
  assert.equal(previewWithoutSession.status, 403);

  const previewWithoutMarker = await fetch(new URL("/api/link-preview?url=https://example.com", server.url), {
    headers: { Cookie: sessionCookie },
  });
  assert.equal(previewWithoutMarker.status, 403);

  const blockedPreview = await fetch(new URL("/api/link-preview?url=http://127.0.0.1", server.url), {
    headers: { Cookie: sessionCookie, "X-Telegram-History-Viewer": "1" },
  });
  assert.equal(blockedPreview.status, 400);

  console.log("Telegram History Viewer desktop server smoke test passed.");
} finally {
  await server.close();
}
