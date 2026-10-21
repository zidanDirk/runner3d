/// <reference types="vite/client" />
import type { GameView } from './game/types';
import type { CityMetrics } from './runtime/city-metrics';

declare global {
  interface Window {
    __PRODUCT_LIFECYCLE__?: () => { mixers: { created: number; disposed: number; active: number } };
    __RUNNER_INSPECT__?: () => { camera: { position: number[]; world: number[]; inverse: number[]; projection: number[] }; fog: { near: number; far: number } | null; batches: { id: string; count: number; declared: number; uuid: string; version: number; matrix: number[]; items: number[][] }[] };
    __FEEDBACK__?: ReturnType<import('./runtime/feedback').FeedbackRuntime['diagnostics']>;
    __EFFECT_PREVIEW__?: { particles: number; capacity: number; time: number; seed: string; kind: string; calls: number; triangles: number };
    __CITY_RENDER__?: CityMetrics;
    __ASSET_PREVIEW__?: {
      models: Record<string, { size: number[]; minY: number; materials: string[]; emissiveMaterials: number }>;
      camera: number[];
      calls: number;
      triangles: number;
      preset?: import('./assets/CharacterPreview').CharacterView;
      light?: import('./assets/CharacterPreview').CharacterLight;
      joints?: boolean;
      jointMarkers: Record<string, number[]>;
      bones: Record<string, number[]>;
      skeletonHelpers: number;
      animation?: import('./character/CharacterAnimationController').AnimationDiagnostics;
      footSoles?: { left: number[]; right: number[] };
      pelvisY?: number;
    };
    __RUNNER_TEST__?: {
      stepFeedback: (seconds: number) => ReturnType<import('./runtime/feedback').FeedbackRuntime['diagnostics']>;
      stressEffects: (count: number) => ReturnType<import('./runtime/feedback').FeedbackRuntime['diagnostics']>;
      read: () => GameView;
      freeze: (value: boolean) => void;
      autopilot: (value: boolean) => void;
      captureAt: (seed: string, distance: number) => { seed: string; distance: number; tick: number; chunk: number };
      advanceTo: (distance: number) => { seed: string; distance: number; tick: number; chunk: number };
      stepTicks: (count: number) => { seed: string; distance: number; tick: number; chunk: number };
    };
    __RUNNER_RENDER__?: {
      tick: number;
      camera: { position: number[]; quaternion: number[]; fov: number };
      calls: number; triangles: number; geometries: number; textures: number;
      powerups: { triangles: number; models: number; visible: number; types: string[]; pickups: number };
      roadblock: {
        models: number; fallbacks: number; visible: number;
        bounds: { size: number[]; minY: number; materials: string[] } | null;
      };
      character: {
        appearance: { skinId: string; jacketColors: string[] };
        models: number; fallbacks: number; visible: number; meshes: number; triangles: number;
        materials: string[]; bounds: { size: number[]; minY: number } | null;
        position: number[]; scale: number[]; jointMetadata: boolean;
        skinnedMeshes: number; skinCount: number; bones: Record<string, number[]>;
        animation: import('./character/CharacterAnimationController').AnimationDiagnostics | null;
        lean: number;
        bankLift: number;
        bankSamples: number;
        impact: { landing: number; scaleY: number };
        soles: { left: number; right: number } | null;
      };
    };
  }
}
