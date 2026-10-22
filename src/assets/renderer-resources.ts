import { Mesh } from 'three';
import type { Camera, Object3D, WebGLRenderer } from 'three';

// Cache data outlives a Canvas. Three's material/geometry dispose callbacks
// otherwise keep the old GL context alive through those shared cache objects.
const marked = new WeakSet<object>();
let rendering: ResourceOwner | null = null;
export function markSharedResource(resource: object): void {
  if (marked.has(resource)) return;
  const add: unknown = Reflect.get(resource, 'addEventListener');
  if (typeof add !== 'function') throw new Error('Shared resource must support dispose events');
  marked.add(resource);
  // Wrap this cached resource's public method, never Three's global prototype.
  Reflect.set(resource, 'addEventListener', function (this: object, type: unknown, listener: unknown) {
    Reflect.apply(add, this, [type, listener]);
    if (type === 'dispose' && typeof listener === 'function') rendering?.record(this, listener);
  });
}
export function markSharedAssetResources(source: Object3D): void {
  source.traverse(object => {
    if (!(object instanceof Mesh)) return;
    markSharedResource(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) markSharedResource(material);
  });
}

type Renderer = Pick<WebGLRenderer, 'render'>;
const owners = new WeakMap<Renderer, ResourceOwner>();
const live = new Set<ResourceOwner>();
class ResourceOwner {
  references = 0;
  private readonly registrations = new Map<object, Set<object>>();
  private readonly original: Renderer['render'];
  private readonly draw: Renderer['render'];
  constructor(private readonly renderer: Renderer) {
    this.original = renderer.render;
    this.draw = (scene: Object3D, camera: Camera): void => {
      const previous = rendering;
      rendering = this;
      try { this.original.call(renderer, scene, camera); }
      finally { rendering = previous; }
    };
    renderer.render = this.draw;
    live.add(this);
  }
  record(resource: object, listener: object): void {
    let listeners = this.registrations.get(resource);
    if (!listeners) { listeners = new Set(); this.registrations.set(resource, listeners); }
    listeners.add(listener);
  }
  get bindings(): number { let count = 0; for (const listeners of this.registrations.values()) count += listeners.size; return count; }
  dispose(): void {
    if (this.renderer.render === this.draw) this.renderer.render = this.original;
    for (const [resource, listeners] of this.registrations) {
      const remove: unknown = Reflect.get(resource, 'removeEventListener');
      if (typeof remove !== 'function') continue;
      for (const listener of listeners) Reflect.apply(remove, resource, ['dispose', listener]);
    }
    this.registrations.clear();
    owners.delete(this.renderer);
    live.delete(this);
  }
}
/** Deferred release survives StrictMode replay; never disposes shared data. */
export function retainRendererResources(renderer: Renderer): () => void {
  let owner = owners.get(renderer);
  if (!owner) { owner = new ResourceOwner(renderer); owners.set(renderer, owner); }
  owner.references++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    owner.references--;
    queueMicrotask(() => { if (owner.references === 0 && owners.get(renderer) === owner) owner.dispose(); });
  };
}
if (import.meta.env.MODE === 'e2e') window.__PRODUCT_RESOURCES__ = () => ({ owners: live.size, bindings: [...live].reduce((n, owner) => n + owner.bindings, 0) });
