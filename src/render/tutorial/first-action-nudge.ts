// Phase C.6 — first-action nudge for a normal (non-tutorial) match.
//
// A single coach bubble pointing at the player's HQ ("SELECT YOUR HQ") so
// even players who skip the tutorial get one clue on entry. Dismisses itself
// the moment the HQ is selected, or after a timeout, then tears down. Reuses
// the tutorial coach so the nudge reads in the same visual language.

import type { Camera } from 'three';
import { toFloat } from '../../sim/fixed';
import type { Sim } from '../../sim/sim';
import type { Faction } from '../../sim/types';
import type { InputController } from '../input-controller';
import { CoachOverlay, projectTileToScreen } from './coach-overlay';

const AUTO_DISMISS_MS = 12_000;

export class FirstActionNudge {
  private readonly sim: Sim;
  private readonly input: InputController;
  private readonly playerFaction: Faction;
  private readonly camera: Camera;
  private readonly canvas: HTMLCanvasElement;
  private readonly coach: CoachOverlay;
  private elapsed = 0;
  private done = false;

  constructor(
    sim: Sim,
    input: InputController,
    playerFaction: Faction,
    camera: Camera,
    canvas: HTMLCanvasElement,
  ) {
    this.sim = sim;
    this.input = input;
    this.playerFaction = playerFaction;
    this.camera = camera;
    this.canvas = canvas;
    this.coach = new CoachOverlay(playerFaction);
    this.coach.setStep({
      title: 'SELECT YOUR HQ',
      body: 'Click your HQ to begin. New to Vylux? Try the Tutorial from the menu.',
      gesture: 'leftClick',
      ack: false,
    });
  }

  update(dtMs: number): void {
    if (this.done) return;
    this.elapsed += dtMs;
    if (this.input.getSelectedHqFaction() === this.playerFaction || this.elapsed > AUTO_DISMISS_MS) {
      this.destroy();
      return;
    }
    const fs = this.sim.state.factions[this.playerFaction];
    this.coach.setAnchor(projectTileToScreen(toFloat(fs.hqX), toFloat(fs.hqY), this.camera, this.canvas));
    this.coach.update(dtMs);
  }

  destroy(): void {
    if (this.done) return;
    this.done = true;
    this.coach.destroy();
  }
}
