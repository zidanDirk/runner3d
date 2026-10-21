import { useEffect, useRef, useState } from 'react';
import { game, useGame } from '../runtime/store';
import { profile, useProfile } from '../runtime/profile';
import { claimMission, purchaseUpgrade, useProgressNotice, useProgressFact } from '../runtime/progression';
import { ECONOMY_BALANCE, getMissionViews, UPGRADE_TYPES } from '../progression';
import { POWERUP_BALANCE, POWERUP_TYPES } from '../game/balance';
import type { PowerUpType } from '../game/balance';
import { useFeedbackUI } from '../runtime/feedback';
import { input } from '../runtime/input';

export const POWERUP_NAMES = { magnet: '磁铁', shield: '护盾', 'double-score': '双倍得分' };
const marks = { magnet: '∩', shield: '◇', 'double-score': '2×' };
const format = (value: number) => Math.floor(value).toLocaleString('en-US');
function effect(type: PowerUpType, level: number): string {
  const duration = POWERUP_BALANCE.durations[type][level];
  return type === 'magnet' ? `${duration} 秒 · ${POWERUP_BALANCE.magnetRadius[level]} 米范围` : type === 'shield' ? `${duration} 秒 · 抵挡 1 次碰撞` : `${duration} 秒 · 新增得分 2×`;
}
export function CareerNotice() {
  const state = useGame(); const fact = useProgressFact();
  const visible = state.status === 'running' && fact.run === game.runId && fact.kind === 'mission-completed' && game.view.tick - fact.tick < 360;
  return visible ? <div className="career-notice" role="status" aria-label="任务完成提示">{fact.message}</div> : null;
}
export function PowerUpHUD() {
  const { powerups, status } = useGame();
  const notice = useFeedbackUI().notice;
  const active = status === 'over' || status === 'ready' ? [] : POWERUP_TYPES.filter(type => powerups[type] > 0);
  if (!active.length) return <span className="sr-only" role="status">{notice}</span>;
  return <div className="powerup-hud" aria-label="生效道具">
    {active.map(type => <div className={`powerup-timer ${type}`} key={type} data-testid={`active-${type}`}><b aria-hidden="true">{marks[type]}</b><span>{POWERUP_NAMES[type]}<strong>{Math.ceil(powerups[type])}s</strong></span></div>)}
    <span className="sr-only" role="status">{notice}</span>
  </div>;
}
export function ProgressionMenu({ onOpen }: { onOpen?: (panel: 'shop' | 'missions') => void } = {}) {
  const state = useGame(); const player = useProfile();
  const [panel, setPanel] = useState<'shop' | 'missions' | null>(null);
  const available = getMissionViews(player).filter(m => m.unlocked && m.completed && !m.claimed).length;
  return <div className="progression-menu" data-input-ui>
    {state.status === 'over' && <p className="settlement" data-testid="settlement">{game.isPreview ? '预览局 · 不记入钱包与成长' : <>本局金币 <b>+{format(profile.lastSettlement?.walletAdded ?? 0)}</b> · 道具 {state.powerupsCollected} 次{state.scoreBonus > 0 && <span> · 加成 +{format(state.scoreBonus)} 分</span>}</>}</p>}
    <div className="progression-links"><span>钱包 <b data-testid="wallet">{format(player.walletCoins)}</b></span><button type="button" onClick={() => { input.clear(); if (onOpen) onOpen('shop'); else setPanel('shop'); }}>升级商店</button><button type="button" onClick={() => { input.clear(); if (onOpen) onOpen('missions'); else setPanel('missions'); }}>任务{available > 0 && <i aria-label={`${available}项待领取`}>{available}</i>}</button></div>
    {panel && <ProgressionDialog panel={panel} close={() => setPanel(null)} />}
  </div>;
}
export function ProgressionDialog({ panel, close, returnLabel = '返回游戏' }: { panel: 'shop' | 'missions'; close: () => void; returnLabel?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const player = useProfile(); const notice = useProgressNotice();
  const purchased = useRef(new Set<PowerUpType>());
  useEffect(() => { const element = dialog.current; input.clear(); game.pause(); element?.showModal(); return () => element?.close(); }, []);
  const title = panel === 'shop' ? '升级商店' : '成长任务';
  const missions = getMissionViews(player);
  return <dialog ref={dialog} className="progression-panel product-dialog" aria-label={title} onCancel={(event) => { event.preventDefault(); close(); }}>
    <header><div><small>KEEP MOVING / {panel === 'shop' ? 'UPGRADES' : 'MISSIONS'}</small><h2>{title}</h2></div><button className="dialog-close" type="button" aria-label="关闭成长面板" onClick={close}>×</button></header>
    <p className="panel-wallet">钱包 <strong data-testid="panel-wallet">{format(player.walletCoins)}</strong><span> 金币</span></p>
    <p className="panel-hint">{panel === 'shop' ? '升级永久保留，下一局开始时生效。' : '跨局累计，不因领取或重新开始清零。'}</p>
    {panel === 'shop' && UPGRADE_TYPES.every(type => player.upgrades[type] === 3) && <p className="product-empty" role="status">当前升级已全部完成。带上这些积累，继续向前。</p>}
    {panel === 'missions' && missions.every(mission => mission.claimed) && <p className="product-empty" role="status">当前任务已全部完成。已领取奖励保留在钱包中。</p>}
    {panel === 'shop' ? <div className="upgrade-list">{UPGRADE_TYPES.map(type => {
      const level = player.upgrades[type], price = level < 3 ? ECONOMY_BALANCE.upgradePrices[level as 0 | 1 | 2] : undefined;
      return <section className={`upgrade-row ${type}`} key={type} aria-label={`${POWERUP_NAMES[type]}升级`}>
        <span className="powerup-mark" aria-hidden="true">{marks[type]}</span><div><h3>{POWERUP_NAMES[type]} <small>Lv.{level} / 3</small></h3><p>当前：{effect(type, level)}</p><p>{level < 3 ? `下一级：${effect(type, level + 1)}` : '已达到最高等级'}</p>
        <button type="button" disabled={price === undefined || player.walletCoins < price || purchased.current.has(type)} onClick={() => { if (purchaseUpgrade(type, level)) purchased.current.add(type); }} aria-label={`升级${POWERUP_NAMES[type]}`}>{purchased.current.has(type) ? '升级成功 · 下次再升级' : price === undefined ? '已满级' : `${price} 金币 · ${player.walletCoins < price ? '金币不足' : '升级'}`}</button></div>
      </section>;
    })}</div> : <div className="mission-list">{(['coins', 'distance', 'powerups'] as const).map(kind => {
      const chain = missions.filter(m => m.kind === kind); const mission = chain.find(m => !m.claimed) ?? chain[chain.length - 1];
      if (!mission) return null;
      const label = kind === 'coins' ? '累计收集金币' : kind === 'distance' ? '累计奔跑距离' : '累计拾取道具';
      return <section className="mission-row" key={kind} aria-label={label}><div><h3>{label} <small>阶段 {mission.tier} / 3</small></h3><strong data-testid={`mission-${kind}`}>{format(mission.progress)} / {format(mission.target)}{kind === 'distance' ? ' m' : ''}</strong></div><progress value={mission.progress} max={mission.target} /><footer><span>奖励 {mission.reward} 金币</span><button type="button" disabled={!mission.unlocked || !mission.completed || mission.claimed} onClick={() => claimMission(mission.id)} aria-label={`领取${label}奖励`}>{mission.claimed ? '全部完成' : mission.completed ? '领取奖励' : '继续奔跑'}</button></footer></section>;
    })}</div>}
    <p className="progress-notice" role="status">{notice || '每一步，都算数。'}</p>
    {(profile.persistenceFailed || profile.recovered) && <p className="profile-warning">{profile.persistenceFailed ? '当前进度仅保留在本页，存储暂时不可用。' : '已安全恢复存档，可继续奔跑。'}</p>}
    <button className="primary-button" type="button" onClick={close}>{returnLabel}</button>
  </dialog>;
}
