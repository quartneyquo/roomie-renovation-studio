import type { DecartSDKError, Logger, RealTimeClient } from "@decartai/sdk";

export type LucySession = {
  close: () => void;
  update: (prompt: string, reference?: string) => void;
};

function explainLucyError(message: string) {
  const clean = message.trim();
  const lower = clean.toLowerCase();
  if (/concurrent|already.+session|session.+limit/.test(lower))
    return "Lucy is already running in another Roomie tab. Close that live session, then retry.";
  if (/credit|balance|quota|insufficient/.test(lower))
    return "The Decart account does not have enough Lucy realtime credit.";
  if (
    /unauthorized|invalid.+(?:token|api key)|forbidden|permission denied/.test(
      lower,
    )
  )
    return "Decart rejected the Lucy session credentials.";
  if (/capacity|overloaded|unavailable/.test(lower))
    return "Lucy is at capacity right now. Retry in a moment.";
  return clean.slice(0, 220) || "Lucy live editing disconnected.";
}

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
  let closed = false;
  let session: RealTimeClient | null = null;
  let providerError = "";

  const fail = (error: unknown) => {
    if (closed) return;
    const message = explainLucyError(
      error instanceof Error
        ? error.message
        : "Lucy live editing disconnected.",
    );
    if (message === providerError) return;
    providerError = message;
    onError(message);
  };

  // The SDK logs signaling errors before realtime.connect() rejects. Capture the
  // provider's useful reason instead of leaving the UI on an opaque spinner.
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message, data) => {
      const detail = typeof data?.error === "string" ? data.error : "";
      if (detail) fail(new Error(detail));
      else if (/exhausted all retries/i.test(message)) fail(new Error(message));
    },
  };

  const apiKey = await tokenProvider();
  const client = createDecartClient({
    apiKey,
    integration: "roomie-studio",
    logger,
  });

  try {
    session = await client.realtime.connect(stream, {
      model: models.realtime("lucy-2.5"),
      preferredVideoCodec: "vp8",
      onRemoteStream: onStream,
      initialState: {
        prompt: { text: prompt, enhance: false },
        ...(reference ? { image: reference } : {}),
      },
    });
  } catch (error) {
    throw new Error(
      providerError ||
        explainLucyError(
          error instanceof Error ? error.message : "Lucy could not connect.",
        ),
    );
  }

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
