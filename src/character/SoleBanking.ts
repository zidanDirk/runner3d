import { Matrix4, Mesh, SkinnedMesh, Vector3 } from 'three';
import type { Object3D } from 'three';

interface SoleVertex { mesh: Mesh; index: number }
/** A cached actual-shoe envelope probe for the additional visual roll only.
 * Pure clips preserve their original minimum Y. During an Action crossfade,
 * bound the additional blend penetration to the independently tested 3mm floor.
 */
export class SoleBanking {
  private readonly vertices: SoleVertex[] = [];
  private readonly inverse = new Matrix4();
  private readonly point = new Vector3();
  readonly skeletons = new Set<SkinnedMesh['skeleton']>();
  constructor(private readonly root: Object3D) {
    this.updateMatrices();
    for (const side of ['Left', 'Right']) {
      const foot = root.getObjectByName(`city_runner_${side}Foot`);
      if (!foot) throw new Error(`City Runner 缺少实际 ${side}Foot 鞋底`);
      const candidates: (SoleVertex & { x: number; y: number; z: number })[] = [];
      foot.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        if (object instanceof SkinnedMesh) { this.skeletons.add(object.skeleton); object.skeleton.update(); }
        for (let index = 0; index < object.geometry.getAttribute('position').count; index++) {
          object.getVertexPosition(index, this.point).applyMatrix4(object.matrixWorld).applyMatrix4(this.inverse);
          candidates.push({ mesh: object, index, x: this.point.x, y: this.point.y, z: this.point.z });
        }
      });
      const seen = new Set<string>();
      // A side edge can become the lowest point when rolling a pitched shoe.
      // Cache all unique shoe vertices once rather than assuming the rest sole
      // is still its complete lower envelope in every animated orientation.
      for (const vertex of candidates) {
        const key = [vertex.x, vertex.y, vertex.z].map((value) => Math.round(value * 100000)).join(',');
        if (!seen.has(key)) { this.vertices.push({ mesh: vertex.mesh, index: vertex.index }); seen.add(key); }
      }
    }
    if (this.vertices.length === 0) throw new Error('City Runner 实际鞋底顶点为空');
  }
  get sampleCount(): number { return this.vertices.length; }
  private updateMatrices(): void {
    this.root.updateWorldMatrix(true, false);
    // SkinnedMesh overrides updateMatrixWorld to refresh its attached inverse
    // bind matrix. updateWorldMatrix alone bypasses that override after a roll.
    this.root.updateMatrixWorld(true);
    this.inverse.copy(this.root.matrixWorld).invert();
  }
  liftForRoll(angle: number, blending = false): number {
    if (Math.abs(angle) < .00001 && !blending) return 0;
    this.updateMatrices();
    for (const skeleton of this.skeletons) skeleton.update();
    let base = Infinity; let rolled = Infinity;
    const sine = Math.sin(angle); const cosine = Math.cos(angle);
    for (const { mesh, index } of this.vertices) {
      mesh.getVertexPosition(index, this.point).applyMatrix4(mesh.matrixWorld).applyMatrix4(this.inverse);
      base = Math.min(base, this.point.y); rolled = Math.min(rolled, sine * this.point.x + cosine * this.point.y);
    }
    return Math.max(0, base - rolled, blending ? -.003 - rolled : 0);
  }
}
