# Stillgram

Stillgram is a private, on-device viewer for exported Telegram conversations. It displays messages, photos, videos, GIFs, stickers, audio, files, and links without uploading the archive.

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
release/Stillgram-0.1.0-portable.exe
```

It does not need installation. The application starts a private server bound only to the local computer, and archive files remain on the device.

To test the desktop runtime without packaging it:

```powershell
npm run desktop:run
```

## Validation

```powershell
npm test
```

This checks the production viewer and the embedded desktop server.
