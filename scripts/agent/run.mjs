// Separate filename keeps importing cli.ts side-effect free (Vite resolves .mjs before .ts).
import { createServer } from 'vite';
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
try { const { main, fail } = await server.ssrLoadModule('/scripts/agent/cli.ts'); try { await main(); } catch (error) { fail(error); } }
finally { await server.close(); }
