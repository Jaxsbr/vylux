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
import { trainUnit, buildOccupiedSet, findFreeNeighbour } from './training';
import { GRID_CONSTANTS } from './grid';
import { tickCombat } from './combat';
import { advanceRaidersFaction } from './advance';
import { tickNodePoints, computeNodeHolder } from './node-points';
import { tickAi, createAiState } from './ai';
import { evaluateMatch, type MatchOutcome } from './match';
import { showMatchOverlay, hideMatchOverlay, isOverlayVisible } from './overlay';
import { createBuildablesPanel } from './buildables-panel';
import {
  createOnboardingCue,
  dismissCue,
  resetCue,
  shouldShowCue,
  INITIAL_ONBOARDING_CUE_STATE,
  type OnboardingCueState,
} from './onboarding-cue';
import { UNIT_STATS, type UnitKind } from './units-config';
import {
  INITIAL_TRAINING_PANEL_STATE,
  handleHqClick,
  handleBuildableClick,
  handleEscape,
  handlePlacementSuccess,
  type TrainingPanelState,
} from './training-panel-state';

const bundle = createScene();
const canvas = bundle.renderer.domElement;
canvas.style.display = 'block';
canvas.style.cursor = 'default';
document.body.appendChild(canvas);

const hook = attachDebugHook(bundle);

const energyLedger = createEnergyLedger();
const pointsLedger = createPointsLedger();
const hud = createHud();

let trainingPanelState: TrainingPanelState = INITIAL_TRAINING_PANEL_STATE;

function setTrainingPanelState(next: TrainingPanelState): void {
  trainingPanelState = next;
}

// Whether Q/W/E dev hotkeys are active (requires ?dev=1 in URL or window.__vylux present).
const devParams = new URLSearchParams(window.location.search);
const isDevMode = (): boolean =>
  devParams.get('dev') === '1' || typeof window.__vylux !== 'undefined';

// Build panel — callback fires when a buildable button is clicked.
function onBuildableButtonClick(kind: UnitKind): void {
  const next = handleBuildableClick(trainingPanelState, kind);
  if (next !== trainingPanelState) {
    setTrainingPanelState(next);
    buildablesPanel.setArmed(next.armedKind);
  }
}

const buildablesPanel = createBuildablesPanel(onBuildableButtonClick);

// Onboarding cue — shown on fresh match start, dismissed on first HQ click.
const onboardingCue = createOnboardingCue();
let onboardingCueState: OnboardingCueState = INITIAL_ONBOARDING_CUE_STATE;

function syncOnboardingCue(): void {
  if (shouldShowCue(onboardingCueState)) {
    onboardingCue.show();
  } else {
    onboardingCue.hide();
  }
}

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

  // 8. Reset training panel — close panel and clear armed kind for fresh match.
  trainingPanelState = INITIAL_TRAINING_PANEL_STATE;
  syncBuildablesPanel();

  // 9. Reset onboarding cue — fresh match gets fresh guidance.
  onboardingCueState = resetCue(onboardingCueState);
  syncOnboardingCue();
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
  openBuildablesPanel: () => {
    const next = handleHqClick(trainingPanelState);
    if (!next.panelOpen) {
      // Was open, close it — open it fresh.
      setTrainingPanelState({ panelOpen: true, armedKind: null });
    } else {
      setTrainingPanelState(next);
    }
    syncBuildablesPanel();
    // Dismiss onboarding cue on the first panel open (e2e path).
    onboardingCueState = dismissCue(onboardingCueState);
    syncOnboardingCue();
  },
  closeBuildablesPanel: () => {
    const next = handleEscape(trainingPanelState);
    setTrainingPanelState(next);
    syncBuildablesPanel();
  },
  getBuildablesPanelOpen: () => trainingPanelState.panelOpen,
  armBuildable: (kind: UnitKind) => {
    const next = handleBuildableClick(trainingPanelState, kind);
    setTrainingPanelState(next);
    syncBuildablesPanel();
  },
  getArmedKind: () => trainingPanelState.armedKind,
  mouseTrainUnit: (kind: UnitKind, tileX: number, tileY: number) => {
    return attemptMouseTrain(kind, tileX, tileY);
  },
  getOnboardingCueVisible: () => onboardingCue.isVisible(),
  dismissOnboardingCue: () => {
    onboardingCueState = dismissCue(onboardingCueState);
    syncOnboardingCue();
  },
});

let state: PlacementState = INITIAL_STATE;

attachInputHandlers({
  target: window,
  canvas,
  raycastPointer: bundle.raycastPointer,
  isDevMode,
  getState: () => state,
  setState: (next) => {
    state = next;
    if (hook) {
      hook.state = next;
    }
  },
});

/** Check whether (tileX, tileY) is one of the 8 neighbours of (hqX, hqY). */
function isAdjacentToHq(tileX: number, tileY: number, hqX: number, hqY: number): boolean {
  const dx = Math.abs(tileX - hqX);
  const dy = Math.abs(tileY - hqY);
  return dx <= 1 && dy <= 1 && (dx + dy > 0);
}

/**
 * Try to place the armed unit kind at (tileX, tileY), or fall back to
 * findFreeNeighbour if the clicked tile is occupied.
 * Returns true on success.
 */
function attemptMouseTrain(kind: UnitKind, tileX: number, tileY: number): boolean {
  const hqX = bundle.hqs.blue.tileX;
  const hqY = bundle.hqs.blue.tileY;

  if (!isAdjacentToHq(tileX, tileY, hqX, hqY)) {
    buildablesPanel.showFeedback('Must place adjacent to HQ');
    return false;
  }

  const allUnits = [
    ...bundle.workers,
    ...bundle.defenders,
    ...bundle.raiders,
  ];
  const hqTiles = [bundle.hqs.blue, bundle.hqs.red];
  const occupied = buildOccupiedSet(allUnits, hqTiles);
  const isOccupied = (tx: number, ty: number): boolean => occupied.has(`${tx},${ty}`);

  // If the clicked tile is occupied, try the nearest free neighbour.
  let spawnX = tileX;
  let spawnY = tileY;
  if (isOccupied(tileX, tileY)) {
    const fallback = findFreeNeighbour(hqX, hqY, GRID_CONSTANTS.gridSize, isOccupied);
    if (fallback === null) {
      buildablesPanel.showFeedback('No free tile near HQ');
      return false;
    }
    spawnX = fallback.tileX;
    spawnY = fallback.tileY;
  }

  const result = trainUnit(
    energyLedger.get(),
    'blue',
    kind,
    hqX,
    hqY,
    GRID_CONSTANTS.gridSize,
    (tx, ty) => {
      // When we have a specific spawn tile, only reject if it's that exact tile occupied.
      // We already resolved the spawn tile above — just use the occupied set.
      return occupied.has(`${tx},${ty}`);
    },
  );

  if (!result.ok) {
    if (result.reason === 'insufficient-energy') {
      buildablesPanel.showFeedback('Not enough energy');
    } else {
      buildablesPanel.showFeedback('No free tile near HQ');
    }
    return false;
  }

  // Use our resolved spawn tile (not the one from trainUnit which uses findFreeNeighbour).
  energyLedger.set({ blue: result.newEnergy.blue, red: result.newEnergy.red });
  hud.updateEnergy(energyLedger.get());

  if (kind === 'worker') {
    const w = buildWorker('blue', spawnX, spawnY);
    bundle.scene.add(w.mesh);
    bundle.workers.push(w);
  } else if (kind === 'defender') {
    const d = buildDefender('blue', spawnX, spawnY);
    bundle.scene.add(d.mesh);
    bundle.defenders.push(d);
  } else {
    const r = buildRaider('blue', spawnX, spawnY);
    bundle.scene.add(r.mesh);
    bundle.raiders.push(r);
  }

  return true;
}

function syncBuildablesPanel(): void {
  buildablesPanel.updateAffordability(energyLedger.get().blue);
  buildablesPanel.setArmed(trainingPanelState.armedKind);
  if (trainingPanelState.panelOpen) {
    buildablesPanel.show();
  } else {
    buildablesPanel.hide();
  }
}

// Worker / HQ click-to-select + click-to-move wiring.
// Priority: armed-place-mode → HQ hit → worker hit → tile hit / deselect.
canvas.addEventListener('pointerdown', (event: PointerEvent) => {
  if (event.button !== 0) return;
  // Only process in idle mode — placement mode owns its own click logic.
  if (state.mode !== 'idle') return;

  // Armed place-mode takes priority over all other interactions.
  if (trainingPanelState.armedKind !== null) {
    const tileHit = bundle.raycastPointer(event.clientX, event.clientY);
    if (tileHit !== null) {
      const success = attemptMouseTrain(trainingPanelState.armedKind, tileHit.tileX, tileHit.tileY);
      if (success) {
        const next = handlePlacementSuccess(trainingPanelState);
        setTrainingPanelState(next);
        syncBuildablesPanel();
      }
    }
    return;
  }

  // HQ raycast — higher priority than worker (HQ is a large mesh).
  const hqHit = bundle.raycastHq(event.clientX, event.clientY);
  if (hqHit !== null) {
    if (hqHit.faction === 'blue') {
      // Toggle panel on blue HQ click.
      const next = handleHqClick(trainingPanelState);
      setTrainingPanelState(next);
      syncBuildablesPanel();
      // Dismiss onboarding cue on the first panel open.
      if (next.panelOpen) {
        onboardingCueState = dismissCue(onboardingCueState);
        syncOnboardingCue();
      }
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

// Escape key: close buildables panel when open (in addition to placement.ts Escape handling).
window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape' && trainingPanelState.panelOpen) {
    const next = handleEscape(trainingPanelState);
    setTrainingPanelState(next);
    syncBuildablesPanel();
  }
});

// Training hotkeys (Q/W/E) — dev-only: only active when ?dev=1 or window.__vylux present.
// E2E specs use pressTrainKey() instead, which goes through attemptTrain() directly.
window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (state.mode !== 'idle') return;
  if (!isDevMode()) return;
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

    // Keep buildables panel affordability in sync with current energy.
    if (trainingPanelState.panelOpen) {
      buildablesPanel.updateAffordability(energyLedger.get().blue);
    }

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

    // Advance raiders toward nearest enemy — runs before combat so raiders
    // close distance each frame and the auto-attack loop fires when in range.
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
