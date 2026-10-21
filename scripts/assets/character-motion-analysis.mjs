import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AnimationMixer, LoopOnce, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Versioned regression budgets, not a universal score for animation aesthetics. */
export const MOTION_HARD_LIMITS = Object.freeze({ penetration: .010, mirroredMax: .035, mirroredRms: .012, loopPosition: .001, loopAngle: Math.PI / 360, bodyVelocitySeam: .25, supportMin: .25, supportMax: .65, supportDutyDifference: .05, reversedSupportFraction: .05, supportSpeedCv: .20 });
export const MOTION_TARGETS = Object.freeze({ penetration: .003, mirroredMax: .005, bodyVelocitySeam: .08 });
export const DEFAULT_SPEED_CASES = Object.freeze([Object.freeze({ gameSpeed: 16, timeScale: 1.08 }), Object.freeze({ gameSpeed: 24, timeScale: 1.5 })]);
const SIDES = ['left', 'right'];
const LABELS = { left: 'Left', right: 'Right' };
const DEFAULT_FILE = fileURLToPath(new URL('../../public/models/generated/city-runner.glb', import.meta.url));
function check(condition, message) { if (!condition) throw new Error(`角色运动质量：${message}`); }
function finitePoint(value, label) { check(value.length === 3 && value.every(Number.isFinite), `${label} 含 NaN/Infinity`); return value; }
function statistics(values) {
  check(values.length > 0 && values.every(Number.isFinite), '统计输入为空或含非法值');
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { count: values.length, min: Math.min(...values), max: Math.max(...values), mean, rms: Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length), sd: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) };
}
function distance(a, b) { return Math.hypot(...a.map((value, axis) => value - b[axis])); }
function ranges(indices, intervals) {
  const result = [];
  for (const id of indices) {
    const previous = result.at(-1);
    if (previous && Math.abs(previous.end - id / intervals) < 1e-7) previous.end = (id + 1) / intervals;
    else result.push({ start: id / intervals, end: (id + 1) / intervals });
  }
  return result;
}
function restoreTransforms(saved, scene, skeletons) {
  for (const { object, position, quaternion, scale } of saved) { object.position.copy(position); object.quaternion.copy(quaternion); object.scale.copy(scale); }
  scene.updateMatrixWorld(true); for (const skeleton of skeletons) skeleton.update();
}

/** No renderer/React/game state. The supplied GLTF is restored even on failure. */
export function analyzeCharacterMotion(gltf, { intervals = 240, includeSamples = true, speedCases = DEFAULT_SPEED_CASES } = {}) {
  check(Number.isInteger(intervals) && intervals >= 32 && intervals <= 1024 && intervals % 4 === 0, 'intervals 必须是32..1024内4的倍数');
  check(Array.isArray(speedCases) && speedCases.length > 0 && speedCases.length <= 8 && speedCases.every((value) => value && Number.isFinite(value.gameSpeed) && value.gameSpeed > 0 && Number.isFinite(value.timeScale) && value.timeScale > 0 && value.timeScale <= 4), '速度比较输入无效');
  const scene = gltf.scene; const skeletons = new Set(); const saved = []; let info;
  scene.traverse((object) => {
    saved.push({ object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() });
    if (object.isSkinnedMesh) skeletons.add(object.skeleton);
    if (object.userData.character) { check(!info, '角色根参考重复'); info = object.userData.character; }
  });
  check(info?.parts && info?.bones && skeletons.size > 0, '缺少实际角色 Skin/骨骼/部件参考');
  const mixer = new AnimationMixer(scene); const point = new Vector3();
  const update = () => { scene.updateMatrixWorld(true); for (const skeleton of skeletons) skeleton.update(); };
  const bonePose = (name) => {
    const object = scene.getObjectByName(info.bones[name]); check(object?.isBone, `缺少 ${name} Bone`);
    const position = finitePoint(object.getWorldPosition(new Vector3()).toArray(), name);
    const quaternion = object.getWorldQuaternion(new Quaternion()).toArray(); check(quaternion.every(Number.isFinite), `${name} 旋转无效`);
    return { position, quaternion };
  };
  try {
    for (const skeleton of skeletons) skeleton.pose(); update();
    const soles = {};
    for (const side of SIDES) {
      const nodeName = info.parts[`${LABELS[side]}Foot`]; const root = scene.getObjectByName(nodeName);
      check(root, `缺少实际 ${side} Foot Mesh`);
      const all = [];
      root.traverse((object) => {
        if (!object.isMesh) return;
        check(object.isSkinnedMesh, `${side} 鞋不是 SkinnedMesh`);
        for (let index = 0; index < object.geometry.getAttribute('position').count; index++) {
          object.getVertexPosition(index, point).applyMatrix4(object.matrixWorld);
          all.push({ object, index, rest: finitePoint(point.toArray(), `${side} 鞋底`) });
        }
      });
      check(all.length > 0, `${side} 鞋缺少几何体`);
      const minimum = Math.min(...all.map(({ rest }) => rest[1])); const seen = new Set();
      const refs = all.filter(({ rest }) => {
        const key = rest.map((value) => value.toFixed(6)).join(',');
        if (rest[1] > minimum + .001 || seen.has(key)) return false;
        seen.add(key); return true;
      });
      check(refs.length >= 3, `${side} 鞋底实际参考点不足`);
      soles[side] = { nodeName, restMinimumY: minimum, refs };
    }
    const soleSample = (side) => {
      let minY = Infinity; let maxY = -Infinity; const center = new Vector3();
      for (const { object, index } of soles[side].refs) {
        object.getVertexPosition(index, point).applyMatrix4(object.matrixWorld); finitePoint(point.toArray(), `${side} 蒙皮鞋底`);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); center.add(point);
      }
      center.divideScalar(soles[side].refs.length);
      return { minY, maxY, center: center.toArray(), ankle: bonePose(`${LABELS[side]}Foot`).position };
    };
    const runs = gltf.animations.filter((clip) => clip.name === 'Run'); const run = runs[0];
    check(runs.length === 1 && run && run.duration > 0 && Number.isFinite(run.duration), '必须有唯一有效实际 Run 动画');
    const samples = []; const grounding = {};
    for (const clip of gltf.animations) {
      check(Number.isFinite(clip.duration) && clip.duration > 0, `${clip.name} 动作时长无效`);
      const action = mixer.clipAction(clip); action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
      const heights = { left: [], right: [] };
      for (let i = 0; i <= intervals; i++) {
        action.reset().play(); mixer.setTime(clip.duration * i / intervals); update();
        const left = soleSample('left'); const right = soleSample('right');
        heights.left.push(left.minY); heights.right.push(right.minY);
        if (clip === run) samples.push({ progress: i / intervals, seconds: clip.duration * i / intervals, left, right, root: bonePose('Root'), hips: bonePose('Hips'), head: bonePose('Head') });
      }
      grounding[clip.name] = { leftMinimumY: Math.min(...heights.left), rightMinimumY: Math.min(...heights.right) };
      action.stop(); mixer.stopAllAction(); for (const skeleton of skeletons) skeleton.pose(); update();
    }
    const dt = run.duration / intervals; const feet = {};
    for (const side of SIDES) {
      const contact = []; const support = []; const backward = []; const sensitivity = { '.10': 0, '.25': 0 };
      for (let i = 0; i < intervals; i++) {
        const first = samples[i][side]; const second = samples[i + 1][side];
        const near = Math.max(first.minY, second.minY) <= .012 && Math.max(first.maxY, second.maxY) <= .018;
        const verticalSpeed = Math.abs(second.center[1] - first.center[1]) / dt;
        if (near) { contact.push(i); if (verticalSpeed < .10) sensitivity['.10']++; if (verticalSpeed < .25) sensitivity['.25']++; }
        if (near && verticalSpeed < .15) { support.push(i); backward.push((second.center[2] - first.center[2]) / dt); }
      }
      check(backward.length > 0, `${side} Run 不存在可测量的近地支撑候选`);
      const speed = statistics(backward);
      feet[side] = {
        minimumSoleY: Math.min(...samples.map((sample) => sample[side].minY)), maximumSoleY: Math.max(...samples.map((sample) => sample[side].maxY)),
        foreAftSpan: Math.max(...samples.map((sample) => sample[side].center[2])) - Math.min(...samples.map((sample) => sample[side].center[2])),
        nearGroundDuty: contact.length / intervals, nearGroundIntervals: ranges(contact, intervals), supportCandidateDuty: support.length / intervals, supportCandidateIntervals: ranges(support, intervals),
        supportSensitivity: { verticalSpeed10cm: sensitivity['.10'] / intervals, verticalSpeed25cm: sensitivity['.25'] / intervals },
        backwardSpeed: speed, backwardSpeedCv: speed.sd / Math.max(Math.abs(speed.mean), .001), reversedSupportFraction: backward.filter((value) => value < -.05).length / backward.length,
        speedCases: speedCases.map(({ gameSpeed, timeScale }) => {
          const scaled = backward.map((value) => value * timeScale); const residual = statistics(scaled.map((value) => gameSpeed - value));
          return { gameSpeed, timeScale, footBackwardSpeed: statistics(scaled), residualSlip: residual, meanResidualFraction: residual.mean / gameSpeed };
        }),
      };
    }
    const symmetry = statistics(samples.slice(0, intervals).map((sample, i) => {
      const other = samples[(i + intervals / 2) % intervals].right.center;
      return Math.hypot(sample.left.center[0] + other[0], sample.left.center[1] - other[1], sample.left.center[2] - other[2]);
    }));
    const loop = {};
    for (const name of ['root', 'hips', 'head', 'left', 'right']) {
      const position = (sample) => name === 'left' || name === 'right' ? sample[name].center : sample[name].position;
      const first = position(samples[0]); const last = position(samples[intervals]);
      const startVelocity = first.map((value, axis) => (position(samples[1])[axis] - value) / dt);
      const endVelocity = last.map((value, axis) => (value - position(samples[intervals - 1])[axis]) / dt);
      const angle = name === 'left' || name === 'right' ? 0 : 2 * Math.acos(Math.min(1, Math.abs(new Quaternion().fromArray(samples[0][name].quaternion).dot(new Quaternion().fromArray(samples[intervals][name].quaternion)))));
      loop[name] = { positionError: distance(first, last), angleError: angle, startVelocity, endVelocity, velocityDiscontinuity: distance(startVelocity, endVelocity) };
    }
    const minimumY = Math.min(...Object.values(grounding).flatMap((data) => [data.leftMinimumY, data.rightMinimumY]));
    const penetration = Math.max(0, -minimumY); const bodyVelocitySeam = Math.max(loop.hips.velocityDiscontinuity, loop.head.velocityDiscontinuity);
    const rootDrift = Math.max(...samples.map((sample) => distance(sample.root.position, samples[0].root.position)));
    const checks = [];
    const upper = (id, value, limit, category = 'hard') => checks.push({ id, category, comparison: '<=', value, limit, passed: value <= limit });
    const lower = (id, value, limit) => checks.push({ id, category: 'hard', comparison: '>=', value, limit, passed: value >= limit });
    upper('sole-penetration', penetration, MOTION_HARD_LIMITS.penetration);
    upper('mirrored-maximum', symmetry.max, MOTION_HARD_LIMITS.mirroredMax); upper('mirrored-rms', symmetry.rms, MOTION_HARD_LIMITS.mirroredRms);
    upper('loop-position', Math.max(...Object.values(loop).map((value) => value.positionError)), MOTION_HARD_LIMITS.loopPosition);
    upper('loop-angle', Math.max(...Object.values(loop).map((value) => value.angleError)), MOTION_HARD_LIMITS.loopAngle);
    upper('body-velocity-seam', bodyVelocitySeam, MOTION_HARD_LIMITS.bodyVelocitySeam);
    upper('root-drift', rootDrift, MOTION_HARD_LIMITS.loopPosition);
    upper('support-duty-difference', Math.abs(feet.left.supportCandidateDuty - feet.right.supportCandidateDuty), MOTION_HARD_LIMITS.supportDutyDifference);
    for (const side of SIDES) {
      lower(`${side}-support-min`, feet[side].supportCandidateDuty, MOTION_HARD_LIMITS.supportMin);
      upper(`${side}-support-max`, feet[side].supportCandidateDuty, MOTION_HARD_LIMITS.supportMax);
      upper(`${side}-reversed-support`, feet[side].reversedSupportFraction, MOTION_HARD_LIMITS.reversedSupportFraction);
      upper(`${side}-support-speed-cv`, feet[side].backwardSpeedCv, MOTION_HARD_LIMITS.supportSpeedCv);
    }
    upper('target-sole-penetration', penetration, MOTION_TARGETS.penetration, 'target');
    upper('target-mirrored-maximum', symmetry.max, MOTION_TARGETS.mirroredMax, 'target');
    upper('target-body-velocity-seam', bodyVelocitySeam, MOTION_TARGETS.bodyVelocitySeam, 'target');
    return {
      schemaVersion: 1, clip: 'Run', duration: run.duration, sampling: { intervals, secondsPerInterval: dt, speedCaseMeaning: 'Explicit steady-state animation targets; excludes runtime smoothing transients', method: 'GLTFLoader + AnimationMixer + SkinnedMesh.getVertexPosition' },
      reference: { groundY: 0, forward: [0, 0, -1], groundScrollAxis: '+Z', soleRule: 'Unique actual rest-pose foot vertices within 1 mm of the minimum; never the ankle',
        feet: Object.fromEntries(SIDES.map((side) => [side, { nodeName: soles[side].nodeName, restMinimumY: soles[side].restMinimumY, vertices: soles[side].refs.map(({ object, index, rest }) => ({ meshName: object.name, vertexIndex: index, restPosition: rest })) }])),
        contactRule: 'Interval endpoints sole min<=12mm/max<=18mm; support candidates additionally abs(sole center vertical speed)<0.15m/s; not a ground-reaction-force measurement' },
      feet, symmetry, loop, grounding, penetration, bodyVelocitySeam, rootDrift, thresholds: { hard: MOTION_HARD_LIMITS, targets: MOTION_TARGETS }, checks,
      hardLimitsPass: checks.filter(({ category }) => category === 'hard').every(({ passed }) => passed), targetsPass: checks.filter(({ category }) => category === 'target').every(({ passed }) => passed),
      warnings: ['Residual foot slip versus 16–24 m/s scrolling ground remains large and is reported numerically; a bounded human gait cannot physically cancel that speed.', 'Contact/support are geometric candidates, not inferred body weight or ground force.', 'This source-clip analysis excludes controller crossfades, visual feedback, camera, GPU performance, and aesthetic judgment.', 'The standalone motion report does not replace the complete GLB/material/asset-contract validation; also run assets:validate.'],
      quarterSamples: [0, intervals / 4, intervals / 2, intervals * 3 / 4, intervals].map((i) => samples[i]),
      ...(includeSamples ? { samples } : {}),
    };
  } finally { mixer.stopAllAction(); mixer.uncacheRoot(scene); restoreTransforms(saved, scene, skeletons); }
}

export function assertCharacterMotionQuality(report, { requireTargets = false } = {}) {
  const failed = report.checks.filter(({ category, passed }) => !passed && (category === 'hard' || requireTargets));
  check(failed.length === 0, failed.map(({ id, value, limit, comparison }) => `${id}=${value.toFixed(6)} 不满足 ${comparison}${limit.toFixed(6)}`).join('；'));
  return report;
}
export function compareMotionAnalysis(current, baseline) {
  for (const report of [current, baseline]) {
    check(report?.schemaVersion === 1 && report.feet?.left && report.feet?.right && report.symmetry && report.loop, '对比报告格式无效');
    check([report.penetration, report.symmetry.max, report.symmetry.rms, report.bodyVelocitySeam, ...SIDES.flatMap((side) => [report.feet[side].backwardSpeed?.mean, report.feet[side].supportCandidateDuty, report.feet[side].foreAftSpan])].every(Number.isFinite), '对比报告指标必须为有限实测值');
  }
  return { penetration: current.penetration - baseline.penetration, mirroredMaximum: current.symmetry.max - baseline.symmetry.max, mirroredRms: current.symmetry.rms - baseline.symmetry.rms, bodyVelocitySeam: current.bodyVelocitySeam - baseline.bodyVelocitySeam,
    feet: Object.fromEntries(SIDES.map((side) => [side, { backwardSpeed: current.feet[side].backwardSpeed.mean - baseline.feet[side].backwardSpeed.mean, supportDuty: current.feet[side].supportCandidateDuty - baseline.feet[side].supportCandidateDuty, foreAftSpan: current.feet[side].foreAftSpan - baseline.feet[side].foreAftSpan }])) };
}
export async function analyzeMotionFile({ filePath = DEFAULT_FILE, ...options } = {}) {
  const file = resolve(filePath); const buffer = await readFile(file);
  check(buffer.length >= 28 && buffer.readUInt32LE(0) === 0x46546c67 && buffer.readUInt32LE(4) === 2 && buffer.readUInt32LE(8) === buffer.length && buffer.readUInt32LE(16) === 0x4e4f534a, 'GLB 文件头无效');
  const jsonLength = buffer.readUInt32LE(12); check(jsonLength > 0 && 20 + jsonLength + 8 <= buffer.length, 'GLB JSON 长度无效');
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const forbidUri = (value) => { if (!value || typeof value !== 'object') return; check(!Object.hasOwn(value, 'uri'), '独立分析不允许外部 URI'); Object.values(value).forEach(forbidUri); }; forbidUri(json);
  check(!json.images?.length && !json.textures?.length, '分析仅接受当前无纹理角色契约');
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  try { return { ...analyzeCharacterMotion(gltf, options), source: { file, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') } }; }
  finally {
    const geometries = new Set(); const materials = new Set(); const skeletons = new Set();
    gltf.scene.traverse((object) => { if (!object.isMesh) return; geometries.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); if (object.isSkinnedMesh) skeletons.add(object.skeleton); });
    geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose()); skeletons.forEach((skeleton) => skeleton.dispose());
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = {};
    for (const arg of process.argv.slice(2)) { const match = /^--(file|output|baseline)=(.+)$/.exec(arg); check(match && !Object.hasOwn(args, match[1]), `未知或重复参数：${arg}`); args[match[1]] = match[2]; }
    const report = await analyzeMotionFile({ filePath: args.file });
    if (args.baseline) report.comparison = compareMotionAnalysis(report, JSON.parse(await readFile(resolve(args.baseline), 'utf8')));
    if (args.output) { const target = resolve(args.output); await mkdir(dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(report, null, 2)}\n`); console.log(`[分析报告] ${target}`); }
    console.log(`[真实鞋底] Run ${report.duration.toFixed(3)}s / ${report.sampling.intervals + 1} 帧 / 穿透 ${(report.penetration * 1000).toFixed(2)}mm / 半周期镜像最大 ${(report.symmetry.max * 1000).toFixed(2)}mm / 身体循环速度差 ${report.bodyVelocitySeam.toFixed(4)}m/s`);
    for (const side of SIDES) {
      console.log(`[${side}] 近地 ${(report.feet[side].nearGroundDuty * 100).toFixed(2)}% / 支撑候选 ${(report.feet[side].supportCandidateDuty * 100).toFixed(2)}% / 后退 ${report.feet[side].backwardSpeed.mean.toFixed(3)}m/s`);
      for (const speed of report.feet[side].speedCases) console.log(`[残余脚滑 ${side}] 地面 ${speed.gameSpeed}m/s / 动画 ${speed.timeScale}x / 残余 ${speed.residualSlip.mean.toFixed(3)}m/s (${(speed.meanResidualFraction * 100).toFixed(2)}%)`);
    }
    console.log(`[数值质量] 回归门 ${report.hardLimitsPass ? '通过' : '失败'} / 改进目标 ${report.targetsPass ? '通过' : '未全部达到'}；不代替实际画面/连续运动审查`);
    assertCharacterMotionQuality(report);
  } catch (error) { console.error(`[运动分析失败] ${error.message}`); process.exitCode = 1; }
}
