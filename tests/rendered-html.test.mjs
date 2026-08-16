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
  assert.match(html, /Jamie &amp; Alex Chen/);
  assert.match(html, /Rename chat/);
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
  assert.match(page, /desktopSidebarOpenRef/);
  assert.match(page, /syncSidebarToViewport/);
  assert.match(page, /narrowViewport\.matches \? false : desktopSidebarOpenRef\.current/);
  assert.match(page, /function toggleSidebar/);
  assert.match(page, /className="theme-toggle"/);
  assert.match(page, /Use.*theme/);
  assert.match(page, /selectSenderFilter/);
  assert.match(page, /conversationName/);
  assert.match(page, /conversationInitials/);
  assert.match(page, /conversationNameStorageKey/);
  assert.match(page, /localStorage\.getItem\(conversationNameStorageKey\)/);
  assert.match(page, /localStorage\.setItem\(conversationNameStorageKey, nextName\)/);
  assert.match(page, /aria-label="Chat name"/);
  assert.match(page, /aria-label="Save chat name"/);
  assert.match(page, /aria-label="Cancel renaming chat"/);
  assert.match(page, /className="rename-chat-overlay"/);
  assert.match(page, /className="rename-chat-modal"/);
  assert.match(page, /aria-labelledby="rename-chat-title"/);
  assert.match(page, /Close rename dialog/);
  assert.match(page, /className="rename-chat-backdrop"/);
  assert.match(page, /Dismiss rename dialog/);
  assert.doesNotMatch(page, /className="conversation-name-editor"/);
  assert.match(page, /className="chat-list-rename"/);
  assert.match(page, /aria-label="Rename chat from chat list"/);
  assert.match(page, /className="header-avatar-rename"/);
  assert.match(page, /aria-label="Rename chat from header avatar"/);
  assert.doesNotMatch(page, /className="rename-chat-button"/);
  assert.doesNotMatch(page, /<button className="chat-list-row/);
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
  assert.match(page, /rootMargin: "350px 0px"/);
  assert.match(page, /function useNearViewport/);
  assert.match(page, /const MEDIA_MESSAGE_LIMIT = 60/);
  assert.match(page, /selectMediaFilter/);
  assert.match(page, /\/api\/link-preview/);
  assert.match(page, /fetch\(src\)/);
  assert.doesNotMatch(page, /fetch\(\s*["'`]https?:/);
  assert.match(page, /Media folder isn’t connected/);
  assert.match(page, /lottie-web\/build\/player\/lottie_light/);
  assert.match(page, /poster=\{poster\}/);
  assert.match(page, /<source src=\{src\} type=/);
  assert.match(page, /function TelegramGif/);
  assert.match(page, /function TelegramVideo/);
  assert.match(page, /className="telegram-gif-frame" role="img"/);
  assert.match(page, /className="telegram-gif-media" autoPlay loop muted playsInline preload="auto"/);
  assert.match(page, /addEventListener\("pause", ensurePlayback\)/);
  assert.match(page, /loading="lazy" decoding="async"/);
  assert.match(page, /className={`telegram-audio\$\{active \? "" : " is-deferred"}`}/);
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
