import { expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { RULES } from '../../src/game/config';
import { POWERUP_BALANCE } from '../../src/game/balance';
import type { Lane } from '../../src/game/types';
import { controlWindow, createRoutePlan, forecastDistance, observePickups, planRouteStep, POWERUP_ROUTE, routePollDelay } from './route-plan';
import type { RouteDecision, RoutePlan, RouteSample } from './route-plan';
export { POWERUP_ROUTE } from './route-plan';

interface KeyObservation { at: number; key: string; distance: number; trusted: boolean }
interface BrowserObserver { keys: KeyObservation[]; onKey: (event: KeyboardEvent) => void }
declare global { interface Window { __runnerRouteObservation?: BrowserObserver } }
interface Sample extends RouteSample { keys: KeyObservation[]; notice: string; awaitedPickup?: string; browserStartedAtMs: number }
interface RouteCommand { key: string; requestedAt: number; returnedAt: number; matched: boolean }
export interface RouteStart {
  lane: Lane; keyboardMs: number; pendingThrough: number | null;
  commands: RouteCommand[]; log: unknown[]; jumpReturnedAt: number;
}

/** One atomic public-UI observation. No game state/production test API is read. */
async function sampleUI(page: Page, plan: RoutePlan, lane: Lane, collected: ReadonlySet<string>, remainingMs: number, allowWait = true, landingPending = false, checkpointPending = false): Promise<Sample> {
  const rows = plan.rows.map(r => ({ index: r.row.index, lane: r.row.safeLane, clearEnd: r.clearEnd,
    pickup: r.pickup && plan.required.some(p => p.id === r.pickup?.id) && !collected.has(r.pickup.id)
      ? { id: r.pickup.id, type: r.pickup.type, contactStart: r.pickup.distance - (RULES.playerDepth + POWERUP_BALANCE.pickupDepth) / 2,
          missedAt: r.pickup.distance + 1 + (RULES.playerDepth + POWERUP_BALANCE.pickupDepth) / 2 } : null }));
  return page.evaluate(({ rows, lane, remainingMs, allowWait, landingPending, checkpointPending, jumpTravel }) => {
    const browserStartedAtMs = Date.now();
    if (!window.__runnerRouteObservation) {
      const keys: KeyObservation[] = [];
      const onKey = (event: KeyboardEvent) => {
        if (!['ArrowLeft', 'ArrowRight', 'Space', 'ArrowDown'].includes(event.code === 'Space' ? 'Space' : event.key)) return;
        keys.push({ at: Date.now(), key: event.code === 'Space' ? 'Space' : event.key, trusted: event.isTrusted,
          distance: Number(document.querySelector('[data-testid="distance"]')?.textContent?.replaceAll(',', '')) });
        if (keys.length > 64) keys.shift();
      };
      window.__runnerRouteObservation = { keys, onKey };
      window.addEventListener('keydown', onKey, true);
    }
    const number = (id: string) => {
      const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      if (!element) throw new Error(`Route UI missing: ${id}`);
      const value = Number(element.innerText.replaceAll(',', ''));
      if (!Number.isFinite(value)) throw new Error(`Invalid route UI value: ${id}`);
      return value;
    };
    const visible = (id: string) => {
      const element = document.querySelector<HTMLElement>(`[data-testid="active-${id}"]`);
      if (!element) return false;
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.visibility === 'visible' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const read = (): Sample => {
      const status = document.querySelector<HTMLElement>('.game-overlay')?.dataset.status;
      if (!status) throw new Error('Route UI missing game status');
      const speedMatch = document.querySelector('.scene-status')?.textContent?.match(/([\d.]+)\s*M\/S/);
      return { sampledAtMs: Date.now(), browserStartedAtMs, distance: number('distance'), coins: number('coins'), status,
        speed: speedMatch ? Number(speedMatch[1]) : 0,
        powerups: { magnet: visible('magnet'), shield: visible('shield'), 'double-score': visible('double-score') },
        notice: Array.from(document.querySelectorAll('[role="status"]')).map(e => e.textContent).join(' '),
        keys: window.__runnerRouteObservation?.keys.slice() ?? [] };
    };
    const initial = read();
    const jump = initial.keys.slice().reverse().find(k => k.key === 'Space');
    // Wake for an earlier required observation; only Node's conservative
    // complete-flight bound can actually confirm landing.
    const landingWake = landingPending && jump ? Math.max(20, jump.distance + jumpTravel) : null;
    const requiredObservation = (sample: Sample) => (landingWake !== null && sample.distance > landingWake) || (checkpointPending && sample.distance > 266);
    const row = rows.find(r => !(initial.distance > r.clearEnd && (!r.pickup || (initial.distance + 1 >= r.pickup.contactStart && initial.powerups[r.pickup.type]))));
    if (!allowWait || !row || row.lane !== lane || initial.status !== 'running' || requiredObservation(initial)) return initial;
    const pickup = row.pickup && !initial.powerups[row.pickup.type] ? row.pickup : null;
    // Hold an already-commanded safe lane until its real UI completion boundary.
    // This avoids returning a stale negative packet and paying a second RPC when
    // the obstacle clears or the required pickup activates in between calls.
    return new Promise<Sample>((resolve, reject) => {
      let done = false;
      const observer = new MutationObserver(() => inspect(false));
      const finish = (sample: Sample) => { if (done) return; done = true; observer.disconnect(); clearTimeout(timer); resolve({ ...sample, awaitedPickup: pickup?.id ?? `row-${row.index}-clear` }); };
      const inspect = (expired: boolean) => {
        let sample: Sample;
        try { sample = read(); } catch (error) { observer.disconnect(); clearTimeout(timer); reject(error); return; }
        if (expired || sample.status !== 'running' || requiredObservation(sample) || (pickup ? sample.powerups[pickup.type] || sample.distance > pickup.missedAt : sample.distance > row.clearEnd)) finish(sample);
      };
      const timer = setTimeout(() => inspect(true), Math.max(1, Math.min(5000, remainingMs)));
      observer.observe(document.querySelector('.game-overlay') ?? document.body, { subtree: true, childList: true, characterData: true });
      inspect(false);
    });
  }, { rows, lane, remainingMs, allowWait, landingPending, checkpointPending, jumpTravel: RULES.baseSpeed * 2 * RULES.jumpVelocity / RULES.gravity });
}

function saveReport(capturePath: string, suffix: string, data: unknown): void {
  const path = capturePath.replace(/\.png$/, '') + suffix;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}
async function disposeObservation(page: Page): Promise<void> {
  await page.evaluate(() => {
    const observer = window.__runnerRouteObservation;
    if (observer) window.removeEventListener('keydown', observer.onKey, true);
    delete window.__runnerRouteObservation;
  }).catch(() => {});
}

/** Acquire the first safe lane before asynchronous jump/slide smoke checks can
 * consume its approach window. Call after the existing left/right input pair.
 */
export async function beginPowerupRoute(page: Page, capturePath: string): Promise<RouteStart> {
  const log: unknown[] = [], startedAt = Date.now();
  let lastSample: Sample | null = null;
  try {
    const plan = createRoutePlan(), requestedAt = Date.now();
    log.push({ type: 'bootstrap-read-request', requestedAt });
    const sample = await sampleUI(page, plan, 1, new Set(), 5000, false), receivedAt = Date.now();
    lastSample = sample;
    log.push({ type: 'bootstrap-sample', receivedAt, sample });
    if (sample.status !== 'running') throw new Error(`Route bootstrap is not running: ${sample.status}`);
    const keyboardMs = Math.max(100, receivedAt - requestedAt);
    const decision = planRouteStep(plan, sample, 1, new Set(), { nowMs: Date.now(), keyboardMs, pendingThrough: null });
    const fullCompletion = forecastDistance(sample, (Date.now() - sample.sampledAtMs + keyboardMs) / 1000 + RULES.laneChangeDuration);
    log.push({ type: 'bootstrap', requestedAt, receivedAt, sample, decision, fullCompletion });
    if (decision.dangerStart !== null && fullCompletion >= decision.dangerStart) throw new Error(`Route bootstrap cannot complete the first move before ${decision.dangerStart}m`);
    if (decision.kind === 'unsafe') throw new Error(`Route bootstrap has no safe window: ${JSON.stringify(decision)}`);
    if (decision.kind === 'hold') {
      log.push({ type: 'bootstrap-jump-request', at: Date.now() });
      await page.keyboard.press('Space');
      return { lane: 1, keyboardMs, pendingThrough: null, commands: [], log, jumpReturnedAt: Date.now() };
    }
    const key = decision.lane < 1 ? 'ArrowLeft' : 'ArrowRight';
    const command = { key, requestedAt: Date.now(), returnedAt: 0, matched: false };
    log.push({ type: 'bootstrap-input-request', ...command });
    await page.keyboard.press(key); command.returnedAt = Date.now();
    log.push({ type: 'bootstrap-input-returned', ...command });
    log.push({ type: 'bootstrap-jump-request', at: Date.now() });
    await page.keyboard.press('Space');
    const jumpReturnedAt = Date.now();
    log.push({ type: 'bootstrap-jump-returned', at: jumpReturnedAt });
    return { lane: decision.lane, keyboardMs: command.returnedAt - command.requestedAt,
      pendingThrough: forecastDistance(sample, (command.returnedAt - sample.sampledAtMs) / 1000 + RULES.laneChangeDuration),
      commands: [command], log, jumpReturnedAt };
  } catch (error) {
    log.push({ type: 'failure', at: Date.now(), error: error instanceof Error ? error.message : String(error), lastSample });
    let reportError: unknown;
    try { saveReport(capturePath, '.bootstrap.json', { schemaVersion: 1, seed: POWERUP_ROUTE, startedAt, completedAt: Date.now(), log }); }
    catch (failure) { reportError = failure; }
    finally { await disposeObservation(page); }
    if (reportError) throw new AggregateError([error, reportError], 'Route bootstrap and failure-report write both failed');
    throw error;
  }
}

/** Trusted production inputs; all physics remain in the real game loop. */
export async function followPowerupRoute(page: Page, capturePath: string, maxMs = 33000, start?: RouteStart): Promise<void> {
  const plan = createRoutePlan(), collected = new Set<string>();
  const startedAt = Date.now(), log: unknown[] = start ? [...start.log] : [];
  const record = (data: unknown) => { if (log.length === 2048) log.shift(); log.push(data); };
  let lane: Lane = start?.lane ?? 1, captured = false, checkpointConfirmed = false, intentionalCollision = false;
  let pendingThrough: number | null = start?.pendingThrough ?? null;
  let keyboardMs = start?.keyboardMs ?? 100, measuredKeyboard = false;
  let keyboardRoundTripMs = start?.keyboardMs ?? 100;
  const commands: RouteCommand[] = start ? [...start.commands] : [];
  let landingConfirmed = !start, slideCommand: RouteCommand | null = null, slideVerified = !start;
  let lastSample: Sample | null = null;
  try {
    while (Date.now() - startedAt < maxMs) {
      const requestedAt = Date.now(), sample = await sampleUI(page, plan, lane, collected, maxMs - (Date.now() - startedAt), !intentionalCollision && !(captured && !checkpointConfirmed), !!start && !landingConfirmed, !captured), receivedAt = Date.now();
      const transportMs = Math.max(0, receivedAt - requestedAt - (sample.sampledAtMs - sample.browserStartedAtMs));
      lastSample = sample;
      record({ type: 'sample', requestedAt, receivedAt, roundTripMs: receivedAt - requestedAt, transportMs, ageMs: receivedAt - sample.sampledAtMs, sample });
      if (!commands.length && !measuredKeyboard) keyboardMs = Math.max(100, receivedAt - requestedAt);
      for (const command of commands.filter(c => !c.matched)) {
        const actual = sample.keys.find(k => k.key === command.key && k.at >= command.requestedAt && k.at <= command.returnedAt);
        if (!actual) continue;
        if (!actual.trusted) throw new Error('Route input was not a trusted keyboard event');
        command.matched = true;
        keyboardMs = measuredKeyboard ? Math.max(keyboardMs, actual.at - command.requestedAt) : actual.at - command.requestedAt;
        measuredKeyboard = true;
        pendingThrough = forecastDistance({ ...sample, distance: actual.distance }, RULES.laneChangeDuration);
        record({ type: 'input-executed', ...command, actual, executionLatencyMs: actual.at - command.requestedAt, keyboardBudgetMs: keyboardMs, pendingThrough });
      }
      if (slideCommand && !slideVerified) {
        const sent = slideCommand;
        const actual = sample.keys.find(k => k.key === 'ArrowDown' && k.at >= sent.requestedAt && k.at <= sent.returnedAt);
        if (actual) {
          if (!actual.trusted) throw new Error('Slide input was not trusted');
          slideVerified = true;
          record({ type: 'slide-executed', actual, executionLatencyMs: actual.at - slideCommand.requestedAt });
        }
      }
      if (start && !landingConfirmed) {
        const jump = sample.keys.slice().reverse().find(k => k.key === 'Space');
        if (!jump?.trusted) throw new Error('Missing trusted jump input observation');
        const landingDistance = forecastDistance({ ...sample, distance: jump.distance }, 2 * RULES.jumpVelocity / RULES.gravity);
        if (sample.distance > 20 && sample.distance > landingDistance) {
          if (Date.now() > start.jumpReturnedAt + 5000) throw new Error('Jump progress exceeded the original 5s budget');
          expect(sample.distance).toBeGreaterThan(20);
          expect(sample.distance).toBeGreaterThan(landingDistance);
          landingConfirmed = true;
          record({ type: 'landing-confirmed', at: Date.now(), sample, jump, landingDistance });
        } else if (Date.now() > start.jumpReturnedAt + 5000) throw new Error('Jump progress exceeded the original 5s budget');
      }
      if (pendingThrough !== null && sample.distance >= pendingThrough) pendingThrough = null;
      if (sample.status === 'over') {
        if (!intentionalCollision) throw new Error('Route ended before deliberate settlement');
        break;
      }
      if (sample.status !== 'running') throw new Error(`Route stopped advancing: ${sample.status}`);
      observePickups(plan, sample, collected);
      const shield = plan.required.find(p => p.type === 'shield');
      if (!intentionalCollision && (sample.notice.includes('护盾已抵挡碰撞') || (shield && collected.has(shield.id) && !sample.powerups.shield))) throw new Error('Route consumed shield before deliberate settlement');
      const checkpointEligible = !captured && sample.distance > 266;
      if (checkpointEligible || (captured && !checkpointConfirmed)) {
        // A single simultaneous sample; no five-second retry that stops steering.
        expect(sample.powerups, 'three powerups must be simultaneously visible at the original >266m checkpoint').toEqual({ magnet: true, shield: true, 'double-score': true });
        expect(collected.size, 'all three actual pickups must have HUD evidence').toBe(3);
        expect(sample.coins).toBeGreaterThan(0);
        if (captured) {
          checkpointConfirmed = true;
          record({ type: 'checkpoint-confirmed', sample });
        }
      }
      const settling = checkpointConfirmed && sample.distance > 280;
      if (settling && !intentionalCollision) { intentionalCollision = true; record({ type: 'deliberate-settlement', at: Date.now(), sample }); }
      const decision: RouteDecision | null = settling ? null : planRouteStep(plan, sample, lane, collected, { nowMs: Date.now(), keyboardMs, pendingThrough });
      if (decision) record({ type: 'decision', at: Date.now(), decision });
      if (decision?.kind === 'unsafe') throw new Error(`Route cannot guarantee safe input: ${JSON.stringify(decision)}`);
      const target: Lane | undefined = settling
        ? plan.rows.flatMap(r => r.row.entities).find(e => e.kind !== 'coin' && e.distance > sample.distance + 9)?.lane
        : decision?.kind === 'move' ? decision.lane : lane;
      if (target !== undefined && target !== lane && pendingThrough === null) {
        const key = target < lane ? 'ArrowLeft' : 'ArrowRight';
        const command = { key, requestedAt: Date.now(), returnedAt: 0, matched: false };
        record({ type: 'input-request', at: command.requestedAt, key, fromLane: lane, target, settling });
        await page.keyboard.press(key);
        command.returnedAt = Date.now(); commands.push(command);
        keyboardRoundTripMs = Math.max(keyboardRoundTripMs, command.returnedAt - command.requestedAt);
        lane = target < lane ? lane === 2 ? 1 : 0 : lane === 0 ? 1 : 2;
        // Until actual keydown is returned in the next sample, use the full RTT.
        pendingThrough = forecastDistance(sample, (command.returnedAt - sample.sampledAtMs) / 1000 + RULES.laneChangeDuration);
        record({ type: 'input-returned', ...command, roundTripMs: command.returnedAt - command.requestedAt, pendingThrough });
        // The input and its trace may have advanced the game: never screenshot
        // or issue another command from the pre-input observation.
        continue;
      }
      if (start && landingConfirmed && !slideCommand) {
        const window = controlWindow(plan, sample, lane, (Date.now() - sample.sampledAtMs + keyboardRoundTripMs + transportMs + keyboardMs) / 1000 + RULES.laneChangeDuration);
        record({ type: 'slide-window', at: Date.now(), window });
        if (window.safe) {
          slideCommand = { key: 'ArrowDown', requestedAt: Date.now(), returnedAt: 0, matched: false };
          await page.keyboard.press('ArrowDown'); slideCommand.returnedAt = Date.now();
          record({ type: 'slide-returned', ...slideCommand });
          continue;
        }
      }
      if (checkpointEligible && pendingThrough === null) {
        const screenshotAt = Date.now();
        await page.screenshot({ path: capturePath, timeout: Math.max(1, maxMs - (Date.now() - startedAt)) });
        record({ type: 'checkpoint', sample, screenshotAt, screenshotReturnedAt: Date.now() });
        captured = true;
        continue;
      }
      // Driver-side pacing adds no browser RPC or synthetic game time.
      const waitMs = routePollDelay(plan, sample, collected, receivedAt - requestedAt, keyboardMs);
      await new Promise<void>(resolve => setTimeout(resolve, waitMs));
    }
    await expect(page.getByRole('button', { name: '再跑一次', exact: true })).toBeVisible();
    expect(landingConfirmed && slideVerified, 'the original trusted jump and grounded slide must complete').toBe(true);
    expect(captured && checkpointConfirmed, 'all three powerups must be actually collected and remain active across checkpoint capture').toBe(true);
  } catch (error) {
    record({ type: 'failure', at: Date.now(), error: error instanceof Error ? error.message : String(error), lastSample });
    throw error;
  } finally {
    try {
      saveReport(capturePath, '.route.json', { schemaVersion: 1, seed: POWERUP_ROUTE, startedAt, completedAt: Date.now(), captured, checkpointConfirmed,
        intentionalCollision, landingConfirmed, slideVerified, collected: [...collected], lane, keyboardMs, log });
    } finally { await disposeObservation(page); }
  }
}
