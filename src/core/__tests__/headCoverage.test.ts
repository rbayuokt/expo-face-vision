import { HeadCoverageTracker } from '../headCoverage';

describe('HeadCoverageTracker', () => {
  it('ignores a head near center', () => {
    const t = new HeadCoverageTracker();
    expect(t.update({ yaw: 5, pitch: 3 })).toMatchObject({ current: -1, count: 0 });
  });

  it('maps directions clockwise from the top on a mirrored preview', () => {
    const t = new HeadCoverageTracker({ segments: 4, spread: 0 });
    expect(t.segmentFor({ yaw: 0, pitch: 20 })).toBe(0); // up
    expect(t.segmentFor({ yaw: 30, pitch: 0 })).toBe(1); // subject's right = screen right
    expect(t.segmentFor({ yaw: 0, pitch: -20 })).toBe(2); // down
    expect(t.segmentFor({ yaw: -30, pitch: 0 })).toBe(3); // left
  });

  it('flips left/right for an un-mirrored preview', () => {
    const t = new HeadCoverageTracker({ segments: 4, mirrored: false });
    expect(t.segmentFor({ yaw: 30, pitch: 0 })).toBe(3);
  });

  it('scales pitch so a diagonal lands between the axes', () => {
    const t = new HeadCoverageTracker({ segments: 8, minYaw: 15, minPitch: 10 });
    expect(t.segmentFor({ yaw: 15, pitch: 10 })).toBe(1); // up-right
  });

  it('marks neighbours and completes after a full sweep', () => {
    const t = new HeadCoverageTracker({ segments: 60, spread: 2 });
    expect(t.update({ yaw: 0, pitch: 20 }).count).toBe(5);
    let last = t.update({ yaw: 0, pitch: 20 });
    for (let deg = 0; deg < 360; deg += 4) {
      const r = (deg * Math.PI) / 180;
      last = t.update({ yaw: Math.sin(r) * 25, pitch: Math.cos(r) * 18 });
    }
    expect(last.complete).toBe(true);
    expect(last.progress).toBe(1);
    expect(t.reset().count).toBe(0);
  });
});
