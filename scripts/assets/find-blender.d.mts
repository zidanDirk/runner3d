export const BLENDER_INSTALL_HELP: string;
export function discoverBlender(options?: {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  pathCandidates?: string[];
  searchDirs?: string[];
}): string;
