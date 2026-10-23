export interface VisualHostFacts { githubActions?: string; runnerEnvironment?: string; runnerOS?: string; runnerArch?: string; imageOS?: string; imageVersion?: string; platform?: string; arch?: string; release?: string; node?: string; macosVersion?: string | null; }
export interface VisualPlatform { id: 'local-original' | 'github-macos-26'; snapshotPathTemplate: string; }
export const REVIEWED_IMAGE_VERSION: string;
export const REVIEWED_BROWSER_VERSION: string;
export function selectVisualPlatform(requested: string | undefined, facts: VisualHostFacts): VisualPlatform;
export function visualHostFacts(): VisualHostFacts;
export function currentVisualPlatform(): VisualPlatform;
