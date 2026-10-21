import { ANIMATION_NAMES, ANIMATION_STATES } from '../character/animationConfig';
import type { AnimationState } from '../character/animationConfig';
import type { PreviewPlayback } from '../character/AnimatedCharacter';

export function clipDurations(asset: unknown): Record<AnimationState, number> {
  const result = { idle: 0, run: 0, jump: 0, slide: 0 };
  if (!asset || typeof asset !== 'object' || !('animationClips' in asset) || !Array.isArray(asset.animationClips)) return result;
  for (const clip of asset.animationClips) {
    if (!clip || typeof clip !== 'object' || !('name' in clip) || !('duration' in clip) || typeof clip.duration !== 'number') continue;
    for (const state of ANIMATION_STATES) if (clip.name === ANIMATION_NAMES[state]) result[state] = clip.duration;
  }
  return result;
}

export function AnimationPreviewControls({ value, durations, actualTime, footSoles, pelvisY, onChange }: {
  value: PreviewPlayback; durations: Readonly<Record<AnimationState, number>>; actualTime?: number;
  footSoles?: { left: number[]; right: number[] }; pelvisY?: number;
  onChange: (value: PreviewPlayback) => void;
}) {
  const duration = durations[value.state];
  const seek = (seconds: number) => onChange({ ...value, seconds, playing: false, revision: value.revision + 1 });
  return <section className="animation-preview-controls" aria-label="动画预览控制">
    <div role="group" aria-label="角色动作">{ANIMATION_STATES.map((state) => <button type="button" key={state} aria-pressed={value.state === state} onClick={() => onChange({ ...value, state, seconds: 0, revision: value.revision + 1 })}>{ANIMATION_NAMES[state]}</button>)}</div>
    <div className="animation-playback-row">
      <button type="button" onClick={() => onChange({ ...value, playing: !value.playing })}>{value.playing ? '暂停动画' : '播放动画'}</button>
      <button type="button" onClick={() => onChange({ ...value, seconds: 0, playing: true, revision: value.revision + 1 })}>重新播放</button>
      <button type="button" onClick={() => seek(Math.min(duration, (actualTime ?? value.seconds) + 1 / 60))}>单步 +1/60秒</button>
      <label>播放速度<select aria-label="动画播放速度" value={value.speed} onChange={(event) => onChange({ ...value, speed: Number(event.target.value) })}>{[.5, 1, 1.5, 2].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}</select></label>
      <label><input type="checkbox" checked={value.showSkeleton} onChange={(event) => onChange({ ...value, showSkeleton: event.target.checked })} />显示骨骼</label>
    </div>
    <label className="animation-time-row">动画时间（秒）<input aria-label="动画时间（秒）" type="range" min={0} max={duration} step={.001} value={value.playing ? Math.min(duration, actualTime ?? value.seconds) : value.seconds} onChange={(event) => seek(Number(event.target.value))} /><output data-testid="animation-time">{(actualTime ?? value.seconds).toFixed(3)} / {duration.toFixed(3)} s</output></label>
    <p>固定时间会暂停在指定姿态。骨骼来自实际 GLB，角色根部保持原地。</p>
    <p data-testid="preview-motion-data">{value.state} · 进度 {(((actualTime ?? value.seconds) / duration) * 100).toFixed(1)}% · 骨盆Y {pelvisY?.toFixed(3) ?? '—'}m · 鞋底Y 左 {footSoles?.left[1]?.toFixed(4) ?? '—'} / 右 {footSoles?.right[1]?.toFixed(4) ?? '—'}m</p>
  </section>;
}
