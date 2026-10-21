/** The one registered humanoid generator; data cannot select executable code. */
export const CHARACTER_ROUGHNESS = Object.freeze({ jacket: .82, pants: .88, shoe: .75, skin: .85 });
export const CHARACTER_PARTS = Object.freeze(['Head', 'Neck', 'Torso', 'Pelvis', 'LeftUpperArm', 'LeftLowerArm', 'RightUpperArm', 'RightLowerArm', 'LeftUpperLeg', 'LeftLowerLeg', 'RightUpperLeg', 'RightLowerLeg', 'LeftFoot', 'RightFoot']);
export const CHARACTER_JOINT_PARTS = Object.freeze({ center: 'Pelvis', neck: 'Neck', head: 'Head', leftShoulder: 'LeftUpperArm', rightShoulder: 'RightUpperArm', leftElbow: 'LeftLowerArm', rightElbow: 'RightLowerArm', leftWrist: 'LeftHand', rightWrist: 'RightHand', leftHip: 'LeftUpperLeg', rightHip: 'RightUpperLeg', leftKnee: 'LeftLowerLeg', rightKnee: 'RightLowerLeg', leftAnkle: 'LeftFoot', rightAnkle: 'RightFoot' });
function check(condition, message) { if (!condition) throw new Error(message); }
function fields(value, keys, label) {
  check(value && typeof value === 'object' && !Array.isArray(value), `${label} 必须为对象`);
  check(Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)), `${label} 字段缺失或存在未知字段`);
}
function number(value, min, max, label) { check(Number.isFinite(value) && value >= min && value <= max, `${label} 必须是 ${min}..${max} 范围内的有限数值`); return value; }
export function normalizeCharacter(asset, base, label) {
  const required = ['id', 'type', 'generator', 'height', 'proportions', 'outfit', 'accessories'];
  fields(asset, [...required, ...(Object.hasOwn(asset, 'theme') ? ['theme'] : [])], label);
  check(asset.generator === 'humanoid-runner', `${label}.generator 必须是 humanoid-runner`);
  fields(asset.proportions, ['headScale', 'shoulderWidth', 'legLengthRatio'], `${label}.proportions`);
  fields(asset.outfit, ['jacketColor', 'pantsColor', 'shoeColor', 'skinColor'], `${label}.outfit`);
  fields(asset.accessories, ['backpack'], `${label}.accessories`);
  check(typeof asset.accessories.backpack === 'boolean', `${label}.accessories.backpack 必须是 boolean`);
  const outfit = {};
  for (const [key, color] of Object.entries(asset.outfit)) {
    check(typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color), `${label}.outfit.${key} 必须是 #RRGGBB`);
    outfit[key] = color.toUpperCase();
  }
  return { ...base, generator: 'humanoid-runner', height: number(asset.height, 1.65, 1.8, `${label}.height`), proportions: {
    headScale: number(asset.proportions.headScale, 1, 1.2, `${label}.proportions.headScale`),
    shoulderWidth: number(asset.proportions.shoulderWidth, .44, .56, `${label}.proportions.shoulderWidth`),
    legLengthRatio: number(asset.proportions.legLengthRatio, .43, .49, `${label}.proportions.legLengthRatio`),
  }, outfit, accessories: { backpack: asset.accessories.backpack } };
}
export function characterDimensions(asset) {
  const scale = asset.height / 1.75;
  return [asset.proportions.shoulderWidth + .24 * scale, asset.height, .5 * scale];
}
export function characterPalette(asset) {
  return Object.fromEntries(Object.entries(CHARACTER_ROUGHNESS).map(([role, roughness]) => [role, { color: asset.outfit[`${role}Color`], roughness, metalness: 0 }]));
}
