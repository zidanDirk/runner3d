/** Versioned design inputs. These defaults reproduce Task11, pending measured tuning. */
export interface DifficultyConfig {
  readonly version: 1;
  readonly speed: { readonly initial: number; readonly maximum: number; readonly perMeter: number };
  readonly track: { readonly rowSpacing: number; readonly firstRow: number; readonly lookAhead: number; readonly recycleBehind: number };
  readonly obstacles: { readonly blockedLanes: number; readonly recoveryEvery: number; readonly weights: { readonly hurdle: number; readonly gate: number; readonly block: number } };
  readonly coins: { readonly trailCount: number; readonly trailStart: number; readonly trailSpacing: number; readonly introCount: number; readonly introStart: number; readonly introSpacing: number };
  readonly powerups: { readonly rowProbability: number; readonly firstDistance: number };
  readonly fairness: { readonly reactionSeconds: number; readonly inputLatencySeconds: number; readonly decisionTicks: number; readonly maxSearchNodes: number; readonly maxAttempts: number };
  readonly telegraph: { readonly minimumSpeed: number; readonly lookAhead: number; readonly minimumLeadDistance: number; readonly maxRows: number };
  readonly stages: readonly { readonly id: string; readonly name: string; readonly startDistance: number }[];
}

const defaults: DifficultyConfig = {
  version: 1,
  speed: { initial: 16, maximum: 24, perMeter: .004 },
  track: { rowSpacing: 26, firstRow: 48, lookAhead: 170, recycleBehind: 12 },
  obstacles: { blockedLanes: 2, recoveryEvery: 5, weights: { hurdle: 1, gate: 1, block: 1 } },
  coins: { trailCount: 4, trailStart: -9, trailSpacing: 4, introCount: 6, introStart: 10, introSpacing: 4 },
  powerups: { rowProbability: .18, firstDistance: 180 },
  fairness: { reactionSeconds: .35, inputLatencySeconds: .08, decisionTicks: 6, maxSearchNodes: 4096, maxAttempts: 1 },
  telegraph: { minimumSpeed: 20, lookAhead: 50, minimumLeadDistance: 4, maxRows: 2 },
  stages: [
    { id: 'beginner', name: '适应', startDistance: 0 },
    { id: 'easy', name: '基础', startDistance: 250 },
    { id: 'medium', name: '进阶', startDistance: 600 },
    { id: 'hard', name: '挑战', startDistance: 1200 },
    { id: 'expert', name: '高速', startDistance: 2000 },
  ],
};
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function keys(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) throw new Error('Unknown/missing difficulty fields');
}
function range(value: unknown, min: number, max: number, integer = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error('Difficulty value outside supported range');
}
export function validateDifficultyConfig(value: unknown): asserts value is DifficultyConfig {
  keys(value, ['version', 'speed', 'track', 'obstacles', 'coins', 'powerups', 'fairness', 'telegraph', 'stages']);
  if (value.version !== 1) throw new Error('Unsupported difficulty version');
  keys(value.speed, ['initial', 'maximum', 'perMeter']);
  range(value.speed.initial, 8, 24); range(value.speed.maximum, value.speed.initial, 24); range(value.speed.perMeter, .0001, .02);
  keys(value.track, ['rowSpacing', 'firstRow', 'lookAhead', 'recycleBehind']);
  range(value.track.rowSpacing, 24, 40); range(value.track.firstRow, 40, 80);
  range(value.track.lookAhead, 150, 180); range(value.track.recycleBehind, 10, 16);
  keys(value.obstacles, ['blockedLanes', 'recoveryEvery', 'weights']);
  range(value.obstacles.blockedLanes, 1, 2, true); range(value.obstacles.recoveryEvery, 2, 8, true);
  keys(value.obstacles.weights, ['hurdle', 'gate', 'block']);
  for (const weight of Object.values(value.obstacles.weights)) range(weight, .01, 100);
  keys(value.coins, ['trailCount', 'trailStart', 'trailSpacing', 'introCount', 'introStart', 'introSpacing']);
  range(value.coins.trailCount, 1, 4, true); range(value.coins.trailStart, -10, -8); range(value.coins.trailSpacing, 3, 4);
  range(value.coins.introCount, 0, 6, true); range(value.coins.introStart, 8, 12); range(value.coins.introSpacing, 3, 4);
  if (value.coins.trailStart + (value.coins.trailCount - 1) * value.coins.trailSpacing > 4
    || value.coins.introStart + (value.coins.introCount - 1) * value.coins.introSpacing > value.track.firstRow - 12) throw new Error('Coin trail overlaps the next decision');
  keys(value.powerups, ['rowProbability', 'firstDistance']); range(value.powerups.rowProbability, 0, .5); range(value.powerups.firstDistance, 100, 1000);
  keys(value.fairness, ['reactionSeconds', 'inputLatencySeconds', 'decisionTicks', 'maxSearchNodes', 'maxAttempts']);
  range(value.fairness.reactionSeconds, 0, .6); range(value.fairness.inputLatencySeconds, 0, .15);
  range(value.fairness.decisionTicks, 1, 12, true); range(value.fairness.maxSearchNodes, 32, 16384, true); range(value.fairness.maxAttempts, 1, 4, true);
  if ((value.fairness.reactionSeconds + value.fairness.inputLatencySeconds + .36 + .1) * value.speed.maximum > value.track.rowSpacing - 2) throw new Error('Spacing cannot support the configured reaction and two lane changes');
  keys(value.telegraph, ['minimumSpeed', 'lookAhead', 'minimumLeadDistance', 'maxRows']);
  range(value.telegraph.minimumSpeed, value.speed.initial, value.speed.maximum); range(value.telegraph.lookAhead, 30, 60);
  range(value.telegraph.minimumLeadDistance, 0, 10); range(value.telegraph.maxRows, 1, 2, true);
  if (Math.floor((value.telegraph.lookAhead - value.telegraph.minimumLeadDistance) / value.track.rowSpacing) + 1 > value.telegraph.maxRows) throw new Error('Telegraph must have room for every approaching row');
  if (!Array.isArray(value.stages) || value.stages.length < 2 || value.stages.length > 8) throw new Error('Difficulty stages need2..8 ordered anchors');
  const ids = new Set<string>(); let previous = -1;
  for (const stage of value.stages) {
    keys(stage, ['id', 'name', 'startDistance']);
    if (typeof stage.id !== 'string' || !/^[a-z][a-z-]*$/.test(stage.id) || ids.has(stage.id) || typeof stage.name !== 'string' || stage.name.length < 1 || stage.name.length > 20) throw new Error('Invalid stage identity');
    range(stage.startDistance, 0, 10000);
    if (stage.startDistance <= previous || (previous === -1 && stage.startDistance !== 0)) throw new Error('Stages must start at zero and increase');
    previous = stage.startDistance; ids.add(stage.id);
  }
}
function freeze<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) if (child !== null && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}
validateDifficultyConfig(defaults);
export const DIFFICULTY_CONFIG = freeze(defaults);
export function speedAtDistance(distance: number, config: DifficultyConfig = DIFFICULTY_CONFIG): number {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('Distance must be finite and nonnegative');
  return Math.min(config.speed.maximum, config.speed.initial + distance * config.speed.perMeter);
}
export function getDifficulty(distance: number, config: DifficultyConfig = DIFFICULTY_CONFIG) {
  const speed = speedAtDistance(distance, config);
  let stage = config.stages[0];
  for (const item of config.stages) if (item.startDistance <= distance) stage = item;
  if (!stage) throw new Error('Missing difficulty stage');
  const obstacleRowProbability = 1 - 1 / config.obstacles.recoveryEvery;
  const obstaclesPerMeter = config.obstacles.blockedLanes * obstacleRowProbability / config.track.rowSpacing;
  return { stage, speed, obstacleRowProbability, obstaclesPerMeter, rowsPerSecond: speed / config.track.rowSpacing,
    powerupProbability: config.powerups.rowProbability,
    // Explicit internal index: temporal obstacle pressure relative to the opening, not a psychological measure.
    difficultyScore: speed / config.speed.initial * 100 };
}
