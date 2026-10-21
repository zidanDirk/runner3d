import { useEffect } from 'react';
import { addAfterEffect, useThree } from '@react-three/fiber';
import { Box3, Color, Frustum, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial } from 'three';
import { city } from '../runtime/city';
import { publishCityMetrics } from '../runtime/city-metrics';
import { game } from '../runtime/store';
import { getThemeTransition } from '../city/zones';
import { getCityTheme } from '../city/themes';
import { cityAssetIds } from '../assets/city-loading';
import { getAsset } from '../assets/catalog';

/** After R3F renders: last completed main scene pass, excluding shadow map passes.
 * There are no postprocess passes. Sampling never drives the simulation or city layout. */
export function CityDiagnostics() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    let nextSample = 0;
    let sample = 0;
    let previousFrame = performance.now();
    const durations: number[] = [];
    const frustum = new Frustum();
    const matrix = new Matrix4();
    const world = new Matrix4();
    const box = new Box3();
    return addAfterEffect(() => {
      const now = performance.now();
      const duration = now - previousFrame;
      previousFrame = now;
      if (duration > 0 && duration < 1000) { durations.push(duration); if (durations.length > 120) durations.shift(); }
      if (now < nextSample) return;
      const snapshot = city.snapshot;
      if (scene.getObjectByName('procedural-city')?.userData.revision !== snapshot.revision) return;
      nextSample = now + 250;
      frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      let batches = 0;
      let fallbackBatches = 0;
      const renderedInstances: Record<string, number> = {};
      const visibleBySide: Record<string, [number, number]> = {};
      scene.traverse((object) => {
        if (!(object instanceof InstancedMesh) || typeof object.userData.cityAsset !== 'string') return;
        batches++;
        if (object.userData.fallback) fallbackBatches++;
        const id: string = object.userData.cityAsset;
        if (renderedInstances[id] !== undefined) return;
        renderedInstances[id] = object.count;
        const sides: [number, number] = [0, 0];
        visibleBySide[id] = sides;
        object.geometry.computeBoundingBox();
        for (let i = 0; i < object.count; i++) {
          object.getMatrixAt(i, matrix);
          world.multiplyMatrices(object.matrixWorld, matrix);
          if (object.geometry.boundingBox && frustum.intersectsBox(box.copy(object.geometry.boundingBox).applyMatrix4(world))) {
            const x = world.elements[12] ?? 0;
            sides[x < 0 ? 0 : 1]++;
          }
        }
      });
      const transition = getThemeTransition(game.view.distance);
      const road = scene.getObjectByName('city-road');
      const roadColor = road instanceof Mesh && road.material instanceof MeshStandardMaterial ? `#${road.material.color.getHexString()}` : '';
      const frameTimeMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
      const value = {
        seed: snapshot.seed, currentChunk: snapshot.currentChunk, revision: snapshot.revision,
        chunkIds: snapshot.chunks.map((chunk) => chunk.id), buildings: snapshot.buildingCount,
        lamps: snapshot.lampCount, decorations: snapshot.decorationCount,
        calls: gl.info.render.calls, triangles: gl.info.render.triangles,
        geometries: gl.info.memory.geometries, textures: gl.info.memory.textures,
        batches, fallbackBatches, renderedInstances, visibleBySide, sample: ++sample, distance: game.view.distance,
        themeId: transition.themeId, themeName: getCityTheme(transition.themeId).name, zoneId: transition.zoneId,
        nextThemeId: transition.nextThemeId, transitionProgress: transition.progress, distanceToBoundary: transition.distanceToBoundary,
        chunkThemes: snapshot.chunks.map(({ id, themeId, zoneId }) => ({ id, themeId, zoneId })),
        props: snapshot.propCount, expectedBatches: cityAssetIds.filter((id) => scene.getObjectByName('procedural-city')?.userData.mountedAssetIds?.includes(id)).reduce((sum, id) => sum + getAsset(id).primitiveCount, 0),
        culledInstances: Number(scene.getObjectByName('procedural-city')?.userData.culledInstances ?? 0),
        activeAssetIds: Object.keys(renderedInstances).filter((id) => (renderedInstances[id] ?? 0) > 0),
        environment: { background: scene.background instanceof Color ? `#${scene.background.getHexString()}` : '', road: roadColor },
        frameTimeMs, fps: frameTimeMs ? 1000 / frameTimeMs : 0,
      };
      publishCityMetrics(value);
      if (import.meta.env.MODE === 'e2e') window.__CITY_RENDER__ = value;
    });
  }, [gl, scene, camera]);
  return null;
}
