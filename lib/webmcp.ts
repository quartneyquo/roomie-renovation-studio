import type { Placement, RoomSource } from "./room";
type RoomState = {
  placement: Placement;
  source: RoomSource;
  revision: number;
  placed: boolean;
  prompt: string;
};
type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};
export function registerRoomTools(
  read: () => RoomState,
  update: (p: Partial<Placement>) => void,
) {
  const context = (
    document as Document & {
      modelContext?: {
        registerTool: (tool: Tool, options: { signal: AbortSignal }) => void;
      };
    }
  ).modelContext;
  if (!context) return () => {};
  const lifecycle = new AbortController();
  try {
    context.registerTool(
      {
        name: "read_room_placement",
        description:
          "Read the current editable visual placement and its revision. No camera images are returned.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input) => {
          if (!input || typeof input !== "object" || Object.keys(input).length)
            throw new Error("Expected an empty object.");
          return read();
        },
      },
      { signal: lifecycle.signal },
    );
    context.registerTool(
      {
        name: "configure_room_placement",
        description:
          "Move, scale or rotate an already placed item. Changes the visible room preview; does not save or send anything.",
        inputSchema: {
          type: "object",
          properties: {
            x: { type: "number", minimum: 8, maximum: 92 },
            y: { type: "number", minimum: 15, maximum: 88 },
            scale: { type: "number", minimum: 0.5, maximum: 1.8 },
            rotation: { type: "number", minimum: -180, maximum: 180 },
          },
          additionalProperties: false,
          minProperties: 1,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input) => {
          if (!read().placed) throw new Error("Place an item first.");
          if (
            !input ||
            typeof input !== "object" ||
            Array.isArray(input) ||
            !Object.keys(input).length
          )
            throw new Error("Expected a placement change.");
          const bounds = {
            x: [8, 92],
            y: [15, 88],
            scale: [0.5, 1.8],
            rotation: [-180, 180],
          };
          for (const [key, value] of Object.entries(input)) {
            const range = bounds[key as keyof Placement];
            if (
              !range ||
              typeof value !== "number" ||
              !Number.isFinite(value) ||
              value < range[0] ||
              value > range[1]
            )
              throw new Error("Invalid placement.");
          }
          update(input as Partial<Placement>);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          return read();
        },
      },
      { signal: lifecycle.signal },
    );
  } catch {
    lifecycle.abort();
  }
  return () => lifecycle.abort();
}
