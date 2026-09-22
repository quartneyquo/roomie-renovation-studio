export type Placement = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
};
export type RoomSource = "demo" | "camera" | "upload";
export type FurnitureItem = {
  id: string;
  prompt: string;
  reference?: string;
  placement: Placement;
};
export type Evaluation = {
  verdict: "good" | "adjust" | "uncertain";
  title: string;
  explanation: string;
  revision: number;
  checks: { label: string; status: "pass" | "warn" | "unknown" }[];
  adjustment: Placement | null;
  provider: string;
  fit?: "green" | "amber" | "red";
  confidence?: number;
  visualEstimate?: boolean;
};
export const initialPlacement: Placement = {
  x: 40,
  y: 67,
  scale: 1,
  rotation: 0,
};
export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
export function evaluatePlacement(
  p: Placement,
  source: RoomSource,
  revision: number,
): Evaluation {
  const edge = p.x < 17 || p.x > 83 || p.y < 30 || p.y > 83;
  const overlap = source === "demo" && p.x > 57 && p.y < 66;
  const crowded = p.scale > 1.45;
  const adjust = edge || overlap || crowded;
  return {
    verdict: adjust ? "adjust" : source === "demo" ? "good" : "uncertain",
    revision,
    title: adjust
      ? "A little breathing room?"
      : source === "demo"
        ? "This is a lovely starting point."
        : "Looking good. Let’s check the room.",
    explanation: edge
      ? "Part of your item is close to the image edge. Bring it further into view."
      : overlap
        ? "The item overlaps the sofa in this example room. Try the open area to the left."
        : crowded
          ? "Your item dominates the view. A smaller scale may leave the room feeling more open."
          : source === "demo"
            ? "Your item sits in the open part of our example room. Check real-world dimensions before making it yours."
            : "Your placement is in view. A room scan is needed to check obstacles and walking space.",
    checks: [
      { label: "Inside the view", status: edge ? "warn" : "pass" },
      { label: "Visual balance", status: crowded ? "warn" : "pass" },
      {
        label:
          source === "demo" ? "Example sofa overlap" : "Furniture clearance",
        status: source !== "demo" ? "unknown" : overlap ? "warn" : "pass",
      },
      { label: "Real-world walking space", status: "unknown" },
    ],
    adjustment: adjust
      ? { x: 38, y: 68, scale: Math.min(p.scale, 1), rotation: 0 }
      : null,
    provider: "Visual preview · no room measurements",
  };
}
export type SavedRoom = {
  sceneState?: string;
  id: string;
  name: string;
  createdAt: number;
  placement: Placement;
  prompt: string;
  reference?: string;
  roomImage: string;
  screenshot: string;
  source: RoomSource;
  revision: number;
  evaluation: Evaluation;
  items?: FurnitureItem[];
};
