# Telegram History Viewer

[![CI](https://github.com/alex94dmit/telegram-history-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/alex94dmit/telegram-history-viewer/actions/workflows/ci.yml)

A private, on-device viewer for Telegram Desktop chat exports. Browse an archived conversation with a Telegram-inspired interface instead of reading raw JSON files.

## Highlights

- Opens Telegram Desktop exports in JSON format.
- Displays messages, replies, forwarded posts, reactions, photos, videos, looping GIFs, stickers, audio, files, and links.
- Includes conversation search, date and sender filters, media-type filters, and a media library.
- Opens images and videos in an in-app viewer.
- Remembers imported chats locally and lets you rename or remove them from the viewer.
- Runs as a web application during development or as a portable Windows application.

## Privacy and security

Chat archives stay on the device and are not uploaded by Telegram History Viewer.

The viewer saves a local cached copy so an imported chat can be restored after a refresh. You can remove it from **Privacy settings → Clear saved copy**. The cache is not encrypted by the application; it relies on the operating-system account and device security.

Rich link previews are disabled by default. Enabling them contacts the linked websites and may reveal your public IP address and the requested URLs. Desktop preview requests block local and private network targets, and preview images are proxied through the local application. External links open in the system browser rather than being embedded.

See [SECURITY.md](SECURITY.md) for the full security boundary, known limitations, and vulnerability-reporting instructions.

## Supported exports

Export the conversation with Telegram Desktop and choose **Machine-readable JSON**. Select the export folder itself when importing it; the folder should contain `result.json` and any exported media directories.

HTML-only exports are not supported.

## Run locally

Requirements:

- Node.js 22.13 or newer
- npm

Install the locked dependencies and start the development server:

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000/`, select the plus button, and choose the Telegram export folder.

## Build the portable Windows application

```powershell
npm ci
npm run desktop:build
```

The 64-bit portable executable is written to:

```text
release/Telegram-History-Viewer-0.1.0-portable.exe
```

It does not require installation. The desktop application serves the interface on a randomly selected local port bound only to the computer.

To run the desktop application without packaging it:

```powershell
npm run desktop:run
```

## Development checks

```powershell
npm run typecheck
npm run lint
npm test
```

`npm test` creates a production build, runs the security and rendered-output tests, and verifies the embedded desktop server.

Dependency audits can be run separately:

```powershell
npm audit --omit=dev
npm audit
```

## Technology

- React and TypeScript
- Vinext, Vite, and Tailwind CSS
- Electron and electron-builder
- GitHub Actions for continuous integration and Windows releases

## Continuous integration and releases

The [CI workflow](.github/workflows/ci.yml) runs on every push to `main` and every pull request. It checks TypeScript, linting, the production build, security tests, and the desktop smoke test on a Windows runner.

The [Windows release workflow](.github/workflows/release.yml) runs for tags matching `v*`. To publish a release:

1. Update `version` in `package.json` and commit the change.
2. Create a matching tag, such as `git tag v0.1.0`.
3. Push the tag with `git push origin v0.1.0`.

The workflow rejects mismatched versions, builds the portable x64 executable, generates a SHA-256 checksum, retains both as workflow artifacts, and attaches them to a GitHub Release.
