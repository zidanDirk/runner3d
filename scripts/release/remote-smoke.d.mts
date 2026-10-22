export function verifyRemoteRelease(address: string, expectedId: string, options?: {
  fetcher?: (url: URL, options: RequestInit) => Promise<Response>;
  manifestBytes?: Uint8Array;
  expectedCommit?: string;
}): Promise<{ verifiedAt: string; buildId: string; commit: string; files: number; https: boolean; transport: string; httpRedirect: boolean; missingGLB: number; headers: { path: string; contentType: string; cacheControl: string; age: string | null; etag: string | null }[]; manifestSha256: string; scope: string }>;
