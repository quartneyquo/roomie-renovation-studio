import { z } from "zod";
import {
  evaluatePlacement,
  type Evaluation,
  type Placement,
  type RoomSource,
} from "./room";

export const placementSchema = z.object({
  x: z.number().finite().min(0).max(100),
  y: z.number().finite().min(0).max(100),
  scale: z.number().finite().min(0.1).max(3),
  rotation: z.number().finite().min(-180).max(180),
});
const entities = z.array(z.record(z.unknown())).max(100);
export const snapshotSchema = z.object({
  model: z.string().min(1).max(150),
  geometry: z.object({
    walls: entities,
    doors: entities,
    windows: entities,
    bboxes: entities,
  }),
});
export type SpatialSnapshot = z.infer<typeof snapshotSchema> & {
  provenance: "modal" | "imported";
  capturedAt: number;
  cameraAligned: false;
  metricScaleVerified: false;
};

type SpatialWall = Record<string, unknown>;

/** Merge overlapping SpatialLM segments that represent one physical wall. */
export function normalizeWalls(walls: SpatialWall[]): SpatialWall[] {
  const passthrough: SpatialWall[] = [];
  const groups = new Map<
    string,
    {
      dx: number;
      dy: number;
      offset: number;
      segments: Array<{ start: number; end: number; template: SpatialWall }>;
    }
  >();

  for (const wall of walls) {
    const { ax, ay, bx, by } = wall;
    if (![ax, ay, bx, by].every((value) => Number.isFinite(value))) {
      passthrough.push(wall);
      continue;
    }
    const startX = ax as number;
    const startY = ay as number;
    const endX = bx as number;
    const endY = by as number;
    const length = Math.hypot(endX - startX, endY - startY);
    if (length < 0.08) continue;

    let dx = (endX - startX) / length;
    let dy = (endY - startY) / length;
    if (dx < 0 || (Math.abs(dx) < 1e-9 && dy < 0)) {
      dx = -dx;
      dy = -dy;
    }
    const angle = Math.atan2(dy, dx);
    const offset = -dy * ((startX + endX) / 2) + dx * ((startY + endY) / 2);
    const key = `${Math.round(angle / (Math.PI / 36))}:${Math.round(offset / 0.12)}`;
    const projectedStart = dx * startX + dy * startY;
    const projectedEnd = dx * endX + dy * endY;
    const group = groups.get(key) ?? { dx, dy, offset, segments: [] };
    group.segments.push({
      start: Math.min(projectedStart, projectedEnd),
      end: Math.max(projectedStart, projectedEnd),
      template: wall,
    });
    groups.set(key, group);
  }

  const merged = [...passthrough];
  for (const group of groups.values()) {
    const sorted = group.segments.sort((a, b) => a.start - b.start);
    const runs: typeof sorted = [];
    for (const segment of sorted) {
      const current = runs.at(-1);
      if (!current || segment.start > current.end + 0.18) {
        runs.push({ ...segment });
      } else {
        current.end = Math.max(current.end, segment.end);
      }
    }
    for (const run of runs) {
      const ax = group.dx * run.start - group.dy * group.offset;
      const ay = group.dy * run.start + group.dx * group.offset;
      const bx = group.dx * run.end - group.dy * group.offset;
      const by = group.dy * run.end + group.dx * group.offset;
      merged.push({ ...run.template, ax, ay, bx, by });
    }
  }
  return merged;
}
export function parseSnapshot(
  text: string,
  provenance: SpatialSnapshot["provenance"],
  capturedAt: number,
): SpatialSnapshot {
  if (text.length > 120000)
    throw new Error(
      "Room snapshot must be under 120 KB. Simplify the geometry first.",
    );
  const parsed = snapshotSchema.parse(JSON.parse(text));
  const geometry = {
    ...parsed.geometry,
    walls: normalizeWalls(parsed.geometry.walls),
  };
  if (!Object.values(geometry).some((items) => items.length))
    throw new Error("The snapshot contains no detected room structure.");
  // A PLY or layout JSON contains no registration to this browser's camera.
  // Do not inherit alignment claims from uploaded files or provider metadata.
  return {
    ...parsed,
    geometry,
    provenance,
    capturedAt,
    cameraAligned: false,
    metricScaleVerified: false,
  };
}
export type SceneState = {
  schemaVersion: 1;
  sceneKey: string;
  revision: number;
  source: RoomSource;
  room: SpatialSnapshot | null;
  activeItemId?: string;
  layout?: Array<{
    id: string;
    prompt: string;
    placement: Placement;
  }>;
  lucyObject: {
    description: string;
    placement: Placement;
    coordinateSystem: "screen-percent";
    dimensions: null;
    observedInOutput: false;
  };
};
export function roomSummary(snapshot: SpatialSnapshot): string {
  const g = snapshot.geometry;
  const count = (value: number, singular: string, plural = `${singular}s`) =>
    `${value} ${value === 1 ? singular : plural}`;
  return `${count(normalizeWalls(g.walls).length, "wall")}, ${count(g.doors.length, "door")}, ${count(g.windows.length, "window")} and ${count(g.bboxes.length, "furniture box", "furniture boxes")}`;
}
export function evaluateScene(scene: SceneState): Evaluation {
  const baseline = evaluatePlacement(
    scene.lucyObject.placement,
    scene.source,
    scene.revision,
  );
  if (!scene.room) return baseline;
  return {
    ...baseline,
    verdict: baseline.adjustment ? "adjust" : "uncertain",
    fit: baseline.adjustment ? "red" : "amber",
    confidence: 0,
    visualEstimate: true,
    title: baseline.adjustment
      ? baseline.title
      : "Your room scan is part of the picture.",
    explanation: `${roomSummary(scene.room)} detected in the attached scan. ${baseline.adjustment ? baseline.explanation + " " : ""}Align the scan to this view and confirm scale before checking physical fit. Lucy’s generated position is not yet visually verified.`,
    checks: [
      ...baseline.checks.slice(0, 2),
      { label: "Room structure attached", status: "pass" },
      { label: "Scan-to-camera alignment", status: "unknown" },
      { label: "Measured clearance", status: "unknown" },
      { label: "Lucy output verified", status: "unknown" },
    ],
    provider: "Room scan + intended placement · visual estimate",
  };
}
export function lucyPrompt(description: string, placement: Placement): string {
  return `Add ${description}. Place its center at ${Math.round(placement.x)} percent from the left and ${Math.round(placement.y)} percent from the top of the image. Relative visual scale ${placement.scale.toFixed(2)}; requested image-plane rotation ${Math.round(placement.rotation)} degrees. Keep the rest of the room unchanged. These are visual placement instructions, not verified physical coordinates.`;
}
