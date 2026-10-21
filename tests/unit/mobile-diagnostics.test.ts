import { describe, expect, it } from 'vitest';
import { MobileFrameWindow } from '../../src/runtime/mobile-metrics';
import { InputController } from '../../src/input/InputController';
import { AssetLoadingStore } from '../../src/assets/loading';

describe('mobile measurement and recovery boundaries', () => {
  it('keeps real long frames, caps memory at600 and requires100 samples for P99', () => {
    const frames=new MobileFrameWindow(); let now=0; frames.record(now);
    for(let i=0;i<99;i++) { now+=16;frames.record(now); }
    expect(frames.read().p99Ms).toBe(null);
    now+=80;frames.record(now); expect(frames.read().over50Ms).toBe(1); expect(frames.read().p99Ms).toBe(16);
    now+=120;frames.record(now);expect(frames.read().p99Ms).toBe(80);
    for(let i=0;i<1000;i++) {now+=16;frames.record(now);}
    expect(frames.read().samples).toBe(600); expect(frames.read().meanMs).toBe(16); expect(frames.read().over50Ms).toBe(0);
    frames.reset();now+=100000;frames.record(now);expect(frames.read().samples).toBe(0);
    frames.record(now+16);expect(frames.read().meanMs).toBe(16);
  });
  it('blocks every input source including pause while graphics are unavailable', () => {
    const commands:string[]=[];const controller=new InputController({status:'paused',dispatch:action=>commands.push(action),togglePause:()=>commands.push('pause')});
    controller.setBlocked(true);
    for(const source of ['keyboard','gesture','button'] as const) {expect(controller.send('pause',source)).toBe(false);expect(controller.send('jump',source)).toBe(false);}
    expect(commands).toEqual([]);controller.setBlocked(false);expect(controller.send('pause','keyboard')).toBe(true);expect(commands).toEqual(['pause']);
  });
  it('reports a fatal renderer separately from model progress and clears it on actual recovery', () => {
    const store=new AssetLoadingStore();store.updateDistance(0);store.setRendererFailed('WebGL unavailable');
    expect(store.getSnapshot().rendererError).toBe('WebGL unavailable');expect(store.getSnapshot().phase).toBe('error');expect(store.getSnapshot().ready).toBe(false);
    expect(store.getSnapshot().canContinue).toBe(false);store.setRendererReady();expect(store.getSnapshot().rendererError).toBe(null);
    expect(store.getSnapshot().phase).toBe('core');
  });
});
