import { createHash } from 'node:crypto';
import { normalizeCharacter, characterDimensions } from './character-config.mjs';
import { readFile, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_CONFIG = resolve(PROJECT_ROOT, 'assets.config.json');
export const GENERATED_MANIFEST = resolve(PROJECT_ROOT, 'src/assets/generated/manifest.json');
export const GENERATOR_VERSION = '2.1.0';
export const BLENDER_VERSION = '5.2.2';
export const ASSET_TYPES = Object.freeze(['roadblock', 'traffic-cone', 'street-lamp', 'building', 'billboard', 'character', 'powerup']);
// Additive generator: existing 2.1.0 algorithms, seeds and exported bytes stay pinned.
// A future icon algorithm change must use a new generator identity in asset config.
export const POWERUP_GENERATOR = 'pickup-icon-v1';
const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const MATERIAL_ROLES = ['warning', 'light', 'base', 'building', 'buildingAccent', 'window', 'warmWindow', 'metal', 'lamp'];

function check(condition, message) { if (!condition) throw new Error(message); }
function object(value, label) { check(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} 必须为对象`); }
function fields(value, allowed, required, label) {
  object(value, label);
  for (const key of Object.keys(value)) check(allowed.includes(key), `${label}.${key} 是未知字段`);
  for (const key of required) check(Object.hasOwn(value, key), `${label}.${key} 缺失`);
}
function number(value, label, min, max, integer = false) {
  check(Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), `${label} 必须是 ${min}..${max} 范围内的${integer ? '整数' : '有限数值'}`);
  return value;
}
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function hashValue(value) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }

export function normalizeConfig(input) {
  fields(input, ['schemaVersion', 'blenderVersion', 'theme', 'seed', 'assets'], ['schemaVersion', 'blenderVersion', 'theme', 'seed', 'assets'], 'config');
  check(input.schemaVersion === 1, 'config.schemaVersion 必须为 1');
  check(input.blenderVersion === BLENDER_VERSION, `config.blenderVersion 必须锁定 ${BLENDER_VERSION}`);
  check(typeof input.theme === 'string' && SLUG.test(input.theme) && input.theme.length <= 64, 'config.theme 必须是受控主题 slug，不能包含路径');
  number(input.seed, 'config.seed', 0, 0xffffffff, true);
  check(Array.isArray(input.assets) && input.assets.length > 0 && input.assets.length <= 64, 'config.assets 必须包含 1..64 个资源');
  const ids = new Set();
  const assets = input.assets.map((asset, i) => {
    const label = `config.assets[${i}]`;
    object(asset, label);
    check(typeof asset.id === 'string' && SLUG.test(asset.id) && asset.id.length <= 64, `${label}.id 必须为小写 kebab-case，不能包含路径`);
    check(!ids.has(asset.id), `资源 ID 重复：${asset.id}`);
    ids.add(asset.id);
    check(ASSET_TYPES.includes(asset.type), `${label}.type 不受支持：${asset.type}`);
    if (Object.hasOwn(asset, 'theme')) check(typeof asset.theme === 'string' && SLUG.test(asset.theme) && asset.theme.length <= 64, `${label}.theme 必须是受控主题 slug，不能包含路径`);
    const base = { id: asset.id, type: asset.type, ...(asset.theme ? { theme: asset.theme } : {}) };
    const allowed = (keys) => ['id', 'type', 'theme', ...keys];
    const choice = (key, fallback, values) => { const value = Object.hasOwn(asset, key) ? asset[key] : fallback; check(values.includes(value), `${label}.${key} 必须是 ${values.join(' / ')}`); return value; };
    const field = (key, fallback, min, max, integer = false) => number(Object.hasOwn(asset, key) ? asset[key] : fallback, `${label}.${key}`, min, max, integer);
    if (asset.type === 'character') return normalizeCharacter(asset, base, label);
    if (asset.type === 'powerup') {
      fields(asset, allowed(['generator', 'variant', 'width', 'height', 'depth']), ['id', 'type', 'variant'], label);
      return { ...base, generator: choice('generator', POWERUP_GENERATOR, [POWERUP_GENERATOR]), variant: choice('variant', undefined, ['magnet', 'shield', 'double-score']), width: field('width', .85, .3, 1), height: field('height', .85, .3, 1), depth: field('depth', .3, .12, .4) };
    }
    if (asset.type === 'roadblock') {
      fields(asset, allowed(['width', 'height', 'depth']), ['id', 'type'], label);
      return { ...base, width: field('width', 2, .3, 6), height: field('height', .85, .2, 3), depth: field('depth', .9, .2, 4) };
    }
    if (asset.type === 'traffic-cone') {
      fields(asset, allowed(['height', 'baseSize', 'segments']), ['id', 'type'], label);
      return { ...base, height: field('height', 1.2, .3, 3), baseSize: field('baseSize', .6, .1, 2), segments: field('segments', 8, 8, 16, true) };
    }
    if (asset.type === 'street-lamp') {
      fields(asset, allowed(['height', 'armLength', 'baseSize', 'style']), ['id', 'type'], label);
      return { ...base, height: field('height', 4, 2, 12), armLength: field('armLength', .9, .2, 3), baseSize: field('baseSize', .5, .2, 1.5), style: choice('style', 'classic', ['classic', 'tech']) };
    }
    if (asset.type === 'billboard') {
      fields(asset, allowed(['width', 'height', 'depth']), ['id', 'type'], label);
      return { ...base, width: field('width', 2, .8, 4), height: field('height', 3.5, 2, 6), depth: field('depth', .5, .2, 1) };
    }
    fields(asset, allowed(['width', 'height', 'depth', 'variant', 'floors', 'windowsPerFloor', 'roofStyle', 'accentStyle']), ['id', 'type'], label);
    const variant = Object.hasOwn(asset, 'variant') ? asset.variant : 'residential';
    check(variant === 'residential' || variant === 'office', `${label}.variant 必须是 residential 或 office`);
    const floors = field('floors', variant === 'office' ? 6 : 4, 1, 16, true);
    const windowsPerFloor = field('windowsPerFloor', variant === 'office' ? 4 : 3, 1, 8, true);
    check(floors * windowsPerFloor <= 96, `${label} floors × windowsPerFloor 不能超过 96`);
    return { ...base, width: field('width', 4, 1, 20), height: field('height', 12, 2, 60), depth: field('depth', 4, 1, 20), variant, floors, windowsPerFloor, roofStyle: choice('roofStyle', 'flat', ['flat', 'equipment', 'terrace']), accentStyle: choice('accentStyle', 'plain', ['plain', 'neon']) };
  });
  return { schemaVersion: 1, blenderVersion: BLENDER_VERSION, theme: input.theme, seed: input.seed, assets };
}

export function validateTheme(input, expectedId) {
  fields(input, ['id', 'shading', 'materials', 'scene'], ['id', 'shading', 'materials', 'scene'], 'theme');
  check(typeof input.id === 'string' && SLUG.test(input.id) && input.id === expectedId, 'theme.id 必须与 config.theme 一致');
  check(input.shading === 'flat', 'theme.shading 必须为 flat');
  fields(input.materials, MATERIAL_ROLES, MATERIAL_ROLES, 'theme.materials');
  const materials = {};
  for (const name of MATERIAL_ROLES) {
    const value = input.materials[name];
    const label = `theme.materials.${name}`;
    fields(value, ['color', 'roughness', 'metalness', 'emissive', 'emissiveStrength'], ['color', 'roughness', 'metalness'], label);
    check(typeof value.color === 'string' && HEX.test(value.color), `${label}.color 必须是 #RRGGBB`);
    const material = { color: value.color.toUpperCase(), roughness: number(value.roughness, `${label}.roughness`, 0, 1), metalness: number(value.metalness, `${label}.metalness`, 0, 1) };
    if (Object.hasOwn(value, 'emissive') || Object.hasOwn(value, 'emissiveStrength')) {
      check(typeof value.emissive === 'string' && HEX.test(value.emissive), `${label}.emissive 必须是 #RRGGBB`);
      material.emissive = value.emissive.toUpperCase();
      material.emissiveStrength = number(value.emissiveStrength, `${label}.emissiveStrength`, 0, 1);
    }
    materials[name] = material;
  }
  fields(input.scene, ['road', 'background', 'coin', 'keyLight'], ['road', 'background', 'coin', 'keyLight'], 'theme.scene');
  const scene = {};
  for (const [key, value] of Object.entries(input.scene)) {
    check(typeof value === 'string' && HEX.test(value), `theme.scene.${key} 必须是 #RRGGBB`);
    scene[key] = value.toUpperCase();
  }
  return { id: input.id, shading: 'flat', materials, scene };
}

async function jsonFile(path, label) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`${label} 无法读取：${path}；${error.message}`); }
}
export async function readTheme(id) {
  check(typeof id === 'string' && SLUG.test(id) && id.length <= 64, 'theme 必须是受控主题 slug，不能包含路径');
  const root = await realpath(resolve(PROJECT_ROOT, 'themes'));
  const path = await realpath(resolve(root, `${id}.json`));
  const rel = relative(root, path);
  check(rel && !rel.startsWith(`..${sep}`) && rel !== '..', '主题文件必须位于 themes/ 内');
  return validateTheme(await jsonFile(path, '主题'), id);
}
export async function readConfig(path = DEFAULT_CONFIG) {
  const config = normalizeConfig(await jsonFile(resolve(path), '资源配置'));
  const ids = [...new Set([config.theme, ...config.assets.map((asset) => asset.theme ?? config.theme)])];
  const themes = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await readTheme(id)])));
  return { config, theme: themes[config.theme], themes };
}
export function selectAssets(config, only) {
  if (only === undefined) return config.assets;
  check(typeof only === 'string' && SLUG.test(only), '--only 必须是一个资源 ID');
  const asset = config.assets.find((entry) => entry.id === only);
  check(asset !== undefined, `--only 资源不存在：${only}`);
  return [asset];
}
export function assetSeed(seed, id) { return createHash('sha256').update(`${seed}:${id}`).digest().readUInt32LE(0); }
export function powerupPalette(asset) {
  const colors = asset.variant === 'magnet' ? ['#DF4054', '#FFD36B', '#FFF5DF'] : asset.variant === 'shield' ? ['#126A89', '#50E2F2', '#E5FCFF'] : ['#6550B9', '#FFD36B', '#FFF5DF'];
  return Object.fromEntries(['body', 'accent', 'mark'].map((role, index) => [role, { color: colors[index], roughness: role === 'body' ? .62 : .42, metalness: role === 'accent' ? .15 : 0 }]));
}
export function assetContract(asset, seed = 0) {
  const prefix = asset.id.replaceAll('-', '_');
  const roles = asset.type === 'powerup' ? ['body', 'accent', 'mark'] : asset.type === 'character' ? ['jacket', 'pants', 'shoe', 'skin'] : asset.type === 'street-lamp' ? ['metal', 'base', 'lamp'] : asset.type === 'building' ? ['body', 'trim', 'window', 'warm_window'] : asset.type === 'billboard' ? ['frame', 'cyan', 'magenta'] : ['orange', 'white', 'base'];
  const dimensions = asset.type === 'character' ? characterDimensions(asset) : asset.type === 'traffic-cone' ? [asset.baseSize, asset.height, asset.baseSize] : asset.type === 'street-lamp' ? [asset.armLength + asset.baseSize, asset.height, asset.baseSize] : [asset.width, asset.height, asset.depth];
  return { ...asset, path: `public/models/generated/${asset.id}.glb`, dimensions, materials: roles.map((role) => `${prefix}_${role}`), tolerance: .005, maxTriangles: asset.type === 'character' ? 3500 : asset.type === 'building' ? 3000 : 1000, maxBytes: asset.type === 'character' ? 409600 : asset.type === 'building' ? 262144 : 131072, assetSeed: assetSeed(seed, asset.id) };
}
export function configHash(config, theme, themes = { [theme.id]: theme }) { return hashValue({ generatorVersion: GENERATOR_VERSION, config, themes }); }
export function assetConfigHash(asset, config, theme) { return hashValue({ generatorVersion: GENERATOR_VERSION, blenderVersion: BLENDER_VERSION, asset, theme, seed: config.seed }); }
export function selectedTheme(asset, config, themes) {
  const id = asset.theme ?? config.theme;
  check(Object.hasOwn(themes, id) && themes[id].id === id, `资源 ${asset.id} 未加载主题 ${id}`);
  return themes[id];
}
export function createJob(config, theme, only, themes = { [theme.id]: theme }) {
  return { schemaVersion: 1, generatorVersion: GENERATOR_VERSION, blenderVersion: BLENDER_VERSION, themes, seed: config.seed, assets: selectAssets(config, only).map((asset) => { const { path: _path, ...contract } = assetContract(asset, config.seed); return { ...contract, themeId: selectedTheme(asset, config, themes).id }; }) };
}
export function parseCli(args, { file = false, only = false } = {}) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const raw = args[i];
    const equal = raw.indexOf('=');
    const key = equal < 0 ? raw : raw.slice(0, equal);
    check(key === '--config' || (file && key === '--file') || (only && key === '--only'), `未知参数：${raw}`);
    check(!Object.hasOwn(parsed, key.slice(2)), `参数重复：${key}`);
    const value = equal < 0 ? args[++i] : raw.slice(equal + 1);
    check(typeof value === 'string' && value.length > 0 && !value.startsWith('--'), `${key} 缺少值`);
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = parseCli(process.argv.slice(2));
    const { config, theme, themes } = await readConfig(args.config);
    console.log(`[配置] 通过：${config.assets.length} 个资源，主题 ${Object.keys(themes).join(' / ')}，seed ${config.seed}，Blender ${config.blenderVersion}`);
    console.log(`[配置摘要] ${configHash(config, theme, themes)}`);
  } catch (error) { console.error(`[配置验证失败] ${error.message}`); process.exitCode = 1; }
}
