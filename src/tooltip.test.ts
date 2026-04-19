import { describe, it, expect } from 'vitest';
import { clampTooltipPosition } from './tooltip';

describe('clampTooltipPosition', () => {
  const vpW = 1280;
  const vpH = 800;
  const tipW = 200;
  const tipH = 80;

  it('no clamping needed when tooltip fits comfortably', () => {
    const { left, top } = clampTooltipPosition(100, 100, tipW, tipH, vpW, vpH);
    expect(left).toBe(100);
    expect(top).toBe(100);
  });

  it('flips left when anchor + offset would clip right edge', () => {
    // Anchor at 1200 + tipW(200) = 1400 > 1280 — should flip.
    const { left } = clampTooltipPosition(1200, 100, tipW, tipH, vpW, vpH);
    // Flipped: anchorX - tipW = 1200 - 200 = 1000.
    expect(left).toBe(1200 - tipW);
  });

  it('hard clamps left to margin when flip would go negative', () => {
    // Anchor near left edge — flip would put left at 0 - tipW < margin.
    const { left } = clampTooltipPosition(2, 100, tipW, tipH, vpW, vpH);
    expect(left).toBe(8);
  });

  it('flips up when anchor + offset would clip bottom edge', () => {
    // Anchor at 750 + tipH(80) = 830 > 800 — should flip.
    const { top } = clampTooltipPosition(100, 750, tipW, tipH, vpW, vpH);
    // Flipped: anchorY - tipH = 750 - 80 = 670.
    expect(top).toBe(750 - tipH);
  });

  it('hard clamps top to margin when tooltip is very tall at top of viewport', () => {
    // Anchor at 1 — flipped would be 1 - tipH = negative.
    const { top } = clampTooltipPosition(100, 1, tipW, tipH, vpW, vpH);
    expect(top).toBe(8);
  });

  it('respects custom margin', () => {
    const { left, top } = clampTooltipPosition(100, 100, tipW, tipH, vpW, vpH, 20);
    // Fits fine at 100,100 with margin 20 (100 + 200 + 20 = 320 < 1280).
    expect(left).toBe(100);
    expect(top).toBe(100);
  });

  it('returns margin when anchor is 0 and tooltip would clip both edges', () => {
    // Tiny viewport, big tooltip — should clamp to margin.
    const { left, top } = clampTooltipPosition(0, 0, 500, 500, 300, 300);
    expect(left).toBe(8);
    expect(top).toBe(8);
  });

  it('zero-size tooltip returns anchor without clamping', () => {
    const { left, top } = clampTooltipPosition(50, 50, 0, 0, vpW, vpH);
    expect(left).toBe(50);
    expect(top).toBe(50);
  });
});
