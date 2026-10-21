import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing');
const appRoot = createRoot(root);
const params = new URLSearchParams(window.location.search);
if (import.meta.env.DEV && params.has('effectPreview')) {
  const Preview = lazy(() => import('./effects/EffectPreview').then((module) => ({ default: module.EffectPreview })));
  appRoot.render(<StrictMode><Suspense fallback={<p>正在打开反馈预览…</p>}><Preview /></Suspense></StrictMode>);
} else if (import.meta.env.DEV && (params.get('assetPreview') === '1' || params.has('themePreview') || params.has('characterPreview'))) {
  const Preview = lazy(() => import('./assets/AssetPreview').then((module) => ({ default: () => <module.AssetPreview themeId={params.get('themePreview') ?? undefined} characterId={params.get('characterPreview') ?? undefined} showJoints={params.get('showJoints') === '1'} showSkeleton={params.get('showSkeleton') === '1'} animation={params.get('animation') ?? undefined} animationTime={params.get('animationTime') ?? undefined} /> })));
  appRoot.render(<StrictMode><Suspense fallback={<p>正在打开资产工厂…</p>}><Preview /></Suspense></StrictMode>);
} else {
  appRoot.render(<StrictMode><App /></StrictMode>);
}
