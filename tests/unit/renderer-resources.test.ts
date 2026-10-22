import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Camera, Group, Mesh, MeshStandardMaterial } from 'three';
import { markSharedAssetResources, markSharedResource, retainRendererResources } from '../../src/assets/renderer-resources';

const scene = new Group(), camera = new Camera();
describe('shared GLTF resource ownership across retired renderers', () => {
  it('removes only the retired renderer callbacks and keeps shared geometry, material and other listeners', async () => {
    const geometry = new BoxGeometry(), material = new MeshStandardMaterial();
    markSharedAssetResources(new Mesh(geometry, material));
    const first = vi.fn(), second = vi.fn(), user = vi.fn();
    geometry.addEventListener('dispose', user);
    const a = { render: () => { geometry.addEventListener('dispose', first); material.addEventListener('dispose', first); } };
    const b = { render: () => { geometry.addEventListener('dispose', second); material.addEventListener('dispose', second); } };
    const releaseA = retainRendererResources(a), releaseB = retainRendererResources(b);
    a.render(); b.render(); releaseA(); await Promise.resolve();
    expect(geometry.hasEventListener('dispose', first)).toBe(false);
    expect(material.hasEventListener('dispose', first)).toBe(false);
    expect(geometry.hasEventListener('dispose', second)).toBe(true);
    expect(geometry.hasEventListener('dispose', user)).toBe(true);
    expect(geometry.getAttribute('position').count).toBe(24);
    expect(material.color.getHexString()).toBe('ffffff');
    expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled(); expect(user).not.toHaveBeenCalled();
    releaseB(); await Promise.resolve();
    expect(geometry.hasEventListener('dispose', second)).toBe(false);
    expect(geometry.hasEventListener('dispose', user)).toBe(true);
    geometry.dispose(); material.dispose();
  });
  it('survives immediate effect release/reacquire and cleans idempotently on the true unmount', async () => {
    const resource = new MeshStandardMaterial(), callback = vi.fn(); markSharedResource(resource);
    const original = () => resource.addEventListener('dispose', callback);
    const renderer = { render: original };
    const first = retainRendererResources(renderer); renderer.render(); first(); first();
    const replay = retainRendererResources(renderer); await Promise.resolve();
    expect(resource.hasEventListener('dispose', callback)).toBe(true);
    expect(renderer.render).not.toBe(original);
    replay(); await Promise.resolve();
    expect(resource.hasEventListener('dispose', callback)).toBe(false);
    expect(renderer.render).toBe(original);
    resource.dispose();
  });
  it('restores the render scope on exceptions and does not remove unrelated later callbacks', async () => {
    const resource = new BoxGeometry(), during = vi.fn(), later = vi.fn(); markSharedResource(resource);
    const renderer = { render: () => { resource.addEventListener('dispose', during); throw new Error('draw failed'); } };
    const release = retainRendererResources(renderer);
    expect(() => renderer.render()).toThrow('draw failed');
    resource.addEventListener('dispose', later);
    release(); await Promise.resolve();
    expect(resource.hasEventListener('dispose', during)).toBe(false);
    expect(resource.hasEventListener('dispose', later)).toBe(true);
    resource.dispose(); expect(later).toHaveBeenCalledOnce();
  });
  it('keeps nested renderer ownership separate and leaves ordinary private resources alone', async () => {
    const shared = new BoxGeometry(), privateResource = new BoxGeometry(); markSharedResource(shared);
    const outer = vi.fn(), inner = vi.fn(), privateCallback = vi.fn();
    const b = { render: () => shared.addEventListener('dispose', inner) };
    const a = { render: () => { b.render(); shared.addEventListener('dispose', outer); privateResource.addEventListener('dispose', privateCallback); } };
    const releaseA = retainRendererResources(a), releaseB = retainRendererResources(b);
    // Renders repeatedly to exercise duplicate registration with actual Three events.
    for (let i = 0; i < 1000; i++) a.render();
    releaseA(); await Promise.resolve();
    expect(shared.hasEventListener('dispose', outer)).toBe(false);
    expect(shared.hasEventListener('dispose', inner)).toBe(true);
    expect(privateResource.hasEventListener('dispose', privateCallback)).toBe(true);
    releaseB(); await Promise.resolve();
    expect(shared.hasEventListener('dispose', inner)).toBe(false);
    shared.dispose(); privateResource.dispose();
    expect(privateCallback).toHaveBeenCalledOnce();
    // A normal renderer signature remains compatible without a WebGL context.
    const realSignature = { render: (_scene: Group, _camera: Camera) => {} };
    const release = retainRendererResources(realSignature); realSignature.render(scene, camera); release(); await Promise.resolve();
  });
});
