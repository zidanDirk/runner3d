export const ERROR_MESSAGES = {
  JS_UNCAUGHT: '未捕获的脚本异常', PROMISE_REJECTION: '未处理的异步异常',
  GLB_LOAD: '模型加载失败', GLB_VALIDATION: '模型校验失败', GLB_TIMEOUT: '模型加载超时',
  WEBGL_INIT: '图形初始化失败', WEBGL_LOST: '图形连接丢失', WEBGL_RESTORE: '图形连接未能恢复',
  AUDIO_INIT: '音频初始化或播放失败', PROFILE_READ: '玩家存档读取异常', PROFILE_WRITE: '玩家存档写入异常',
  PROFILE_INVALID: '玩家存档格式异常', PROFILE_FUTURE: '存档来自更高版本', GAME_FATAL: '游戏无法继续',
  ADAPTER_FAILURE: '远程监控不可用', CACHE_FAILURE: '资源缓存不可用',
} as const;
export type ErrorCode = keyof typeof ERROR_MESSAGES;
export type BrowserCategory = 'chrome' | 'safari' | 'firefox' | 'edge' | 'other';
export interface TelemetryContext {
  readonly browser: BrowserCategory; readonly device: 'mobile' | 'desktop';
  readonly quality: 'high' | 'medium' | 'low' | 'unknown'; readonly gameState: 'home' | 'ready' | 'running' | 'paused' | 'over';
}
export function browserCategory(agent: string): BrowserCategory {
  return /Edg\//.test(agent) ? 'edge' : /Firefox\//.test(agent) ? 'firefox' : /Chrome\/|CriOS\//.test(agent) ? 'chrome' : /Safari\//.test(agent) ? 'safari' : 'other';
}
export const ANALYTICS_NAMES = ['APP_OPENED', 'GAME_READY', 'TUTORIAL_STARTED', 'TUTORIAL_COMPLETED', 'TUTORIAL_SKIPPED', 'RUN_STARTED', 'RUN_ENDED', 'RUN_RESTARTED', 'SHOP_OPENED', 'UPGRADE_PURCHASED', 'MISSION_COMPLETED', 'MISSION_REWARD_CLAIMED', 'RUN_PAUSED', 'RUN_RESUMED', 'PAGE_HIDDEN', 'PAGE_VISIBLE', 'PAGE_ENDED'] as const;
export type AnalyticsName = typeof ANALYTICS_NAMES[number];
export interface AnalyticsData {
  readonly run?: number; readonly distanceMeters?: number; readonly distanceBand?: '0-99' | '100-499' | '500-999' | '1000-2999' | '3000+';
  readonly durationSeconds?: number; readonly coins?: number; readonly obstacle?: 'hurdle' | 'gate' | 'block' | 'unknown';
  readonly usedPowerup?: boolean; readonly upgrade?: 'magnet' | 'shield' | 'double-score'; readonly level?: number;
  readonly mission?: string;
}
/** Reject unknown fields rather than spreading user input or a profile into an event. */
export function validAnalytics(name: unknown, data: unknown): data is AnalyticsData {
  if (!ANALYTICS_NAMES.some(candidate => candidate === name) || !data || typeof data !== 'object' || Array.isArray(data)) return false;
  const fields = Object.entries(data);
  const allowed: Record<string, (v: unknown) => boolean> = {
    run: v => Number.isSafeInteger(v) && Number(v) >= 0,
    distanceMeters: v => Number.isSafeInteger(v) && Number(v) >= 0,
    distanceBand: v => ['0-99', '100-499', '500-999', '1000-2999', '3000+'].includes(typeof v === 'string' ? v : ''),
    durationSeconds: v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 86400,
    coins: v => Number.isSafeInteger(v) && Number(v) >= 0,
    obstacle: v => ['hurdle', 'gate', 'block', 'unknown'].includes(typeof v === 'string' ? v : ''), usedPowerup: v => typeof v === 'boolean',
    upgrade: v => ['magnet', 'shield', 'double-score'].includes(typeof v === 'string' ? v : ''), level: v => Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 3,
    mission: v => typeof v === 'string' && /^(coins|distance|powerups)-(1|2|3)$/.test(v),
  };
  if (!fields.every(([key, value]) => Object.hasOwn(allowed, key) && allowed[key]?.(value) === true)) return false;
  const keys: readonly string[] = name === 'RUN_ENDED' ? ['run', 'distanceMeters', 'distanceBand', 'durationSeconds', 'coins', 'obstacle', 'usedPowerup'] : name === 'UPGRADE_PURCHASED' ? ['upgrade', 'level'] : name === 'MISSION_COMPLETED' || name === 'MISSION_REWARD_CLAIMED' ? ['mission'] : String(name).startsWith('RUN_') ? ['run'] : [];
  return fields.length === keys.length && keys.every(key => Object.hasOwn(data, key));
}
export function distanceBand(distance: number): NonNullable<AnalyticsData['distanceBand']> {
  return distance < 100 ? '0-99' : distance < 500 ? '100-499' : distance < 1000 ? '500-999' : distance < 3000 ? '1000-2999' : '3000+';
}
/** Keep only generated bundle basenames and line/column. Never retain error text, URLs, queries or user values. */
export function safeStack(error: unknown): string | undefined {
  try {
    if (!(error instanceof Error) || typeof error.stack !== 'string') return undefined;
    const frames = error.stack.split('\n').slice(1, 9).flatMap(line => line.match(/\b(?:index|react|three|fiber|GameScene|GameSession|CharacterPreview|RendererResources|FeedbackPanel)-[A-Za-z0-9_-]{6,}\.js:\d+:\d+/g) ?? []);
    return frames.length ? frames.slice(0, 6).join('\n') : undefined;
  } catch { return undefined; }
}
