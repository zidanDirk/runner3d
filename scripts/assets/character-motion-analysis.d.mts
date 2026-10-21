import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
export interface SpeedCase { gameSpeed: number; timeScale: number }
export interface Statistics { count: number; min: number; max: number; mean: number; rms: number; sd: number }
export interface SoleSample { minY: number; maxY: number; center: number[]; ankle: number[] }
export interface BoneSample { position: number[]; quaternion: number[] }
export interface MotionSample { progress: number; seconds: number; left: SoleSample; right: SoleSample; root: BoneSample; hips: BoneSample; head: BoneSample }
export interface MotionInterval { start: number; end: number }
export interface FootMotionMetrics {
  minimumSoleY: number; maximumSoleY: number; foreAftSpan: number;
  nearGroundDuty: number; nearGroundIntervals: MotionInterval[]; supportCandidateDuty: number; supportCandidateIntervals: MotionInterval[];
  supportSensitivity: { verticalSpeed10cm: number; verticalSpeed25cm: number };
  backwardSpeed: Statistics; backwardSpeedCv: number; reversedSupportFraction: number;
  speedCases: (SpeedCase & { footBackwardSpeed: Statistics; residualSlip: Statistics; meanResidualFraction: number })[];
}
export interface LoopMotionMetrics { positionError: number; angleError: number; startVelocity: number[]; endVelocity: number[]; velocityDiscontinuity: number }
export interface MotionQualityCheck { id: string; category: 'hard' | 'target'; comparison: '<=' | '>='; value: number; limit: number; passed: boolean }
export interface CharacterMotionAnalysis {
  schemaVersion: 1; clip: 'Run'; duration: number;
  sampling: { intervals: number; secondsPerInterval: number; speedCaseMeaning: string; method: string };
  reference: { groundY: number; forward: number[]; groundScrollAxis: string; soleRule: string; contactRule: string; feet: Record<'left' | 'right', { nodeName: string; restMinimumY: number; vertices: { meshName: string; vertexIndex: number; restPosition: number[] }[] }> };
  feet: Record<'left' | 'right', FootMotionMetrics>; symmetry: Statistics;
  loop: Record<'root' | 'hips' | 'head' | 'left' | 'right', LoopMotionMetrics>;
  grounding: Record<string, { leftMinimumY: number; rightMinimumY: number }>;
  penetration: number; bodyVelocitySeam: number; rootDrift: number;
  thresholds: { hard: typeof MOTION_HARD_LIMITS; targets: typeof MOTION_TARGETS };
  checks: MotionQualityCheck[]; hardLimitsPass: boolean; targetsPass: boolean; warnings: string[];
  quarterSamples: MotionSample[]; samples?: MotionSample[];
}
export interface CharacterMotionOptions { intervals?: number; includeSamples?: boolean; speedCases?: readonly SpeedCase[] }
export interface MotionComparison { penetration: number; mirroredMaximum: number; mirroredRms: number; bodyVelocitySeam: number; feet: Record<'left' | 'right', { backwardSpeed: number; supportDuty: number; foreAftSpan: number }> }
export const MOTION_HARD_LIMITS: Readonly<{ penetration: number; mirroredMax: number; mirroredRms: number; loopPosition: number; loopAngle: number; bodyVelocitySeam: number; supportMin: number; supportMax: number; supportDutyDifference: number; reversedSupportFraction: number; supportSpeedCv: number }>;
export const MOTION_TARGETS: Readonly<{ penetration: number; mirroredMax: number; bodyVelocitySeam: number }>;
export const DEFAULT_SPEED_CASES: readonly Readonly<SpeedCase>[];
export function analyzeCharacterMotion(gltf: GLTF, options?: CharacterMotionOptions): CharacterMotionAnalysis;
export function assertCharacterMotionQuality(report: CharacterMotionAnalysis, options?: { requireTargets?: boolean }): CharacterMotionAnalysis;
export function compareMotionAnalysis(current: CharacterMotionAnalysis, baseline: CharacterMotionAnalysis): MotionComparison;
export function analyzeMotionFile(options?: CharacterMotionOptions & { filePath?: string }): Promise<CharacterMotionAnalysis & { source: { file: string; bytes: number; sha256: string } }>;
