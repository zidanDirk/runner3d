import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { createRoadblockInstance } from '../../src/assets/generated/Roadblock';
import { readFileSync } from 'node:fs';
import { SHAPES } from '../../src/game/config';
import { assetIds, assetManifest, assetUrl } from '../../src/assets/catalog';

describe('visual asset boundary', () => {
  it('resolves IDs to base-relative URLs versioned by actual content hashes', () => {
    for (const id of assetIds) {
      expect(assetUrl(id)).toBe(`${import.meta.env.BASE_URL}${assetManifest.assets[id].path}?v=${assetManifest.assets[id].sha256}`);
    }
  });
  it('keeps the Blender size contract equal to the original hurdle collider', () => {
    const config: { assets: { id: string; width?: number; height: number; depth?: number }[] } = JSON.parse(readFileSync(new URL('../../assets.config.json', import.meta.url), 'utf8'));
    const roadblock = config.assets.find((asset) => asset.id === 'roadblock');
    expect([roadblock?.width, roadblock?.height, roadblock?.depth]).toEqual([SHAPES.hurdle.width, SHAPES.hurdle.height, SHAPES.hurdle.depth]);
  });
  it('clones transforms but shares geometry and material across roadblocks', () => {
    const source = new Group();
    const mesh = new Mesh(new BoxGeometry(2, 0.85, 0.9), new MeshStandardMaterial());
    mesh.position.y = 0.425;
    source.add(mesh);
    const a = createRoadblockInstance(source);
    const b = createRoadblockInstance(source);
    a.position.x = 10;
    expect(b.position.x).toBe(0);
    expect(source.position.x).toBe(0);
    const clone = a.children[0];
    expect(clone).toBeInstanceOf(Mesh);
    if (!(clone instanceof Mesh)) throw new Error('Missing mesh');
    expect(clone.geometry).toBe(mesh.geometry);
    expect(clone.material).toBe(mesh.material);
    expect(clone.castShadow).toBe(true);
    expect(mesh.castShadow).toBe(false);
    mesh.geometry.dispose(); mesh.material.dispose();
  });

  it('rejects incorrect scale or a floating origin instead of silently resizing', () => {
    const source = new Group();
    const mesh = new Mesh(new BoxGeometry(2, 0.85, 0.9), new MeshStandardMaterial());
    mesh.position.y = 1;
    source.add(mesh);
    expect(() => createRoadblockInstance(source)).toThrow('ground origin');
    mesh.position.y = 0.425; mesh.scale.setScalar(100);
    expect(() => createRoadblockInstance(source)).toThrow('dimensions');
    mesh.geometry.dispose(); mesh.material.dispose();
  });
});
