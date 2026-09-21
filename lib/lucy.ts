import type { DecartSDKError, RealTimeClient } from "@decartai/sdk";

export type LucySession = {
  close: () => void;
  update: (prompt: string, reference?: string) => void;
};

/** Connect a camera directly to Decart Lucy using a short-lived client token. */
export async function connectLucy(
  stream: MediaStream,
  tokenProvider: () => Promise<string>,
  prompt: string,
  reference: string | undefined,
  onStream: (stream: MediaStream) => void,
  onError: (error: string) => void,
): Promise<LucySession> {
  const { createDecartClient, models } = await import("@decartai/sdk");
  const apiKey = await tokenProvider();
  const client = createDecartClient({
    apiKey,
    integration: "roomie-studio",
  });
  let closed = false;
  let session: RealTimeClient | null = null;

  const fail = (error: unknown) => {
    if (closed) return;
    onError(
      error instanceof Error
        ? error.message
        : "Lucy live editing disconnected.",
    );
  };

  session = await client.realtime.connect(stream, {
    model: models.realtime("lucy-2.5"),
    preferredVideoCodec: "vp8",
    onRemoteStream: onStream,
    initialState: {
      prompt: { text: prompt, enhance: false },
      ...(reference ? { image: reference } : {}),
    },
  });

  const handleError = (error: DecartSDKError) => fail(error);
  const handleEnded = ({ reason }: { reason: string }) =>
    fail(new Error(reason || "Lucy ended the live editing session."));
  session.on("error", handleError);
  session.on("sessionEnded", handleEnded);

  return {
    update: (next, nextReference) => {
      if (!session || closed) return;
      void session
        .set({
          prompt: next,
          image: nextReference ?? null,
          enhance: false,
        })
        .catch(fail);
    },
    close: () => {
      if (closed) return;
      closed = true;
      session?.off("error", handleError);
      session?.off("sessionEnded", handleEnded);
      session?.disconnect();
      session = null;
    },
  };
}
