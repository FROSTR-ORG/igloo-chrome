#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

import esbuild from 'esbuild';
import postcss from 'postcss';
import postcssImport from 'postcss-import';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const publicDir = path.join(rootDir, 'public');
const defaultScratchWasmDir = path.resolve(rootDir, '../../.tmp/test-prebuild/browser-wasm/igloo-chrome/public/wasm');
const trackedWasmDir = path.join(publicDir, 'wasm');
const sourceCss = path.join(rootDir, 'src/index.css');
const distCss = path.join(distDir, 'index.css');
// igloo-ui's source styles.css references its vendored fonts with relative
// url("./fonts/*.woff2"). postcss-import inlines the @font-face rules but does
// NOT rebase the url() (unlike Vite's asset pipeline used by pwa/home). The CSS
// lands at dist/index.css, so "./fonts/" resolves to dist/fonts/ — copy the
// igloo-ui vendored woff2 there so the refs resolve and Inter renders.
const iglooFontsDir = path.resolve(rootDir, '../igloo-ui/src/fonts');
const distFontsDir = path.join(distDir, 'fonts');

// esbuild has no `dedupe` (a Vite/rollup concept). igloo-shared is bundled from
// source under preserveSymlinks, so it resolves its own nested nostr-tools while
// the extension resolves another — two instances split the module-level
// singletons (useWebSocketImplementation / SimplePool relay pools). Re-run
// esbuild's own resolver anchored at this package's root so every nostr-tools
// import (incl. the `nostr-tools/pure` subpath) collapses to ONE copy. We defer
// to build.resolve rather than require.resolve so the browser/import export
// conditions are preserved (require.resolve would pick the node build).
const dedupeNostrTools = {
  name: 'dedupe-nostr-tools',
  setup(build) {
    build.onResolve({ filter: /^nostr-tools(\/.*)?$/ }, async (args) => {
      if (args.pluginData?.dedupedNostrTools) return null;
      const resolved = await build.resolve(args.path, {
        kind: args.kind,
        resolveDir: rootDir,
        pluginData: { dedupedNostrTools: true },
      });
      if (resolved.errors.length > 0) return { errors: resolved.errors };
      return { path: resolved.path, external: resolved.external };
    });
  },
};

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

async function exists(pathToCheck) {
  try {
    await fs.access(pathToCheck);
    return true;
  } catch {
    return false;
  }
}

async function resolveWasmSourceDir() {
  if (process.env.IGLOO_CHROME_WASM_SOURCE_DIR) {
    return path.resolve(process.env.IGLOO_CHROME_WASM_SOURCE_DIR);
  }
  if (await exists(defaultScratchWasmDir)) {
    return defaultScratchWasmDir;
  }
  return trackedWasmDir;
}

async function copyWasmAssets() {
  const wasmSourceDir = await resolveWasmSourceDir();
  const distWasmDir = path.join(distDir, 'wasm');
  await fs.rm(distWasmDir, { recursive: true, force: true });
  await fs.cp(wasmSourceDir, distWasmDir, { recursive: true });
}

async function buildCss() {
  // postcss-import runs FIRST so it resolves chrome's
  // `@import "../../igloo-ui/src/styles.css"` AND igloo-ui's nested
  // `@import "./tokens/design-tokens.css"` (relative to igloo-ui's own file),
  // inlining the design tokens before tailwind processes the file. Without it,
  // the `--igloo-*` tokens would vanish and colors/fonts would break.
  const input = await fs.readFile(sourceCss, 'utf8');
  const result = await postcss([
    postcssImport(),
    tailwindcss({ config: path.join(rootDir, 'tailwind.config.ts') }),
    autoprefixer()
  ]).process(input, {
    from: sourceCss,
    to: distCss
  });
  await fs.writeFile(distCss, result.css, 'utf8');
}

async function copyFonts() {
  // The CSS at dist/index.css references "./fonts/*.woff2" (see iglooFontsDir
  // comment). Mirror the igloo-ui vendored fonts into dist/fonts/ so the rebased
  // url() refs resolve at runtime — this postcss pass, unlike Vite, does not
  // emit/rebase the woff2 itself.
  await fs.cp(iglooFontsDir, distFontsDir, { recursive: true });
}

async function bundleBrowserEntry(entryPoint, outfile, format = 'esm') {
  const reactRoot = path.join(rootDir, 'node_modules', 'react');
  const reactDomRoot = path.join(rootDir, 'node_modules', 'react-dom');
  await esbuild.build({
    absWorkingDir: rootDir,
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    preserveSymlinks: true,
    format,
    platform: 'browser',
    target: ['chrome116'],
    jsx: 'automatic',
    tsconfig: path.join(rootDir, 'tsconfig.json'),
    logLevel: 'silent',
    loader: assetLoaders,
    plugins: [dedupeNostrTools],
    alias: {
      '@': path.join(rootDir, 'src'),
      react: path.join(reactRoot, 'index.js'),
      'react/jsx-runtime': path.join(reactRoot, 'jsx-runtime.js'),
      'react/jsx-dev-runtime': path.join(reactRoot, 'jsx-dev-runtime.js'),
      'react-dom': path.join(reactDomRoot, 'index.js'),
      'react-dom/client': path.join(reactDomRoot, 'client.js')
    },
    assetNames: 'assets/[name]-[hash]',
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.env.VITE_DEFAULT_RELAYS': JSON.stringify(process.env.VITE_DEFAULT_RELAYS ?? ''),
      'import.meta.env.VITE_BIFROST_EVENT_KIND': JSON.stringify(
        process.env.VITE_BIFROST_EVENT_KIND ?? '20000'
      ),
      'import.meta.env.VITE_IGLOO_VERBOSE': JSON.stringify(process.env.VITE_IGLOO_VERBOSE ?? '0'),
      'import.meta.env.VITE_IGLOO_DEBUG': JSON.stringify(process.env.VITE_IGLOO_DEBUG ?? '0'),
      // Dev/test-only render seam (lib/dev-scenario.ts). Off by default so the
      // shipped extension never carries it; the test prebuild sets it to '1'.
      'import.meta.env.VITE_IGLOO_VISUAL': JSON.stringify(process.env.VITE_IGLOO_VISUAL ?? '0')
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
      path.join(distDir, 'index.html'),
      htmlShell({ title: 'Igloo Chrome', script: 'options.js' })
    )
  ]);
}

async function buildAll() {
  await cleanDist();
  await copyPublic();
  await copyWasmAssets();
  await buildCss();
  await copyFonts();

  await bundleBrowserEntry('src/main.tsx', path.join(distDir, 'options.js'));
  await bundleBrowserEntry('src/popup.tsx', path.join(distDir, 'popup.js'));
  await bundleBrowserEntry('src/prompt.tsx', path.join(distDir, 'prompt.js'));
  await bundleBrowserEntry('src/background.ts', path.join(distDir, 'background.js'));
  await bundleBrowserEntry('src/content-script.ts', path.join(distDir, 'content-script.js'), 'iife');
  await bundleBrowserEntry('src/nostr-provider.ts', path.join(distDir, 'nostr-provider.js'), 'iife');

  await writeHtmlPages();
}

buildAll().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
