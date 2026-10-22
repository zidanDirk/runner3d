import { useSyncExternalStore } from 'react';
import { monitor } from '../observability/client';
import { input } from './input';
import { game } from './store';
import { profile, publishProfile } from './profile';
import type { UpgradeLevel, UpgradeType } from '../progression';
import { feedback } from './feedback';
import type { FeedbackEvent } from '../feedback/types';

let notice = '';
let serial = 0;
let noticeFact = { message: '', tick: 0, run: -1, kind: '' };
export const useProgressFact = () => useSyncExternalStore(subscribe, () => noticeFact, () => noticeFact);
let previewDepth = 0;
let previewRun = -1;
/** Explicit developer positioning never earns a wallet or career progress. */
export function withPreviewProgression<T>(operation: () => T): T {
  previewDepth++; const finish = game.beginPreview();
  try { return operation(); } finally { finish(); previewDepth--; }
}
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useProgressNotice = () => useSyncExternalStore(subscribe, () => notice, () => notice);
const names = { magnet: '磁铁', shield: '护盾', 'double-score': '双倍得分' };
function events(trustedTransaction = false): void {
  for (const event of profile.drainEvents()) {
    if (event.type === 'UPGRADE_PURCHASED') monitor.track(event.type, `${event.upgrade}:${event.level}`, { upgrade: event.upgrade, level: event.level });
    else monitor.track(event.type, event.missionId, { mission: event.missionId });
    const type = event.type === 'MISSION_COMPLETED' ? 'mission-completed' : event.type === 'MISSION_REWARD_CLAIMED' ? 'mission-reward-claimed' : 'upgrade-purchased';
    notice = event.type === 'UPGRADE_PURCHASED' ? `${names[event.upgrade]}升级成功 · Lv.${event.level} · 下一局生效` : event.type === 'MISSION_COMPLETED' ? '任务已完成 · 结束后领取奖励' : `已领取任务奖励 +${event.reward} 金币`;
    const view = game.view;
    noticeFact = { message: notice, tick: view.tick, run: game.runId, kind: type };
    const fact: FeedbackEvent = { type, id: `progress:${game.runId}:${++serial}`, runId: feedback.runId, tick: view.tick, time: view.tick / 120, distance: view.distance, position: [view.player.x, 1.2, 0], intensity: .8 };
    if (trustedTransaction && !input.isBlocked && !document.hidden) {
      const currentRun = game.runId;
      void feedback.audio.unlock().then(() => { if (input.isBlocked || document.hidden) { feedback.audio.setPaused(true); return; } if (currentRun === game.runId) feedback.handle(fact); });
    } else feedback.handle(fact);
    for (const listener of listeners) listener();
  }
  publishProfile();
}
export function purchaseUpgrade(type: UpgradeType, level: UpgradeLevel): boolean {
  if (game.view.status === 'running') return false;
  const result = profile.purchase(type, level); events(result.ok); return result.ok;
}
export function claimMission(id: string): boolean {
  if (game.view.status === 'running') return false;
  const result = profile.claim(id); events(result.ok); return result.ok;
}
export function attachProgression(): () => void {
  const observe = game.observe(view => {
    if (previewDepth) previewRun = game.runId;
    if (previewRun === game.runId) return;
    profile.observeRun({ id: `run-${game.runId}`, tick: view.tick, distance: view.distance, coins: view.coins, score: view.score, powerupsCollected: view.powerupsCollected, status: view.status });
    if (profile.hasEvents || view.powerupFacts.length || view.status !== 'running') events();
  });
  // Profile snapshots are published at the game's existing HUD cadence, not every fixed tick.
  const publish = game.subscribe(publishProfile);
  const checkpoint = () => { profile.flush(); publishProfile(); };
  window.addEventListener('pagehide', checkpoint);
  const hidden = () => { if (document.hidden) checkpoint(); };
  document.addEventListener('visibilitychange', hidden);
  return () => { observe(); publish(); checkpoint(); window.removeEventListener('pagehide', checkpoint); document.removeEventListener('visibilitychange', hidden); };
}
