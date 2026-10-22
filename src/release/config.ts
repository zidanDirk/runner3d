export type ReleaseEnvironment = 'development' | 'preview' | 'production';
export interface ReleaseInfo {
  readonly version: string;
  readonly buildId: string;
  readonly commit: string;
  readonly buildTime: string;
  readonly environment: ReleaseEnvironment;
}

/** Public build metadata only. Never pass a whole process.env to the browser. */
export function createReleaseInfo(input: {
  readonly version: string;
  readonly environment: string;
  readonly commit: string;
  readonly buildTime: string;
  readonly buildId?: string;
}): ReleaseInfo {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.version)) throw new Error('Invalid application version');
  const environment = input.environment;
  if (environment !== 'development' && environment !== 'preview' && environment !== 'production') throw new Error('RELEASE_ENV must be development, preview or production');
  if (!/^(?:[a-f0-9]{7,40}|unknown)$/.test(input.commit)) throw new Error('Invalid public commit SHA');
  const time = new Date(input.buildTime);
  if (!Number.isFinite(time.getTime()) || time.toISOString() !== input.buildTime) throw new Error('BUILD_TIME must be an ISO UTC timestamp');
  const buildId = input.buildId ?? `${input.version}-${input.commit.slice(0, 12)}-${input.buildTime.replace(/[-:.]/g, '')}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(buildId)) throw new Error('BUILD_ID must be a safe, nonempty path segment (max 120 characters)');
  return Object.freeze({ version: input.version, buildId, commit: input.commit, buildTime: input.buildTime, environment });
}

/** Relative assets make the exact same artifact work inside its immutable release directory. */
export function validateBase(base: string): string {
  if (base === './' || base === '/') return base;
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)+$/.test(base)) throw new Error('ASSET_BASE must be ./, / or a slash-delimited absolute path');
  return base;
}
