import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Stillgram archive viewer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Stillgram — Private Telegram archive viewer<\/title>/i);
  assert.match(html, /Stillgram/);
  assert.match(html, /local archive/);
  assert.match(html, /Private archive/);
  assert.match(html, /Open a Telegram export folder/);
  assert.match(html, /Message filters/);
  assert.match(html, /Sample archive/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps local import behavior explicit in the source", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /webkitdirectory/);
  assert.match(page, /indexedDB/);
  assert.match(page, /cacheArchive/);
  assert.match(page, /readCachedArchive/);
  assert.match(page, /saved for refresh/);
  assert.doesNotMatch(page, /showDirectoryPicker|queryPermission|requestPermission/);
  assert.match(page, /result\.json/);
  assert.match(page, /aria-label="Archive source"/);
  assert.match(page, /aria-controls="archive-sidebar"/);
  assert.match(page, /Hide archive panel/);
  assert.match(page, /Show archive panel/);
  assert.match(page, /className="theme-toggle"/);
  assert.match(page, /Use.*theme/);
  assert.match(page, /selectSenderFilter/);
  assert.match(page, /scrollMessagesToLatest/);
  assert.match(page, /View Media/);
  assert.match(page, /Shared media/);
  assert.match(page, /No media connected/);
  assert.match(page, /Show older media/);
  assert.match(page, /className="control-tooltip" role="tooltip"/);
  assert.match(page, /Open a Telegram export folder/);
  assert.doesNotMatch(page, /▧ Choose folder|☷ Messages only|jsonInputRef/);
  assert.match(page, /URL\.createObjectURL/);
  assert.match(page, /IntersectionObserver/);
  assert.match(page, /rootMargin: "700px 0px"/);
  assert.match(page, /\/api\/link-preview/);
  assert.match(page, /fetch\(src\)/);
  assert.doesNotMatch(page, /fetch\(\s*["'`]https?:/);
  assert.match(page, /Media folder isn’t connected/);
  assert.match(page, /lottie-web\/build\/player\/lottie_light/);
  assert.match(page, /poster=\{poster\}/);
  assert.match(page, /<source src=\{url\} type=/);
  assert.match(page, /function TelegramGif/);
  assert.match(page, /className="telegram-gif-frame" role="img"/);
  assert.match(page, /className="telegram-gif-media" autoPlay loop muted playsInline preload="auto"/);
  assert.match(page, /addEventListener\("pause", ensurePlayback\)/);
  assert.match(page, /viewerUrlRef/);
  assert.match(page, /openMediaViewer\(path, label, alt, "photo"\)/);
  assert.match(page, /Open \$\{label\} in media viewer/);
  assert.match(page, /controlsList="nofullscreen noremoteplayback"/);
  assert.match(page, /className="media-viewer-video"/);
  assert.match(page, /closeMediaViewer/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /Close media viewer/);
  assert.match(layout, /Stillgram/);
  assert.match(layout, /\/og\.png/);
  assert.match(layout, /ResizeObserver loop completed with undelivered notifications/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
