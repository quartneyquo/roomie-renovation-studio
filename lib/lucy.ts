import { createFalClient } from "@fal-ai/client";
export type LucySession = {
  close: () => void;
  update: (prompt: string, reference?: string) => void;
};
/** fal provides scoped signaling; camera media is exchanged over WebRTC. */
export async function connectLucy(
  stream: MediaStream,
  tokenProvider: () => Promise<string>,
  prompt: string,
  onStream: (stream: MediaStream) => void,
  onError: (error: string) => void,
): Promise<LucySession> {
  const fal = createFalClient({});
  const peer = new RTCPeerConnection();
  let closed = false;
  const pending: RTCIceCandidateInit[] = [];
  const fail = (error: unknown) => {
    if (!closed)
      onError(
        error instanceof Error ? error.message : "Live preview disconnected.",
      );
  };
  const connection = fal.realtime.connect<
    Record<string, unknown>,
    {
      type?: string;
      sdp?: string;
      candidate?: RTCIceCandidateInit;
      iceServers?: RTCIceServer[];
      error?: unknown;
    }
  >("decart/lucy-2-5/realtime", {
    connectionKey: crypto.randomUUID(),
    tokenProvider,
    tokenExpirationSeconds: 120,
    throttleInterval: 0,
    maxBuffering: 60,
    onError: fail,
    onResult: (result) => {
      void (async () => {
        if (closed) return;
        if (result.error)
          throw new Error("Lucy could not create this preview.");
        if (result.iceServers)
          peer.setConfiguration({ iceServers: result.iceServers });
        if (result.type === "answer" && result.sdp) {
          await peer.setRemoteDescription({ type: "answer", sdp: result.sdp });
          for (const candidate of pending.splice(0))
            await peer.addIceCandidate(candidate);
        }
        if (result.type === "offer" && result.sdp) {
          await peer.setRemoteDescription({ type: "offer", sdp: result.sdp });
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          connection.send({ type: "answer", sdp: answer.sdp });
        }
        if (result.candidate) {
          if (peer.remoteDescription)
            await peer.addIceCandidate(result.candidate);
          else pending.push(result.candidate);
        }
      })().catch(fail);
    },
  });
  peer.ontrack = (event) => {
    if (event.streams[0]) onStream(event.streams[0]);
    else onStream(new MediaStream([event.track]));
  };
  peer.onicecandidate = (event) => {
    if (event.candidate)
      connection.send({
        type: "candidate",
        candidate: event.candidate.toJSON(),
      });
  };
  peer.onconnectionstatechange = () => {
    if (["failed", "disconnected"].includes(peer.connectionState))
      fail(
        new Error(
          "Live connection interrupted. Your original camera is still available.",
        ),
      );
  };
  for (const track of stream.getVideoTracks()) peer.addTrack(track, stream);
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  connection.send({
    type: "offer",
    sdp: offer.sdp,
    prompt,
    enable_prompt_expansion: false,
  });
  const timer = setTimeout(() => {
    if (peer.connectionState !== "connected")
      fail(
        new Error(
          "Lucy connection timed out. Live signaling needs verification with your fal credentials.",
        ),
      );
  }, 25000);
  return {
    update: (next, reference) =>
      connection.send({
        type: "update",
        prompt: next,
        ...(reference ? { reference_image_url: reference } : {}),
        enable_prompt_expansion: false,
      }),
    close: () => {
      closed = true;
      clearTimeout(timer);
      connection.close();
      peer.close();
    },
  };
}
