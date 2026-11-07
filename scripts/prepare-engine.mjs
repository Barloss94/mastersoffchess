import { copyFile, mkdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";

const source = resolve("node_modules", "stockfish", "bin");
const target = resolve("engine");
const files = [
  "stockfish-19-lite-single.js",
  "stockfish-19-lite-single.wasm"
];

await mkdir(target, { recursive: true });
for (const filename of files) {
  const from = join(source, filename);
  const to = join(target, filename);
  await copyFile(from, to);
  const info = await stat(to);
  if (!info.size) throw new Error("Empty Stockfish asset: " + filename);
  console.log("Stockfish asset ready:", filename, info.size, "bytes");
}
