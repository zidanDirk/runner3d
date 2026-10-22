import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';

// Production file graph, distinct from dev-server ResourceTiming or user TTI.
const html = readFileSync('dist/index.html', 'utf8');
const entry = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1];
if (!entry) throw new Error('Production module entry missing');
const files = readdirSync('dist/assets');
function asset(prefix) {
  const matches = files.filter(name => name.startsWith(prefix + '-') && name.endsWith('.js'));
  if (matches.length !== 1) throw new Error('Ambiguous production chunk ' + prefix);
  return join('dist/assets', matches[0]);
}
function closure(initial) {
  const visited = new Set();
  const add = file => {
    file = normalize(file);
    if (visited.has(file)) return;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    const patterns = [/\bimport\s*(?:[^"'();]*?\bfrom\s*)?["']([^"']+)["']/g, /\bexport\s*[^"'();]*?\bfrom\s*["']([^"']+)["']/g];
    for (const pattern of patterns) for (const match of source.matchAll(pattern)) {
      const dependency = match[1];
      if (dependency?.startsWith('.') && dependency.endsWith('.js')) add(join(dirname(file), dependency));
    }
  };
  initial.forEach(add);
  return [...visited].sort();
}
function report(paths) {
  const output = paths.map(path => { const bytes = readFileSync(path); return { path, bytes: bytes.length, gzipBytes: gzipSync(bytes).length }; });
  return { files: output, bytes: output.reduce((n, f) => n + f.bytes, 0), gzipBytes: output.reduce((n, f) => n + f.gzipBytes, 0) };
}
const ui = closure([join('dist', entry.replace(/^\//, ''))]);
const home = closure([...ui, asset('CharacterPreview')]);
const game = closure([...home, asset('GameSession'), asset('GameScene')]);
const result = {
  method: 'Actual built ESM static-import closure plus explicit lazy boundaries; raw filesystem bytes and individual gzip sizes, not network transfer, CDN timing or standardized TTI.',
  entry, initialUi: report(ui), homeWithTrueCharacterPreview: report(home), afterFirstGame: report(game),
  allJavaScript: report(files.filter(name => name.endsWith('.js')).map(name => join('dist/assets', name))),
  homeDoesNotImportGameSession: !home.includes(asset('GameSession')),
  homeDoesNotImportGameScene: !home.includes(asset('GameScene')),
  styles: report(files.filter(name => name.endsWith('.css')).map(name => join('dist/assets', name))),
  totalGlbBytes: readdirSync('public/models/generated').filter(name => name.endsWith('.glb')).reduce((n, name) => n + readFileSync(join('public/models/generated', name)).length, 0),
  characterGlb: { path: 'public/models/generated/city-runner.glb', bytes: readFileSync('public/models/generated/city-runner.glb').length },
};
if (!result.homeDoesNotImportGameScene || !result.homeDoesNotImportGameSession) throw new Error('Homepage eagerly imports the game scene/session');
writeFileSync('artifacts/beta/bundle-stats.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ initialUiBytes: result.initialUi.bytes, homePreviewBytes: result.homeWithTrueCharacterPreview.bytes, allJavaScriptBytes: result.allJavaScript.bytes, noHomeGameSession: result.homeDoesNotImportGameSession }));
