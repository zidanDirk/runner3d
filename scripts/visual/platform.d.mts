export interface VisualHostFacts { githubActions?: string; runnerEnvironment?: string; runnerOS?: string; runnerArch?: string; imageOS?: string; imageVersion?: string; platform?: string; arch?: string; release?: string; node?: string; macosVersion?: string | null; }
export interface VisualPlatform { id: 'local-original' | 'github-macos-26' | 'github-macos-26-20261013-0424-1-v1' | 'github-macos-26-20261021-0445-8-v1'; contractId?: string; referenceSetSha256?: string; snapshotPathTemplate: string; }
export const REVIEWED_IMAGE_VERSION: string;
export const REVIEWED_BROWSER_VERSION: string;
export function selectVisualPlatform(requested: string | undefined, facts: VisualHostFacts): VisualPlatform;
export function visualHostFacts(): VisualHostFacts;
export function currentVisualPlatform(): VisualPlatform;
