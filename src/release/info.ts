import type { ReleaseInfo } from './config';

declare const __APP_RELEASE__: ReleaseInfo;

/** Vite injects only this validated allowlist. Unit imports have a deterministic fallback. */
export const releaseInfo: ReleaseInfo = typeof __APP_RELEASE__ === 'undefined'
  ? Object.freeze({ version: '0.14.0-beta', buildId: 'unit-test', commit: 'unknown', buildTime: '2026-01-01T00:00:00.000Z', environment: 'development' })
  : Object.freeze(__APP_RELEASE__);
