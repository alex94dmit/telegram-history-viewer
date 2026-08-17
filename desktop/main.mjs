import { app, BrowserWindow, shell } from "electron";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStillgramServer } from "./server.mjs";

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

async function createMainWindow() {
  localServer ??= await startStillgramServer(appRoot);
  const localOrigin = new URL(localServer.url).origin;
  const window = new BrowserWindow({
    title: "Stillgram",
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
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url, localOrigin)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isExternalUrl(url, localOrigin)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
  window.once("ready-to-show", () => window.show());
  await window.loadURL(localServer.url);
  return window;
}

app.setName("Stillgram");

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
