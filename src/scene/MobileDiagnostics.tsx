import { useEffect } from 'react';
import { addAfterEffect, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector2, Vector3 } from 'three';
import { RULES } from '../game/config';
import { getThemeTransition } from '../city/zones';
import { city } from '../runtime/city';
import { feedback } from '../runtime/feedback';
import { clearMobileMetrics, debugMobileEnabled, MobileFrameWindow, publishMobileMetrics } from '../runtime/mobile-metrics';
import { quality } from '../runtime/quality';
import { game } from '../runtime/store';

function browserHeap(): { usedBytes: number; totalBytes: number; limitBytes: number } | null {
  if (!('memory' in performance) || !performance.memory || typeof performance.memory !== 'object') return null;
  const memory = performance.memory;
  if (!('usedJSHeapSize' in memory) || !('totalJSHeapSize' in memory) || !('jsHeapSizeLimit' in memory)) return null;
  const usedBytes = memory.usedJSHeapSize; const totalBytes = memory.totalJSHeapSize; const limitBytes = memory.jsHeapSizeLimit;
  return typeof usedBytes === 'number' && typeof totalBytes === 'number' && typeof limitBytes === 'number' &&
    Number.isFinite(usedBytes) && Number.isFinite(totalBytes) && Number.isFinite(limitBytes) ? { usedBytes, totalBytes, limitBytes } : null;
}

/** Completed main-pass statistics. No scene traversal, React update or state write per frame. */
export function MobileDiagnostics() {
  const { gl, scene, size, camera } = useThree();
  useEffect(() => {
    if (import.meta.env.MODE !== 'e2e' && !debugMobileEnabled) return;
    const frames = new MobileFrameWindow();
    const drawingBuffer = new Vector2();
    const projected = new Vector3();
    let nextSample = 0; let sample = 0;
    let gpu: string | null = null;
    try {
      const context = gl.getContext();
      const extension = context.getExtension('WEBGL_debug_renderer_info');
      if (extension) gpu = String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL));
    } catch { /* Optional diagnostic unavailable on some browsers. */ }
    const visibility = (): void => frames.reset();
    document.addEventListener('visibilitychange', visibility);
    gl.domElement.addEventListener('webglcontextlost', visibility);
    gl.domElement.addEventListener('webglcontextrestored', visibility);
    const remove = addAfterEffect(() => {
      if (document.hidden) { frames.reset(); return; }
      const now = performance.now();
      const contextLost = gl.getContext().isContextLost();
      if (contextLost) frames.reset(); else frames.record(now);
      if (now < nextSample) return;
      nextSample = now + 250;
      let sceneObjects = 0;
      scene.traverse(() => { sceneObjects++; });
      gl.getDrawingBufferSize(drawingBuffer);
      const state = game.view; const snapshot = city.snapshot;
      const project = (x: number, y: number, z: number): readonly [number, number, number] => {
        projected.set(x, y, z).project(camera); return [projected.x, projected.y, projected.z];
      };
      const playerFoot = project(state.player.x, state.player.y, 0);
      const playerHead = project(state.player.x, state.player.y + (state.player.slideRemaining > 0 ? RULES.slidingHeight : RULES.standingHeight), 0);
      const pixel = (point: readonly [number, number, number]): readonly [number, number] => [(point[0] + 1) * size.width / 2, (1 - point[1]) * size.height / 2];
      const transition = getThemeTransition(state.distance);
      const root = scene.getObjectByName('procedural-city');
      const mounted: unknown = root?.userData.mountedAssetIds;
      const mountedAssetIds = Array.isArray(mounted) ? mounted.filter((id): id is string => typeof id === 'string') : [];
      const particles = feedback.effects.stats();
      const value = {
        sample: ++sample, measuredAt: now,
        viewport: { width: window.innerWidth, height: window.innerHeight, deviceDpr: window.devicePixelRatio, canvasWidth: size.width, canvasHeight: size.height },
        drawingBuffer: { width: drawingBuffer.x, height: drawingBuffer.y }, dpr: gl.getPixelRatio(),
        quality: { mode: quality.getSnapshot().mode, profile: quality.getSnapshot().profile, sampling: quality.getSamplingStats() },
        frames: frames.read(),
        render: { calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries,
          textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? 0, sceneObjects },
        camera: { position: camera.position.toArray(), fov: camera instanceof PerspectiveCamera ? camera.fov : null,
          aspect: camera instanceof PerspectiveCamera ? camera.aspect : null,
          playerPixels: { foot: pixel(playerFoot), head: pixel(playerHead) },
          projections: { leftFoot: project(-RULES.laneWidth, 0, 0), leftHead: project(-RULES.laneWidth, RULES.standingHeight, 0),
            rightFoot: project(RULES.laneWidth, 0, 0), rightHead: project(RULES.laneWidth, RULES.standingHeight, 0),
            playerFoot, playerHead, jumpTop: project(state.player.x, state.player.y + RULES.standingHeight, 0), forwardHazard: project(0, .425, -15) } },
        game: { status: state.status, seed: state.seed, tick: state.tick, distance: state.distance, themeId: transition.themeId, zoneId: transition.zoneId },
        city: { chunks: snapshot.chunks.length, revision: snapshot.revision, buildings: snapshot.buildingCount, lamps: snapshot.lampCount,
          logicalDecorations: snapshot.decorationCount, logicalProps: snapshot.propCount, mountedAssetIds },
        particles: { active: particles.particles, capacity: particles.capacity, peak: particles.peak, activeEffects: particles.activeEffects, free: particles.free },
        audio: feedback.audio.diagnostics(), heap: browserHeap(), gpu, contextLost,
      };
      publishMobileMetrics(value);
      if (import.meta.env.MODE === 'e2e') window.__MOBILE_RENDER__ = value;
    });
    return () => {
      remove(); document.removeEventListener('visibilitychange', visibility);
      gl.domElement.removeEventListener('webglcontextlost', visibility);
      gl.domElement.removeEventListener('webglcontextrestored', visibility);
      clearMobileMetrics();
      if (import.meta.env.MODE === 'e2e') delete window.__MOBILE_RENDER__;
    };
  }, [gl, scene, size, camera]);
  return null;
}
