import { describe, it, expect } from "vitest";
import { evaluatePlacement, initialPlacement } from "../lib/room";
describe("visual placement checks", () => {
  it("never reuses example-room geometry for a real camera or uploaded room", () => {
    for (const source of ["camera", "upload"] as const) {
      const result = evaluatePlacement(
        { ...initialPlacement, x: 70, y: 55 },
        source,
        12,
      );
      expect(result.verdict).toBe("uncertain");
      expect(result.checks[2].status).toBe("unknown");
      expect(result.adjustment).toBeNull();
      expect(result.revision).toBe(12);
    }
  });
  it("offers a bounded adjustment for example-sofa overlap", () => {
    const result = evaluatePlacement(
      { ...initialPlacement, x: 75, y: 50 },
      "demo",
      8,
    );
    expect(result.verdict).toBe("adjust");
    expect(result.adjustment).not.toBeNull();
    const next = evaluatePlacement(result.adjustment!, "demo", 9);
    expect(next.verdict).toBe("good");
    expect(next.checks.at(-1)?.status).toBe("unknown");
  });
});
