import { releaseInfo } from '../release/info';
import { Monitor } from './Monitor';
import { browserCategory } from './schema';
export const browser = browserCategory(typeof navigator === 'undefined' ? '' : navigator.userAgent);
export const monitor = new Monitor(releaseInfo);
monitor.setContext({ browser, device: typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop', quality: 'unknown', gameState: 'home' });
export function attachGlobalMonitoring(): () => void {
  const error = (event: ErrorEvent): void => monitor.error('JS_UNCAUGHT', { error: event.error });
  const rejection = (event: PromiseRejectionEvent): void => monitor.error('PROMISE_REJECTION', { error: event.reason });
  window.addEventListener('error', error); window.addEventListener('unhandledrejection', rejection);
  monitor.timing('pageInitializedMs', performance.now());
  const loaded = (): void => monitor.timing('pageLoadedMs', performance.now());
  if (document.readyState === 'complete') loaded(); else window.addEventListener('load', loaded, { once: true });
  return () => { window.removeEventListener('error', error); window.removeEventListener('unhandledrejection', rejection); window.removeEventListener('load', loaded); };
}
