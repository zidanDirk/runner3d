import { DIFFICULTY_CONFIG } from '../game/difficulty';
import { previewHazards } from '../game/telegraph';
import { game, useGame } from '../runtime/store';

/** Optional visual telegraph for compact screens. Uses the existing HUD cadence;
 * symbols describe actual obstacle types and do not prescribe automatic actions. */
export function HazardPreview() {
  const snapshot = useGame();
  if (snapshot.status !== 'running' || snapshot.speed < DIFFICULTY_CONFIG.telegraph.minimumSpeed) return null;
  const rows = previewHazards(game.view);
  if (!rows.length) return null;
  return <aside className="hazard-preview" aria-label="前方路况预警" data-testid="hazard-preview">
    <header>前方路况 <small>{DIFFICULTY_CONFIG.telegraph.lookAhead}m</small></header>
    <ol>{rows.map(row => <li key={row.id} data-testid="hazard-row" data-row-id={row.id} data-distance={row.distance}>
      <span className="hazard-distance">{Math.ceil(row.ahead)}<small>m</small></span>
      <span className="hazard-lanes">{row.lanes.map(lane => <span className={`hazard-glyph ${lane.kind ?? 'clear'}`} key={lane.lane} data-lane={lane.lane} data-kind={lane.kind ?? 'clear'} aria-label={`${lane.lane === 0 ? '左' : lane.lane === 1 ? '中' : '右'}轨：${lane.label}`}>{lane.glyph}</span>)}</span>
    </li>)}</ol>
    <small className="hazard-legend">↑低栏 ↓高架 ■箱墙 ·空</small>
  </aside>;
}
