import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Inspect the actual configuration without evaluating it or needing a dist build.
const source = ts.createSourceFile('playwright.release.config.ts', readFileSync('playwright.release.config.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const exported = source.statements.find(ts.isExportAssignment);
if (!exported || !ts.isCallExpression(exported.expression)) throw new Error('Release configuration export not found');
const config = exported.expression.arguments[0];
if (!config || !ts.isObjectLiteralExpression(config)) throw new Error('Release configuration must expose its settings');

function setting(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item)
    && (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) && item.name.text === name);
  return property?.initializer;
}

function jobBlock(workflow: string, job: string): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex(line => line === `  ${job}:`);
  if (start < 0) throw new Error(`Missing workflow job: ${job}`);
  const next = lines.findIndex((line, index) => index > start && /^  [\w-]+:/.test(line));
  return lines.slice(start, next < 0 ? undefined : next).join('\n');
}

function uploadPaths(job: string): string[] {
  const steps = job.split(/(?=^      - )/m).filter(step => /^      - /m.test(step));
  const result: string[] = [];
  for (const step of steps) {
    if (!/^\s+(?:- )?uses: actions\/upload-artifact@/m.test(step)) continue;
    // A success-only upload cannot preserve artifacts from a failed smoke run.
    if (!/^\s+if: .*\b(?:always|failure)\(\)/m.test(step)) continue;
    const lines = step.split('\n');
    const index = lines.findIndex(line => /^\s+path:/.test(line));
    if (index < 0) continue;
    const line = lines[index];
    if (!line) throw new Error('Upload path is missing');
    const indent = line.length - line.trimStart().length;
    const value = line.trim().slice('path:'.length).trim();
    const values = /^[|>][-+]?$/.test(value)
      ? lines.slice(index + 1).filter((_candidate, at, following) => following.slice(0, at + 1).every(item => !item.trim() || item.length - item.trimStart().length > indent)).map(item => item.trim())
      : [value];
    result.push(...values.filter(item => item && !item.startsWith('#')).map(item => item.replace(/^(['"])(.*)\1$/, '$2')));
  }
  return result;
}

function globMatches(pattern: string, file: string): boolean {
  const normalized = posix.normalize(pattern).replace(/\/$/, '');
  if (!/[?*]/.test(normalized)) return file === normalized || file.startsWith(normalized + '/');
  let expression = '';
  for (let index = 0; index < normalized.length; index++) {
    const character = normalized[index];
    if (character === '*' && normalized[index + 1] === '*') {
      index++;
      if (normalized[index + 1] === '/') { expression += '(?:.*/)?'; index++; }
      else expression += '.*';
    } else if (character === '*') expression += '[^/]*';
    else if (character === '?') expression += '[^/]';
    else expression += character?.replace(/[\\^$+?.()|{}[\]]/g, '\\$&') ?? '';
  }
  return new RegExp(`^${expression}$`).test(file);
}

describe('Release Gate retains production smoke failure evidence', () => {
  it('archives the configured smoke screenshots, failure context and trace from the same job', () => {
    const output = setting(config, 'outputDir');
    if (!output || !ts.isStringLiteral(output)) throw new Error('Release outputDir must be an inspectable path');
    const directory = posix.normalize(output.text);
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const paths = uploadPaths(jobBlock(workflow, 'release-gate'));
    // These are representative Playwright failure filenames, rooted in the real
    // outputDir. A different job's glob must never count as coverage here.
    for (const filename of ['test-failed-1.png', 'error-context.md', 'trace.zip']) {
      const file = posix.join(directory, 'smoke-case', filename);
      const included = paths.some(pattern => !pattern.startsWith('!') && globMatches(pattern, file));
      const excluded = paths.some(pattern => pattern.startsWith('!') && globMatches(pattern.slice(1), file));
      expect(included && !excluded, `${file} is not retained by a failure-capable release-gate upload; paths: ${paths.join(', ')}`).toBe(true);
    }
  });

  it('records a retained-on-failure trace in the actual Release browser configuration', () => {
    const use = setting(config, 'use');
    if (!use || !ts.isObjectLiteralExpression(use)) throw new Error('Release browser configuration not found');
    const trace = setting(use, 'trace');
    expect(trace && ts.isStringLiteral(trace) ? trace.text : undefined).toBe('retain-on-failure');
  });
});
