import { validateRigManifest } from './character-rig-validation.mjs';
import { Box3, Vector3, Quaternion } from 'three';
import { CHARACTER_PARTS, CHARACTER_JOINT_PARTS } from './character-config.mjs';

function check(condition, message) { if (!condition) throw new Error(`角色：${message}`); }
function exact(value, keys, label) {
  check(value && typeof value === 'object' && !Array.isArray(value), `${label} 必须为对象`);
  check(Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)), `${label} 字段缺失或存在未知字段`);
}
function vector(value, label) { check(Array.isArray(value) && value.length === 3 && value.every(Number.isFinite), `${label} 必须为有限三维坐标`); }
function metadata(value, contract) {
  exact(value, ['schemaVersion', 'generator', 'forward', 'joints', 'parts', 'bones'], '参考信息');
  check(value.schemaVersion === 2 && value.generator === 'humanoid-runner', '参考信息版本/生成器无效');
  check(JSON.stringify(value.forward) === '[0,0,-1]', '正前方必须为 glTF -Z');
  exact(value.joints, Object.keys(CHARACTER_JOINT_PARTS), 'joints');
  for (const [name, point] of Object.entries(value.joints)) vector(point, `joint.${name}`);
  check(value.parts && typeof value.parts === 'object' && !Array.isArray(value.parts), 'parts 缺失');
  const names = Object.keys(value.parts);
  check(names.length >= 17 && names.length <= 24, '身体部件数量应为 17..24');
  for (const part of [...CHARACTER_PARTS, 'LeftHand', 'RightHand', 'Hair']) check(Object.hasOwn(value.parts, part), `缺少身体部件 ${part}`);
  check(Object.hasOwn(value.parts, 'Backpack') === contract.accessories.backpack, '背包与配置不一致');
  const prefix = contract.id.replaceAll('-', '_');
  for (const [name, nodeName] of Object.entries(value.parts)) check(/^[A-Z][A-Za-z]+$/.test(name) && nodeName === `${prefix}_${name}`, `部件 ${name} 节点名称无效`);
  return value;
}

/** Structural metadata is checked before the actual loader independently measures each body part. */
export function validateCharacterStructure(json, contract) {
  const roots = json.nodes.filter((node) => node.extras?.character !== undefined);
  check(roots.length === 1, '必须有且仅有一个含参考信息的模型根节点');
  const root = roots[0];
  check(root.name === `${contract.id.replaceAll('-', '_')}_Root` && root.mesh === undefined, '模型根节点必须为命名的非 Mesh 根');
  const info = metadata(root.extras.character, contract);
  check(json.scenes.length === 1 && json.scenes[0].nodes.length === 1 && json.nodes[json.scenes[0].nodes[0]] === root, '只允许导出角色的单一根层级');
  const names = json.nodes.map((node) => node.name);
  check(names.every((name) => typeof name === 'string') && new Set(names).size === names.length, '节点必须具有唯一名称');
  for (const name of Object.values(info.parts)) check(names.includes(name), `身体部件 ${name} 在 GLB 中不存在`);
  const visited = new Set();
  const visit = (id) => { check(!visited.has(id), '节点重复引用'); visited.add(id); for (const child of json.nodes[id].children ?? []) visit(child); };
  visit(json.scenes[0].nodes[0]);
  check(visited.size === json.nodes.length, '包含根层级外的无关节点');
}

const PARENTS = { Pelvis: null, Torso: 'Pelvis', Neck: 'Torso', Head: 'Neck', Hair: 'Head', Backpack: 'Torso',
  LeftUpperArm: 'Torso', RightUpperArm: 'Torso', LeftLowerArm: 'LeftUpperArm', RightLowerArm: 'RightUpperArm', LeftHand: 'LeftLowerArm', RightHand: 'RightLowerArm',
  LeftUpperLeg: 'Pelvis', RightUpperLeg: 'Pelvis', LeftLowerLeg: 'LeftUpperLeg', RightLowerLeg: 'RightUpperLeg', LeftFoot: 'LeftLowerLeg', RightFoot: 'RightLowerLeg' };

export function validateCharacterLoaded(scene, contract) {
  const roots = [];
  scene.traverse((object) => { if (object.userData.character !== undefined) roots.push(object); });
  check(roots.length === 1, 'Three.js 缺少唯一角色根参考信息');
  const root = roots[0];
  const info = metadata(root.userData.character, contract);
  const tolerance = contract.tolerance;
  const rootPosition = root.getWorldPosition(new Vector3());
  const rootRotation = root.getWorldQuaternion(new Quaternion());
  check(rootPosition.length() <= tolerance && Math.abs(rootRotation.x) < 1e-5 && Math.abs(rootRotation.y) < 1e-5 && Math.abs(rootRotation.z) < 1e-5 && Math.abs(Math.abs(rootRotation.w) - 1) < 1e-5, '根部必须位于世界原点且无旋转补偿');
  const partByNode = new Map(Object.entries(info.parts).map(([part, nodeName]) => [nodeName, part]));
  const parts = {};
  const measuredMeshes = new Set();
  for (const [part, nodeName] of Object.entries(info.parts)) {
    const object = scene.getObjectByName(nodeName);
    check(object, `Three.js 缺少部件 ${part}`);
    let parent = object.parent;
    while (parent && !partByNode.has(parent.name)) parent = parent.parent;
    const parentPart = parent ? partByNode.get(parent.name) : null;
    const box = new Box3();
    let triangles = 0;
    let meshCount = 0;
    const measure = (node) => {
      if (node !== object && partByNode.has(node.name)) return;
      if (node.isMesh) {
        measuredMeshes.add(node);
        const position = node.geometry.getAttribute('position');
        const point = new Vector3();
        for (let i = 0; i < position.count; i++) box.expandByPoint(node.getVertexPosition(i, point).applyMatrix4(node.matrixWorld));
        triangles += (node.geometry.index?.count ?? position.count) / 3;
        meshCount++;
      }
      for (const child of node.children) measure(child);
    };
    measure(object);
    check(!box.isEmpty() && triangles > 0, `${part} 必须包含有效几何体`);
    parts[part] = { nodeName, parent: parentPart, origin: object.getWorldPosition(new Vector3()).toArray(), bounds: { min: box.min.toArray(), max: box.max.toArray() }, triangles, meshCount };
  }
  scene.traverse((object) => { if (object.isMesh) check(measuredMeshes.has(object), `存在未登记的身体 Mesh ${object.name}`); });
  for (const [joint, part] of Object.entries(CHARACTER_JOINT_PARTS)) {
    const measured = info.joints[joint];
    check(parts[part] && measured, `缺少关节 ${joint} 的身体部件`);
    const bounds = parts[part].bounds;
    check(measured.every((value, axis) => value >= bounds.min[axis] - .04 && value <= bounds.max[axis] + .04), `关节 ${joint} 远离实际 ${part} 几何体`);
  }
  validateCharacterAnatomy(parts, info.joints, contract);
  return { joints: info.joints, parts };
}

/** These checks catch structural errors; they deliberately make no aesthetic judgment. */
export function validateCharacterAnatomy(parts, joints, contract) {
  const tolerance = .01;
  for (const part of ['UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot']) {
    const left = parts[`Left${part}`];
    const right = parts[`Right${part}`];
    check(left && right, `缺少成对部件 ${part}`);
    const l = left.bounds; const r = right.bounds;
    check(Math.abs(l.min[0] + r.max[0]) <= tolerance && Math.abs(l.max[0] + r.min[0]) <= tolerance && [1, 2].every((axis) => Math.abs(l.min[axis] - r.min[axis]) <= tolerance && Math.abs(l.max[axis] - r.max[axis]) <= tolerance), `${part} 左右几何不对称`);
  }
  for (const name of ['Shoulder', 'Elbow', 'Wrist', 'Hip', 'Knee', 'Ankle']) {
    const left = joints[`left${name}`]; const right = joints[`right${name}`];
    check(Math.abs(left[0] + right[0]) <= tolerance && Math.abs(left[1] - right[1]) <= tolerance && Math.abs(left[2] - right[2]) <= tolerance, `${name} 左右关节不对称`);
  }
  const separation = (first, second) => Math.hypot(...[0, 1, 2].map((axis) => Math.max(0, first.min[axis] - second.max[axis], second.min[axis] - first.max[axis])));
  for (const [part, parent] of Object.entries(PARENTS)) {
    if (!parent || !parts[part] || part === 'Backpack') continue;
    check(separation(parts[part].bounds, parts[parent].bounds) <= .035 * (contract.height / 1.75), `${part} 与 ${parent} 之间存在过大空隙`);
  }
  const h = contract.height;
  const center = (part, axis) => (parts[part].bounds.min[axis] + parts[part].bounds.max[axis]) / 2;
  check(center('Head', 1) > center('Neck', 1) && center('Neck', 1) > center('Torso', 1) && center('Torso', 1) > center('Pelvis', 1), '头/颈/躯干/骨盆高度关系异常');
  check(parts.Head.bounds.min[1] <= parts.Neck.bounds.max[1] + .025 && parts.Neck.bounds.min[1] <= parts.Torso.bounds.max[1] + .025, '头颈连接存在过大空隙');
  for (const side of ['Left', 'Right']) {
    const foot = parts[`${side}Foot`].bounds;
    check(Math.abs(foot.min[1]) <= contract.tolerance && foot.max[1] <= h * .16, `${side}Foot 必须接地且高度合理`);
    check(Math.abs(center(`${side}UpperArm`, 0)) >= Math.abs(center(`${side}UpperLeg`, 0)) + .05, `${side} 手臂未位于身体外侧`);
    const shoulder = joints[`${side.toLowerCase()}Shoulder`]; const elbow = joints[`${side.toLowerCase()}Elbow`]; const wrist = joints[`${side.toLowerCase()}Wrist`];
    const hip = joints[`${side.toLowerCase()}Hip`]; const knee = joints[`${side.toLowerCase()}Knee`]; const ankle = joints[`${side.toLowerCase()}Ankle`];
    check(shoulder[1] > elbow[1] && elbow[1] > wrist[1] && hip[1] > knee[1] && knee[1] > ankle[1], `${side} 肢体关节顺序异常`);
  }
  check(parts.LeftUpperLeg.bounds.min[0] >= parts.RightUpperLeg.bounds.max[0] + .005 || parts.RightUpperLeg.bounds.min[0] >= parts.LeftUpperLeg.bounds.max[0] + .005, '双腿明显重叠');
  if (contract.accessories.backpack) {
    const back = parts.Backpack?.bounds; const torso = parts.Torso.bounds;
    check(back && center('Backpack', 2) > center('Torso', 2) && back.min[2] <= torso.max[2] + .035 && back.max[2] >= torso.max[2] && back.min[1] >= torso.min[1] - .08 && back.max[1] <= torso.max[1] + .08, '背包必须贴近躯干背面，不能悬空或远离身体');
  }
}

export function validateCharacterManifest(entry, contract) {
  check(entry.assetId === contract.id, 'Manifest assetId 不一致');
  check(Number.isFinite(entry.height) && Math.abs(entry.height - entry.dimensions[1]) <= contract.tolerance && Math.abs(entry.height - contract.height) <= contract.tolerance, 'Manifest 高度不一致');
  exact(entry.bounds, ['min', 'max'], 'Manifest.bounds');
  vector(entry.bounds.min, 'Manifest.bounds.min'); vector(entry.bounds.max, 'Manifest.bounds.max');
  check(entry.bounds.min.every((value, axis) => Math.abs(entry.bounds.max[axis] - value - entry.dimensions[axis]) <= contract.tolerance), 'Manifest bounds 与 dimensions 不一致');
  exact(entry.joints, Object.keys(CHARACTER_JOINT_PARTS), 'Manifest.joints');
  for (const [name, point] of Object.entries(entry.joints)) vector(point, `Manifest.joints.${name}`);
  check(entry.parts && typeof entry.parts === 'object' && Object.keys(entry.parts).length >= 17 && Object.keys(entry.parts).length <= 24, 'Manifest.parts 无效');
  for (const [part, data] of Object.entries(entry.parts)) {
    exact(data, ['nodeName', 'parent', 'origin', 'bounds', 'triangles', 'meshCount'], `Manifest.parts.${part}`);
    check(data.nodeName === `${contract.id.replaceAll('-', '_')}_${part}` && (data.parent === null || typeof data.parent === 'string'), 'Manifest 身体节点/父节点无效');
    vector(data.origin, `Manifest.parts.${part}.origin`);
    exact(data.bounds, ['min', 'max'], `Manifest.parts.${part}.bounds`);
    vector(data.bounds.min, `Manifest.parts.${part}.bounds.min`); vector(data.bounds.max, `Manifest.parts.${part}.bounds.max`);
    check(Number.isSafeInteger(data.triangles) && data.triangles > 0 && Number.isSafeInteger(data.meshCount) && data.meshCount > 0, 'Manifest 身体几何统计无效');
  }
  for (const part of [...CHARACTER_PARTS, 'LeftHand', 'RightHand', 'Hair']) check(entry.parts[part], `Manifest 缺少部件 ${part}`);
  validateCharacterAnatomy(entry.parts, entry.joints, contract);
  validateRigManifest(entry);
}
