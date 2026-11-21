import { describe, expect, it } from 'vitest';
import {
  CompassWatcher,
  GpsTrackHeading,
  HeadingResolver,
  MedianHeadingFilter,
  headingFromDeviceOrientation,
} from '../src/compass';

const asEvt = (o: Record<string, unknown>) => o as unknown as DeviceOrientationEvent;

describe('headingFromDeviceOrientation', () => {
  it('prefers webkitCompassHeading when present', () => {
    expect(headingFromDeviceOrientation(asEvt({ webkitCompassHeading: 123, alpha: 20, absolute: true }))).toBe(123);
  });

  it('derives 360 - alpha when absolute', () => {
    expect(headingFromDeviceOrientation(asEvt({ alpha: 20, absolute: true }))).toBe(340);
    expect(headingFromDeviceOrientation(asEvt({ alpha: 0, absolute: true }))).toBe(0);
  });

  it('returns null when not absolute or alpha missing', () => {
    expect(headingFromDeviceOrientation(asEvt({ alpha: 20, absolute: false }))).toBeNull();
    expect(headingFromDeviceOrientation(asEvt({ alpha: null, absolute: true }))).toBeNull();
    expect(headingFromDeviceOrientation(asEvt({}))).toBeNull();
  });
});

describe('MedianHeadingFilter', () => {
  it('returns null until 3 samples, then the median', () => {
    const f = new MedianHeadingFilter();
    expect(f.push(10, 0)).toBeNull();
    expect(f.push(20, 100)).toBeNull();
    expect(f.push(30, 200)).toBe(20);
  });

  it('drops samples older than ~2s', () => {
    const f = new MedianHeadingFilter();
    f.push(10, 0);
    f.push(20, 100);
    f.push(30, 200);
    expect(f.push(200, 3000)).toBeNull(); // window holds only the new sample
    expect(f.push(210, 3100)).toBeNull();
    expect(f.push(220, 3200)).toBe(210);
  });

  it('median is the sorted middle value, not the average', () => {
    const f = new MedianHeadingFilter();
    expect(f.push(5, 0)).toBeNull();
    expect(f.push(10, 10)).toBeNull();
    expect(f.push(30, 20)).toBe(10);
  });
});

describe('CompassWatcher', () => {
  it('emits mock heading on start and on setMock; null clears', () => {
    const w = new CompassWatcher();
    const got: number[] = [];
    w.setMock(45);
    w.start((h) => got.push(h));
    expect(got).toEqual([45]);
    w.setMock(90);
    expect(got).toEqual([45, 90]);
    w.setMock(null); // resume real feed, no emission
    expect(got).toEqual([45, 90]);
    w.stop();
  });

  it('exposes latest heading for resolvers', () => {
    const w = new CompassWatcher();
    expect(w.heading()).toBeNull();
    w.setMock(270);
    w.start(() => {});
    expect(w.heading()).toBe(270);
    w.stop();
  });
});

describe('GpsTrackHeading', () => {
  const A = { lat: 39.9042, lng: 116.4074, accuracy: 5 };

  it('returns null until two fixes >=5m apart', () => {
    const g = new GpsTrackHeading();
    expect(g.update(A)).toBeNull();
    expect(g.update({ ...A })).toBeNull(); // same point, <5m
  });

  it('returns bearing once moved >=5m and keeps updating', () => {
    const g = new GpsTrackHeading();
    g.update(A);
    const north = g.update({ lat: 39.9142, lng: 116.4074, accuracy: 5 });
    expect(north).not.toBeNull();
    expect(Math.min(north!, 360 - north!)).toBeLessThan(2);
    const east = g.update({ lat: 39.9042, lng: 116.4174, accuracy: 5 });
    expect(Math.abs(east! - 142.5)).toBeLessThan(2); // last fix was the north point → SE bearing
  });
});

describe('HeadingResolver', () => {
  it('prefers compass, falls back to track, else null', () => {
    const compass = new CompassWatcher();
    compass.setMock(90);
    const track = new GpsTrackHeading();
    track.update({ lat: 39.9042, lng: 116.4074, accuracy: 5 });
    track.update({ lat: 39.9142, lng: 116.4074, accuracy: 5 });
    const resolver = new HeadingResolver(compass, track);

    expect(resolver.heading()).toBe(90); // compass first
    compass.setMock(null);
    expect(resolver.heading()).not.toBeNull();
    expect(resolver.heading()! < 2 || resolver.heading()! > 358).toBe(true); // track fallback ~0

    const empty = new HeadingResolver(new CompassWatcher(), new GpsTrackHeading());
    expect(empty.heading()).toBeNull();
  });
});
