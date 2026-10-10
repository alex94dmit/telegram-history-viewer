import assert from "node:assert/strict";
import test from "node:test";
import {
  blockedHostname,
  blockedIpAddress,
  handleLinkPreviewRequest,
  supportedTarget,
} from "./link-preview.mjs";

test("blocks loopback, private, carrier-grade NAT, multicast, and local IPv4 targets", () => {
  for (const address of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.168.1.1", "224.0.0.1"]) {
    assert.equal(blockedIpAddress(address), true, address);
  }
  assert.equal(blockedIpAddress("8.8.8.8"), false);
});

test("blocks private and local IPv6 targets", () => {
  for (const address of ["::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "2001:db8::1"]) {
    assert.equal(blockedIpAddress(address), true, address);
  }
  assert.equal(blockedIpAddress("2606:4700:4700::1111"), false);
});

test("rejects local names, credentials, and non-web ports", () => {
  for (const hostname of ["localhost", "printer.local", "service.internal", "router.home.arpa", "intranet"]) {
    assert.equal(blockedHostname(hostname), true, hostname);
  }
  assert.equal(supportedTarget(new URL("https://example.com/page")), true);
  assert.equal(supportedTarget(new URL("https://user:password@example.com/")), false);
  assert.equal(supportedTarget(new URL("https://example.com:8443/")), false);
  assert.equal(supportedTarget(new URL("file:///etc/passwd")), false);
});

test("link-preview handler requires the same-origin request marker", async () => {
  const denied = await handleLinkPreviewRequest(new Request("http://127.0.0.1/api/link-preview?url=https://example.com"));
  assert.equal(denied.status, 403);

  const blocked = await handleLinkPreviewRequest(new Request("http://127.0.0.1/api/link-preview?url=http://127.0.0.1", {
    headers: { "X-Telegram-History-Viewer": "1" },
  }));
  assert.equal(blocked.status, 400);
});
