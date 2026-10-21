import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { addAfterEffect, Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei/core/PerspectiveCamera.js';
import { EffectManager } from './EffectManager';
import { effectPalette } from './theme';
import type { FeedbackEvent, FeedbackKind } from '../feedback/types';
import { FeedbackEffects } from '../scene/FeedbackEffects';
import { feedback, useAudioSettings } from '../runtime/feedback';
import './effect-preview.css';

const kinds = ['coin', 'jump', 'land', 'slide', 'lane', 'collision', 'game-over', 'speed'] as const;
const labels: Record<FeedbackKind, string> = { coin: '金币', jump: '起跳', land: '落地', slide: '滑铲', lane: '换道', collision: '碰撞', 'game-over': '结束', speed: '速度', 'powerup-collected': '拾取道具', 'powerup-activated': '道具生效', 'powerup-expired': '道具到期', 'shield-broken': '护盾破碎', 'upgrade-purchased': '购买升级', 'mission-completed': '任务完成', 'mission-reward-claimed': '领取奖励' };
export function previewEvent(type: FeedbackKind): FeedbackEvent {
  const base = { id: `preview:${type}`, runId: 0, tick: 0, time: 0, distance: 0, position: [0, type === 'coin' ? 1.075 : type === 'collision' ? .8 : .05, 0] as const, intensity: 1 };
  switch (type) {
    case 'coin': return { ...base, type, total: 1, entityId: 'preview' };
    case 'slide': return { ...base, type, duration: .75 };
    case 'lane': return { ...base, type, duration: .18, direction: -1 };
    case 'collision': return { ...base, type, obstacle: 'hurdle' };
    case 'speed': return { ...base, type, speed: 22 };
    case 'powerup-collected': case 'powerup-activated': case 'powerup-expired': case 'shield-broken': return { ...base, type, powerup: 'shield', entityId: 'preview' };
    default: return { ...base, type };
  }
}

function PreviewScene({ manager, playing, kind, seed, reduced, neon, timeRef }: { manager: EffectManager; playing: boolean; kind: FeedbackKind; seed: string; reduced: boolean; neon: boolean; timeRef: { current: number } }) {
  const { gl } = useThree();
  useFrame((_, dt) => {
    if (playing && timeRef.current < 2) {
      const step = Math.min(.05, dt, 2 - timeRef.current); timeRef.current += step;
      manager.advance(step, 0, { x: 0, y: 0, slideRemaining: kind === 'slide' ? Math.max(0, .75 - timeRef.current) : 0 }, kind === 'speed' ? 24 : 16, reduced, effectPalette(neon ? 780 : 95));
    }
  }, -3);
  useEffect(() => addAfterEffect(() => {
    if (import.meta.env.MODE === 'e2e') window.__EFFECT_PREVIEW__ = { particles: manager.particles.count, capacity: manager.particles.capacity, time: timeRef.current, seed, kind, calls: gl.info.render.calls, triangles: gl.info.render.triangles };
  }), [manager, gl, timeRef, seed, kind]);
  return <>
    <PerspectiveCamera makeDefault fov={44} position={[2.8, 2.6, 5]} onUpdate={(camera) => camera.lookAt(0, .6, 0)} />
    <color attach="background" args={[neon ? '#171c37' : '#233747']} />
    <gridHelper args={[12, 12, '#566675', '#344957']} position={[0, -.005, 0]} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.012, 0]}><planeGeometry args={[20, 20]} /><meshBasicMaterial color={neon ? '#20304b' : '#344655'} /></mesh>
    <FeedbackEffects manager={manager} preview />
  </>;
}

/** DEV-only isolated feedback stage: never mounts the game loop or edits its state. */
export function EffectPreview() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const raw = params.get('effectPreview') === 'landing' ? 'land' : params.get('effectPreview');
  const valid = kinds.some((kind) => kind === raw);
  const initial = valid ? raw as FeedbackKind : 'coin';
  const initialTime = Number(params.get('effectTime') ?? '.12');
  const invalid = !valid || !Number.isFinite(initialTime) || initialTime < 0 || initialTime > 2;
  const [kind, setKind] = useState<FeedbackKind>(initial);
  const [neon, setNeon] = useState(params.get('theme') === 'neon-city');
  const [reduced, setReduced] = useState(params.get('reducedMotion') === '1');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(invalid ? .12 : initialTime);
  const timeRef = useRef(time);
  const audition = useRef(0);
  const seed = params.get('effectSeed') ?? 'FEEL-PREVIEW-01';
  const manager = useMemo(() => new EffectManager(seed), [seed]);
  const audio = useAudioSettings();
  useEffect(() => {
    const hidden = () => { if (document.hidden) feedback.audio.setPaused(true); };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); feedback.audio.reset(); feedback.audio.setPaused(true); };
  }, []);
  const sample = (target: number): void => {
    timeRef.current = target; manager.reset(seed);
    const palette = effectPalette(neon ? 780 : 95); manager.handle(previewEvent(kind), palette, reduced);
    for (let t = 0; t < target - 1e-9; t += 1 / 120) {
      const dt = Math.min(1 / 120, target - t);
      manager.advance(dt, 0, { x: 0, y: 0, slideRemaining: kind === 'slide' ? Math.max(0, .75 - t - dt) : 0 }, kind === 'speed' ? 24 : 16, reduced, palette);
    }
  };
  useEffect(() => { sample(time); }, [kind, neon, reduced, manager, time]);
  if (invalid) return <p role="alert">特效预览参数无效：选择已注册特效，时间范围为0～2秒。</p>;
  return <main className="effect-preview"><header><a href="./">← 返回跑道</a><h1>Game Feel · 独立预览</h1><p>固定种子 {seed} · 不运行游戏物理</p></header>
    <div className="effect-preview-stage"><Canvas dpr={1}><Suspense fallback={null}><PreviewScene manager={manager} playing={playing} kind={kind} seed={seed} reduced={reduced} neon={neon} timeRef={timeRef} /></Suspense></Canvas></div>
    <div className="effect-preview-controls">
      <label>特效 <select value={kind} onChange={(event) => { setPlaying(false); setKind(event.target.value as FeedbackKind); }}>{kinds.map((key) => <option value={key} key={key}>{labels[key]}</option>)}</select></label>
      <button type="button" onClick={() => { if (!playing) sample(time); else setTime(timeRef.current); setPlaying(!playing); }}>{playing ? '暂停特效' : '播放特效'}</button>
      <button type="button" onClick={() => { setPlaying(false); setTime(Math.min(2, timeRef.current + 1 / 60)); }}>单步 +1/60秒</button>
      <button type="button" onClick={() => { setPlaying(false); setTime(0); sample(0); }}>重播特效</button>
      <label>固定时间 <input aria-label="特效固定时间" type="range" min="0" max="2" step=".008333333333" value={time} onChange={(event) => { setPlaying(false); setTime(Number(event.target.value)); }} /></label>
      <label><input type="checkbox" checked={neon} onChange={(event) => setNeon(event.target.checked)} />Neon</label>
      <label><input type="checkbox" checked={reduced} onChange={(event) => setReduced(event.target.checked)} />减少动态效果</label>
      <button type="button" onClick={() => { const tick = ++audition.current; void feedback.audio.unlock().then(() => feedback.audio.handle({ ...previewEvent(kind), tick, time: manager.time, id: `preview-audio:${tick}` }, effectPalette(neon ? 780 : 95))); }}>试听音效</button>
      <span>声音：{audio.status}</span>
    </div>
  </main>;
}
