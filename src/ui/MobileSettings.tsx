import { useEffect, useRef, useState } from 'react';
import { game } from '../runtime/store';
import { input, inputPreferences, useInputMode } from '../runtime/input';
import { quality, useQuality } from '../runtime/quality';
import { isQualityMode } from '../quality/profiles';
import { feedback, useAudioSettings } from '../runtime/feedback';
import { motionPreferences, useReducedMotion } from '../runtime/motion-preferences';

export function SettingsButton({ mobile = false, onOpen }: { mobile?: boolean; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  return <><button className={mobile ? 'mobile-settings-button' : 'settings-entry'} type="button" aria-label={mobile ? '游戏设置' : '更多游戏设置'} onClick={() => { input.clear(); game.pause(); if (onOpen) onOpen(); else setOpen(true); }}>⚙<span>设置</span></button>{open && <SettingsDialog close={() => setOpen(false)} />}</>;
}

export function SettingsDialog({ close, returnLabel = '完成设置' }: { close: () => void; returnLabel?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const q = useQuality(); const mode = useInputMode(); const audio = useAudioSettings(); const reduced = useReducedMotion();
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="settings-panel product-dialog" aria-labelledby="settings-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="settings-heading"><h2 id="settings-title">游戏设置</h2><button type="button" aria-label="关闭设置" onClick={close}>×</button></div>
    <p>调整后继续奔跑。各项设置独立保存。</p>
    <label>画质<select aria-label="画质" value={q.mode} onChange={(event) => { if (isQualityMode(event.target.value)) quality.setMode(event.target.value); }}><option value="auto">自动</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
    <small>当前：{q.level === 'high' ? '高' : q.level === 'medium' ? '中' : '低'} · 自动模式根据运行帧时间调整</small>
    <label>操作方式<select aria-label="操作方式" value={mode} onChange={(event) => { const value = event.target.value; if (value === 'both' || value === 'gestures' || value === 'buttons') inputPreferences.setMode(value); }}><option value="both">手势与按钮</option><option value="gestures">手势</option><option value="buttons">按钮</option></select></label>
    <small>左右划动换道，上划跳跃，下划滑铲。键盘始终可用。</small>
    <label className="setting-toggle"><input type="checkbox" aria-label="设置游戏音效" checked={!audio.muted} onChange={(event) => feedback.audio.setMuted(!event.target.checked)} />游戏音效</label>
    <label>音量<input aria-label="设置音效音量" type="range" min="0" max="100" value={Math.round(audio.volume * 100)} onChange={(event) => feedback.audio.setVolume(Number(event.target.value) / 100)} /><output>{Math.round(audio.volume * 100)}%</output></label>
    <small role="status">{audio.status === 'unsupported' ? '当前浏览器无法启动音频，游戏仍可继续。' : audio.status === 'blocked' ? '声音暂未启用；回到游戏后点击开始或继续可重试。' : '音量与静音设置即时生效。声音需要一次开始或继续操作。'}</small>
    <label className="setting-toggle"><input type="checkbox" aria-label="设置减少动态效果" checked={reduced} onChange={(event) => motionPreferences.set(event.target.checked)} />减少动态效果</label>
    <button className="settings-system" type="button" onClick={() => motionPreferences.set(null)}>动态效果跟随系统</button>
    <button className="primary-button" type="button" onClick={close}>{returnLabel}</button>
    <small>{game.view.status === 'paused' ? '关闭设置后仍保持暂停，请点击继续。' : '设置即时生效并独立保存。'}</small>
  </dialog>;
}
