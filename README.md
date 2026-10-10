# Telegram History Viewer

Telegram History Viewer is a private, on-device viewer for exported Telegram conversations. It displays messages, photos, videos, GIFs, stickers, audio, files, and links without uploading the archive.

## Privacy model

- The archive is read in the application and is never uploaded by Telegram History Viewer.
- A local cached copy is saved for refresh recovery. It can be removed at any time from **Privacy settings → Clear saved copy**. Telegram History Viewer does not encrypt this cache; access is protected by the operating-system account and device security.
- Rich link previews are off by default. When enabled, Telegram History Viewer contacts the linked websites, which can reveal the device's public IP address and the requested URLs. Desktop preview requests reject local/private network targets and proxy preview images into the app.
- Clicking a link opens it in the system browser. Telegram History Viewer does not embed external websites.

See [SECURITY.md](SECURITY.md) for the security boundary, reporting process, and remaining limitations.

## Run the web version

Requirements: Node.js 22.13 or newer.

```powershell
npm install
npm run dev
```

Open `http://localhost:3000/`, then use the plus button to choose a Telegram export folder.

## Build the Windows application

Create a portable 64-bit Windows executable:

```powershell
npm install
npm run desktop:build
```

The finished executable is written to:

```text
release/Telegram-History-Viewer-0.1.0-portable.exe
```

It does not need installation. The application starts a private server bound only to the local computer, and archive files remain on the device.

To test the desktop runtime without packaging it:

```powershell
npm run desktop:run
```

## Continuous integration and releases

GitHub Actions validates TypeScript, linting, the production build, security tests, and the desktop smoke test on every push to `main` and every pull request.

To publish a Windows release:

1. Update `version` in `package.json` and commit the change.
2. Create a matching tag, for example `git tag v0.1.0`.
3. Push it with `git push origin v0.1.0`.

The release workflow builds the portable x64 `.exe`, creates a SHA-256 checksum, stores both as a workflow artifact, and publishes them to the repository's GitHub Releases page. The workflow rejects a tag that does not match the version in `package.json`.

## Validation

```powershell
npm test
```

This checks the production viewer and the embedded desktop server.

Run the dependency checks separately:

```powershell
npm audit --omit=dev
npm audit
```
