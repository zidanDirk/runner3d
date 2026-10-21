import { lazy, Suspense, useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { startLoop } from '../runtime/store';
import { attachCity, syncCity } from '../runtime/city';
import { attachAssetLoading, loading as assets, useLoading } from '../assets/loading';
import { attachKeyboard } from '../runtime/keyboard';
import { attachGestureInput } from '../runtime/input';
import { feedback } from '../runtime/feedback';

const GameScene = lazy(() => import('../scene/GameScene').then(module => ({ default: module.GameScene })));
export interface CaptureDriver { isFrozen(): boolean; driveFrame(): void; dispose(): void }

/** Loaded only after leaving the home preview. No second simulation or WebGL canvas. */
export function GameSession({ children, capture, onReady }: { children: ReactNode; capture: RefObject<CaptureDriver | null>; onReady: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const ready = useLoading().ready;
  useEffect(() => {
    const loading = attachAssetLoading();
    const city = attachCity();
    const stop = startLoop(seconds => { capture.current?.driveFrame(); syncCity(); if (!capture.current?.isFrozen()) feedback.advancePost(seconds); }, () => !capture.current?.isFrozen());
    const keyboard = attachKeyboard();
    const gestures = stage.current ? attachGestureInput(stage.current) : () => {};
    return () => { stop(); keyboard(); gestures(); city(); loading(); assets.setRendererReady(false); };
  }, [capture]);
  useEffect(() => { if (ready) onReady(); }, [ready, onReady]);
  return <div ref={stage} className="game-stage"><Suspense fallback={null}><GameScene /></Suspense>{children}</div>;
}
