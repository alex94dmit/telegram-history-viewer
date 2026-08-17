import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = new URL("../public/favicon.svg", import.meta.url);
const destination = new URL("../build-resources/icon.png", import.meta.url);
const svg = await readFile(source);

await mkdir(new URL("../build-resources/", import.meta.url), { recursive: true });
await sharp(svg, { density: 1024 })
  .resize(512, 512)
  .png()
  .toFile(fileURLToPath(destination));
