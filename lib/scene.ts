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
  if (!Object.values(parsed.geometry).some((items) => items.length))
    throw new Error("The snapshot contains no detected room structure.");
  // A PLY or layout JSON contains no registration to this browser's camera.
  // Do not inherit alignment claims from uploaded files or provider metadata.
  return {
    ...parsed,
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
  return `${g.walls.length} walls, ${g.doors.length} doors, ${g.windows.length} windows and ${g.bboxes.length} furniture boxes`;
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
