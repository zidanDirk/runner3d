import { describe, expect, it } from 'vitest';
import { DIFFICULTY_CONFIG } from '../../src/game/difficulty';
import { GameEngine } from '../../src/game/engine';
import { previewHazards, validateHazardPreviewConfig } from '../../src/game/telegraph';
import type { TrackRow } from '../../src/game/types';

const config = { minimumSpeed: 20, lookAhead: 50, minimumLeadDistance: 4, maxRows: 2 };
function row(index: number, distance: number): TrackRow {
  return { index, distance, safeLane: 0, entities: [
    { id: `${index}-coin`, kind: 'coin', lane: 1, distance: distance - 5, collected: false },
    { id: `${index}-hurdle`, kind: 'hurdle', lane: 0, distance, collected: false },
    { id: `${index}-gate`, kind: 'gate', lane: 2, distance, collected: false },
  ] };
}
function view(rows: TrackRow[]) { return { status: 'running', speed: 24, distance: 1000, rows } as const; }

describe('compact-screen obstacle telegraph is a bounded read-only rendering description', () => {
  it('uses centrally configured defaults and rejects unknown/missing/invalid fields', () => {
    expect(DIFFICULTY_CONFIG.telegraph).toEqual(config); expect(() => validateHazardPreviewConfig(config)).not.toThrow();
    const unknown = { ...config, automaticInput: true }; expect(() => validateHazardPreviewConfig(unknown)).toThrow();
    for (const missing of [null, [], {}, { minimumSpeed: 20, lookAhead: 50, maxRows: 2 }]) expect(() => validateHazardPreviewConfig(missing)).toThrow();
    for (const minimumSpeed of [0, -1, 25, NaN, Infinity]) expect(() => validateHazardPreviewConfig({ ...config, minimumSpeed })).toThrow();
    for (const lookAhead of [0, -1, 171, NaN, Infinity]) expect(() => validateHazardPreviewConfig({ ...config, lookAhead })).toThrow();
    for (const minimumLeadDistance of [-1, 50, NaN, Infinity]) expect(() => validateHazardPreviewConfig({ ...config, minimumLeadDistance })).toThrow();
    for (const maxRows of [0, 3, 1.5, NaN, Infinity]) expect(() => validateHazardPreviewConfig({ ...config, maxRows })).toThrow();
  });
  it('derives icons from actual obstacle entities even when safeLane metadata disagrees', () => {
    const result = previewHazards(view([row(0, 1030)]), config);
    expect(result[0]?.lanes.map(lane => lane.glyph)).toEqual(['↑', '·', '↓']);
    expect(result[0]?.lanes.map(lane => lane.kind)).toEqual(['hurdle', null, 'gate']);
    const block = row(1, 1040); block.entities.push({ id: 'block', kind: 'block', lane: 1, distance: 1040, collected: false });
    expect(previewHazards(view([block]), config)[0]?.lanes.map(lane => lane.glyph)).toEqual(['↑', '■', '↓']);
  });
  it('includes4m and50m boundaries, ignores behind/too-near/too-far and caps two nearest rows', () => {
    const result = previewHazards(view([row(0, 999), row(1, 1003.99), row(2, 1004), row(3, 1050), row(4, 1050.01)]), config);
    expect(result.map(item => item.ahead)).toEqual([4, 50]);
    expect(previewHazards(view([row(0, 1045), row(1, 1010), row(2, 1020)]), config).map(item => item.ahead)).toEqual([10, 20]);
  });
  it('does not use recovery/coin-only rows as obstacles or mutate input/state', () => {
    const recovery = { index: 4, distance: 1005, safeLane: 1, entities: [{ id: 'coin', lane: 1, kind: 'coin', distance: 1005, collected: false }] } as const;
    const state = { status: 'running', speed: 24, distance: 1000, rows: [recovery, row(5, 1020)] } as const;
    const before = JSON.stringify(state), result = previewHazards(state, config);
    expect(result.map(item => item.id)).toEqual([5]); expect(JSON.stringify(state)).toBe(before);
  });
  it('gates on running speed including exact20m/s boundary and excludes paused/over/ready', () => {
    const state = view([row(0, 1030)]);
    expect(previewHazards({ ...state, speed: 19.999 }, config)).toEqual([]);
    expect(previewHazards({ ...state, speed: 20 }, config)).toHaveLength(1);
    for (const status of ['ready', 'paused', 'over'] as const) expect(previewHazards({ ...state, status }, config)).toEqual([]);
    expect(() => previewHazards({ ...state, distance: NaN }, config)).toThrow();
  });
  it('reads the original engine without writing inputs, entities, score or clocks', () => {
    const engine = new GameEngine('RUNNER-01'); engine.start(); const before = JSON.stringify(engine.view);
    expect(previewHazards(engine.view)).toEqual([]); expect(JSON.stringify(engine.view)).toBe(before);
    const running = { ...engine.view, distance: 2400, speed: 24, rows: [row(90, 2430)] };
    expect(previewHazards(running)[0]?.ahead).toBe(30); expect(JSON.stringify(engine.view)).toBe(before);
  });
});
