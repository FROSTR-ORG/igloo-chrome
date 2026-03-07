#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const artifactsDir = path.join(rootDir, 'artifacts');
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
const manifestJson = JSON.parse(await fs.readFile(path.join(rootDir, 'public', 'manifest.json'), 'utf8'));

if (packageJson.version !== manifestJson.version) {
  throw new Error(`Version mismatch: package.json=${packageJson.version}, manifest.json=${manifestJson.version}`);
}

const version = packageJson.version;
const candidateName = `igloo-chrome-v${version}-test-candidate`;
const candidateDir = path.join(artifactsDir, candidateName);
const checksumPath = path.join(artifactsDir, `${candidateName}.sha256`);
const metadataPath = path.join(artifactsDir, `${candidateName}.json`);
const zipPath = path.join(artifactsDir, `${candidateName}.zip`);

await fs.access(distDir);
await fs.mkdir(artifactsDir, { recursive: true });
await fs.rm(candidateDir, { recursive: true, force: true });
await fs.rm(checksumPath, { force: true });
await fs.rm(metadataPath, { force: true });
await fs.rm(zipPath, { force: true });
await fs.cp(distDir, candidateDir, { recursive: true });

async function hashDirectory(dir) {
  const hash = createHash('sha256');

  async function walk(currentDir) {
    const entries = (await fs.readdir(currentDir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(dir, fullPath);
      if (entry.isDirectory()) {
        hash.update(`dir:${relativePath}\n`);
        await walk(fullPath);
        continue;
      }
      const content = await fs.readFile(fullPath);
      hash.update(`file:${relativePath}\n`);
      hash.update(content);
    }
  }

  await walk(dir);
  return hash.digest('hex');
}

let gitCommit = null;
const gitResult = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: rootDir,
  encoding: 'utf8'
});
if (gitResult.status === 0) {
  gitCommit = gitResult.stdout.trim() || null;
}

const checksum = await hashDirectory(candidateDir);
await fs.writeFile(checksumPath, `${checksum}  ${candidateName}\n`, 'utf8');
await fs.writeFile(
  metadataPath,
  JSON.stringify(
    {
      name: candidateName,
      version,
      generatedAt: new Date().toISOString(),
      manifestVersion: manifestJson.manifest_version,
      commit: gitCommit,
      candidateDir,
      checksumSha256: checksum
    },
    null,
    2
  ) + '\n',
  'utf8'
);

const zipCheck = spawnSync('zip', ['-qr', zipPath, candidateName], {
  cwd: artifactsDir,
  encoding: 'utf8'
});
const zipCreated = zipCheck.status === 0;
if (!zipCreated && zipCheck.error?.code !== 'ENOENT') {
  throw new Error(zipCheck.stderr || zipCheck.error.message);
}

console.log(`ok: created candidate directory ${candidateDir}`);
console.log(`ok: wrote checksum ${checksumPath}`);
console.log(`ok: wrote metadata ${metadataPath}`);
if (zipCreated) {
  console.log(`ok: wrote zip archive ${zipPath}`);
} else {
  console.log('note: zip command not available; skipped zip archive');
}
