# Telegram History Viewer security

## Supported version

Security fixes currently target the latest source and the latest Windows release built from it.

## Reporting a vulnerability

Do not include real Telegram exports, messages, media, access tokens, or other personal data in a public issue. When this project is published, use GitHub private vulnerability reporting if it is enabled. Otherwise, open a public issue containing only a minimal synthetic reproduction and ask the maintainer for a private contact channel.

## Security boundary

Telegram History Viewer is a local archive viewer, not an encrypted vault. The original Telegram export and the viewer's refresh cache are plaintext data available to software running as the same operating-system user. Use full-disk encryption, a protected Windows account, and the **Clear saved copy** control when the archive should not remain cached.

The desktop renderer is sandboxed, has no Node.js access, and is restricted to the app's loopback origin. The embedded server listens only on `127.0.0.1`, requires a per-launch session cookie for link-preview requests, and applies restrictive browser security headers.

Rich link previews are disabled by default. Enabling them makes outbound requests to websites represented by links in the archive. The destination can observe the public IP address, requested URL, timing, and preview user agent. Desktop requests permit only standard HTTP(S) ports, resolve hostnames before connecting, reject any hostname resolving to a private or special-use address, revalidate redirects, cap response sizes, and return preview images as local data rather than loading them directly in the renderer.

## Release checklist

Before publishing a release:

1. Run `npm test`, `npm run lint`, `npm audit --omit=dev`, and `npm audit`.
2. Review unresolved development/build dependency advisories; do not assume `--omit=dev` covers the packaged Electron runtime.
3. Scan tracked files and Git history for exports, screenshots, absolute user paths, credentials, and private keys.
4. Build from a clean checkout and publish the executable with a SHA-256 checksum.
5. Code-sign the Windows executable when a signing identity is available.

## Known limitations

- Cached archive data is not encrypted by Telegram History Viewer.
- The Content Security Policy permits inline scripts because the current application framework emits inline hydration data. External script origins remain blocked.
- The unsigned development executable can trigger Windows SmartScreen warnings.
- The hosted/browser build cannot pin DNS results in the same way as the desktop runtime. Its rich-preview endpoint applies protocol, hostname, address-literal, port, redirect, request-marker, timeout, and size checks, but the desktop build has the stronger network boundary.
