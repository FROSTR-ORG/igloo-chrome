#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IGLOO_ROOT = path.resolve(__dirname, '..');
const SHARED_ROOT = path.resolve(IGLOO_ROOT, '../igloo-shared');
const DEFAULT_BIFROST_RS_DIR = path.resolve(IGLOO_ROOT, '../bifrost-rs');
const BIFROST_RS_DIR = process.env.BIFROST_RS_DIR
  ? path.resolve(process.env.BIFROST_RS_DIR)
  : DEFAULT_BIFROST_RS_DIR;

const WASM_ARTIFACTS = [
  'bifrost_bridge_wasm.js',
  'bifrost_bridge_wasm.d.ts',
  'bifrost_bridge_wasm_bg.wasm'
].map((name) => path.join(IGLOO_ROOT, 'public/wasm', name));

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function statMtimeMs(filePath) {
  return fs.statSync(filePath).mtimeMs;
}

function listFilesRecursively(rootDir, predicate) {
  const results = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'target' || entry.name === '.git') {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (predicate(fullPath)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function newestSourceMtimeMs() {
  let newest = 0;
  const sourceFiles = listFilesRecursively(BIFROST_RS_DIR, (fullPath) =>
    fullPath.endsWith('.rs') ||
    fullPath.endsWith('.toml') ||
    fullPath.endsWith('.lock')
  );
  for (const sourceFile of sourceFiles) {
    newest = Math.max(newest, statMtimeMs(sourceFile));
  }
  return newest;
}

function artifactsReady() {
  return WASM_ARTIFACTS.every(exists);
}

function newestArtifactMtimeMs() {
  return Math.min(...WASM_ARTIFACTS.map(statMtimeMs));
}

function rebuild() {
  execFileSync('npm', ['run', 'build:bridge-wasm'], {
    cwd: SHARED_ROOT,
    stdio: 'inherit'
  });
  execFileSync('npm', ['run', 'build:bridge-wasm'], {
    cwd: IGLOO_ROOT,
    stdio: 'inherit'
  });
}

function main() {
  const reason = [];
  if (!artifactsReady()) {
    reason.push('missing artifacts');
  }

  if (reason.length === 0) {
    const sourceMtime = newestSourceMtimeMs();
    const artifactMtime = newestArtifactMtimeMs();
    if (sourceMtime > artifactMtime) {
      reason.push('stale artifacts');
    }
  }

  if (reason.length > 0) {
    console.log(`[ensure-bridge-wasm] rebuilding (${reason.join(', ')})`);
    rebuild();
    return;
  }

  console.log('[ensure-bridge-wasm] bridge wasm artifacts are up to date');
}

main();
