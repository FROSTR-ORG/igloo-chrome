#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromeRoot = path.resolve(__dirname, '..');
const sharedRoot = path.resolve(chromeRoot, '../igloo-shared');
const sourceDir = path.resolve(sharedRoot, 'public/wasm');
const targetDir = path.resolve(chromeRoot, 'public/wasm');
const expectedArtifacts = [
  'bifrost_bridge_wasm.js',
  'bifrost_bridge_wasm.d.ts',
  'bifrost_bridge_wasm_bg.wasm'
];

for (const artifact of expectedArtifacts) {
  const artifactPath = path.join(sourceDir, artifact);
  try {
    await fs.access(artifactPath);
  } catch {
    throw new Error(
      `Missing shared bridge artifact ${artifactPath}. Build igloo-shared first or use ./run.sh browser igloo-chrome build.`
    );
  }
}

await fs.mkdir(targetDir, { recursive: true });

for (const entry of await fs.readdir(sourceDir)) {
  const sourcePath = path.join(sourceDir, entry);
  const targetPath = path.join(targetDir, entry);
  await fs.copyFile(sourcePath, targetPath);
}

console.log(`ok: synced bridge wasm assets to ${targetDir}`);
