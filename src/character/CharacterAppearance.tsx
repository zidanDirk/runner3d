import { useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { Mesh, MeshStandardMaterial } from 'three';
import type { Material, Object3D } from 'three';
import { getCharacterSkin } from './appearance';
import type { SkinId } from './appearance';

export interface AppearanceLease {
  /** Only owned, changed clothing materials; shared skin/geometry stay cached. */
  readonly materials: readonly MeshStandardMaterial[];
  dispose(): void;
}

const leases = new WeakMap<Object3D, AppearanceLease>();
const CLOTHING = /^city_runner_(Backpack|Torso|Pelvis|(?:Left|Right)(?:Foot|LowerArm|UpperArm|LowerLeg|UpperLeg))(?:_mesh(?:_\d+)?)?$/;

/** Apply only to an already cloned scene. Never mutate the loader's materials. */
export function applyAppearance(instance: Object3D, skinId: SkinId): AppearanceLease {
  const skin = getCharacterSkin(skinId);
  leases.get(instance)?.dispose();
  // Preserve every original material property and pixel, without a clone/recolor.
  if (skinId === 'original-orange') return { materials: [], dispose() {} };
  const clones = new Map<Material, MeshStandardMaterial>();
  const assignments: { mesh: Mesh; original: Material | Material[]; applied: Material | Material[] }[] = [];
  const change = (material: Material): Material => {
    const role = material.name === 'city_runner_jacket' ? 'jacket'
      : material.name === 'city_runner_pants' ? 'pants'
      : material.name === 'city_runner_shoe' ? 'shoe' : null;
    if (!role || !(material instanceof MeshStandardMaterial)) return material;
    let copy = clones.get(material);
    if (!copy) {
      copy = material.clone();
      copy.color.set(skin.colors[role]);
      clones.set(material, copy);
    }
    return copy;
  };
  instance.traverse((object) => {
    // The pants material is also reused by the face/hair in the original GLB.
    // Restrict variants to clothing parts rather than recoloring those features.
    if (!(object instanceof Mesh) || !CLOTHING.test(object.name)) return;
    const original = object.material;
    const applied = Array.isArray(original) ? original.map(change) : change(original);
    if (Array.isArray(original) ? original.some((material, index) => material !== (Array.isArray(applied) ? applied[index] : applied)) : original !== applied) {
      object.material = applied;
      assignments.push({ mesh: object, original, applied });
    }
  });
  let disposed = false;
  const lease: AppearanceLease = {
    materials: [...clones.values()],
    dispose() {
      if (disposed) return;
      disposed = true;
      // Do not undo a newer lease if a caller disposes an old handle late.
      for (const { mesh, original, applied } of assignments) if (mesh.material === applied) mesh.material = original;
      for (const material of clones.values()) material.dispose();
      if (leases.get(instance) === lease) leases.delete(instance);
    },
  };
  leases.set(instance, lease);
  return lease;
}

/** Effects acquire/release resources so React StrictMode replay stays safe. */
export function CharacterAppearance({ instance, skinId, children }: { instance: Object3D; skinId: SkinId; children: ReactNode }) {
  useLayoutEffect(() => {
    const lease = applyAppearance(instance, skinId);
    return () => lease.dispose();
  }, [instance, skinId]);
  return <group name="character-appearance" userData={{ skinId }} dispose={null}>{children}</group>;
}
