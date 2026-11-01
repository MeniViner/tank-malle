import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { SCAN_MODEL_FILES, SCAN_MODEL_VERSION, type ScanModelFile } from "../src/lib/scan/models.ts";

/**
 * Serves (dev) and emits (build) the scan recogniser files at
 * /scan-models/<version>/. Each file is taken from node_modules or fetched
 * from its pinned URL once, and is used only if its sha256 matches the
 * manifest. A production build without verified files fails.
 */
const cache = resolve(process.env.SCAN_MODEL_CACHE ?? "node_modules/.cache/tank-maleh-scan-models");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function verified(file: ScanModelFile): Promise<Uint8Array> {
  const cached = join(cache, `${file.sha256}-${file.name}`);
  if (existsSync(cached)) {
    const bytes = await readFile(cached);
    if (sha256(bytes) === file.sha256) return bytes;
  }
  const bytes = file.source.startsWith("npm:")
    ? await readFile(resolve("node_modules", file.source.slice(4).replace(/@[^/]+/, "")))
    : file.source.startsWith("repo:") ? await readFile(resolve(file.source.slice(5)))
    : new Uint8Array(await (await fetch(file.source)).arrayBuffer());
  if (sha256(bytes) !== file.sha256 || bytes.length !== file.bytes) throw new Error(`Scan model ${file.name} does not match its pinned sha256`);
  await mkdir(cache, { recursive: true });
  await writeFile(cached, bytes);
  return bytes;
}

export function scanModels(): Plugin {
  return {
    name: "scan-models",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const match = /^\/scan-models\/([^/]+)\/([^/?]+)/.exec(request.url ?? "");
        const file = match?.[1] === SCAN_MODEL_VERSION ? SCAN_MODEL_FILES.find(f => f.name === match[2]) : undefined;
        if (!file) return next();
        try {
          const bytes = await verified(file);
          response.setHeader("Content-Type", file.name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
          response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          response.end(bytes);
        } catch { response.statusCode = 503; response.end(); }
      });
    },
    async generateBundle() {
      for (const file of SCAN_MODEL_FILES) this.emitFile({ type: "asset", fileName: `scan-models/${SCAN_MODEL_VERSION}/${file.name}`, source: await verified(file) });
    },
  };
}
