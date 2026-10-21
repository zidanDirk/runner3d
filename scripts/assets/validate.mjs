import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Box3, Vector3 } from 'three';
import { validateRigStructure, validateRigLoaded, measureDeformed } from './character-rig-validation.mjs';
import { characterPalette } from './character-config.mjs';
import { validateCharacterStructure, validateCharacterLoaded, validateCharacterManifest } from './character-validation.mjs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PROJECT_ROOT, GENERATED_MANIFEST, GENERATOR_VERSION, BLENDER_VERSION, readConfig, assetContract, assetConfigHash, configHash, stableStringify, selectedTheme, parseCli, powerupPalette } from './config.mjs';

export { PROJECT_ROOT };
export const DEFAULT_MANIFEST = GENERATED_MANIFEST;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const COMPONENT_BYTES = new Map([[5120, 1], [5121, 1], [5122, 2], [5123, 2], [5125, 4], [5126, 4]]);
const TYPE_COMPONENTS = new Map([['SCALAR', 1], ['VEC2', 2], ['VEC3', 3], ['VEC4', 4], ['MAT2', 4], ['MAT3', 9], ['MAT4', 16]]);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function index(value, collection, label) {
  check(Number.isInteger(value) && value >= 0 && value < collection.length, `${label} 引用无效`);
  return collection[value];
}

function natural(value, label, minimum = 0) {
  check(Number.isSafeInteger(value) && value >= minimum, `${label} 必须是 >= ${minimum} 的整数`);
  return value;
}

function finiteVector(value, length, label) {
  check(Array.isArray(value) && value.length === length && value.every(Number.isFinite), `${label} 数值无效`);
}

/** Compatibility helper: the old single-resource API now derives its contract from unified config. */
export async function readManifest(configPath, id = 'roadblock') {
  const { config } = await readConfig(configPath);
  const asset = config.assets.find((item) => item.id === id);
  check(asset, `配置缺少资源：${id}`);
  return assetContract(asset, config.seed);
}

/** Deliberately validates our small uncompressed, texture-free asset contract, not all glTF extensions. */
export function validateGlbStructure(buffer, manifest) {
  check(buffer.length >= 20, 'GLB 文件头或 JSON chunk 缺失');
  check(buffer.readUInt32LE(0) === 0x46546c67, 'GLB magic 无效');
  check(buffer.readUInt32LE(4) === 2, 'GLB version 必须是 2');
  check(buffer.readUInt32LE(8) === buffer.length, 'GLB 声明长度与实际长度不一致');
  check(buffer.length % 4 === 0, 'GLB 长度必须四字节对齐');
  const chunks = [];
  for (let offset = 12; offset < buffer.length;) {
    check(offset + 8 <= buffer.length, 'GLB chunk 头越界');
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    check(length > 0 && length % 4 === 0 && offset + 8 + length <= buffer.length, 'GLB chunk 长度或对齐无效');
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }
  check(chunks.length === 2 && chunks[0].type === JSON_CHUNK && chunks[1].type === BIN_CHUNK, 'GLB 必须包含依次排列的唯一 JSON 和 BIN chunk');
  let json;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(chunks[0].data));
  } catch (error) {
    throw new Error(`glTF JSON 无效：${error.message}`);
  }
  check(json && typeof json === 'object' && !Array.isArray(json) && json.asset?.version === '2.0', 'glTF asset.version 必须是 2.0');
  function noExtensions(value) {
    if (!value || typeof value !== 'object') return;
    check(!Object.hasOwn(value, 'extensions'), '当前资源契约不允许 extensions');
    for (const item of Object.values(value)) noExtensions(item);
  }
  noExtensions(json);
  const character = manifest.type === 'character';
  for (const key of ['textures', 'images', 'samplers', 'cameras', 'extensionsRequired', 'extensionsUsed', ...(!character ? ['animations', 'skins'] : [])]) {
    check(json[key] === undefined || (Array.isArray(json[key]) && json[key].length === 0), `当前资源契约不允许 ${key}`);
  }
  check(Array.isArray(json.buffers) && json.buffers.length === 1 && json.buffers[0].uri === undefined, 'GLB 必须仅使用一个内嵌 buffer，禁止外部 URI');
  const binaryLength = natural(json.buffers[0].byteLength, 'buffer.byteLength', 1);
  check(binaryLength <= chunks[1].data.length && chunks[1].data.length - binaryLength <= 3, 'BIN 与 buffer.byteLength 不一致');
  check(Array.isArray(json.bufferViews) && json.bufferViews.length > 0, 'glTF bufferViews 缺失');
  for (const view of json.bufferViews) {
    check(view.buffer === 0, 'bufferView.buffer 必须引用内嵌 buffer');
    const start = natural(view.byteOffset ?? 0, 'bufferView.byteOffset');
    const length = natural(view.byteLength, 'bufferView.byteLength', 1);
    check(start + length <= binaryLength, 'bufferView 超出 BIN 范围');
    if (view.byteStride !== undefined) {
      natural(view.byteStride, 'bufferView.byteStride', 4);
      check(view.byteStride <= 252 && view.byteStride % 4 === 0, 'bufferView.byteStride 无效');
    }
  }
  check(Array.isArray(json.accessors) && json.accessors.length > 0, 'glTF accessors 缺失');
  for (const accessor of json.accessors) {
    check(accessor.sparse === undefined, '当前资源契约不允许 sparse accessor');
    const view = index(accessor.bufferView, json.bufferViews, 'accessor.bufferView');
    const components = TYPE_COMPONENTS.get(accessor.type);
    const bytes = COMPONENT_BYTES.get(accessor.componentType);
    check(components !== undefined && bytes !== undefined, 'accessor.type / componentType 无效');
    check(accessor.normalized === undefined || typeof accessor.normalized === 'boolean', 'accessor.normalized 必须为 boolean');
    check(accessor.normalized !== true || [5120, 5121, 5122, 5123].includes(accessor.componentType), 'accessor.normalized 仅适用于 8/16 位整数');
    const count = natural(accessor.count, 'accessor.count', 1);
    const start = natural(accessor.byteOffset ?? 0, 'accessor.byteOffset');
    const elementSize = components * bytes;
    const stride = view.byteStride ?? elementSize;
    check(start % bytes === 0 && (view.byteOffset ?? 0) % bytes === 0 && stride >= elementSize && stride % bytes === 0, 'accessor 对齐或 stride 无效');
    check(start + (count - 1) * stride + elementSize <= view.byteLength, 'accessor 超出 bufferView 范围');
    for (const key of ['min', 'max']) if (accessor[key] !== undefined) finiteVector(accessor[key], components, `accessor.${key}`);
  }
  check(Array.isArray(json.materials) && json.materials.length > 0, 'glTF 材质缺失');
  check(json.materials.length <= 4, `glTF 材质数量不能超过 4`);
  const names = json.materials.map((material) => material.name);
  check(names.length === manifest.materials.length && new Set(names).size === names.length && manifest.materials.every((name) => names.includes(name)), 'glTF 材质名称与 manifest 不一致');
  for (const material of json.materials) {
    check(material.alphaMode === undefined || material.alphaMode === 'OPAQUE', '当前资源契约仅允许不透明材质');
    const pbr = material.pbrMetallicRoughness ?? {};
    check(pbr.baseColorTexture === undefined && pbr.metallicRoughnessTexture === undefined && material.normalTexture === undefined && material.occlusionTexture === undefined && material.emissiveTexture === undefined, '当前资源契约不允许材质纹理');
    for (const [key, length] of [['baseColorFactor', 4]]) {
      if (pbr[key] !== undefined) { finiteVector(pbr[key], length, `material.${key}`); check(pbr[key].every((value) => value >= 0 && value <= 1), `material.${key} 超出 0..1`); }
    }
    for (const key of ['roughnessFactor', 'metallicFactor']) if (pbr[key] !== undefined) check(Number.isFinite(pbr[key]) && pbr[key] >= 0 && pbr[key] <= 1, `material.${key} 超出 0..1`);
    if (material.emissiveFactor !== undefined) { finiteVector(material.emissiveFactor, 3, 'material.emissiveFactor'); check(material.emissiveFactor.every((value) => value >= 0 && value <= 1), 'material.emissiveFactor 超出 0..1'); }
  }
  check(Array.isArray(json.meshes) && json.meshes.length > 0, 'glTF Mesh 缺失');
  check(character ? json.meshes.length >= 17 && json.meshes.length <= 24 : json.meshes.length === 1, character ? '角色 glTF Mesh 数量必须为 17..24' : '资源必须合并为一个 glTF Mesh');
  let triangles = 0;
  let primitiveCount = 0;
  for (const mesh of json.meshes) {
    check(Array.isArray(mesh.primitives) && mesh.primitives.length > 0, 'Mesh primitives 缺失');
    primitiveCount += mesh.primitives.length;
    for (const primitive of mesh.primitives) {
      check((primitive.mode ?? 4) === 4, 'Mesh 必须使用三角形');
      check(primitive.targets === undefined, '当前资源契约不允许 morph targets');
      const position = index(primitive.attributes?.POSITION, json.accessors, 'Mesh POSITION');
      check(position.type === 'VEC3' && position.componentType === 5126, 'Mesh POSITION 必须是 FLOAT VEC3');
      check(Object.keys(primitive.attributes).every((name) => ['POSITION', 'NORMAL', ...(character ? ['JOINTS_0', 'WEIGHTS_0'] : [])].includes(name)), '当前资源契约仅允许 POSITION / NORMAL，禁止蒙皮权重或额外属性');
      const normal = index(primitive.attributes.NORMAL, json.accessors, 'Mesh NORMAL');
      check(normal.type === 'VEC3' && normal.componentType === 5126 && normal.count === position.count, 'Mesh NORMAL 必须与 POSITION 对应');
      for (const accessorId of Object.values(primitive.attributes)) index(accessorId, json.accessors, 'Mesh attribute');
      index(primitive.material, json.materials, 'Mesh material');
      let count = position.count;
      if (primitive.indices !== undefined) {
        const indices = index(primitive.indices, json.accessors, 'Mesh indices');
        check(indices.type === 'SCALAR' && [5121, 5123, 5125].includes(indices.componentType), 'Mesh indices 格式无效');
        count = indices.count;
      }
      check(count % 3 === 0, 'Mesh 顶点/索引数不能构成三角形');
      triangles += count / 3;
    }
  }
  check(primitiveCount <= (character ? 40 : 4), `primitive 数 ${primitiveCount} 超出上限 ${character ? 40 : 4}`);
  check(triangles <= manifest.maxTriangles, `三角形数 ${triangles} 超出上限 ${manifest.maxTriangles}`);
  check(Array.isArray(json.nodes) && json.nodes.length > 0, 'glTF nodes 缺失');
  for (const node of json.nodes) {
    check(node.camera === undefined && (character || node.skin === undefined) && node.extensions === undefined, 'node 包含无关或不支持的对象');
    if (node.mesh !== undefined) index(node.mesh, json.meshes, 'node.mesh');
    for (const [key, length] of [['translation', 3], ['rotation', 4], ['scale', 3], ['matrix', 16]]) {
      if (node[key] !== undefined) finiteVector(node[key], length, `node.${key}`);
    }
    check(node.scale === undefined || node.scale.every((value) => value > 0), 'node 禁止负缩放或零缩放');
    check(node.scale === undefined || node.scale.every((value) => Math.abs(value - 1) <= 1e-6), 'node 必须使用单位缩放');
    check(node.matrix === undefined || (node.translation === undefined && node.rotation === undefined && node.scale === undefined), 'node.matrix 与 TRS 不能同时存在');
    check(node.children === undefined || Array.isArray(node.children), 'node.children 必须为数组');
    for (const child of node.children ?? []) index(child, json.nodes, 'node.children');
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    check(!visiting.has(id), 'node 层级存在循环');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of json.nodes[id].children ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  }
  json.nodes.forEach((_, id) => visit(id));
  check(Array.isArray(json.scenes) && json.scenes.length > 0, 'glTF scenes 缺失');
  const scene = index(json.scene ?? 0, json.scenes, 'glTF scene');
  check(Array.isArray(scene.nodes) && scene.nodes.length > 0, 'glTF 默认场景为空');
  for (const id of scene.nodes) index(id, json.nodes, 'scene.nodes');
  if (character) {
    validateCharacterStructure(json, manifest);
    const info = json.nodes.find((node) => node.extras?.character)?.extras.character;
    validateRigStructure(json, chunks[1].data, info);
  }
  return { json, triangles, primitiveCount };
}

export async function validateThreeLoad(buffer, manifest) {
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const gltf = await new GLTFLoader().parseAsync(data, '');
  const materials = new Set();
  let triangles = 0;
  try {
    check((manifest.type === 'character' || gltf.animations.length === 0) && gltf.cameras.length === 0, 'Three.js 场景含无关动画或相机');
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
      check(object.scale.toArray().every((value) => Number.isFinite(value) && Math.abs(value - 1) <= 1e-6) && object.matrixWorld.determinant() > 0, 'Three.js 对象必须为单位缩放，不能通过 node.matrix 补偿');
      if (!object.isMesh) return;
      const position = object.geometry.getAttribute('position');
      check(position?.count > 0, 'Three.js Mesh 缺少 position');
      for (let i = 0; i < position.count; i++) {
        check([position.getX(i), position.getY(i), position.getZ(i)].every(Number.isFinite), 'Three.js 顶点含非有限数值');
      }
      const indices = object.geometry.index;
      if (indices) {
        for (let i = 0; i < indices.count; i++) check(indices.getX(i) < position.count, 'Three.js Mesh 索引越界');
      }
      triangles += (indices?.count ?? position.count) / 3;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        check(material.isMeshStandardMaterial && material.color?.toArray().every(Number.isFinite), 'Three.js 材质异常');
        materials.add(material.name);
      }
    });
    check(triangles > 0 && triangles <= manifest.maxTriangles, `Three.js 实际三角形数 ${triangles} 不符合预算`);
    check(materials.size === manifest.materials.length && manifest.materials.every((name) => materials.has(name)), 'Three.js 实际材质与 manifest 不一致');
    const measured = manifest.type === 'character' ? measureDeformed(gltf.scene) : undefined;
    const box = measured ? new Box3(new Vector3().fromArray(measured.min), new Vector3().fromArray(measured.max)) : new Box3().setFromObject(gltf.scene, true);
    const dimensions = box.getSize(new Vector3()).toArray();
    const center = box.getCenter(new Vector3());
    check(dimensions.every((value, axis) => Number.isFinite(value) && value > 0 && Math.abs(value - manifest.dimensions[axis]) <= manifest.tolerance), `Three.js 模型尺寸异常：${dimensions.join(' × ')}，预期 ${manifest.dimensions.join(' × ')}`);
    check(Math.abs(box.min.y) <= manifest.tolerance && Math.abs(center.x) <= manifest.tolerance && Math.abs(center.z) <= manifest.tolerance, 'Three.js 模型原点异常：要求底部 y=0，x/z 居中');
    const character = manifest.type === 'character' ? validateCharacterLoaded(gltf.scene, manifest) : undefined;
    const rig = character ? validateRigLoaded(gltf, (() => { let info; gltf.scene.traverse((node) => { if (node.userData.character) info = node.userData.character; }); return info; })()) : undefined;
    return { dimensions, triangles, materials: [...materials], min: box.min.toArray(), max: box.max.toArray(), ...(character ? { character: { ...character, ...rig } } : {}) };
  } finally {
    const geometries = new Set();
    const loadedMaterials = new Set();
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) loadedMaterials.add(material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    loadedMaterials.forEach((material) => material.dispose());
  }
}

export async function validateAsset({ filePath, configPath, manifest: suppliedContract, theme, log = () => {} } = {}) {
  const manifest = suppliedContract ?? await readManifest(configPath);
  const target = resolve(filePath ?? resolve(PROJECT_ROOT, manifest.path));
  const info = await stat(target);
  check(info.isFile() && info.size > 0, `资源不存在、为空或不是文件：${target}`);
  check(info.size <= manifest.maxBytes, `文件大小 ${info.size} 超出上限 ${manifest.maxBytes}`);
  const buffer = await readFile(target);
  log(`[静态文件] 通过：${target} (${buffer.length} bytes)`);
  const structure = validateGlbStructure(buffer, manifest);
  if (theme || manifest.type === 'character' || manifest.type === 'powerup') validateMaterialTheme(structure.json, manifest, theme);
  log(`[GLB 结构] 通过：glTF 2.0，内嵌 buffer，${structure.json.meshes.length} Mesh，${structure.triangles} 三角形，${structure.json.materials.length} 材质`);
  const three = await validateThreeLoad(buffer, manifest);
  if (three.character) log(`[角色几何] 通过：${Object.keys(three.character.parts).length} 身体部件，${Object.keys(three.character.joints).length} 真实骨骼关节，左右对称/肢体连接/双脚接地/背包位置`);
  if (three.character) log(`[骨骼/动画] 通过：${three.character.skinCount} Skin / ${three.character.boneCount} Bone / ${three.character.skinnedMeshCount} SkinnedMesh，四个实际 AnimationMixer 动作 × 五个记录采样 / 33 点连续 CPU 蒙皮检查，四个关节姿态测试`);
  if (three.character) {
    const quality = three.character.motionQuality;
    log(`[运动质量] 通过：实际鞋底 ${quality.sampling.intervals + 1} 点，最大穿透 ${(quality.penetration * 1000).toFixed(2)}mm，半周期镜像 ${(quality.symmetry.max * 1000).toFixed(4)}mm，身体循环速度差 ${quality.bodyVelocitySeam.toFixed(4)}m/s；残余脚滑另报告，不代表美术验收`);
  }
  check(three.triangles === structure.triangles, 'Three.js 实际场景三角形数与 glTF Mesh 不一致（可能重复或隐藏 Mesh）');
  log(`[实际 Three.js 加载] 通过：GLTFLoader.parseAsync，尺寸 ${three.dimensions.map((value) => value.toFixed(4)).join(' × ')} m，底部 y=${three.min[1].toFixed(4)}`);
  return { filePath: target, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), structure, three };
}

function linearColor(hex) {
  return [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
}
export function validateMaterialTheme(json, contract, theme) {
  const palette = contract.type === 'powerup' ? powerupPalette(contract) : contract.type === 'character' ? characterPalette(contract) : theme.materials;
  const roles = contract.type === 'powerup' ? { body: 'body', accent: 'accent', mark: 'mark' } : contract.type === 'character' ? { jacket: 'jacket', pants: 'pants', shoe: 'shoe', skin: 'skin' } : contract.type === 'building' ? { body: 'building', trim: 'buildingAccent', window: 'window', warm_window: 'warmWindow' }
    : contract.type === 'street-lamp' ? { metal: 'metal', base: 'base', lamp: 'lamp' }
    : contract.type === 'billboard' ? { frame: 'base', cyan: 'window', magenta: 'warmWindow' }
    : { orange: 'warning', white: 'light', base: 'base' };
  const prefix = `${contract.id.replaceAll('-', '_')}_`;
  for (const material of json.materials) {
    const role = roles[material.name.slice(prefix.length)];
    const expected = palette[role];
    check(expected, `材质 ${material.name} 不在主题角色内`);
    const pbr = material.pbrMetallicRoughness ?? {};
    const color = pbr.baseColorFactor ?? [1, 1, 1, 1];
    check(linearColor(expected.color).every((value, i) => Math.abs(value - color[i]) <= 2e-5) && color[3] === 1, `材质 ${material.name} 颜色与主题不一致`);
    check(Math.abs((pbr.roughnessFactor ?? 1) - expected.roughness) <= 2e-5 && Math.abs((pbr.metallicFactor ?? 1) - expected.metalness) <= 2e-5, `材质 ${material.name} PBR 参数与主题不一致`);
    const emissive = material.emissiveFactor ?? [0, 0, 0];
    const expectedEmissive = expected.emissive ? linearColor(expected.emissive).map((value) => value * expected.emissiveStrength) : [0, 0, 0];
    check(expectedEmissive.every((value, i) => Math.abs(value - emissive[i]) <= 2e-5), `材质 ${material.name} 发光参数与主题不一致`);
  }
}

export function assetRole(type) { return type === 'powerup' ? 'pickup' : type === 'character' ? 'player' : type === 'roadblock' ? 'obstacle' : type === 'traffic-cone' ? 'preview' : 'decoration'; }
export function createManifestEntry(asset, config, theme, result) {
  return {
    path: `models/generated/${asset.id}.glb`, type: asset.type, role: assetRole(asset.type), themeId: theme.id,
    dimensions: result.three.dimensions, triangles: result.three.triangles,
    meshCount: result.structure.json.meshes.length, primitiveCount: result.structure.primitiveCount,
    materialCount: result.structure.json.materials.length, materials: result.structure.json.materials.map((item) => item.name).sort(),
    bytes: result.bytes, sha256: result.sha256, generatorVersion: GENERATOR_VERSION, blenderVersion: BLENDER_VERSION,
    configHash: assetConfigHash(asset, config, theme), config: asset,
    ...(asset.type === 'character' ? { assetId: asset.id, height: result.three.dimensions[1], bounds: { min: result.three.min, max: result.three.max }, joints: result.three.character.joints, parts: result.three.character.parts, boneCount: result.three.character.boneCount, skinCount: result.three.character.skinCount, skinnedMeshCount: result.three.character.skinnedMeshCount, animationCount: result.three.character.animationCount, animations: result.three.character.animations, animationClips: result.three.character.animationClips,
      // Keep the distributed catalog compact; full sampled bone poses remain in validateAsset's result.
      animationSamples: Object.fromEntries(Object.entries(result.three.character.animationSamples).map(([name, samples]) => [name, samples.map(({ progress, bounds }) => ({ progress, bounds }))])), poseTests: result.three.character.poseTests } : {}),
  };
}
export function createGeneratedManifest(config, theme, entries, themes = { [theme.id]: theme }) {
  return { schemaVersion: 1, generatorVersion: GENERATOR_VERSION, blenderVersion: BLENDER_VERSION,
    theme: theme.id, seed: config.seed, configHash: configHash(config, theme, themes), assets: entries };
}
function exactFields(value, expected, label) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} 必须为对象`);
  check(Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key)), `${label} 字段缺失或存在未知字段`);
}
export function validateManifestShape(manifest, config, theme, { allowStaleRoot = false, themes = { [theme.id]: theme } } = {}) {
  exactFields(manifest, ['schemaVersion', 'generatorVersion', 'blenderVersion', 'theme', 'seed', 'configHash', 'assets'], 'manifest');
  check(manifest.schemaVersion === 1 && manifest.generatorVersion === GENERATOR_VERSION && manifest.blenderVersion === BLENDER_VERSION, 'Manifest schema/生成器/Blender 版本不一致，请全量生成');
  check(manifest.theme === theme.id && manifest.seed === config.seed, 'Manifest 主题或 seed 过期，请全量生成');
  if (!allowStaleRoot) check(manifest.configHash === configHash(config, theme, themes), 'Manifest 配置摘要不一致，请全量生成');
  check(typeof manifest.configHash === 'string' && /^[a-f0-9]{64}$/.test(manifest.configHash), 'Manifest configHash 无效');
  exactFields(manifest.assets, config.assets.map((asset) => asset.id), 'manifest.assets');
  for (const asset of config.assets) {
    const entry = manifest.assets[asset.id];
    exactFields(entry, ['path', 'type', 'role', 'themeId', 'dimensions', 'triangles', 'meshCount', 'primitiveCount', 'materialCount', 'materials', 'bytes', 'sha256', 'generatorVersion', 'blenderVersion', 'configHash', 'config', ...(asset.type === 'character' ? ['assetId', 'height', 'bounds', 'joints', 'parts', 'boneCount', 'skinCount', 'skinnedMeshCount', 'animationCount', 'animations', 'animationClips', 'animationSamples', 'poseTests'] : [])], `manifest.assets.${asset.id}`);
    check(entry.themeId === (asset.theme ?? config.theme), `Manifest ${asset.id} 主题不一致`);
    check(entry.path === `models/generated/${asset.id}.glb` && entry.type === asset.type && entry.role === assetRole(asset.type), `Manifest ${asset.id} 路径、类型或角色不一致`);
    check(entry.generatorVersion === GENERATOR_VERSION && entry.blenderVersion === BLENDER_VERSION, `Manifest ${asset.id} 版本不一致`);
    for (const key of ['sha256', 'configHash']) check(typeof entry[key] === 'string' && /^[a-f0-9]{64}$/.test(entry[key]), `Manifest ${asset.id}.${key} 无效`);
    finiteVector(entry.dimensions, 3, `Manifest ${asset.id}.dimensions`);
    check(entry.dimensions.every((value) => value > 0), `Manifest ${asset.id} 尺寸无效`);
    for (const key of ['triangles', 'meshCount', 'primitiveCount', 'materialCount', 'bytes']) natural(entry[key], `Manifest ${asset.id}.${key}`, 1);
    if (asset.type === 'character') validateCharacterManifest(entry, assetContract(asset, config.seed));
    check(Array.isArray(entry.materials) && entry.materials.every((name) => typeof name === 'string') && entry.materials.length === entry.materialCount && new Set(entry.materials).size === entry.materials.length, `Manifest ${asset.id}.materials 无效`);
  }
  return manifest;
}
export function assertEntryCurrent(entry, asset, config, theme) {
  check(entry.configHash === assetConfigHash(asset, config, theme) && stableStringify(entry.config) === stableStringify(asset), `资源 ${asset.id} 的配置或主题过期，请运行全量 npm run assets:generate`);
}
export function assertEntryMatches(entry, actual, id) {
  check(stableStringify(entry) === stableStringify(actual), `Manifest ${id} 与实际 GLB 的统计、内容哈希、尺寸或配置不一致`);
}
export async function readGeneratedManifest(path = DEFAULT_MANIFEST) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`无法读取生成 Manifest，请先运行 npm run assets:generate：${error.message}`); }
}
export async function validateAssets({ configPath, manifestPath = DEFAULT_MANIFEST, log = () => {} } = {}) {
  const { config, theme, themes } = await readConfig(configPath);
  log(`[配置] 通过：${config.assets.length} 个资源，seed=${config.seed}，Blender=${config.blenderVersion}`);
  const manifest = validateManifestShape(await readGeneratedManifest(manifestPath), config, theme, { themes });
  const results = {};
  for (const asset of config.assets) {
    const entry = manifest.assets[asset.id];
    const palette = selectedTheme(asset, config, themes);
    assertEntryCurrent(entry, asset, config, palette);
    const result = await validateAsset({ manifest: assetContract(asset, config.seed), theme: palette, log });
    assertEntryMatches(entry, createManifestEntry(asset, config, palette, result), asset.id);
    results[asset.id] = result;
    log(`[Manifest] ${asset.id} 与真实文件/Three.js 统计一致，sha256=${result.sha256}`);
  }
  log('[浏览器视觉] 此命令不作视觉结论；需另运行 Playwright 并检查预览和游戏截图。');
  return { config, theme, manifest, results };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = parseCli(process.argv.slice(2), { file: true });
    if (args.file) {
      const { config, theme } = await readConfig(args.config);
      const asset = config.assets.find((item) => item.id === 'roadblock');
      check(asset, '--file 验证 roadblock 契约，配置必须包含 roadblock');
      await validateAsset({ filePath: args.file, manifest: assetContract(asset, config.seed), theme, log: console.log });
      console.log('[浏览器视觉] 未执行；需另运行 Playwright 并查看截图。');
    } else await validateAssets({ configPath: args.config, log: console.log });
  } catch (error) { console.error(`[资源验证失败] ${error.message}`); process.exitCode = 1; }
}
