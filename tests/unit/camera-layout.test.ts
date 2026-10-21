import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { cameraLayout } from '../../src/scene/cameraLayout';
import { RULES } from '../../src/game/config';

describe('camera layout uses the canvas aspect and preserves gameplay space', () => {
  for (const [width, height] of [[300,484],[355,583],[370,760],[410,848],[647,343],[824,358],[1004,684],[1004,600]]) it(`${width}x${height}: lane edges, jump and approaching obstacles stay visible`, () => {
    const layout = cameraLayout(width ?? 1, height ?? 1);
    const camera = new PerspectiveCamera(layout.baseFov, (width ?? 1) / (height ?? 1), .1, 250);
    for (const follow of [-.45, 0, .45]) {
      camera.position.set(follow, layout.y, layout.z); camera.lookAt(0, layout.targetY, layout.targetZ); camera.updateMatrixWorld();
      for (const x of [-3.15, 0, 3.15]) for (const y of [0, .68, 1.8, RULES.jumpVelocity ** 2 / (2 * RULES.gravity) + 1.8]) for (const z of [0, -15]) {
        const point = new Vector3(x, y, z).project(camera);
        expect(Math.abs(point.x)).toBeLessThan(.95); expect(Math.abs(point.y)).toBeLessThan(1); expect(point.z).toBeLessThan(1);
      }
    }
  });
  it('keeps the Task 9 desktop camera and translates horizontal to vertical FOV', () => {
    expect(cameraLayout(1004,600)).toEqual({ y:7.8,z:12,baseFov:51,targetY:1.1,targetZ:-19 });
    const a = cameraLayout(370,760); const horizontal = 2 * Math.atan(Math.tan(a.baseFov * Math.PI / 360) * 370 / 760) * 180 / Math.PI;
    expect(horizontal).toBeCloseTo(40, 8);
  });
});
