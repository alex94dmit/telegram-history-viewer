import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStillgramServer } from "./server.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await startStillgramServer(appRoot);

try {
  const page = await fetch(server.url);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Stillgram/);

  const cssPath = html.match(/href="([^"]+\.css[^"]*)"/)?.[1];
  assert.ok(cssPath, "The desktop page should reference its compiled stylesheet.");
  const stylesheet = await fetch(new URL(cssPath, server.url));
  assert.equal(stylesheet.status, 200, `Compiled stylesheet was not served: ${cssPath}`);
  assert.match(stylesheet.headers.get("content-type") ?? "", /^text\/css\b/);

  console.log("Stillgram desktop server smoke test passed.");
} finally {
  await server.close();
}
