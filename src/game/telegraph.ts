import { RULES } from './config';
import { DIFFICULTY_CONFIG } from './difficulty';
import type { GameView, Lane, ObstacleKind } from './types';

export interface HazardPreviewConfig {
  readonly minimumSpeed: number;
  readonly lookAhead: number;
  readonly minimumLeadDistance: number;
  readonly maxRows: number;
}
export type HazardGlyph = '↑' | '↓' | '■' | '·';
export interface HazardLane {
  readonly lane: Lane;
  readonly kind: ObstacleKind | null;
  readonly glyph: HazardGlyph;
  readonly label: string;
}
export interface HazardPreviewRow {
  readonly id: number;
  readonly distance: number;
  readonly ahead: number;
  readonly lanes: readonly HazardLane[];
}
const GLYPHS: Readonly<Record<ObstacleKind, HazardGlyph>> = { hurdle: '↑', gate: '↓', block: '■' };
const LABELS: Readonly<Record<ObstacleKind, string>> = { hurdle: '低栏', gate: '高架', block: '箱墙' };

export function validateHazardPreviewConfig(value: unknown): asserts value is HazardPreviewConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'lookAhead,maxRows,minimumLeadDistance,minimumSpeed'
    || !('minimumSpeed' in value) || !('lookAhead' in value) || !('minimumLeadDistance' in value) || !('maxRows' in value)) throw new Error('Unknown or missing telegraph configuration');
  if (typeof value.minimumSpeed !== 'number' || !Number.isFinite(value.minimumSpeed) || value.minimumSpeed <= 0 || value.minimumSpeed > RULES.maxSpeed
    || typeof value.lookAhead !== 'number' || !Number.isFinite(value.lookAhead) || value.lookAhead <= 0 || value.lookAhead > RULES.lookAhead
    || typeof value.minimumLeadDistance !== 'number' || !Number.isFinite(value.minimumLeadDistance) || value.minimumLeadDistance < 0 || value.minimumLeadDistance >= value.lookAhead
    || typeof value.maxRows !== 'number' || !Number.isInteger(value.maxRows) || value.maxRows < 1 || value.maxRows > 2) throw new Error('Invalid bounded telegraph configuration');
}

/** Read existing generated rows only. No PRNG, entity mutation, automatic input,
 * physics, collision or safeLane inference. Recovery rows do not consume slots. */
export function previewHazards(view: Pick<GameView, 'status' | 'speed' | 'distance' | 'rows'>, config: HazardPreviewConfig = DIFFICULTY_CONFIG.telegraph): readonly HazardPreviewRow[] {
  validateHazardPreviewConfig(config);
  if (!Number.isFinite(view.distance) || view.distance < 0 || !Number.isFinite(view.speed) || view.speed < 0) throw new Error('Invalid telegraph view');
  if (view.status !== 'running' || view.speed < config.minimumSpeed) return [];
  const candidates = view.rows.filter(row => {
    const ahead = row.distance - view.distance;
    return ahead >= config.minimumLeadDistance && ahead <= config.lookAhead && row.entities.some(entity => entity.kind !== 'coin');
  }).slice().sort((a, b) => a.distance - b.distance).slice(0, config.maxRows);
  return candidates.map(row => ({
    id: row.index, distance: row.distance, ahead: row.distance - view.distance,
    lanes: ([0, 1, 2] as const).map(lane => {
      const obstacle = row.entities.find(entity => entity.lane === lane && entity.kind !== 'coin');
      const kind = obstacle && obstacle.kind !== 'coin' ? obstacle.kind : null;
      return { lane, kind, glyph: kind ? GLYPHS[kind] : '·', label: kind ? LABELS[kind] : '无障碍' };
    }),
  }));
}
