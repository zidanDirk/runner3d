import { Object3D } from 'three';
import type { InstancedMesh, Matrix4 } from 'three';
import type { CityPlacement } from '../city/types';

export interface CityInstance { readonly placement: CityPlacement; readonly offset: number }

/** Owns uploads, not geometry. A reconstructed host object must receive the same
 * placements even when React dependencies have not changed. Normal frames cost
 * only identity/count/version checks; transforms are written once per revision. */
export class CityInstanceWriter {
  private readonly transform = new Object3D();
  private mesh: InstancedMesh | undefined;
  private items: readonly CityInstance[] | undefined;
  private localMatrix: Matrix4 | undefined;
  private lift = NaN;

  sync(mesh: InstancedMesh, items: readonly CityInstance[], localMatrix?: Matrix4, fallbackHeight = 0): void {
    if (mesh === this.mesh && items === this.items && localMatrix === this.localMatrix && fallbackHeight === this.lift && mesh.count === items.length && mesh.instanceMatrix.version > 0) return;
    if (items.length > mesh.instanceMatrix.count) throw new Error('City instance capacity exceeded');
    const transform = this.transform;
    items.forEach(({ placement, offset }, index) => {
      transform.position.set(placement.position[0], placement.position[1] + fallbackHeight * placement.scale[1] / 2, placement.position[2] - offset);
      transform.rotation.set(0, placement.rotationY, 0); transform.scale.set(...placement.scale); transform.updateMatrix();
      if (localMatrix) transform.matrix.multiply(localMatrix);
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.count = items.length; mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    this.mesh = mesh; this.items = items; this.localMatrix = localMatrix; this.lift = fallbackHeight;
  }
}

/** Effect replay/hidden Suspense trees still own their GPU buffers. Only an
 * actually detached object can be released; shared GLB buffers are never freed. */
export function releaseDetachedInstance(mesh: InstancedMesh): void {
  queueMicrotask(() => { if (!mesh.parent) mesh.dispose(); });
}
