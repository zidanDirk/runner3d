export const SOURCE_PINS: Readonly<{ version: '1.64.1'; core: Readonly<{ relativePath: string; sha256: string }>; matcher: Readonly<{ relativePath: string; sha256: string }> }>;
export function buildDiagnosticSource(kind: 'core' | 'matcher', source: string): string;
export function installCapture(): boolean;
