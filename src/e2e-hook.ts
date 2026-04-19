import * as THREE from 'three';
import type { SceneBundle } from './scene';
import type { FactionEnergy } from './economy';
import { tickEnergy } from './economy';
import type { FactionPoints } from './points';
import type { FactionHold } from './energy-node';
import { buildWorker } from './worker';
import { UNIT_STATS } from './units-config';
import { buildDefender } from './defender';
import { buildRaider } from './raider';
import type { UnitKind } from './units-config';
import { selectHq as selectionSelectHq, selectWorker as selectionSelectWorker, clearSelection, getSelectedHq } from './selection';
import { tickCombat, type PointsLedger } from './combat';
import { advanceRaidersFaction } from './advance';
import { tickNodePoints } from './node-points';
import { tickAi, type AiState } from './ai';
import { evaluateMatch } from './match';
import { showMatchOverlay, isOverlayVisible } from './overlay';

// E2E-only hook — installed only when the URL contains `?e2e=1`.
// This file is imported by main.ts but the install function exits early unless
// the query param is present, so production builds that never pass ?e2e=1
// never run any of this logic.
//
// State-ownership: this module does NOT write to placement.ts state. It seeds
// unit meshes directly into the scene so the main reconcile loop never sees them.
//
// HQs and energy nodes are NOT seeded here — they are pre-placed by
// createScene() and are always present in the scene.

type SceneName = 'idle-start' | 'early-economy' | 'mid-combat';

function clearGroup(group: THREE.Group): void {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  }
}

function seedIdleStart(_group: THREE.Group): void {
  // HQs, energy nodes, and starter workers are already in the scene from createScene().
  // Nothing extra to seed for idle-start.
}

function seedEarlyEconomy(group: THREE.Group, bundle: SceneBundle): void {
  seedIdleStart(group);

  // Move starter blue workers near the bottom-left node (tile 5,5).
  // Blue starters: index 0 = (1,0), index 1 = (0,1).
  if (bundle.workers[0]) bundle.workers[0].setTile(5, 5);
  if (bundle.workers[1]) bundle.workers[1].setTile(4, 5);

  // Spawn a third blue worker at (5,6).
  const blueExtra = buildWorker('blue', 5, 6);
  blueExtra.mesh.name = 'e2e-spawned-blue-worker';
  bundle.scene.add(blueExtra.mesh);
  bundle.workers.push(blueExtra);

  // Move starter red workers near the top-right node (tile 14,14).
  // Red starters: index 2 = (18,19), index 3 = (19,18).
  if (bundle.workers[2]) bundle.workers[2].setTile(14, 14);
  if (bundle.workers[3]) bundle.workers[3].setTile(13, 14);

  // Spawn a third red worker at (14,13).
  const redExtra = buildWorker('red', 14, 13);
  redExtra.mesh.name = 'e2e-spawned-red-worker';
  bundle.scene.add(redExtra.mesh);
  bundle.workers.push(redExtra);

  // Spawn 1 defender per faction near each HQ — shows new silhouette.
  const blueDefender = buildDefender('blue', 1, 1);
  blueDefender.mesh.name = 'e2e-spawned-blue-defender';
  bundle.scene.add(blueDefender.mesh);
  bundle.defenders.push(blueDefender);

  const redDefender = buildDefender('red', 18, 18);
  redDefender.mesh.name = 'e2e-spawned-red-defender';
  bundle.scene.add(redDefender.mesh);
  bundle.defenders.push(redDefender);
}

function seedMidCombat(group: THREE.Group, bundle: SceneBundle): void {
  seedIdleStart(group);

  // Blue workers at their node for economy context.
  if (bundle.workers[0]) bundle.workers[0].setTile(5, 5);
  if (bundle.workers[1]) bundle.workers[1].setTile(4, 5);

  // Red workers near their HQ.
  if (bundle.workers[2]) bundle.workers[2].setTile(17, 18);
  if (bundle.workers[3]) bundle.workers[3].setTile(18, 17);

  // Blue raiders charging toward the red HQ — real raider meshes.
  const blueRaiderPositions: [number, number][] = [
    [15, 16],
    [16, 16],
    [16, 17],
  ];
  for (const [tx, ty] of blueRaiderPositions) {
    const raider = buildRaider('blue', tx, ty);
    raider.mesh.name = 'e2e-blue-raider';
    bundle.scene.add(raider.mesh);
    bundle.raiders.push(raider);
  }

  // Red defenders near their HQ — real defender meshes.
  const redDefenderPositions: [number, number][] = [
    [17, 17],
    [18, 18],
  ];
  for (const [tx, ty] of redDefenderPositions) {
    const defender = buildDefender('red', tx, ty);
    defender.mesh.name = 'e2e-red-defender';
    bundle.scene.add(defender.mesh);
    bundle.defenders.push(defender);
  }
}

function seedScene(name: SceneName, group: THREE.Group, bundle: SceneBundle): void {
  clearGroup(group);

  // Remove any extra e2e-spawned workers from previous scene.
  const spawnedWorkers = bundle.workers.filter((w) => w.mesh.name.startsWith('e2e-spawned'));
  for (const w of spawnedWorkers) {
    bundle.scene.remove(w.mesh);
  }
  const keepWorkers = bundle.workers.filter((w) => !w.mesh.name.startsWith('e2e-spawned'));
  bundle.workers.length = 0;
  for (const w of keepWorkers) {
    bundle.workers.push(w);
  }

  // Remove all e2e-spawned defenders.
  for (const d of bundle.defenders) {
    bundle.scene.remove(d.mesh);
  }
  bundle.defenders.length = 0;

  // Remove all e2e-spawned raiders.
  for (const r of bundle.raiders) {
    bundle.scene.remove(r.mesh);
  }
  bundle.raiders.length = 0;

  if (name === 'idle-start') {
    seedIdleStart(group);
  } else if (name === 'early-economy') {
    seedEarlyEconomy(group, bundle);
  } else if (name === 'mid-combat') {
    seedMidCombat(group, bundle);
  }
}

export type HudSetters = {
  setEnergy: (patch: Partial<FactionEnergy>) => void;
  getEnergy: () => FactionEnergy;
  setPoints: (patch: Partial<FactionPoints>) => void;
  attemptTrain: (kind: UnitKind) => void;
  pointsLedger: PointsLedger;
  aiState: AiState;
  getAiEnabled: () => boolean;
  setAiEnabled: (v: boolean) => void;
  getMatchState: () => { outcome: import('./match').MatchOutcome | null; active: boolean };
  playAgain: () => void;
  /** Called by e2e advanceTime when evaluateMatch returns non-null. */
  onMatchEnd: (outcome: import('./match').MatchOutcome, score: { blue: number; red: number }) => void;
  // Mouse-training panel hooks — wired by main.ts after panel is created.
  openBuildablesPanel: () => void;
  closeBuildablesPanel: () => void;
  getBuildablesPanelOpen: () => boolean;
  armBuildable: (kind: UnitKind) => void;
  getArmedKind: () => UnitKind | null;
  mouseTrainUnit: (kind: UnitKind, tileX: number, tileY: number) => boolean;
  // Onboarding cue hooks.
  getOnboardingCueVisible: () => boolean;
  dismissOnboardingCue: () => void;
  // Node tooltip hooks.
  getNodeTooltipVisible: () => boolean;
  showNodeTooltip: (x: number, y: number) => void;
  hideNodeTooltip: () => void;
};

export type E2EHookExtension = {
  setScene: (name: string) => void;
  ready: () => Promise<void>;
  setEnergy: (patch: Partial<FactionEnergy>) => void;
  getEnergy: () => FactionEnergy;
  setPoints: (patch: Partial<FactionPoints>) => void;
  setNodeHolds: (holds: Record<number, FactionHold>) => void;
  spawnWorker: (faction: string, tileX: number, tileY: number) => number;
  moveWorker: (index: number, tileX: number, tileY: number) => void;
  getWorkerTile: (index: number) => { tileX: number; tileY: number } | null;
  selectHq: (faction: string) => void;
  pressTrainKey: (key: string) => void;
  getUnitCount: (query: { faction: string; kind: string }) => number;
  // Combat test hooks.
  setUnitHp: (query: { faction: string; kind: string; index: number; hp: number }) => void;
  getHqHp: (faction: string) => number;
  advanceTime: (seconds: number) => void;
  // Node-control point hooks.
  getNodePointAccumulator: (nodeIndex: number) => number;
  getPoints: (faction: string) => number;
  // AI hooks.
  setAiEnabled: (enabled: boolean) => void;
  getAiBuildQueue: () => UnitKind[];
  getAiState: () => { trainCooldown: number; workerAssignTimer: number; mustering: boolean };
  // Match hooks.
  getMatchState: () => { outcome: import('./match').MatchOutcome | null; active: boolean };
  playAgain: () => void;
  // Mouse-training panel hooks.
  openBuildablesPanel: () => void;
  closeBuildablesPanel: () => void;
  getBuildablesPanelOpen: () => boolean;
  armBuildable: (kind: string) => void;
  getArmedKind: () => string | null;
  mouseTrainUnit: (kind: string, tileX: number, tileY: number) => boolean;
  // Onboarding cue hooks.
  getOnboardingCueVisible: () => boolean;
  dismissOnboardingCue: () => void;
  // Worker selection / move-order hooks.
  selectWorkerByIndex: (index: number) => void;
  getWorkerSelectionRingVisible: (index: number) => boolean;
  giveWorkerMoveOrder: (index: number, tileX: number, tileY: number) => void;
  getWorkerTargetTile: (index: number) => { tileX: number; tileY: number } | null;
  // Raider placement hooks.
  spawnRaider: (faction: string, tileX: number, tileY: number) => number;
  getRaiderTile: (faction: string, index: number) => { tileX: number; tileY: number } | null;
  // Node tooltip hooks.
  getNodeTooltipVisible: () => boolean;
  showNodeTooltip: (x: number, y: number) => void;
  hideNodeTooltip: () => void;
};

export function attachE2EHook(bundle: SceneBundle, hudSetters: HudSetters): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('e2e') !== '1') return;

  // Disable AI by default in E2E sessions — tests that want AI must opt in
  // via setAiEnabled(true). This prevents AI from interfering with existing
  // combat/worker/training specs that were written before AI existed.
  hudSetters.setAiEnabled(false);

  const overlayGroup = new THREE.Group();
  overlayGroup.name = 'e2e-overlays';
  bundle.scene.add(overlayGroup);

  const ext: E2EHookExtension = {
    setScene(name: string): void {
      seedScene(name as SceneName, overlayGroup, bundle);
    },
    ready(): Promise<void> {
      return new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
    },
    setEnergy: hudSetters.setEnergy,
    getEnergy: hudSetters.getEnergy,
    setPoints: hudSetters.setPoints,
    setNodeHolds(holds: Record<number, FactionHold>): void {
      for (const [indexStr, faction] of Object.entries(holds)) {
        const idx = Number(indexStr);
        const node = bundle.energyNodes[idx];
        if (node !== undefined) {
          node.setFactionHold(faction);
        }
      }
    },
    spawnWorker(faction: string, tileX: number, tileY: number): number {
      const f = faction === 'red' ? 'red' : 'blue';
      const w = buildWorker(f, tileX, tileY);
      w.mesh.name = 'e2e-spawned-' + f + '-worker';
      bundle.scene.add(w.mesh);
      bundle.workers.push(w);
      return bundle.workers.length - 1;
    },
    moveWorker(index: number, tileX: number, tileY: number): void {
      const w = bundle.workers[index];
      if (w !== undefined) {
        w.setTile(tileX, tileY);
      }
    },
    getWorkerTile(index: number): { tileX: number; tileY: number } | null {
      const w = bundle.workers[index];
      if (w === undefined) return null;
      return { tileX: w.tileX, tileY: w.tileY };
    },
    selectHq(faction: string): void {
      if (faction === 'red') {
        clearSelection();
      } else {
        selectionSelectHq(bundle.hqs.blue);
      }
    },
    pressTrainKey(key: string): void {
      // Gate on blue HQ being selected — same condition as the real keyboard handler.
      const selectedHq = getSelectedHq();
      if (selectedHq === null || selectedHq.faction !== 'blue') return;

      const k = key.toLowerCase();
      if (k === 'q') {
        hudSetters.attemptTrain('worker');
      } else if (k === 'w') {
        hudSetters.attemptTrain('defender');
      } else if (k === 'e') {
        hudSetters.attemptTrain('raider');
      }
    },
    getUnitCount(query: { faction: string; kind: string }): number {
      const faction = query.faction === 'red' ? 'red' : 'blue';
      if (query.kind === 'worker') {
        return bundle.workers.filter((u) => u.faction === faction).length;
      }
      if (query.kind === 'defender') {
        return bundle.defenders.filter((u) => u.faction === faction).length;
      }
      if (query.kind === 'raider') {
        return bundle.raiders.filter((u) => u.faction === faction).length;
      }
      return 0;
    },

    setUnitHp(query: { faction: string; kind: string; index?: number; hp: number }): void {
      const faction = query.faction === 'red' ? 'red' : 'blue';
      if (query.kind === 'hq') {
        const hq = bundle.hqs[faction];
        hq.hp = Math.max(0, query.hp);
        hq.hpBar.update(hq.hp, hq.maxHp);
        return;
      }
      let arr: Array<{ faction: string; hp: number; maxHp: number; hpBar: { update: (hp: number, max: number) => void; group: { visible: boolean } } }> = [];
      if (query.kind === 'worker') {
        arr = bundle.workers.filter((u) => u.faction === faction);
      } else if (query.kind === 'defender') {
        arr = bundle.defenders.filter((u) => u.faction === faction);
      } else if (query.kind === 'raider') {
        arr = bundle.raiders.filter((u) => u.faction === faction);
      }
      const unit = arr[query.index ?? 0];
      if (unit === undefined) return;
      unit.hp = Math.max(0, query.hp);
      unit.hpBar.update(unit.hp, unit.maxHp);
      unit.hpBar.group.visible = unit.hp < unit.maxHp;
    },

    getHqHp(faction: string): number {
      const f = faction === 'red' ? 'red' : 'blue';
      return bundle.hqs[f].hp;
    },

    advanceTime(seconds: number): void {
      // Simulate combat + node-point ticks (and AI when enabled) in fixed steps.
      const STEP = 0.016;
      // Seed energy from the real ledger so pre-set values (setEnergy calls
      // before advanceTime) are honoured.
      let energyCache = hudSetters.getEnergy();
      let remaining = seconds;
      while (remaining > 0) {
        const dt = Math.min(STEP, remaining);
        remaining -= dt;

        // Tick energy — mirrors main.ts energyLedger.tick.
        energyCache = tickEnergy(energyCache, dt);

        // Tick AI if enabled.
        if (hudSetters.getAiEnabled()) {
          const redWorkers = bundle.workers.filter((w) => w.faction === 'red');
          const redDefenders = bundle.defenders.filter((d) => d.faction === 'red');
          const redRaiders = bundle.raiders.filter((r) => r.faction === 'red');
          tickAi({
            state: hudSetters.aiState,
            dt,
            energy: energyCache,
            redWorkers,
            redDefenders,
            redRaiders,
            allWorkers: bundle.workers,
            allDefenders: bundle.defenders,
            allRaiders: bundle.raiders,
            energyNodes: bundle.energyNodes,
            redHq: bundle.hqs.red,
            blueHq: bundle.hqs.blue,
            onEnergyChanged: (newEnergy) => {
              energyCache = { ...newEnergy };
            },
            onTrained: (kind, tileX, tileY) => {
              if (kind === 'worker') {
                const w = buildWorker('red', tileX, tileY);
                bundle.scene.add(w.mesh);
                bundle.workers.push(w);
              } else if (kind === 'defender') {
                const d = buildDefender('red', tileX, tileY);
                bundle.scene.add(d.mesh);
                bundle.defenders.push(d);
              } else {
                const r = buildRaider('red', tileX, tileY);
                bundle.scene.add(r.mesh);
                bundle.raiders.push(r);
                if (hudSetters.aiState.mustering) {
                  r.moveTo(bundle.hqs.blue.tileX, bundle.hqs.blue.tileY);
                }
              }
            },
          });
        }

        // Tick unit movement.
        for (const w of bundle.workers) w.tick(dt);
        for (const d of bundle.defenders) d.tick(dt);
        for (const r of bundle.raiders) r.tick(dt);

        // Advance raiders toward nearest enemy (mirrors main.ts).
        const raiderRange = UNIT_STATS.raider.range;
        advanceRaidersFaction(
          'blue',
          bundle.raiders,
          bundle.workers.filter((w) => w.faction === 'red'),
          bundle.hqs.red,
          raiderRange,
        );
        advanceRaidersFaction(
          'red',
          bundle.raiders,
          bundle.workers.filter((w) => w.faction === 'blue'),
          bundle.hqs.blue,
          raiderRange,
        );

        tickCombat({
          units: {
            workers: bundle.workers,
            defenders: bundle.defenders,
            raiders: bundle.raiders,
          },
          hqs: bundle.hqs,
          pointsLedger: hudSetters.pointsLedger,
          dt,
          scene: bundle.scene,
        });
        const allUnits = [
          ...bundle.workers,
          ...bundle.defenders,
          ...bundle.raiders,
        ];
        tickNodePoints({
          nodes: bundle.energyNodes,
          units: allUnits,
          pointsLedger: hudSetters.pointsLedger,
          dt,
        });

        // Evaluate match end — mirrors main.ts animate loop.
        const outcome = evaluateMatch({
          pointsLedger: hudSetters.pointsLedger,
          hqs: bundle.hqs,
        });
        if (outcome !== null && !isOverlayVisible()) {
          const score = hudSetters.pointsLedger.get();
          hudSetters.onMatchEnd(outcome, score);
          showMatchOverlay(outcome, score, hudSetters.playAgain);
        }
      }
      // Sync final energy back to the real ledger so HUD reflects AI spending.
      hudSetters.setEnergy({ red: energyCache.red, blue: energyCache.blue });
    },

    getNodePointAccumulator(nodeIndex: number): number {
      const node = bundle.energyNodes[nodeIndex];
      if (node === undefined) return 0;
      return node.pointAccumulator;
    },

    getPoints(faction: string): number {
      const pts = hudSetters.pointsLedger.get();
      return faction === 'red' ? pts.red : pts.blue;
    },

    setAiEnabled(enabled: boolean): void {
      hudSetters.setAiEnabled(enabled);
    },

    getAiBuildQueue(): UnitKind[] {
      return [...hudSetters.aiState.buildQueue];
    },

    getAiState(): { trainCooldown: number; workerAssignTimer: number; mustering: boolean } {
      return {
        trainCooldown: hudSetters.aiState.trainCooldown,
        workerAssignTimer: hudSetters.aiState.workerAssignTimer,
        mustering: hudSetters.aiState.mustering,
      };
    },

    getMatchState(): { outcome: import('./match').MatchOutcome | null; active: boolean } {
      return hudSetters.getMatchState();
    },

    playAgain(): void {
      hudSetters.playAgain();
    },

    openBuildablesPanel(): void {
      hudSetters.openBuildablesPanel();
    },

    closeBuildablesPanel(): void {
      hudSetters.closeBuildablesPanel();
    },

    getBuildablesPanelOpen(): boolean {
      return hudSetters.getBuildablesPanelOpen();
    },

    armBuildable(kind: string): void {
      const k = kind as UnitKind;
      hudSetters.armBuildable(k);
    },

    getArmedKind(): string | null {
      return hudSetters.getArmedKind();
    },

    mouseTrainUnit(kind: string, tileX: number, tileY: number): boolean {
      return hudSetters.mouseTrainUnit(kind as UnitKind, tileX, tileY);
    },

    getOnboardingCueVisible(): boolean {
      return hudSetters.getOnboardingCueVisible();
    },

    dismissOnboardingCue(): void {
      hudSetters.dismissOnboardingCue();
    },

    selectWorkerByIndex(index: number): void {
      const blueWorkers = bundle.workers.filter((w) => w.faction === 'blue');
      const w = blueWorkers[index];
      if (w !== undefined) {
        selectionSelectWorker(w);
      }
    },

    getWorkerSelectionRingVisible(index: number): boolean {
      const blueWorkers = bundle.workers.filter((w) => w.faction === 'blue');
      const w = blueWorkers[index];
      if (w === undefined) return false;
      return w.selectionRing.visible;
    },

    giveWorkerMoveOrder(index: number, tileX: number, tileY: number): void {
      const blueWorkers = bundle.workers.filter((w) => w.faction === 'blue');
      const w = blueWorkers[index];
      if (w !== undefined) {
        w.moveTo(tileX, tileY);
      }
    },

    getWorkerTargetTile(index: number): { tileX: number; tileY: number } | null {
      const blueWorkers = bundle.workers.filter((w) => w.faction === 'blue');
      const w = blueWorkers[index];
      if (w === undefined) return null;
      return { tileX: w.targetTileX, tileY: w.targetTileY };
    },

    spawnRaider(faction: string, tileX: number, tileY: number): number {
      const f = faction === 'red' ? 'red' : 'blue';
      const r = buildRaider(f, tileX, tileY);
      r.mesh.name = 'e2e-spawned-' + f + '-raider';
      bundle.scene.add(r.mesh);
      bundle.raiders.push(r);
      return bundle.raiders.filter((u) => u.faction === f).length - 1;
    },

    getRaiderTile(faction: string, index: number): { tileX: number; tileY: number } | null {
      const f = faction === 'red' ? 'red' : 'blue';
      const factionRaiders = bundle.raiders.filter((u) => u.faction === f);
      const r = factionRaiders[index];
      if (r === undefined) return null;
      return { tileX: r.tileX, tileY: r.tileY };
    },

    getNodeTooltipVisible(): boolean {
      return hudSetters.getNodeTooltipVisible();
    },

    showNodeTooltip(x: number, y: number): void {
      hudSetters.showNodeTooltip(x, y);
    },

    hideNodeTooltip(): void {
      hudSetters.hideNodeTooltip();
    },
  };

  // Merge into window.__vylux if it already exists (from debug.ts), or create
  // a minimal shell if not (production build with ?e2e=1).
  if (window.__vylux) {
    Object.assign(window.__vylux, ext);
  } else {
    (window.__vylux as unknown as Record<string, unknown>) = ext;
  }
}
