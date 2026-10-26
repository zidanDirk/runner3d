export function candidateInputs(inputs: { environment: string; confirmation: string; sourceRun?: string; buildId?: string; manifestSha256?: string }): 'new' | 'resume';
export interface CandidateRun { id: number; repository: { full_name: string }; path: string; name: string; event: string; status: string; conclusion: string; head_sha: string; }
export function verifyResumeSource(run: CandidateRun, repository: string, expectedCommit: string, sourceRun: string): void;
export function verifyResumeArtifact(options: { directory?: string; gatePath?: string; environment: string; expectedCommit: string; buildId: string; manifestSha256: string }): ReturnType<typeof import('./verify.mjs').verifyRelease>;
