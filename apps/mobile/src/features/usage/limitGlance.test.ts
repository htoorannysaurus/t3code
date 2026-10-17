import { describe, expect, it } from "vite-plus/test";

import { glanceTone, updatedLabel } from "./limitGlance";

describe("glanceTone", () => {
  it("grades by projected spend, not the raw percentage", () => {
    expect(glanceTone(69, 90)).toBe("ok");
    expect(glanceTone(69, 40)).toBe("hot");
    expect(glanceTone(39, 40)).toBe("warn");
  });

  it("falls back to flat thresholds early in a window or without a clock", () => {
    expect(glanceTone(30, 4)).toBe("ok");
    expect(glanceTone(80, null)).toBe("warn");
    expect(glanceTone(91, null)).toBe("hot");
  });

  it("treats a nearly spent window as hot whatever the clock says", () => {
    expect(glanceTone(96, 99)).toBe("hot");
  });
});

describe("updatedLabel", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  it("reports the oldest reading", () => {
    expect(updatedLabel(["2026-10-17T11:56:00Z", "2026-10-17T11:59:30Z"], now)).toBe(
      "Updated 4m ago",
    );
    expect(updatedLabel(["2026-10-17T11:59:30Z"], now)).toBe("Updated just now");
    expect(updatedLabel([], now)).toBeNull();
  });
});
