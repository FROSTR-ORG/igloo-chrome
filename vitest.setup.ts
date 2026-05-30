import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

import { ensureLocalStorage } from 'igloo-shared/testing/setup-dom';

// jsdom 28 does not guarantee a spec-compliant localStorage; ensure one exists
// before each test so afterEach's localStorage.clear() is always callable.
beforeEach(() => {
  ensureLocalStorage();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
