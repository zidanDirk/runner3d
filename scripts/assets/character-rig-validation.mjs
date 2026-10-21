import { AnimationMixer, Box3, LoopOnce, Matrix4, Quaternion, Vector3 } from 'three';
import { analyzeCharacterMotion, assertCharacterMotionQuality } from './character-motion-analysis.mjs';

export const CHARACTER_BONE_PARENTS = Object.freeze({ Root: null, Hips: 'Root', Spine: 'Hips', Chest: 'Spine', Neck: 'Chest', Head: 'Neck', LeftShoulder: 'Chest', LeftUpperArm: 'LeftShoulder', LeftLowerArm: 'LeftUpperArm', LeftHand: 'LeftLowerArm', RightShoulder: 'Chest', RightUpperArm: 'RightShoulder', RightLowerArm: 'RightUpperArm', RightHand: 'RightLowerArm', LeftUpperLeg: 'Hips', LeftLowerLeg: 'LeftUpperLeg', LeftFoot: 'LeftLowerLeg', RightUpperLeg: 'Hips', RightLowerLeg: 'RightUpperLeg', RightFoot: 'RightLowerLeg' });
export const CHARACTER_ANIMATIONS = Object.freeze({ idle: 'Idle', run: 'Run', jump: 'Jump', slide: 'Slide' });
export const CHARACTER_JOINT_BONES = Object.freeze({ center: 'Hips', neck: 'Neck', head: 'Head', leftShoulder: 'LeftUpperArm', rightShoulder: 'RightUpperArm', leftElbow: 'LeftLowerArm', rightElbow: 'RightLowerArm', leftWrist: 'LeftHand', rightWrist: 'RightHand', leftHip: 'LeftUpperLeg', rightHip: 'RightUpperLeg', leftKnee: 'LeftLowerLeg', rightKnee: 'RightLowerLeg', leftAnkle: 'LeftFoot', rightAnkle: 'RightFoot' });
function check(value, message) { if (!value) throw new Error(`角色骨骼/动画：${message}`); }

/** Read accessor contents rather than trusting accessor min/max metadata. */
export function accessorValues(json, binary, id) {
  const accessor = json.accessors[id];
  check(accessor, `accessor ${id} 无效`);
  const view = json.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
  const format = { 5120: [1, 'readInt8'], 5121: [1, 'readUInt8'], 5122: [2, 'readInt16LE'], 5123: [2, 'readUInt16LE'], 5125: [4, 'readUInt32LE'], 5126: [4, 'readFloatLE'] }[accessor.componentType];
  check(view && components && format, 'accessor 格式无效');
  const [bytes, method] = format;
  const stride = view.byteStride ?? components * bytes;
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const values = [];
  for (let row = 0; row < accessor.count; row++) for (let col = 0; col < components; col++) {
    let value = binary[method](offset + row * stride + col * bytes);
    if (accessor.normalized && accessor.componentType !== 5126) value /= { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[accessor.componentType];
    check(Number.isFinite(value), `accessor ${id} 包含 NaN/Infinity`);
    values.push(value);
  }
  return values;
}

export function validateRigStructure(json, binary, info) {
  check(info.bones && typeof info.bones === 'object' && Object.keys(info.bones).length === Object.keys(CHARACTER_BONE_PARENTS).length, 'bones 必须包含完整且精简的骨骼');
  const ids = Object.fromEntries(Object.entries(info.bones).map(([name, node]) => [name, json.nodes.findIndex((item) => item.name === node)]));
  check(Object.keys(CHARACTER_BONE_PARENTS).every((name) => Object.hasOwn(ids, name) && ids[name] >= 0), '关键骨骼节点缺失');
  check(new Set(Object.values(ids)).size === Object.keys(ids).length, '骨骼节点重复');
  for (const [name, parent] of Object.entries(CHARACTER_BONE_PARENTS)) {
    if (parent) check(json.nodes[ids[parent]].children?.includes(ids[name]), `${name} 骨骼层级错误，预期 ${parent}`);
  }
  check(Array.isArray(json.skins) && json.skins.length === 1, '必须共享一个有效 Skin');
  const skin = json.skins[0];
  check(Array.isArray(skin.joints) && skin.joints.length === Object.keys(ids).length && new Set(skin.joints).size === skin.joints.length && Object.values(ids).every((id) => skin.joints.includes(id)), 'Skin 骨骼索引无效或缺失');
  if (skin.skeleton !== undefined) check(skin.skeleton === ids.Root, 'Skin skeleton 必须引用 Root');
  const inverse = json.accessors[skin.inverseBindMatrices];
  check(inverse?.type === 'MAT4' && inverse.componentType === 5126 && inverse.count === skin.joints.length, 'inverseBindMatrices 格式无效');
  const inverseValues = accessorValues(json, binary, skin.inverseBindMatrices);
  for (let offset = 0; offset < inverseValues.length; offset += 16) check(Math.abs(new Matrix4().fromArray(inverseValues, offset).determinant()) > 1e-8, '逆绑定矩阵不可逆');
  for (const node of json.nodes) {
    if (node.mesh === undefined) continue;
    check(node.skin === 0, `Mesh ${node.name} 未绑定共享 Skin`);
    for (const primitive of json.meshes[node.mesh].primitives) {
      const positions = json.accessors[primitive.attributes.POSITION];
      const joint = json.accessors[primitive.attributes.JOINTS_0]; const weight = json.accessors[primitive.attributes.WEIGHTS_0];
      check(joint?.type === 'VEC4' && [5121, 5123].includes(joint.componentType) && !joint.normalized && joint.count === positions.count, 'JOINTS_0 格式/数量无效');
      check(weight?.type === 'VEC4' && (weight.componentType === 5126 || ([5121, 5123].includes(weight.componentType) && weight.normalized === true)) && weight.count === positions.count, 'WEIGHTS_0 格式/数量无效');
      const joints = accessorValues(json, binary, primitive.attributes.JOINTS_0);
      const weights = accessorValues(json, binary, primitive.attributes.WEIGHTS_0);
      for (let offset = 0; offset < joints.length; offset += 4) {
        check(joints.slice(offset, offset + 4).every((value) => Number.isInteger(value) && value >= 0 && value < skin.joints.length), '顶点骨骼索引越界');
        const selected = weights.slice(offset, offset + 4);
        check(selected.every((value) => value >= 0 && value <= 1) && Math.abs(selected.reduce((sum, value) => sum + value, 0) - 1) <= .002, '顶点蒙皮权重未归一化或越界');
      }
    }
  }
  check(Array.isArray(json.animations) && json.animations.length === 4 && new Set(json.animations.map((item) => item.name)).size === 4 && Object.values(CHARACTER_ANIMATIONS).every((name) => json.animations.some((item) => item.name === name)), '实际 GLB 必须包含 Idle / Run / Jump / Slide 四个动作');
  const animatedNodes = new Set(Object.values(ids));
  for (const clip of json.animations) {
    check(Array.isArray(clip.channels) && clip.channels.length > 0 && Array.isArray(clip.samplers) && clip.samplers.length > 0, `${clip.name} 缺少动画通道`);
    const targets = new Set(); let duration = 0;
    for (const channel of clip.channels) {
      const target = channel.target;
      check(target && animatedNodes.has(target.node) && ['translation', 'rotation', 'scale'].includes(target.path), `${clip.name} 动画目标无效`);
      const key = `${target.node}:${target.path}`; check(!targets.has(key), `${clip.name} 重复动画轨道`); targets.add(key);
      const sampler = clip.samplers[channel.sampler];
      check(sampler && ['LINEAR', 'STEP', 'CUBICSPLINE'].includes(sampler.interpolation ?? 'LINEAR'), `${clip.name} 动画插值无效`);
      const input = json.accessors[sampler.input]; const output = json.accessors[sampler.output];
      check(input?.type === 'SCALAR' && input.componentType === 5126 && input.count >= 2, `${clip.name} 时间轨道无效`);
      check(output?.componentType === 5126 && output.type === (target.path === 'rotation' ? 'VEC4' : 'VEC3') && output.count === input.count * (sampler.interpolation === 'CUBICSPLINE' ? 3 : 1), `${clip.name} 输出轨道无效`);
      const times = accessorValues(json, binary, sampler.input); const values = accessorValues(json, binary, sampler.output);
      check(times[0] === 0 && times.every((value, i) => value >= 0 && (i === 0 || value > times[i - 1])), `${clip.name} 关键帧时间无效`);
      duration = Math.max(duration, times.at(-1));
      if (target.node === ids.Root) {
        const components = target.path === 'rotation' ? 4 : 3;
        const stride = components * (sampler.interpolation === 'CUBICSPLINE' ? 3 : 1);
        const start = sampler.interpolation === 'CUBICSPLINE' ? components : 0;
        for (let offset = start; offset < values.length; offset += stride) check(values.slice(offset, offset + components).every((value, axis) => Math.abs(value - values[start + axis]) < 1e-6), `${clip.name} 包含 Root Motion`);
      }
      // Only Hips may translate for body compression/bob; X/Z must stay fixed.
      if (target.path === 'translation') {
        const stride = sampler.interpolation === 'CUBICSPLINE' ? 9 : 3;
        const start = sampler.interpolation === 'CUBICSPLINE' ? 3 : 0;
        for (let offset = start; offset < values.length; offset += stride) {
          check(Math.abs(values[offset] - values[start]) <= 1e-5 && Math.abs(values[offset + 2] - values[start + 2]) <= 1e-5, `${clip.name} 含水平 Root Motion`);
          if (target.node !== ids.Hips) check(Math.abs(values[offset + 1] - values[start + 1]) <= 1e-5, `${clip.name} 禁止非 Hips 垂直位移动画`);
        }
      }
      if (target.path === 'rotation') {
        const stride = sampler.interpolation === 'CUBICSPLINE' ? 12 : 4;
        const start = sampler.interpolation === 'CUBICSPLINE' ? 4 : 0;
        for (let offset = start; offset < values.length; offset += stride) check(Math.abs(Math.hypot(...values.slice(offset, offset + 4)) - 1) <= .001, `${clip.name} 四元数未归一化`);
      }
      if (target.path === 'scale') check(values.every((value) => Math.abs(value - 1) < 1e-5), `${clip.name} 禁止缩放动画补偿姿态`);
    }
    check(duration > .1 && duration <= 5, `${clip.name} 动画时长无效`);
  }
  return ids;
}

/** CPU skinning is deliberate: Box3 on the undeformed geometry misses bad weights. */
export function measureDeformed(scene) {
  scene.updateMatrixWorld(true);
  scene.traverse((object) => { if (object.isSkinnedMesh) object.skeleton.update(); });
  const box = new Box3(); const point = new Vector3();
  scene.traverse((object) => {
    if (!object.isMesh) return;
    const count = object.geometry.getAttribute('position').count;
    for (let i = 0; i < count; i++) {
      object.getVertexPosition(i, point); point.applyMatrix4(object.matrixWorld);
      check(point.toArray().every(Number.isFinite), '实际蒙皮顶点包含非法数值'); box.expandByPoint(point);
    }
  });
  check(!box.isEmpty(), '实际蒙皮顶点为空');
  return { min: box.min.toArray(), max: box.max.toArray() };
}
function safeBounds(bounds, label, floor = -.035) {
  check(bounds.min.every(Number.isFinite) && bounds.max.every(Number.isFinite), `${label} 非有限边界`);
  check(bounds.max.every((value, axis) => value - bounds.min[axis] > 0 && value - bounds.min[axis] < 3.2), `${label} 蒙皮尺寸异常巨大`);
  check(bounds.min[1] >= floor, `${label} 明显穿地 y=${bounds.min[1]}`);
}
function partCenter(scene, nodeName) {
  const node = scene.getObjectByName(nodeName); check(node, `姿态测试缺少 ${nodeName}`);
  const result = new Vector3(); const point = new Vector3(); let count = 0;
  node.traverse((object) => {
    if (!object.isMesh) return;
    for (let i = 0; i < object.geometry.getAttribute('position').count; i++) {
      object.getVertexPosition(i, point); result.add(point.applyMatrix4(object.matrixWorld)); count++;
    }
  });
  check(count > 0, `姿态测试 ${nodeName} 缺少蒙皮顶点`); return result.divideScalar(count);
}
function kneeSides(bones, label) {
  const middle = bones.Hips.getWorldPosition(new Vector3()).x;
  const left = bones.LeftLowerLeg.getWorldPosition(new Vector3()).x;
  const right = bones.RightLowerLeg.getWorldPosition(new Vector3()).x;
  // These two actions do not cross legs. Use the existing 5 mm asset tolerance,
  // rather than prescribing an arbitrary pose width or a particular IK solver.
  check(left <= middle + .005 && right >= middle - .005 && left <= right + .005, `${label} 膝关节跨过身体中线或左右交叉`);
}
export function validateRigLoaded(gltf, info) {
  const scene = gltf.scene;
  const bones = Object.fromEntries(Object.entries(info.bones).map(([name, node]) => [name, scene.getObjectByName(node)]));
  check(Object.values(bones).every((bone) => bone?.isBone), 'Three.js 未识别真实 Bone');
  check(bones.Root.getWorldPosition(new Vector3()).length() < .005, 'Root 骨骼必须位于地面原点');
  const meshes = [];
  scene.traverse((object) => { if (object.isMesh) { check(object.isSkinnedMesh, `${object.name} 不是实际 SkinnedMesh`); meshes.push(object); } });
  check(meshes.length > 0, 'Three.js 未识别 SkinnedMesh');
  for (const object of meshes) {
    check(object.skeleton.bones.length === Object.keys(bones).length && Object.values(bones).every((bone) => object.skeleton.bones.includes(bone)), '实际 Skeleton 引用不完整');
    check(object.skeleton.boneInverses.every((matrix) => matrix.elements.every(Number.isFinite) && Math.abs(matrix.determinant()) > 1e-8), '实际 Skeleton 逆绑定矩阵无效');
    for (let i = 0; i < object.skeleton.bones.length; i++) {
      const identity = new Matrix4().multiplyMatrices(object.skeleton.bones[i].matrixWorld, object.skeleton.boneInverses[i]);
      check(identity.elements.every((value, axis) => Math.abs(value - (axis % 5 === 0 ? 1 : 0)) < .005), 'Rest Pose 与逆绑定矩阵不匹配');
    }
  }
  for (const [joint, bone] of Object.entries(CHARACTER_JOINT_BONES)) {
    const point = bones[bone].getWorldPosition(new Vector3()).toArray();
    check(point.every((value, axis) => Math.abs(value - info.joints[joint][axis]) < .005), `关节 ${joint} 不匹配真实骨骼原点`);
  }
  const rest = Object.values(bones).map((bone) => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }));
  const reset = () => { for (const { bone, position, quaternion, scale } of rest) { bone.position.copy(position); bone.quaternion.copy(quaternion); bone.scale.copy(scale); } scene.updateMatrixWorld(true); };
  const restPositions = Object.fromEntries(Object.entries(bones).map(([name, bone]) => [name, bone.getWorldPosition(new Vector3()).toArray()]));
  measureDeformed(scene);
  const poseTests = {};
  const poseCases = { armRaise: ['LeftUpperArm', .7, 'LeftHand'], elbowBend: ['LeftLowerArm', 1, 'LeftHand'], legRaise: ['LeftUpperLeg', .65, 'LeftFoot'], kneeBend: ['LeftLowerLeg', -1, 'LeftFoot'] };
  for (const [name, [boneName, angle, target]] of Object.entries(poseCases)) {
    reset(); measureDeformed(scene); const before = partCenter(scene, info.parts[target]);
    bones[boneName].quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle));
    const bounds = measureDeformed(scene); safeBounds(bounds, name, -.20);
    check(partCenter(scene, info.parts[target]).distanceTo(before) > .015, `${name} 对应肢体蒙皮未产生实际变形`); poseTests[name] = bounds;
  }
  reset();
  const mixer = new AnimationMixer(scene);
  const animationSamples = {}; const animationClips = [];
  try {
    for (const clip of gltf.animations) {
      check(Object.values(CHARACTER_ANIMATIONS).includes(clip.name) && clip.duration > 0 && clip.tracks.length > 0, '实际 Three.js 动作无效');
      animationClips.push({ name: clip.name, duration: clip.duration, trackCount: clip.tracks.length });
      const action = mixer.clipAction(clip); action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
      const samples = [];
      const skinnedFeet = [];
      for (const progress of [0, .25, .5, .75, 1]) {
        action.reset().play(); mixer.setTime(clip.duration * progress);
        const bounds = measureDeformed(scene);
        if (['Run', 'Slide'].includes(clip.name)) kneeSides(bones, `${clip.name}@${progress}`);
        safeBounds(bounds, `${clip.name}@${progress}`);
        const transforms = Object.fromEntries(Object.entries(bones).map(([name, bone]) => [name, { position: bone.getWorldPosition(new Vector3()).toArray(), quaternion: bone.quaternion.toArray() }]));
        const root = transforms.Root.position;
        check(root.every((value, axis) => Math.abs(value - restPositions.Root[axis]) < 1e-5), `${clip.name} 世界 Root 漂移`);
        check(Math.abs(transforms.Hips.position[0] - restPositions.Hips[0]) < 1e-4 && Math.abs(transforms.Hips.position[2] - restPositions.Hips[2]) < 1e-4, `${clip.name} 水平 Root Motion`);
        if (clip.name === 'Jump') check(transforms.Hips.position[1] - restPositions.Hips[1] <= .035, 'Jump 不允许叠加骨盆向上 Root Motion');
        samples.push({ progress, bounds, bones: transforms });
        if (clip.name === 'Run') skinnedFeet.push({ left: partCenter(scene, info.parts.LeftFoot).toArray(), right: partCenter(scene, info.parts.RightFoot).toArray() });
      }
      if (['Idle', 'Run'].includes(clip.name)) for (const name of Object.keys(bones)) {
        const first = samples[0].bones[name]; const last = samples.at(-1).bones[name];
        check(first.position.every((value, axis) => Math.abs(value - last.position[axis]) < .001) && Math.abs(new Quaternion().fromArray(first.quaternion).dot(new Quaternion().fromArray(last.quaternion))) > .9999, `${clip.name} 循环首尾不连续`);
      }
      check(samples.some((sample) => Object.entries(sample.bones).some(([name, transform]) => transform.quaternion.some((value, axis) => Math.abs(value - samples[0].bones[name].quaternion[axis]) > .001))), `${clip.name} 实际播放后姿态没有变化`);
      if (clip.name === 'Slide') check(samples.slice(1, -1).every((sample) => sample.bounds.max[1] <= .82), 'Slide 持续阶段身体未降低到滑铲碰撞体附近');
      if (clip.name === 'Run') {
        const left = samples.map((sample) => sample.bones.LeftFoot.position[2]); const right = samples.map((sample) => sample.bones.RightFoot.position[2]);
        check(Math.max(...left) - Math.min(...left) > .10 && Math.max(...right) - Math.min(...right) > .10, 'Run 左右腿没有实际交替摆动');
        check(left.some((value, i) => value < right[i] - .05) && left.some((value, i) => value > right[i] + .05), 'Run 左右腿方向未交换');
        const arms = samples.map((sample) => sample.bones.LeftHand.position[2] - sample.bones.RightHand.position[2]);
        check(left.some((value, i) => (value - right[i]) * arms[i] < -.005), 'Run 手臂与同侧腿未反向摆动');
        check(skinnedFeet.some((feet) => feet.left[2] < feet.right[2] - .08) && skinnedFeet.some((feet) => feet.left[2] > feet.right[2] + .08), 'Run 实际蒙皮双脚没有交替前后移动');
      }
      // Endpoint checks alone miss a foot going below ground during a transition.
      for (let i = 0; i <= 32; i++) {
        action.reset().play(); mixer.setTime(clip.duration * i / 32);
        const bounds = measureDeformed(scene);
        if (['Run', 'Slide'].includes(clip.name)) kneeSides(bones, `${clip.name} 连续采样 ${i}/32`);
        safeBounds(bounds, `${clip.name} 连续采样 ${i}/32`);
      }
      animationSamples[clip.name] = samples;
      action.stop(); mixer.stopAllAction(); reset();
    }
  } finally { mixer.stopAllAction(); mixer.uncacheRoot(scene); reset(); }
  const motionQuality = analyzeCharacterMotion(gltf, { includeSamples: false });
  assertCharacterMotionQuality(motionQuality, { requireTargets: true });
  return { boneCount: meshes[0].skeleton.bones.length, skinCount: gltf.parser.json.skins.length, skinnedMeshCount: meshes.length, animationCount: gltf.animations.length, animations: { ...CHARACTER_ANIMATIONS }, animationClips, animationSamples, poseTests, motionQuality };
}

export function validateRigManifest(entry) {
  check(entry.boneCount === 20 && entry.skinCount === 1 && Number.isSafeInteger(entry.skinnedMeshCount) && entry.skinnedMeshCount > 0 && entry.skinnedMeshCount <= 40 && entry.animationCount === 4, 'Manifest 骨骼/蒙皮/动画数量无效');
  check(JSON.stringify(entry.animations) === JSON.stringify(CHARACTER_ANIMATIONS), 'Manifest 动画映射无效');
  check(Array.isArray(entry.animationClips) && entry.animationClips.length === 4 && new Set(entry.animationClips.map((clip) => clip.name)).size === 4, 'Manifest 动作统计无效');
  for (const clip of entry.animationClips) check(Object.keys(clip).length === 3 && Object.values(CHARACTER_ANIMATIONS).includes(clip.name) && Number.isFinite(clip.duration) && clip.duration > 0 && clip.duration <= 5 && Number.isSafeInteger(clip.trackCount) && clip.trackCount > 0, 'Manifest 动作时长/轨道无效');
  check(entry.animationSamples && Object.keys(entry.animationSamples).length === 4 && Object.values(CHARACTER_ANIMATIONS).every((name) => Array.isArray(entry.animationSamples[name]) && entry.animationSamples[name].length === 5), 'Manifest 实际动画采样缺失');
  for (const [name, samples] of Object.entries(entry.animationSamples)) for (const [i, sample] of samples.entries()) {
    check(sample.progress === [0, .25, .5, .75, 1][i], 'Manifest 采样时间无效'); safeBounds(sample.bounds, `Manifest ${name}`);
    check(Object.keys(sample).length === 2, 'Manifest 采样仅保留实测时间与边界');
  }
  check(entry.poseTests && ['armRaise', 'elbowBend', 'legRaise', 'kneeBend'].every((name) => entry.poseTests[name]), 'Manifest 蒙皮姿态测试缺失');
  for (const [name, bounds] of Object.entries(entry.poseTests)) safeBounds(bounds, `Manifest ${name}`, -.20);
}
