import { useEffect, useState } from 'react';
import type { FormEvent, MouseEvent, ReactNode } from 'react';
import type { Action, ObstacleKind } from '../game/types';
import { game, useGame } from '../runtime/store';
import { PowerUpHUD, ProgressionMenu, CareerNotice } from './Progression';
import { Icon } from './icons';
import { motionPreferences, useReducedMotion } from '../runtime/motion-preferences';
import { feedback, useAudioSettings, useFeedbackUI } from '../runtime/feedback';
import { feedbackDOM } from '../runtime/feedback-dom';
import { input, useInputMode } from '../runtime/input';
import { useLoading } from '../assets/loading';
import { LoadingPanel } from './LoadingPanel';
import { SettingsButton } from './MobileSettings';
import { useGraphicsAvailable } from '../runtime/graphics';
import { HazardPreview } from './HazardPreview';

const obstacleNames: Record<ObstacleKind, string> = { hurdle: '低栏', gate: '高架', block: '箱墙' };
const formatted = (value: number): string => Math.floor(value).toLocaleString('en-US');

function activate(event: MouseEvent<HTMLButtonElement>, action: () => void): void {
  event.currentTarget.blur();
  action();
}

export function GameUI({ onOpen, onHome, onRestart, results }: { onOpen?: (panel: 'shop' | 'missions' | 'settings' | 'tutorial') => void; onHome?: () => void; onRestart?: () => void; results?: ReactNode } = {}) {
  const state = useGame();
  const feel = useFeedbackUI();
  const reduced = useReducedMotion();
  const running = state.status === 'running';
  const mode = useInputMode();
  const loaded = useLoading().ready;
  const graphicsAvailable = useGraphicsAvailable();
  const sendAction = (event: MouseEvent<HTMLButtonElement>, action: Action): void => activate(event, () => { input.send(action, 'button'); });

  return <div className="game-overlay" data-status={state.status} data-reduced-motion={reduced} data-input-mode={mode}>
    <div className="impact-feedback" ref={(element) => { feedbackDOM.impact = element; }} aria-hidden="true" />
    <div className="game-hud" aria-label="游戏成绩">
      <div className="hud-distance">
        <span className="hud-label">奔跑距离 <span>DISTANCE</span></span>
        <div className="distance-value"><span data-testid="distance">{formatted(state.distance).padStart(3, '0')}</span><small>m</small></div>
      </div>
      <div className="hud-right">
        <SettingsButton mobile onOpen={onOpen ? () => onOpen('settings') : undefined} />
        <div className="hud-score"><span className="hud-label">得分</span><strong data-testid="score">{formatted(state.score).padStart(4, '0')}</strong></div>
        <div className="hud-coins" ref={(element) => { feedbackDOM.coins = element; }}><Icon name="coin" size={21} /><strong data-testid="coins">{formatted(state.coins)}</strong><span className="sr-only">枚金币</span></div>
        {(running || state.status === 'paused') && <button className="pause-button" disabled={!graphicsAvailable} data-audio-unlock={!running || undefined} type="button" aria-label={running ? '暂停游戏' : '继续游戏'} title={running ? '暂停 · Esc' : '继续 · Esc'} onClick={(event) => activate(event, game.togglePause)}><Icon name={running ? 'pause' : 'play'} size={19} /></button>}
      </div>
    </div>
    <PowerUpHUD /><CareerNotice /><HazardPreview />
    <div className="speed-feedback" ref={(element) => { feedbackDOM.speed = element; }} aria-live="polite">{feel.speed > 0 ? `节奏提升 · ${feel.speed} m/s` : ''}</div>

    <div className="game-state-announcement sr-only" role="status">{state.status === 'ready' ? '游戏已准备，点击开始奔跑。' : state.status === 'running' ? '正在奔跑。' : state.status === 'paused' ? '游戏已暂停。' : '游戏结束。'}</div>

    {state.status === 'ready' && <section className="run-menu ready-menu" aria-labelledby="ready-title">
      <p className="menu-eyebrow"><span /> THE ROAD IS YOURS</p>
      <h2 id="ready-title">三条跑道，<br />无限可能。</h2>
      <p className="menu-description">向前奔跑，越过障碍。<br />把下一次，变成最好的一次。</p>
      <button className="primary-button" disabled={!loaded || !graphicsAvailable} data-audio-unlock type="button" onClick={(event) => activate(event, game.start)}>开始奔跑 <Icon name="arrow-right" size={21} /></button>
      <p className="menu-footnote">无需下载 · 键盘或屏幕按钮操作</p>
      <ProgressionMenu onOpen={onOpen} />
    </section>}

    {state.status === 'paused' && <section className="run-menu pause-menu" aria-labelledby="pause-title">
      <p className="menu-eyebrow"><span /> TAKE A BREATHER</p>
      <h2 id="pause-title">稍作停留。</h2>
      <p className="menu-description">你的跑道就在这里。<br />准备好了，继续向前。</p>
      <button className="primary-button" disabled={!graphicsAvailable} data-audio-unlock type="button" onClick={(event) => activate(event, game.resume)}>继续奔跑 <Icon name="play" size={20} /></button>
      <button className="text-button" disabled={!graphicsAvailable} data-audio-unlock type="button" onClick={(event) => activate(event, onRestart ?? (() => game.restart()))}><Icon name="retry" size={15} /> 从头开始</button>
      <div className="pause-navigation"><button type="button" onClick={() => onOpen?.('settings')}>设置</button><button type="button" onClick={() => onOpen?.('tutorial')}>操作指南</button>{onHome && <button type="button" onClick={onHome}>返回首页</button>}</div>
      <ProgressionMenu onOpen={onOpen} />
    </section>}

    {state.status === 'over' && <section className="run-menu over-menu" aria-labelledby="over-title">
      <p className="menu-eyebrow"><span /> ONE MORE RUN?</p>
      <h2 id="over-title">每一步，都算数。</h2>
      <p className="menu-description">{state.hit ? `撞到了${obstacleNames[state.hit]}，这次跑到这里。` : '这次奔跑结束了。'}<br />同一条路线，再挑战一次。</p>
      {results ?? <div className="result-line"><div><span>本次得分</span><strong>{formatted(state.score)}</strong></div><div><span>最佳纪录</span><strong>{formatted(state.best)}</strong></div></div>}
      <button className="primary-button" disabled={!graphicsAvailable} data-audio-unlock type="button" onClick={(event) => activate(event, onRestart ?? (() => game.restart()))}>再跑一次 <Icon name="retry" size={20} /></button>
      {onHome && <button className="text-button" type="button" onClick={onHome}>返回首页</button>}
      <ProgressionMenu onOpen={onOpen} />
    </section>}

    <div className="scene-status" aria-hidden="true"><span className={running ? 'status-dot is-live' : 'status-dot'} />{state.status === 'ready' ? '准备出发' : state.status === 'paused' ? '已暂停' : state.status === 'over' ? '本次奔跑结束' : '保持节奏，向前奔跑'}<span className="scene-status-divider">/</span><span>{running ? `${state.speed.toFixed(1)} M/S` : 'ENDLESS RUNNER'}</span></div>

    <div className="screen-controls" aria-label="屏幕游戏操作">
      <div className="control-pair"><button type="button" className="screen-control" aria-label="向左换道" disabled={!running} onClick={(event) => sendAction(event, 'left')}><Icon name="arrow-left" /><span>左移</span><kbd>A</kbd></button><button type="button" className="screen-control" aria-label="向右换道" disabled={!running} onClick={(event) => sendAction(event, 'right')}><Icon name="arrow-right" /><span>右移</span><kbd>D</kbd></button></div>
      <div className="control-pair"><button type="button" className="screen-control" aria-label="跳跃" disabled={!running} onClick={(event) => sendAction(event, 'jump')}><Icon name="jump" /><span>跳跃</span><kbd>SPACE</kbd></button><button type="button" className="screen-control" aria-label="滑铲" disabled={!running} onClick={(event) => sendAction(event, 'slide')}><Icon name="slide" /><span>滑铲</span><kbd>S</kbd></button></div>
    </div>
    <div className="gesture-hint" aria-hidden="true">左右划动换道 · 上划跳跃 · 下划滑铲</div>
    <LoadingPanel />
  </div>;
}

export function Sidebar() {
  const audio = useAudioSettings();
  const reducedMotion = useReducedMotion();
  const { status, seed, best } = useGame();
  const [draftSeed, setDraftSeed] = useState(seed);
  const canPrepare = status === 'ready' || status === 'over';
  useEffect(() => { setDraftSeed(seed); }, [seed]);

  const prepare = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (canPrepare) {
      game.prepare(draftSeed);
      setDraftSeed(game.getSnapshot().seed);
    }
  };

  return <aside className="sidebar" aria-label="玩法指南与路线设置">
    <SettingsButton />
    <section className="guide-section controls-guide">
      <div className="sidebar-heading"><span className="section-number">01</span><h3>掌握节奏</h3><span className="sidebar-eyebrow">CONTROLS</span></div>
      <p className="sidebar-intro">跑者会自动前进，<br />你只需要决定下一步。</p>
      <dl className="controls-list">
        <div><dt><Icon name="arrow-right" size={17} /> 切换跑道</dt><dd><kbd>A</kbd><kbd>D</kbd><span className="key-alternative">/</span><kbd>←</kbd><kbd>→</kbd></dd></div>
        <div><dt><Icon name="jump" size={17} /> 向上跳跃</dt><dd><kbd className="wide-key">SPACE</kbd></dd></div>
        <div><dt><Icon name="slide" size={17} /> 低身滑铲</dt><dd><kbd>S</kbd><span className="key-alternative">/</span><kbd>↓</kbd></dd></div>
        <div><dt><Icon name="pause" size={17} /> 暂停休息</dt><dd><kbd className="wide-key">ESC</kbd></dd></div>
      </dl>
    </section>

    <section className="guide-section obstacle-guide">
      <div className="sidebar-heading"><span className="section-number">02</span><h3>看清前路</h3><span className="sidebar-eyebrow">THE OBSTACLES</span></div>
      <ul className="obstacle-list">
        <li><span className="obstacle-preview hurdle-preview" aria-hidden="true"><i /><i /><i /></span><div><strong>低栏 <span>HURDLE</span></strong><p>轻轻一跃，越过它。</p></div><Icon name="jump" size={18} /></li>
        <li><span className="obstacle-preview gate-preview" aria-hidden="true"><i /><i /><i /></span><div><strong>高架 <span>GATE</span></strong><p>放低重心，从下方滑过。</p></div><Icon name="slide" size={18} /></li>
        <li><span className="obstacle-preview block-preview" aria-hidden="true"><i /></span><div><strong>箱墙 <span>BLOCK</span></strong><p>提前换道，寻找空隙。</p></div><Icon name="arrow-right" size={18} /></li>
      </ul>
      <p className="coin-note"><span className="coin-token" aria-hidden="true">＋</span><span>每枚金币 <strong>+25</strong> 分，距离也计入得分。</span></p>
    </section>

    <section className="seed-section" aria-labelledby="seed-title">
      <div className="seed-heading"><Icon name="route" size={18} /><h3 id="seed-title">你的专属路线</h3><span>SEED</span></div>
      <p>同一个编号，同一条赛道。</p>
      <form onSubmit={prepare}>
        <label className="sr-only" htmlFor="route-seed">路线 Seed</label>
        <div className="seed-input-row"><input id="route-seed" value={draftSeed} maxLength={40} spellCheck={false} autoComplete="off" disabled={!canPrepare} onChange={(event) => setDraftSeed(event.target.value)} /><button type="submit" aria-label="应用路线" title="应用路线" disabled={!canPrepare || draftSeed.trim() === seed}><Icon name="arrow-right" size={19} /></button></div>
        <span className="seed-caption">{canPrepare ? '修改编号，探索一条新的路线。' : '结束本次奔跑后可更换路线。'}</span>
      </form>
    </section>
    <div className="motion-preference"><label><input type="checkbox" checked={reducedMotion} onChange={(event) => motionPreferences.set(event.target.checked)} />减少动态效果</label><p>固定视野，减弱身体倾斜和落地缓冲。</p><button type="button" onClick={() => motionPreferences.set(null)}>跟随系统设置</button></div>
    <div className="audio-preference">
      <label><input type="checkbox" checked={!audio.muted} onChange={(event) => { feedback.audio.setMuted(!event.target.checked); if (event.target.checked && game.view.status === 'running') void feedback.audio.unlock(); }} />游戏音效</label>
      <label className="audio-volume">音量 <input aria-label="音效音量" type="range" min="0" max="100" step="5" value={Math.round(audio.volume * 100)} onChange={(event) => feedback.audio.setVolume(Number(event.target.value) / 100)} /><output>{Math.round(audio.volume * 100)}%</output></label>
      <p>{audio.status === 'unsupported' ? '当前浏览器不支持音效。' : audio.enabled ? '短促轻快，让每一步都有回应。' : '点击开始或按键后启用声音。'}</p>
    </div>
    <div className="personal-best"><span>个人最佳 <small>PERSONAL BEST</small></span><strong>{formatted(best)}<small>PTS</small></strong></div>
  </aside>;
}
