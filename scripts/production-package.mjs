const LOCAL_RELAY_CSP_TOKENS = [
  'ws://localhost:*',
  'ws://127.0.0.1:*',
  'http://localhost:*',
  'http://127.0.0.1:*',
];

const DEBUG_COMMAND_LITERALS = [
  'ext.debug.reload',
  'ext.debug.clearProfileUnlocks',
  'ext.debug.seedProfileUnlock',
];

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stripLocalRelayCsp(value) {
  let result = value;
  for (const token of LOCAL_RELAY_CSP_TOKENS) {
    result = result.replaceAll(` ${token};`, ';').replaceAll(` ${token}`, '');
  }
  return result.replace(/\s+/g, ' ').trim();
}

export function createReleaseManifest(sourceManifest) {
  const manifest = cloneJson(sourceManifest);
  const csp = manifest.content_security_policy?.extension_pages;
  if (typeof csp === 'string') {
    manifest.content_security_policy.extension_pages = stripLocalRelayCsp(csp);
  }
  return manifest;
}

export function assertProductionPackage({ manifest, backgroundSource }) {
  const errors = [];
  const csp = manifest?.content_security_policy?.extension_pages;
  if (typeof csp !== 'string') {
    errors.push('missing extension_pages CSP');
  } else if (LOCAL_RELAY_CSP_TOKENS.some((token) => csp.includes(token))) {
    errors.push('local relay CSP entries are present');
  }

  const debugLiteral = DEBUG_COMMAND_LITERALS.find((literal) => backgroundSource.includes(literal));
  if (debugLiteral) {
    errors.push(`debug command literal is present: ${debugLiteral}`);
  }

  if (errors.length > 0) {
    throw new Error(`Production package check failed: ${errors.join('; ')}`);
  }
}
