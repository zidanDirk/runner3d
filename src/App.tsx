import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { GameUI } from './ui/GameUI';
import { game, useGame } from './runtime/store';
import { attachPageLifecycle } from './runtime/page-lifecycle';
import { attachQualityPreferences } from './runtime/quality';
import { attachMotionPreferences, useReducedMotion } from './runtime/motion-preferences';
import { attachFeedback, feedback } from './runtime/feedback';
import { attachProgression } from './runtime/progression';
import { input } from './runtime/input';
import { profile, useProfile } from './runtime/profile';
import { useGraphicsAvailable } from './runtime/graphics';
import { INITIAL_NAVIGATION, navigationReducer } from './product/navigation';
import { createRunResults } from './product/results';
import type { RunResults } from './product/results';
import type { ProductPanel } from './product/navigation';
import type { CaptureDriver } from './ui/GameSession';
import { HomeScreen, ProductDialog, Tutorial, CharacterPicker, RunSummary, RouteSeed } from './ui/ProductUI';
import { ProgressionDialog } from './ui/Progression';
import { SettingsDialog } from './ui/MobileSettings';
import './ui/product.css';

const GameSession = lazy(() => import('./ui/GameSession').then(module => ({ default: module.GameSession })));
const BalanceDebug = import.meta.env.DEV ? lazy(() => import('./ui/BalanceDebug').then(module => ({ default: module.BalanceDebug }))) : null;

export default function App() {
  const state = useGame();
  const player = useProfile();
  const reduced = useReducedMotion();
  const graphicsAvailable = useGraphicsAvailable();
  const [navigation, navigate] = useReducer(navigationReducer, INITIAL_NAVIGATION);
  const [launching, setLaunching] = useState(false);
  const [launchNotice, setLaunchNotice] = useState('');
  const pending = useRef(false);
  const capture = useRef<CaptureDriver | null>(null);
  const before = useRef(profile.snapshot);
  const [result, setResult] = useState<RunResults | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [seekState, setSeekState] = useState<'loading' | 'frozen' | 'running' | 'invalid'>('loading');
  const developerSeek = import.meta.env.DEV && new URLSearchParams(window.location.search).get('testMode') === '1';
  const visibleGame = launching || navigation.screen !== 'home' || state.status !== 'ready';

  useEffect(() => {
    const cleanup = [attachFeedback(), attachProgression(), attachMotionPreferences(), attachPageLifecycle(), attachQualityPreferences()];
    const cancelPending = () => {
      if (!pending.current) return;
      pending.current = false; setLaunching(false);
      game.prepare(game.view.seed);
      setLaunchNotice('准备期间页面已离开，本局尚未开始。点击开始奔跑即可重新出发。');
    };
    const hidden = () => { if (document.hidden) cancelPending(); };
    window.addEventListener('blur', cancelPending);
    document.addEventListener('visibilitychange', hidden);
    let active = true;
    if (import.meta.env.MODE === 'e2e' || developerSeek) void import('./runtime/capture').then(({ installCaptureHooks }) => {
      if (!active) return;
      capture.current = installCaptureHooks();
      if (developerSeek) {
        const distance = Number(new URLSearchParams(window.location.search).get('distance') ?? '590');
        if (!Number.isFinite(distance) || distance < 0 || distance > 10000) { setSeekState('invalid'); return; }
        window.__RUNNER_TEST__?.captureAt('RUNNER-01', distance);
        setSeekState('frozen');
      }
    });
    return () => { active = false; capture.current?.dispose(); capture.current = null; window.removeEventListener('blur', cancelPending); document.removeEventListener('visibilitychange', hidden); cleanup.reverse().forEach(stop => stop()); };
  }, [developerSeek]);
  useEffect(() => {
    navigate({ type: 'sync-game', status: state.status });
    if (state.status === 'over' && !game.isPreview && profile.lastSettlement?.runId === 'run-' + game.runId) {
      setResult(previous => previous?.runId === profile.lastSettlement?.runId ? previous : createRunResults(before.current, profile.lastSettlement, profile.snapshot));
    }
  }, [state.status, state.seed, player]);
  useEffect(() => {
    input.setMenuBlocked(navigation.panel !== null || !visibleGame);
    input.setBlocked(!graphicsAvailable);
    return () => input.clear();
  }, [navigation.panel, visibleGame, graphicsAvailable]);
  const open = (panel: Exclude<ProductPanel, 'quit-confirm'>) => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.clear();
    game.pause();
    navigate({ type: 'sync-game', status: game.view.status });
    navigate({ type: 'open-panel', panel });
  };
  const close = () => {
    navigate({ type: 'close-panel' });
    requestAnimationFrame(() => { if (previousFocus.current?.isConnected) previousFocus.current.focus(); });
  };
  const launch = () => {
    if (pending.current || game.view.status === 'running') return;
    input.clear();
    void feedback.audio.unlock();
    setLaunchNotice('');
    before.current = profile.snapshot;
    setResult(null);
    if (game.view.status !== 'ready') game.prepare(game.view.seed);
    pending.current = true;
    setLaunching(true);
  };
  const ready = useCallback(() => {
    if (!pending.current || document.hidden) return;
    pending.current = false;
    setLaunching(false);
    input.setBlocked(false);
    game.start();
  }, []);
  const restart = () => {
    if (game.view.status !== 'paused' && game.view.status !== 'over') return;
    before.current = profile.snapshot;
    setResult(null);
    input.clear(); input.setBlocked(false);
    game.restart();
  };
  const home = () => {
    input.clear();
    if (game.view.status === 'running' || game.view.status === 'paused') {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      game.pause();
      navigate({ type: 'sync-game', status: 'paused' });
      navigate({ type: 'request-home' });
    } else {
      pending.current = false; setLaunching(false);
      feedback.audio.setPaused(true);
      game.prepare(game.view.seed);
      navigate({ type: 'sync-game', status: 'ready' });
    }
  };
  const confirmQuit = () => {
    if (navigation.panel !== 'quit-confirm') return;
    input.clear(); feedback.audio.setPaused(true);
    // Retires this run without fabricating death or awarding unfinished coins.
    navigate({ type: 'confirm-quit' });
    game.prepare(game.view.seed);
    setResult(null);
  };
  const returnLabel = navigation.screen === 'home' ? '返回首页' : navigation.screen === 'results' ? '返回结算' : '返回游戏';
  return <div className="app-shell product-shell" data-screen={navigation.screen} data-panel={navigation.panel ?? 'none'} data-reduced-motion={reduced}>
    {BalanceDebug && new URLSearchParams(window.location.search).get('debugBalance') === '1' && <Suspense fallback={null}><BalanceDebug /></Suspense>}
    <header className="site-header">
      <a className="brand" href="./" aria-label="Runner3D 首页" onClick={event => { event.preventDefault(); home(); }}><span className="brand-mark" aria-hidden="true">↗</span><span>runner<span className="brand-3d">3D</span><span className="brand-dot">.</span></span></a>
      <div className="header-right"><span className="live-dot" />一路向前<span className="version-badge">URBAN RUNNER</span></div>
    </header>
    <main className={visibleGame ? 'main-layout' : 'product-main'}>
      <section className="game-column" aria-label={visibleGame ? '跑酷游戏' : '游戏首页'}>
        <div className="section-heading"><div><div className="eyebrow">THE ENDLESS RUN</div><h1>三条跑道，一路向前<span>。</span></h1></div><span className="mode-label"><span />无尽模式</span></div>
        {!visibleGame && launchNotice && <p className="launch-notice" role="status">{launchNotice}</p>}
        {!visibleGame && developerSeek && seekState === 'invalid' && <p className="launch-notice" role="alert">开发定位演示 · 距离无效（0～10000m）</p>}
        {visibleGame ? <Suspense fallback={<div className="session-loading" role="status">正在准备跑道…<button type="button" onClick={home}>返回首页</button></div>}><GameSession capture={capture} onReady={ready}><GameUI onOpen={open} onHome={home} onRestart={restart} results={<RunSummary result={result} />} />{developerSeek && <div className="developer-seek-label">开发定位演示 · {seekState === 'invalid' ? '距离无效（0～10000m）' : <button type="button" onClick={() => { capture.current && window.__RUNNER_TEST__?.freeze(seekState === 'running'); setSeekState(seekState === 'running' ? 'frozen' : 'running'); }}>{seekState === 'frozen' ? '继续演示' : '冻结画面'}</button>}</div>}{launching && <button className="cancel-loading" type="button" onClick={home}>返回首页</button>}</GameSession></Suspense> : <HomeScreen onStart={launch} onOpen={open} showPreview={navigation.panel === null} />}
        <div className="stage-caption"><span><span className="caption-dot" />保持节奏，下一枚金币就在前方。</span><span>每一次出发，都是新纪录 ↗</span></div>
      </section>
      {visibleGame && <aside className="session-sidebar" aria-label="跑酷指南"><p className="eyebrow">FIND YOUR RHYTHM</p><h2>下一步，由你决定。</h2><p>跑者自动前进。提前看清前路，保持节奏。</p><dl><div><dt>⇆ 换道</dt><dd>A / D · ← / →</dd></div><div><dt>↑ 跳跃</dt><dd>Space</dd></div><div><dt>↓ 滑铲</dt><dd>S · ↓</dd></div><div><dt>Ⅱ 暂停</dt><dd>Esc</dd></div></dl><button type="button" onClick={() => open('tutorial')}>查看引导</button><button type="button" aria-label="更多游戏设置" onClick={() => open('settings')}>游戏设置</button><RouteSeed /></aside>}
    </main>
    {!visibleGame && <RouteSeed />}
    <footer className="site-footer"><span>RUNNER3D <span className="footer-divider">/</span> BUILT TO KEEP MOVING</span><span>没有终点，只有更远。</span><span className="footer-index">01 — ∞</span></footer>
    {navigation.panel === 'shop' || navigation.panel === 'missions' ? <ProgressionDialog panel={navigation.panel} close={close} returnLabel={returnLabel} /> : navigation.panel === 'settings' ? <SettingsDialog close={close} /> : navigation.panel === 'character' ? <ProductDialog title="角色外观" label="关闭角色" close={close} className="character-dialog"><CharacterPicker close={close} /></ProductDialog> : navigation.panel === 'tutorial' ? <ProductDialog title="新手引导" label="关闭引导" close={close}><Tutorial close={close} /></ProductDialog> : navigation.panel === 'quit-confirm' ? <ProductDialog title="离开本局？" label="取消退出" close={close} className="quit-dialog"><p>本局收集的金币不会进入钱包。</p><p className="panel-hint">已发生的累计任务进度与历史纪录会保留。返回首页不会按游戏结束结算。</p><div className="dialog-actions"><button className="secondary-button" type="button" onClick={close}>留在暂停页</button><button className="primary-button" type="button" onClick={confirmQuit}>确认退出</button></div></ProductDialog> : null}
  </div>;
}
