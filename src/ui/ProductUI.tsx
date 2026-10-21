import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { profile, useProfile } from '../runtime/profile';
import { game, useGame } from '../runtime/store';
import { productPreferences, useProductPreferences } from '../runtime/product-preferences';
import { getMissionViews } from '../progression';
import type { ProductPanel } from '../product/navigation';
import type { RunResults } from '../product/results';
import { CHARACTER_SKINS, getCharacterSkin } from '../character/appearance';
import { useInputMode } from '../runtime/input';
import { Icon } from './icons';

const CharacterPreview = lazy(() => import('./CharacterPreview').then(module => ({ default: module.CharacterPreview })));
export const format = (value: number) => Math.floor(value).toLocaleString('en-US');
export type OpenPanel = (panel: Exclude<ProductPanel, 'quit-confirm'>) => void;

export function PersistenceNotice() {
  useProfile(); useProductPreferences();
  return <>{(profile.persistenceFailed || profile.recovered || productPreferences.persistenceFailed || productPreferences.recovered) && <p className="product-storage" role="status">{profile.persistenceFailed || productPreferences.persistenceFailed ? '存储暂不可用，当前进度仅保留在本页。请勿关闭页面。' : '已安全恢复本地存档，可以继续出发。'}</p>}</>;
}

export function HomeScreen({ onStart, onOpen, showPreview }: { onStart: () => void; onOpen: OpenPanel; showPreview: boolean }) {
  const player = useProfile(); const prefs = useProductPreferences();
  const missions = getMissionViews(player).filter(m => m.unlocked && m.completed && !m.claimed).length;
  return <section className="home-screen" aria-label="Runner3D 首页">
    <div className="home-copy">
      <div className="home-kicker"><span /> THREE LANES. YOUR NEXT BEST.</div>
      <h2>一路<span>向前。</span></h2>
      <p className="home-intro">城市没有终点。<br />下一次出发，去更远。</p>
      <button className="primary-button home-start" type="button" data-audio-unlock onClick={onStart}>开始奔跑 <Icon name="arrow-right" /></button>
      <div className="home-records" aria-label="生涯纪录"><div><span>最高分</span><strong>{format(Math.max(player.bestScore, game.getSnapshot().best))}<small>PTS</small></strong></div><div><span>最远距离</span><strong>{format(player.bestDistance)}<small>m</small></strong></div></div>
      <nav className="home-nav" aria-label="首页功能"><button type="button" aria-label="角色外观" onClick={() => onOpen('character')}><span>01</span><b>角色外观</b><small>3 款免费配色</small><span>↗</span></button><button type="button" aria-label="升级商店" onClick={() => onOpen('shop')}><span>02</span><b>升级商店</b><small>永久升级</small><span>↗</span></button><button type="button" aria-label="任务" onClick={() => onOpen('missions')}><span>03</span><b>任务</b><small>{missions ? missions + ' 项可领取' : '每一步都算数'}</small><span>↗</span></button><button type="button" aria-label="游戏设置" onClick={() => onOpen('settings')}><span>04</span><b>设置</b><small>声音 · 画质 · 操作</small><span>↗</span></button></nav>
    </div>
    <div className="home-showcase"><div className="showcase-lines" aria-hidden="true"><span>01</span><i /><span>03</span></div><span className="showcase-caption">MEET YOUR RUNNER</span>{showPreview ? <Suspense fallback={<div className="preview-loading" role="status">正在打开角色预览…</div>}><CharacterPreview interactive={false} /></Suspense> : <div className="preview-placeholder" aria-hidden="true" />}<div className="home-character-label"><span>City Runner</span><strong>{getCharacterSkin(prefs.skinId).label}</strong><button type="button" onClick={() => onOpen('character')}>更换外观 ↗</button></div></div>
    <div className="home-bottom"><div className="home-wallet"><Icon name="coin" size={22} /><span>钱包</span><strong data-testid="wallet">{format(player.walletCoins)}</strong><small>金币</small></div><div className="onboarding-prompt">{prefs.tutorial === 'unseen' && <span className="first-visit">初次上路？</span>}<button type="button" onClick={() => onOpen('tutorial')}>查看引导</button>{prefs.tutorial === 'unseen' && <button className="quiet-link" type="button" onClick={() => productPreferences.setTutorial('skipped')}>跳过引导</button>}</div></div>
    <PersistenceNotice />
  </section>;
}

export function ProductDialog({ title, label, close, children, className = '' }: { title: string; label: string; close: () => void; children: ReactNode; className?: string }) {
  const element = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = element.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={element} className={'product-dialog ' + className} aria-label={title} onCancel={event => { event.preventDefault(); close(); }}><header><div><small>RUNNER3D / KEEP MOVING</small><h2>{title}</h2></div><button className="dialog-close" type="button" aria-label={label} onClick={close}>×</button></header>{children}</dialog>;
}

const tutorial = [
  { title: '掌握节奏', text: '跑者自动前进，你来决定下一步。', desktop: ['A / D 或 ← / → 换道', 'Space 跳跃', 'S / ↓ 滑铲'], mobile: ['左右划动换道', '上划跳跃', '下划滑铲，也可点屏幕按钮'], marks: ['⇆', '↑', '↓'] },
  { title: '看清前路', text: '提前观察，给下一次动作留出空间。', desktop: ['低栏：跳过去', '高架：滑过去', '箱墙：提前换道'], mobile: ['低栏：上划跳跃', '高架：下划滑铲', '箱墙：左右换道'], marks: ['↟', '↧', '⇆'] },
  { title: '带上收获', text: '收集金币与道具，把每一局变成积累。', desktop: ['金币：结束后进入钱包', '磁铁吸币 · 护盾抵挡一次', '双倍得分：新增分数 2×，金币不翻倍'], mobile: ['金币：结束后进入钱包', '磁铁吸币 · 护盾抵挡一次', '双倍得分：新增分数 2×，金币不翻倍'], marks: ['＋', '◇', '2×'] },
] as const;
export function Tutorial({ close }: { close: () => void }) {
  const [step, setStep] = useState(0); const heading = useRef<HTMLHeadingElement>(null);
  const mode = useInputMode(); const [compact, setCompact] = useState(() => matchMedia('(pointer: coarse), (max-width: 1100px)').matches);
  useEffect(() => { const mq = matchMedia('(pointer: coarse), (max-width: 1100px)'); const change = () => setCompact(mq.matches); mq.addEventListener('change', change); return () => mq.removeEventListener('change', change); }, []);
  useEffect(() => { if (step > 0) heading.current?.focus(); }, [step]);
  const current = tutorial[step] ?? tutorial[0];
  const lines = !compact ? current.desktop : mode !== 'buttons' ? current.mobile : step === 0 ? ['点击左移 / 右移按钮换道', '点击跳跃按钮', '点击滑铲按钮'] : step === 1 ? ['低栏：点击跳跃', '高架：点击滑铲', '箱墙：点击左移 / 右移'] : current.mobile;
  const finish = (skipped: boolean) => { productPreferences.setTutorial(skipped ? 'skipped' : 'done'); close(); };
  return <><p className="panel-hint">新手引导 · {step + 1} / 3 <span className="tutorial-dots" aria-hidden="true">{tutorial.map((_, i) => <i key={i} data-active={i <= step} />)}</span></p><h3 className="tutorial-title" ref={heading} tabIndex={-1}>{current.title}</h3><p>{current.text}</p><ol className="tutorial-steps">{lines.map((line, index) => <li key={line}><span aria-hidden="true">{current.marks[index]}</span>{line}</li>)}</ol><div className="dialog-actions">{step > 0 && <button className="secondary-button" type="button" onClick={() => setStep(step - 1)}>上一步</button>}<button className="primary-button" type="button" onClick={() => step === 2 ? finish(false) : setStep(step + 1)}>{step === 2 ? '完成引导' : '下一步'}<Icon name="arrow-right" size={18} /></button></div><button className="quiet-link" type="button" onClick={() => finish(true)}>跳过引导</button></>;
}

export function CharacterPicker({ close }: { close: () => void }) {
  const prefs = useProductPreferences(); const [selected, setSelected] = useState(prefs.skinId);
  return <><p className="panel-hint">一个 City Runner，三种免费服装配色。动作与能力完全相同。</p><div className="wardrobe"><Suspense fallback={<p role="status">正在打开 3D 预览…</p>}><CharacterPreview skinId={selected} /></Suspense><fieldset className="skin-options"><legend>选择外观</legend>{CHARACTER_SKINS.map(skin => <label className="skin-option" data-selected={selected === skin.id} key={skin.id}><input type="radio" name="character-skin" aria-label={skin.name} checked={selected === skin.id} onChange={() => setSelected(skin.id)} /><span className="skin-swatch" style={{ backgroundColor: skin.colors.jacket }} aria-hidden="true" /><span><strong>{skin.name}</strong><small>{skin.label} · 免费</small><span>{skin.description}</span></span></label>)}</fieldset></div><button className="primary-button" type="button" onClick={() => { productPreferences.setSkin(selected); close(); }}>确认外观 <Icon name="arrow-right" size={18} /></button><PersistenceNotice /></>;
}

export function RunSummary({ result }: { result: RunResults | null }) {
  const state = useGame();
  if (!result) return <><div className="result-line"><div><span>本次得分</span><strong>{format(state.score)}</strong></div><div><span>奔跑距离</span><strong>{format(state.distance)} m</strong></div></div>{game.isPreview && <p className="summary-note">预览局 · 不记入钱包与成长</p>}</>;
  const progress = result.missions.filter(m => m.unlocked && !m.claimed && m.delta > 0);
  return <div className="run-summary" data-testid="run-summary">
    {(result.records.score || result.records.distance) && <p className="record-badge" data-testid="record-badge">↗ 新纪录 · {result.records.score ? '得分' : ''}{result.records.score && result.records.distance ? ' / ' : ''}{result.records.distance ? '最远距离' : ''}</p>}
    <div className="result-line"><div><span>本次得分</span><strong>{format(result.score)}</strong></div><div><span>奔跑距离</span><strong data-testid="run-distance">{format(result.distance)}<small> m</small></strong></div></div>
    <div className="result-reward"><span>收集金币 <b>{format(result.runCoins)}</b></span><span>钱包入账 <strong data-testid="run-wallet-added">+{format(result.walletAdded)}</strong></span></div>
    <p className="summary-note">{result.claimableMissionCount ? '已有任务可领取奖励。' : progress.length ? '本局任务进度：' + progress.slice(0, 2).map(m => (m.kind === 'distance' ? '距离 +' : m.kind === 'coins' ? '金币 +' : '道具 +') + format(m.delta)).join(' · ') : '每一次出发，都在积累。'}{result.affordableUpgradeCount > 0 ? ' 钱包已可购买升级。' : result.allUpgradesMaxed ? ' 当前升级已全部完成。' : ''}</p>
  </div>;
}

export function RouteSeed() {
  const { seed, status } = useGame(); const [draft, setDraft] = useState(seed);
  useEffect(() => setDraft(seed), [seed]);
  const apply = (event: FormEvent) => { event.preventDefault(); if (status === 'ready' || status === 'over') game.prepare(draft); };
  return <details className="route-details"><summary>专属路线 · SEED</summary><form onSubmit={apply}><label htmlFor="route-seed">路线 Seed</label><div className="seed-input-row"><input id="route-seed" maxLength={40} spellCheck={false} value={draft} disabled={status === 'running' || status === 'paused'} onChange={e => setDraft(e.target.value)} /><button aria-label="应用路线" type="submit" disabled={draft.trim() === seed || status === 'running' || status === 'paused'}><Icon name="arrow-right" size={18} /></button></div><small>同一个编号，同一条赛道。</small></form></details>;
}
