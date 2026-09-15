import { describe, expect, it } from "vitest";

import {
  formatRegion,
  isRegionVisible,
  MIN_REGION_SIZE,
  parseRegion,
  pointInBox,
  regionFromDrag,
  regionStyle,
} from "../region";

const BOX = { left: 100, top: 50, width: 400, height: 200 };

describe("pointInBox", () => {
  it("converts a client point to fractions of the media box", () => {
    expect(pointInBox(300, 150, BOX)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointInBox(100, 50, BOX)).toEqual({ x: 0, y: 0 });
  });

  it("clamps a drag that leaves the frame to the frame", () => {
    expect(pointInBox(-500, 900, BOX)).toEqual({ x: 0, y: 1 });
  });

  it("survives a box with no area (a player that has not laid out yet)", () => {
    expect(pointInBox(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("regionFromDrag", () => {
  it("is direction-agnostic — the same two corners give the same box", () => {
    const downRight = regionFromDrag({ x: 0.2, y: 0.3 }, { x: 0.5, y: 0.7 });
    const upLeft = regionFromDrag({ x: 0.5, y: 0.7 }, { x: 0.2, y: 0.3 });
    expect(downRight).toEqual({ x: 0.2, y: 0.3, w: 0.3, h: 0.4 });
    expect(upLeft).toEqual(downRight);
  });

  it("treats a tap (or a two-pixel wobble) as no region at all", () => {
    expect(regionFromDrag({ x: 0.4, y: 0.4 }, { x: 0.4, y: 0.4 })).toBeNull();
    const tiny = MIN_REGION_SIZE / 2;
    expect(regionFromDrag({ x: 0.4, y: 0.4 }, { x: 0.4 + tiny, y: 0.4 + tiny })).toBeNull();
  });
});

describe("parseRegion", () => {
  it("accepts a well-formed box", () => {
    expect(parseRegion({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
    });
  });

  it("rejects anything that is not a box inside the frame", () => {
    expect(parseRegion(null)).toBeNull();
    expect(parseRegion([0.1, 0.2, 0.3, 0.4])).toBeNull();
    expect(parseRegion({ x: 0.1, y: 0.2, w: 0.3 })).toBeNull();
    expect(parseRegion({ x: -0.1, y: 0.2, w: 0.3, h: 0.4 })).toBeNull();
    expect(parseRegion({ x: 0.1, y: 0.2, w: 0, h: 0.4 })).toBeNull();
    expect(parseRegion({ x: 0.8, y: 0.2, w: 0.5, h: 0.4 })).toBeNull();
    expect(parseRegion({ x: "0.1", y: 0.2, w: 0.3, h: 0.4 })).toBeNull();
    expect(parseRegion({ x: Number.NaN, y: 0.2, w: 0.3, h: 0.4 })).toBeNull();
  });

  it("tolerates float drift from a drag to the very edge", () => {
    expect(parseRegion({ x: 0.9, y: 0, w: 0.10005, h: 1 })).toEqual({
      x: 0.9,
      y: 0,
      w: 0.1,
      h: 1,
    });
  });
});

describe("regionStyle", () => {
  it("renders percentages, so a mark lands in the same place at any player size", () => {
    expect(regionStyle({ x: 0.125, y: 0.25, w: 0.5, h: 0.1 })).toEqual({
      left: "12.5%",
      top: "25%",
      width: "50%",
      height: "10%",
    });
  });
});

describe("isRegionVisible", () => {
  const base = { commentId: "c1", timecodeMs: 12_400, selectedId: null, currentMs: 0 };

  it("shows a mark while the playhead is within half a second of its note", () => {
    expect(isRegionVisible({ ...base, currentMs: 12_400 })).toBe(true);
    expect(isRegionVisible({ ...base, currentMs: 12_900 })).toBe(true);
    expect(isRegionVisible({ ...base, currentMs: 11_900 })).toBe(true);
    expect(isRegionVisible({ ...base, currentMs: 13_000 })).toBe(false);
  });

  it("shows a selected note's mark wherever the playhead is", () => {
    expect(isRegionVisible({ ...base, currentMs: 90_000, selectedId: "c1" })).toBe(true);
  });

  it("shows a general note's mark only while it is selected", () => {
    const general = { ...base, timecodeMs: null };
    expect(isRegionVisible(general)).toBe(false);
    expect(isRegionVisible({ ...general, selectedId: "c1" })).toBe(true);
  });
});

describe("formatRegion", () => {
  it("renders the digest's four fractions to three decimals", () => {
    expect(formatRegion({ x: 0.12, y: 0.3405, w: 0.25, h: 0.1 })).toBe("0.120,0.341,0.250,0.100");
  });
});
