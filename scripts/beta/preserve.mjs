import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const paths=[];
for (const root of ['src/game','src/city','src/progression','public/models/generated']) for (const name of await readdir(root)) if (!name.includes('.')) continue; else paths.push(`${root}/${name}`);
paths.push('src/assets/generated/manifest.json');
const files={};for(const path of paths){ const content=await readFile(path); files[path]=createHash('sha256').update(content).digest('hex'); }
await writeFile('artifacts/beta/preserved-before.json',JSON.stringify(files,null,2));
