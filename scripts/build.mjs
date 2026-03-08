#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

import esbuild from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const publicDir = path.join(rootDir, 'public');
const sourceCss = path.join(rootDir, 'src/index.css');
const distCss = path.join(distDir, 'index.css');

const assetLoaders = {
  '.png': 'file',
  '.woff': 'file',
  '.woff2': 'file',
  '.svg': 'file'
};

function htmlShell({ title, script, rootId = 'root', styles = true }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    ${styles ? '<link rel="stylesheet" href="./index.css" />' : ''}
  </head>
  <body>
    ${rootId ? `<div id="${rootId}"></div>` : ''}
    <script type="module" src="./${script}"></script>
  </body>
</html>
`;
}

async function cleanDist() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });
}

async function copyPublic() {
  await fs.cp(publicDir, distDir, { recursive: true });
}

async function buildCss() {
  const input = await fs.readFile(sourceCss, 'utf8');
  const result = await postcss([tailwindcss({ config: path.join(rootDir, 'tailwind.config.ts') })]).process(input, {
    from: sourceCss,
    to: distCss
  });
  await fs.writeFile(distCss, result.css, 'utf8');
}

async function bundleBrowserEntry(entryPoint, outfile, format = 'esm') {
  await esbuild.build({
    absWorkingDir: rootDir,
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format,
    platform: 'browser',
    target: ['chrome116'],
    jsx: 'automatic',
    tsconfig: path.join(rootDir, 'tsconfig.json'),
    logLevel: 'silent',
    loader: assetLoaders,
    assetNames: 'assets/[name]-[hash]',
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.env.VITE_DEFAULT_RELAYS': JSON.stringify(process.env.VITE_DEFAULT_RELAYS ?? ''),
      'import.meta.env.VITE_BIFROST_EVENT_KIND': JSON.stringify(
        process.env.VITE_BIFROST_EVENT_KIND ?? '20000'
      ),
      'import.meta.env.VITE_IGLOO_VERBOSE': JSON.stringify(process.env.VITE_IGLOO_VERBOSE ?? '0'),
      'import.meta.env.VITE_IGLOO_DEBUG': JSON.stringify(process.env.VITE_IGLOO_DEBUG ?? '0')
    }
  });
}

async function writeHtmlPages() {
  await Promise.all([
    fs.writeFile(
      path.join(distDir, 'options.html'),
      htmlShell({ title: 'Igloo Chrome', script: 'options.js' })
    ),
    fs.writeFile(
      path.join(distDir, 'popup.html'),
      htmlShell({ title: 'Igloo Popup', script: 'popup.js' })
    ),
    fs.writeFile(
      path.join(distDir, 'prompt.html'),
      htmlShell({ title: 'Igloo Permission Prompt', script: 'prompt.js' })
    ),
    fs.writeFile(
      path.join(distDir, 'offscreen.html'),
      htmlShell({
        title: 'Igloo Offscreen Runtime',
        script: 'offscreen.js',
        rootId: '',
        styles: false
      })
    ),
    fs.writeFile(
      path.join(distDir, 'index.html'),
      htmlShell({ title: 'Igloo Chrome', script: 'options.js' })
    )
  ]);
}

async function buildAll() {
  await cleanDist();
  await copyPublic();
  await buildCss();

  await bundleBrowserEntry('src/main.tsx', path.join(distDir, 'options.js'));
  await bundleBrowserEntry('src/popup.tsx', path.join(distDir, 'popup.js'));
  await bundleBrowserEntry('src/prompt.tsx', path.join(distDir, 'prompt.js'));
  await bundleBrowserEntry('src/offscreen.ts', path.join(distDir, 'offscreen.js'));
  await bundleBrowserEntry('src/background.ts', path.join(distDir, 'background.js'));
  await bundleBrowserEntry('src/content-script.ts', path.join(distDir, 'content-script.js'), 'iife');
  await bundleBrowserEntry('src/nostr-provider.ts', path.join(distDir, 'nostr-provider.js'), 'iife');

  await writeHtmlPages();
}

buildAll().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
