import { createScene } from './scene';
import { attachDebugHook } from './debug';
import { attachE2EHook } from './e2e-hook';
import { attachInputHandlers } from './input';
import { INITIAL_STATE, type PlacementState } from './placement';
import { createEnergyLedger } from './economy';
import { createPointsLedger } from './points';
import { createHud } from './hud';
import { selectWorker, selectHq, getSelected, getSelectedHq, clearSelection } from './selection';
import { buildWorker } from './worker';
import { buildDefender } from './defender';
import { buildRaider } from './raider';
import { trainUnit, buildOccupiedSet } from './training';
import { GRID_CONSTANTS } from './grid';
import { tickCombat } from './combat';
import { tickNodePoints, computeNodeHolder } from './node-points';
import { tickAi, createAiState } from './ai';
import { evaluateMatch, type MatchOutcome } from './match';
import { showMatchOverlay, hideMatchOverlay, isOverlayVisible } from './overlay';

const bundle = createScene();
const canvas = bundle.renderer.domElement;
canvas.style.display = 'block';
canvas.style.cursor = 'default';
document.body.appendChild(canvas);

const hook = attachDebugHook(bundle);

const energyLedger = createEnergyLedger();
const pointsLedger = createPointsLedger();
const hud = createHud();

// Expose HUD setters on the window hook so E2E specs and debug can
// force deterministic values.
const setEnergy = (patch: Parameters<typeof energyLedger.set>[0]): void => {
  energyLedger.set(patch);
  hud.updateEnergy(energyLedger.get());
};
const setPoints = (patch: Parameters<typeof pointsLedger.set>[0]): void => {
  pointsLedger.set(patch);
  hud.updatePoints(pointsLedger.get());
};

// Training: attempt to train a unit of the given kind for blue faction.
// Shared by keyboard handler and e2e hook pressTrainKey.
function attemptTrain(kind: 'worker' | 'defender' | 'raider'): void {
  const allUnits = [
    ...bundle.workers,
    ...bundle.defenders,
    ...bundle.raiders,
  ];
  const hqTiles = [bundle.hqs.blue, bundle.hqs.red];
  const occupied = buildOccupiedSet(allUnits, hqTiles);
  const isOccupied = (tx: number, ty: number): boolean => occupied.has(`${tx},${ty}`);

  const result = trainUnit(
    energyLedger.get(),
    'blue',
    kind,
    bundle.hqs.blue.tileX,
    bundle.hqs.blue.tileY,
    GRID_CONSTANTS.gridSize,
    isOccupied,
  );

  if (!result.ok) return;

  // Apply energy deduction.
  energyLedger.set({ blue: result.newEnergy.blue, red: result.newEnergy.red });
  hud.updateEnergy(energyLedger.get());

  const { tileX, tileY } = result.spawnTile;

  if (kind === 'worker') {
    const w = buildWorker('blue', tileX, tileY);
    bundle.scene.add(w.mesh);
    bundle.workers.push(w);
  } else if (kind === 'defender') {
    const d = buildDefender('blue', tileX, tileY);
    bundle.scene.add(d.mesh);
    bundle.defenders.push(d);
  } else {
    const r = buildRaider('blue', tileX, tileY);
    bundle.scene.add(r.mesh);
    bundle.raiders.push(r);
  }
}

let matchActive = true;
let matchOutcome: MatchOutcome | null = null;

let aiEnabled = true;
const aiState = createAiState();

function resetMatch(): void {
  // 1. Remove all current unit meshes from scene.
  for (const w of bundle.workers) bundle.scene.remove(w.mesh);
  for (const d of bundle.defenders) bundle.scene.remove(d.mesh);
  for (const r of bundle.raiders) bundle.scene.remove(r.mesh);
  bundle.workers.length = 0;
  bundle.defenders.length = 0;
  bundle.raiders.length = 0;

  // 2. Reset HQ HP and damage accumulators.
  bundle.hqs.blue.hp = bundle.hqs.blue.maxHp;
  bundle.hqs.blue.hpBar.update(bundle.hqs.blue.hp, bundle.hqs.blue.maxHp);
  bundle.hqs.blue.damageAccumulator = 0;
  bundle.hqs.red.hp = bundle.hqs.red.maxHp;
  bundle.hqs.red.hpBar.update(bundle.hqs.red.hp, bundle.hqs.red.maxHp);
  bundle.hqs.red.damageAccumulator = 0;

  // 3. Reset points and energy.
  pointsLedger.set({ blue: 0, red: 0 });
  hud.updatePoints(pointsLedger.get());
  energyLedger.set({ blue: 0, red: 0 });
  hud.updateEnergy(energyLedger.get());

  // 4. Reset node accumulators.
  for (const node of bundle.energyNodes) {
    node.pointAccumulator = 0;
    node.lastHolder = null;
    node.setFactionHold(null);
  }

  // 5. Reset AI state.
  const freshAi = createAiState();
  aiState.buildQueue = freshAi.buildQueue;
  aiState.trainCooldown = freshAi.trainCooldown;
  aiState.workerAssignTimer = freshAi.workerAssignTimer;
  aiState.mustering = freshAi.mustering;
  aiEnabled = true;

  // 6. Rebuild starter workers.
  const starters: Array<['blue' | 'red', number, number]> = [
    ['blue', 1, 0],
    ['blue', 0, 1],
    ['red', 18, 19],
    ['red', 19, 18],
  ];
  for (const [faction, tx, ty] of starters) {
    const w = buildWorker(faction, tx, ty);
    bundle.scene.add(w.mesh);
    bundle.workers.push(w);
  }

  // 7. Match state.
  matchOutcome = null;
  matchActive = true;
}

if (hook) {
  hook.setEnergy = setEnergy;
  hook.setPoints = setPoints;
  // Read-only worker tile helper — always available in dev mode for Playwright assertions.
  hook.getWorkerTile = (index: number) => {
    const w = bundle.workers[index];
    if (w === undefined) return null;
    return { tileX: w.tileX, tileY: w.tileY };
  };
  hook.getHqHp = (faction: string): number => {
    const f = faction === 'red' ? 'red' : 'blue';
    return bundle.hqs[f].hp;
  };
  hook.setAiEnabled = (enabled: boolean) => {
    aiEnabled = enabled;
  };
  hook.getAiBuildQueue = () => [...aiState.buildQueue];
  hook.getAiState = () => ({
    trainCooldown: aiState.trainCooldown,
    workerAssignTimer: aiState.workerAssignTimer,
    mustering: aiState.mustering,
  });
  hook.getMatchState = () => ({ outcome: matchOutcome, active: matchActive });
  hook.playAgain = () => {
    resetMatch();
    hideMatchOverlay();
  };
}

attachE2EHook(bundle, {
  setEnergy,
  getEnergy: () => energyLedger.get(),
  setPoints,
  attemptTrain,
  pointsLedger,
  aiState,
  getAiEnabled: () => aiEnabled,
  setAiEnabled: (v: boolean) => { aiEnabled = v; },
  getMatchState: () => ({ outcome: matchOutcome, active: matchActive }),
  playAgain: () => {
    resetMatch();
    hideMatchOverlay();
  },
  onMatchEnd: (outcome) => {
    matchActive = false;
    matchOutcome = outcome;
  },
});

let state: PlacementState = INITIAL_STATE;

attachInputHandlers({
  target: window,
  canvas,
  raycastPointer: bundle.raycastPointer,
  getState: () => state,
  setState: (next) => {
    state = next;
    if (hook) {
      hook.state = next;
    }
  },
});

// Worker / HQ click-to-select + click-to-move wiring.
// Priority: HQ hit → worker hit → tile hit / deselect.
canvas.addEventListener('pointerdown', (event: PointerEvent) => {
  if (event.button !== 0) return;
  // Only process in idle mode — placement mode owns its own click logic.
  if (state.mode !== 'idle') return;

  // HQ raycast — higher priority than worker (HQ is a large mesh).
  const hqHit = bundle.raycastHq(event.clientX, event.clientY);
  if (hqHit !== null) {
    if (hqHit.faction === 'blue') {
      selectHq(hqHit);
    } else {
      // Red HQ click — deselect everything.
      clearSelection();
    }
    return;
  }

  const workerHit = bundle.raycastWorker(event.clientX, event.clientY);
  if (workerHit !== null) {
    if (workerHit.faction === 'blue') {
      selectWorker(workerHit);
    } else {
      // Red worker click — deselect.
      clearSelection();
    }
    return;
  }

  const tileHit = bundle.raycastPointer(event.clientX, event.clientY);
  const current = getSelected();
  if (current !== null && tileHit !== null) {
    current.moveTo(tileHit.tileX, tileHit.tileY);
  } else if (tileHit !== null) {
    // Clicked empty tile with no selection — deselect (already null, no-op).
  } else {
    // Off-grid click — deselect.
    clearSelection();
  }
});

// Training hotkeys — only active when blue HQ is the current selection.
window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (state.mode !== 'idle') return;
  const selectedHq = getSelectedHq();
  if (selectedHq === null || selectedHq.faction !== 'blue') return;

  const key = event.key.toLowerCase();
  if (key === 'q') {
    attemptTrain('worker');
  } else if (key === 'w') {
    attemptTrain('defender');
  } else if (key === 'e') {
    attemptTrain('raider');
  }
});

let lastTime = performance.now();

function animate(): void {
  requestAnimationFrame(animate);

  const now = performance.now();
  const deltaSeconds = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (matchActive) {
    energyLedger.tick(deltaSeconds);
    hud.updateEnergy(energyLedger.get());
    hud.updatePoints(pointsLedger.get());

    // Tick AI — red faction auto-plays when enabled.
    if (aiEnabled) {
      const redWorkers = bundle.workers.filter((w) => w.faction === 'red');
      const redDefenders = bundle.defenders.filter((d) => d.faction === 'red');
      const redRaiders = bundle.raiders.filter((r) => r.faction === 'red');
      tickAi({
        state: aiState,
        dt: deltaSeconds,
        energy: energyLedger.get(),
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
          energyLedger.set({ red: newEnergy.red, blue: newEnergy.blue });
          hud.updateEnergy(energyLedger.get());
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
            // If already mustering, send the new raider immediately.
            if (aiState.mustering) {
              r.moveTo(bundle.hqs.blue.tileX, bundle.hqs.blue.tileY);
            }
          }
        },
      });
    }

    // Tick all units (movement).
    for (const w of bundle.workers) {
      w.tick(deltaSeconds);
    }
    for (const d of bundle.defenders) {
      d.tick(deltaSeconds);
    }
    for (const r of bundle.raiders) {
      r.tick(deltaSeconds);
    }

    // Tick combat — resolves attacks, deaths, and scoring.
    tickCombat({
      units: {
        workers: bundle.workers,
        defenders: bundle.defenders,
        raiders: bundle.raiders,
      },
      hqs: bundle.hqs,
      pointsLedger,
      dt: deltaSeconds,
      scene: bundle.scene,
    });

    // Tick node-control points — accrues 1 pt/sec per held node.
    const allUnitsForNodes = [
      ...bundle.workers,
      ...bundle.defenders,
      ...bundle.raiders,
    ];
    tickNodePoints({
      nodes: bundle.energyNodes,
      units: allUnitsForNodes,
      pointsLedger,
      dt: deltaSeconds,
    });

    // Update node glow from live unit positions.
    for (const node of bundle.energyNodes) {
      node.setFactionHold(computeNodeHolder(node, allUnitsForNodes));
    }

    hud.updatePoints(pointsLedger.get());

    // Evaluate match end condition.
    const outcome = evaluateMatch({ pointsLedger, hqs: bundle.hqs });
    if (outcome !== null && !isOverlayVisible()) {
      matchActive = false;
      matchOutcome = outcome;
      showMatchOverlay(outcome, pointsLedger.get(), () => {
        resetMatch();
        hideMatchOverlay();
      });
    }
  }

  // Billboard HP bars toward camera each frame.
  const cam = bundle.camera;
  for (const w of bundle.workers) {
    w.hpBar.group.lookAt(cam.position);
  }
  for (const d of bundle.defenders) {
    d.hpBar.group.lookAt(cam.position);
  }
  for (const r of bundle.raiders) {
    r.hpBar.group.lookAt(cam.position);
  }
  bundle.hqs.blue.hpBar.group.lookAt(cam.position);
  bundle.hqs.red.hpBar.group.lookAt(cam.position);

  bundle.reconcile(state);
  bundle.render();
}
animate();

window.addEventListener('resize', () => {
  bundle.resize(window.innerWidth, window.innerHeight);
});

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  console.error('[vylux] webglcontextlost', { timestamp: Date.now() });
  bundle.contextLost.current = true;
});
