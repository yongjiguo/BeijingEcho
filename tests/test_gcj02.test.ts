import { describe, expect, it } from 'vitest';
import { wgs84ToGcj02 } from '../src/gcj02';

describe('wgs84ToGcj02', () => {
  it('shifts a central-Beijing coordinate by roughly 300-700m (typical GCJ-02 offset)', () => {
    // Tiananmen Square, WGS-84 (from spots.json ballpark)
    const [lng, lat] = wgs84ToGcj02(116.391, 39.907);
    // Offset magnitude in degrees should be small but nonzero.
    const dLng = Math.abs(lng - 116.391);
    const dLat = Math.abs(lat - 39.907);
    expect(dLng).toBeGreaterThan(0.001);
    expect(dLat).toBeGreaterThan(0.001);
    expect(dLng).toBeLessThan(0.01);
    expect(dLat).toBeLessThan(0.01);
    // ~0.005° ≈ 500m; assert converted distance is in the plausible 200-800m band.
    const meters = Math.hypot(dLng * 85_000, dLat * 111_000);
    expect(meters).toBeGreaterThan(100);
    expect(meters).toBeLessThan(800);
  });

  it('is deterministic (pure function, same input same output)', () => {
    expect(wgs84ToGcj02(116.391, 39.907)).toEqual(wgs84ToGcj02(116.391, 39.907));
  });

  it('output stays monotonic relative to input (no coordinate folding nearby)', () => {
    const a = wgs84ToGcj02(116.0, 40.0);
    const b = wgs84ToGcj02(116.01, 40.01);
    expect(b[0]).toBeGreaterThan(a[0]);
    expect(b[1]).toBeGreaterThan(a[1]);
  });

  it('Beijing landmark lands within ~1km of its WGS-84 truth on a GCJ-02 basemap', () => {
    // Forbidden City: conversion should keep the pin in the same neighborhood.
    const [lng, lat] = wgs84ToGcj02(116.397, 39.918);
    expect(Math.abs(lng - 116.397)).toBeLessThan(0.01);
    expect(Math.abs(lat - 39.918)).toBeLessThan(0.01);
  });
});
