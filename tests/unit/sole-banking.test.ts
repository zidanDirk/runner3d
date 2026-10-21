import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AnimationMixer, Box3, Group, LoopOnce } from 'three';
import { SoleBanking } from '../../src/character/SoleBanking';

it('keeps actual animated shoes above their source floor under either lean, without changing the clip', async () => {
  const buffer = await readFile(new URL('../../public/models/generated/city-runner.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(Uint8Array.from(buffer).buffer, '');
  const pivot = new Group(); pivot.add(gltf.scene); const probe = new SoleBanking(gltf.scene);
  expect(probe.sampleCount).toBeGreaterThanOrEqual(20); expect(probe.sampleCount).toBeLessThanOrEqual(512);
  const run = gltf.animations.find((clip) => clip.name === 'Run'); if (!run) throw new Error('Actual Run required');
  const mixer = new AnimationMixer(gltf.scene); const action = mixer.clipAction(run); action.setLoop(LoopOnce, 1); action.clampWhenFinished = true;
  const left = gltf.scene.getObjectByName('city_runner_LeftFoot'); const right = gltf.scene.getObjectByName('city_runner_RightFoot');
  if (!left || !right) throw new Error('Actual foot geometry required');
  const minimum = () => { pivot.updateMatrixWorld(true); return Math.min(new Box3().setFromObject(left, true).min.y, new Box3().setFromObject(right, true).min.y); };
  for (let i = 0; i <= 32; i++) {
    pivot.rotation.z = 0; pivot.position.y = 0; action.reset().play(); mixer.setTime(run.duration * i / 32);
    const sourceMinimum = minimum();
    for (const angle of [-Math.PI / 16, Math.PI / 16]) {
      pivot.rotation.z = angle; pivot.position.y = 0; const lift = probe.liftForRoll(angle);
      expect(lift).toBeGreaterThanOrEqual(0); expect(lift).toBeLessThan(.065);
      pivot.position.y = lift;
      expect(minimum()).toBeGreaterThanOrEqual(sourceMinimum - .00001);
      expect(minimum()).toBeGreaterThan(-.003);
    }
  }
  expect(probe.liftForRoll(0)).toBe(0); mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
});

it('bounds extra crossfade penetration while leaving pure source clips uncorrected at zero roll', async () => {
  const buffer = await readFile(new URL('../../public/models/generated/city-runner.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(Uint8Array.from(buffer).buffer, '');
  const pivot = new Group(); pivot.add(gltf.scene); const probe = new SoleBanking(gltf.scene); const mixer = new AnimationMixer(gltf.scene);
  const run = gltf.animations.find((clip) => clip.name === 'Run'); const jump = gltf.animations.find((clip) => clip.name === 'Jump');
  if (!run || !jump) throw new Error('Actual clips required');
  const a = mixer.clipAction(run).setEffectiveWeight(.5).play(); const b = mixer.clipAction(jump).setEffectiveWeight(.5).play();
  b.setLoop(LoopOnce, 1); b.clampWhenFinished = true;
  const left = gltf.scene.getObjectByName('city_runner_LeftFoot'); const right = gltf.scene.getObjectByName('city_runner_RightFoot');
  if (!left || !right) throw new Error('Actual shoes required'); let corrected = 0;
  for (let i = 0; i <= 32; i++) {
    pivot.position.y = 0; a.time = run.duration * i / 32; b.time = jump.duration; b.paused = false; mixer.update(0);
    expect(probe.liftForRoll(0, false)).toBe(0);
    const lift = probe.liftForRoll(0, true); if (lift > 0) corrected++;
    expect(lift).toBeLessThan(.065); pivot.position.y = lift; pivot.updateMatrixWorld(true);
    expect(Math.min(new Box3().setFromObject(left, true).min.y, new Box3().setFromObject(right, true).min.y)).toBeGreaterThan(-.00301);
  }
  expect(corrected).toBeGreaterThan(0); mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
});
