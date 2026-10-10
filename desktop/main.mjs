import { app, BrowserWindow, shell } from "electron";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startTelegramHistoryViewerServer } from "./server.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let localServer;

function isExternalUrl(url, localOrigin) {
  try {
    const parsed = new URL(url);
    return parsed.origin !== localOrigin && (parsed.protocol === "http:" || parsed.protocol === "https:");
  } catch {
    return false;
  }
}

function isInternalUrl(url, localOrigin) {
  try {
    return new URL(url).origin === localOrigin;
  } catch {
    return false;
  }
}

async function createMainWindow() {
  localServer ??= await startTelegramHistoryViewerServer(appRoot);
  const localOrigin = new URL(localServer.url).origin;
  const window = new BrowserWindow({
    title: "Telegram History Viewer",
    width: 1180,
    height: 820,
    minWidth: 420,
    minHeight: 560,
    autoHideMenuBar: true,
    backgroundColor: "#dcebf4",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    ({ url }, callback) => callback({ cancel: !isInternalUrl(url, localOrigin) }),
  );

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url, localOrigin)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isInternalUrl(url, localOrigin)) return;
    event.preventDefault();
    if (isExternalUrl(url, localOrigin)) void shell.openExternal(url);
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  await window.loadURL(localServer.url);
  return window;
}

app.setName("Telegram History Viewer");
app.enableSandbox();

app.whenReady().then(async () => {
  await createMainWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createMainWindow();
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (localServer) void localServer.close();
});
