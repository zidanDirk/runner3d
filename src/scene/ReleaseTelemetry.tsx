import { useEffect } from 'react';
import { addAfterEffect, useThree } from '@react-three/fiber';
import { MobileFrameWindow } from '../runtime/mobile-metrics';
import { monitor } from '../observability/client';
import { game } from '../runtime/store';
import { city } from '../runtime/city';
import { feedback } from '../runtime/feedback';
/** One bounded completed-frame window, aggregated once per5s. No scene traversal. */
export function ReleaseTelemetry() {
  const { gl } = useThree();
  useEffect(() => {
    const window = new MobileFrameWindow(); let next = 0;
    return addAfterEffect(() => {
      if (document.hidden || game.view.status !== 'running' || gl.getContext().isContextLost()) { window.reset(); return; }
      const now = performance.now(); window.record(now);
      if (now < next) return; next = now + 5000;
      const frames = window.read();
      monitor.sample({ samples: frames.samples, fps: frames.samples ? frames.fps : null, averageFrameMs: frames.samples ? frames.meanMs : null,
        p95FrameMs: frames.samples ? frames.p95Ms : null, longFrames: frames.over50Ms,
        calls: gl.info.render.calls, triangles: gl.info.render.triangles, chunks: city.snapshot.chunks.length,
        particles: feedback.effects.stats().particles, dpr: gl.getPixelRatio(), gpuBytes: null });
    });
  }, [gl]);
  return null;
}
