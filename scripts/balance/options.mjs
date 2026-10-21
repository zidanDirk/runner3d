const PROFILES = ['beginner', 'casual', 'expert', 'all'];
const MODES = ['baseline', 'proposed'];
export function parseOptions(argv) {
  const result = { command: 'simulate', seed: 'Runner3D-balance-v1', runs: 1000, profile: 'all', distance: 5000, output: 'artifacts/balance', variant: 'proposed', comparisons: 60, careers: 3, careerRuns: 100 };
  const known = { seed: 'string', runs: 'integer', profile: 'string', distance: 'number', output: 'string', variant: 'string', comparisons: 'integer', careers: 'integer', 'career-runs': 'integer' };
  if (argv[0] && !argv[0].startsWith('--')) result.command = argv.shift();
  if (!['analyze', 'simulate', 'report'].includes(result.command)) throw new Error('Command must be analyze, simulate or report');
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!match || !Object.hasOwn(known, match[1]) || seen.has(match[1])) throw new Error(`Unknown or duplicate argument: ${argv[i]}`);
    const key = match[1]; seen.add(key);
    const raw = match[2] ?? argv[++i];
    if (raw === undefined || raw.startsWith('--') || raw.length === 0) throw new Error(`Missing value for --${key}`);
    const name = key === 'career-runs' ? 'careerRuns' : key;
    result[name] = known[key] === 'string' ? raw : Number(raw);
    if (known[key] !== 'string' && (!Number.isFinite(result[name]) || result[name] <= 0 || (known[key] === 'integer' && !Number.isInteger(result[name])))) throw new Error(`Invalid --${key}`);
  }
  if (!PROFILES.includes(result.profile)) throw new Error('Profile must be beginner, casual, expert or all');
  if (!MODES.includes(result.variant)) throw new Error('Variant must be baseline or proposed');
  if (result.seed.length > 100 || result.runs > 100000 || result.distance < 48 || result.distance > 100000 || result.comparisons > 10000 || result.careers > 100 || result.careerRuns > 1000) throw new Error('Simulation option exceeds supported limits');
  return result;
}
