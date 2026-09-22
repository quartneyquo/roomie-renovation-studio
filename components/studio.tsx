"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  Bookmark,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  FolderHeart,
  ImagePlus,
  Layers2,
  Mail,
  Maximize2,
  Mic,
  Move,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Share2,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Toaster, toast } from "sonner";
import {
  clamp,
  initialPlacement,
  type Placement,
  type RoomSource,
  type SavedRoom,
  type Evaluation,
  type FurnitureItem,
} from "@/lib/room";

import Link from "next/link";
import { DeleteRoom } from "@/components/delete-room";
import { registerRoomTools } from "@/lib/webmcp";
import { useCloud, uploadImage } from "@/components/cloud";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { connectLucy, type LucySession } from "@/lib/lucy";
import {
  evaluateScene,
  lucyLayoutPrompt,
  parseSnapshot,
  roomSummary,
  type SceneState,
  type SpatialSnapshot,
} from "@/lib/scene";
type Connections = {
  jev: boolean;
  h3: boolean;
  lucy: boolean;
  research: boolean;
  spatial: boolean;
  email: boolean;
  speech: boolean;
};
type ResearchSource = {
  url: string;
  title: string;
  excerpt: string;
  retrievedAt: number;
};
type Contact = { email: string; name: string; url: string };
type ScanStage =
  | "guide"
  | "permission"
  | "preview"
  | "recording"
  | "uploading"
  | "reconstructing"
  | "analyzing"
  | "ready"
  | "failed";
const scanMinimumSeconds = 30;
const scanMaximumSeconds = 30;

function wavBlob(chunks: Float32Array[], sampleRate: number) {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, sampleCount * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (const value of chunk) {
      const sample = Math.max(-1, Math.min(1, value));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export default function Studio() {
  const cloud = useCloud();
  const [connections, setConnections] = useState<Connections>({
    jev: false,
    h3: false,
    lucy: false,
    research: false,
    spatial: false,
    email: false,
    speech: false,
  });
  const [liveEvaluation, setLiveEvaluation] = useState<Evaluation | null>(null),
    [sources, setSources] = useState<ResearchSource[]>([]),
    [contacts, setContacts] = useState<Contact[]>([]),
    [jobMessage, setJobMessage] = useState("");
  const [jevRunState, setJevRunState] = useState<
    "idle" | "checking" | "ready" | "fallback"
  >("idle");
  const [clipUrl, setClipUrl] = useState<string | null>(null),
    [clipPoster, setClipPoster] = useState<string | null>(null),
    [clipLoading, setClipLoading] = useState(false),
    [clipError, setClipError] = useState<string | null>(null),
    [lucyActive, setLucyActive] = useState(false),
    [lucyState, setLucyState] = useState<
      "idle" | "connecting" | "active" | "placeholder" | "failed"
    >("idle"),
    [preferLucyPlaceholders, setPreferLucyPlaceholders] = useState(false),
    [lucySettling, setLucySettling] = useState(false),
    [lucyError, setLucyError] = useState(""),
    [lockedLucyFrame, setLockedLucyFrame] = useState<{
      revision: number;
      dataUrl: string;
    } | null>(null),
    [emailSnapshot, setEmailSnapshot] = useState<{
      screenshot: string;
      roomImage: string;
      revision: number;
      label: string;
    } | null>(null),
    [emailRequestId, setEmailRequestId] = useState("");
  const activeJobs = useRef(new Map<string, () => void>()),
    latestRevision = useRef(0),
    lucy = useRef<LucySession | null>(null),
    lucyAttempt = useRef(0),
    lucyConnecting = useRef(false),
    lucySettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    lucyLastInstruction = useRef(""),
    lucyLastReference = useRef(""),
    editedVideo = useRef<HTMLVideoElement>(null),
    h3Video = useRef<HTMLVideoElement>(null),
    mounted = useRef(true);
  const jobEpoch = useRef<Record<string, number>>({});
  const scanFile = useRef<HTMLInputElement>(null);
  const scanEpoch = useRef(0);
  const scanPreview = useRef<HTMLVideoElement>(null);
  const scanStream = useRef<MediaStream | null>(null);
  const scanRecorder = useRef<MediaRecorder | null>(null);
  const scanChunks = useRef<Blob[]>([]);
  const scanTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanStartedAt = useRef(0);
  const voiceCapture = useRef<{
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    stream: MediaStream;
    chunks: Float32Array[];
  } | null>(null);
  const voiceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [voiceState, setVoiceState] = useState<
    "idle" | "listening" | "transcribing" | "failed"
  >("idle");
  const [voiceError, setVoiceError] = useState("");
  const [scanStage, setScanStage] = useState<ScanStage>("guide");
  const [scanSeconds, setScanSeconds] = useState(0);
  const [scanError, setScanError] = useState("");
  const [roomScanId, setRoomScanId] = useState<Id<"roomScans"> | null>(null);
  const snapshotFile = useRef<HTMLInputElement>(null);
  const sceneKey = useRef("");
  const [roomSnapshot, setRoomSnapshot] = useState<SpatialSnapshot | null>(
    null,
  );
  const [snapshotSelection, setSnapshotSelection] = useState<{
    snapshotJobId?: Id<"providerJobs">;
    snapshotImport?: string;
    savedConfigurationId?: Id<"savedConfigurations">;
  }>({});
  const [sceneStatus, setSceneStatus] = useState("Waiting for your room");

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [tab, setTab] = useState("studio"),
    [dialog, setDialog] = useState<string | null>(null);
  const [source, setSource] = useState<RoomSource>("demo"),
    [roomImage, setRoomImage] = useState("/room-demo.png"),
    [cameraState, setCameraState] = useState("Opening camera…");
  const [prompt, setPrompt] = useState(""),
    [reference, setReference] = useState(""),
    [placed, setPlaced] = useState(false),
    [placement, setPlacement] = useState<Placement>(initialPlacement),
    [revision, setRevision] = useState(0),
    [before, setBefore] = useState(false);
  const [items, setItems] = useState<FurnitureItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const hasItems = items.length > 0;
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const lucyPlaceholder = source === "camera" && lucyState === "placeholder";
  const lockedLucyFrameUrl =
    lockedLucyFrame?.revision === revision ? lockedLucyFrame.dataUrl : "";
  const lucyVisualReady = lucyActive || lucyPlaceholder || !!lockedLucyFrameUrl;
  const [busy, setBusy] = useState(false),
    [localSaved, setSaved] = useState<SavedRoom[]>([]),
    [saveName, setSaveName] = useState("A warmer living room"),
    [ack, setAck] = useState(false),
    [suggestion, setSuggestion] = useState(false);
  const [recipient, setRecipient] = useState(""),
    [emailBody, setEmailBody] = useState(""),
    [approved, setApproved] = useState(false),
    [location, setLocation] = useState("");
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    stage = useRef<HTMLDivElement>(null),
    roomFile = useRef<HTMLInputElement>(null),
    refFile = useRef<HTMLInputElement>(null),
    drag = useRef<{
      id: string;
      x: number;
      y: number;
      p: Placement;
    } | null>(null);
  const saved = cloud.rooms ?? localSaved;
  latestRevision.current = revision;
  const evaluation =
    liveEvaluation?.revision === revision
      ? liveEvaluation
      : evaluateScene({
          schemaVersion: 1,
          sceneKey: sceneKey.current,
          revision,
          source,
          room: roomSnapshot,
          lucyObject: {
            description: prompt,
            placement,
            coordinateSystem: "screen-percent",
            dimensions: null,
            observedInOutput: false,
          },
        });
  function currentSceneKey() {
    if (!sceneKey.current) sceneKey.current = crypto.randomUUID();
    return sceneKey.current;
  }
  function beginLucySettling(duration = 3_500) {
    if (lucySettleTimer.current) clearTimeout(lucySettleTimer.current);
    setLockedLucyFrame(null);
    setLucySettling(true);
    lucySettleTimer.current = setTimeout(() => {
      lucySettleTimer.current = null;
      if (mounted.current) setLucySettling(false);
    }, duration);
  }
  function resetScene() {
    scanEpoch.current++;
    sceneKey.current = crypto.randomUUID();
    activeJobs.current.get("spatial")?.();
    activeJobs.current.get("jev")?.();
    setRoomSnapshot(null);
    setSnapshotSelection({});
    setLiveEvaluation(null);
    setLockedLucyFrame(null);
    setJevRunState("idle");
    setSceneStatus("New room view · attach a scan");
  }
  async function syncScene() {
    if (!cloud.client || !cloud.ready)
      throw new Error("Cloud session is still connecting.");
    return cloud.client.mutation(api.scenes.sync, {
      sceneKey: currentSceneKey(),
      revision,
      source,
      prompt,
      placement,
      ...(selectedItemId ? { activeItemId: selectedItemId } : {}),
      items: items.map((item) => ({
        id: item.id,
        prompt: item.prompt,
        placement: item.placement,
      })),
      ...snapshotSelection,
    });
  }
  useEffect(() => {
    if (cloud.ready && cloud.client)
      void cloud.client
        .action(api.providers.status, {})
        .then(setConnections)
        .catch(() =>
          toast.error(
            "Connections unavailable. You can keep exploring locally.",
          ),
        );
  }, [cloud.ready, cloud.client]);
  useEffect(() => {
    if (!placed) {
      const stateTimer = setTimeout(() => setJevRunState("idle"), 0);
      return () => clearTimeout(stateTimer);
    }
    if (source === "camera" && !lucyVisualReady) {
      const stateTimer = setTimeout(() => {
        setJevRunState("checking");
        setSceneStatus("Waiting for Lucy’s generated view…");
      }, 0);
      return () => clearTimeout(stateTimer);
    }
    if (source === "camera" && lucyActive && lucySettling) {
      const stateTimer = setTimeout(() => {
        setJevRunState("checking");
        setSceneStatus("Hold steady while Lucy refines the preview…");
      }, 0);
      return () => clearTimeout(stateTimer);
    }
    if (!connections.jev) {
      const stateTimer = setTimeout(() => setJevRunState("fallback"), 0);
      return () => clearTimeout(stateTimer);
    }
    if (!cloud.ready) return;
    const stateTimer = setTimeout(() => setJevRunState("checking"), 0);
    const current = revision;
    const view = currentSceneKey();
    let valid = true;
    const timer = setTimeout(() => {
      setSceneStatus("Updating room understanding…");
      void syncScene()
        .then(async (state) => {
          if (
            !valid ||
            latestRevision.current !== current ||
            sceneKey.current !== view ||
            !state
          )
            return null;
          const scene = JSON.parse(state) as SceneState;
          setRoomSnapshot(scene.room);
          setSceneStatus(
            connections.jev && placed
              ? "Jev is reviewing this scene…"
              : "Scene saved · Jev not running",
          );
          if (!placed || !connections.jev) return null;
          if (source !== "camera" || !video.current?.videoWidth)
            return runJob("jev", { sceneKey: view }, current);
          const originalFrame = await capture(false);
          const lucyFrames: string[] = [];
          if (lucyActive && editedVideo.current?.videoWidth) {
            lucyFrames.push(await captureLucyOutputFrame());
            await new Promise((resolve) => window.setTimeout(resolve, 450));
            if (
              !valid ||
              latestRevision.current !== current ||
              sceneKey.current !== view
            )
              return null;
            lucyFrames.push(await captureLucyOutputFrame());
            setLockedLucyFrame({
              revision: current,
              dataUrl: lucyFrames.at(-1)!,
            });
          }
          const [liveFrameId, ...lucyFrameIds] = await Promise.all([
            uploadImage(cloud.client!, originalFrame),
            ...lucyFrames.map((frame) => uploadImage(cloud.client!, frame)),
          ]);
          return runJob(
            "jev",
            {
              sceneKey: view,
              liveFrameId,
              ...(lucyFrameIds.length ? { lucyFrameIds } : {}),
              lucyOutputObserved: lucyFrameIds.length > 0,
            },
            current,
          );
        })
        .then((r) => {
          if (
            valid &&
            sceneKey.current === view &&
            latestRevision.current === current &&
            r?.evaluation
          ) {
            setLiveEvaluation(r.evaluation as Evaluation);
            setJevRunState("ready");
            setSceneStatus(`Jev reviewed scene revision ${current}`);
          }
        })
        .catch((e) => {
          if (valid && latestRevision.current === current) {
            setJevRunState("fallback");
            setSceneStatus("Review unavailable · showing local guidance");
            toast.error(e.message);
          }
        });
    }, 650);
    return () => {
      valid = false;
      clearTimeout(stateTimer);
      clearTimeout(timer);
      activeJobs.current.get("jev")?.();
    };
  }, [
    revision,
    placed,
    source,
    lucyActive,
    lucySettling,
    lucyVisualReady,
    cloud.ready,
    connections.jev,
  ]);
  useEffect(() => {
    if (!placed || !cloud.ready || !connections.research) return;
    let valid = true;
    void runJob("research", { prompt, location: "" }, revision)
      .then((r) => {
        if (valid) setSources((r.sources || []) as ResearchSource[]);
      })
      .catch(() => {});
    return () => {
      valid = false;
      activeJobs.current.get("research")?.();
    };
  }, [placed, prompt, cloud.ready, connections.research]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      lucyAttempt.current++;
      lucyConnecting.current = false;
      lucy.current?.close();
      if (lucySettleTimer.current) clearTimeout(lucySettleTimer.current);
      stopScanCamera();
      if (voiceTimer.current) clearTimeout(voiceTimer.current);
      const capture = voiceCapture.current;
      capture?.source.disconnect();
      capture?.processor.disconnect();
      capture?.stream.getTracks().forEach((track) => track.stop());
      void capture?.context.close();
      voiceCapture.current = null;
      for (const cancel of activeJobs.current.values()) cancel();
    };
  }, []);
  async function runJob(
    kind: "jev" | "h3" | "research" | "contacts" | "spatial",
    input: unknown,
    current = revision,
  ): Promise<Record<string, unknown>> {
    if (!cloud.ready || !cloud.client)
      throw new Error("Cloud session is still connecting. Please try again.");
    activeJobs.current.get(kind)?.();
    const epoch = (jobEpoch.current[kind] || 0) + 1;
    jobEpoch.current[kind] = epoch;
    activeJobs.current.set(kind, () => {
      jobEpoch.current[kind] = epoch + 1;
    });
    const client = cloud.client;
    const id = await client.mutation(api.jobs.start, {
      kind,
      input: JSON.stringify(input),
      revision: current,
      requestId: crypto.randomUUID(),
    });
    if (
      jobEpoch.current[kind] !== epoch ||
      (["jev", "h3"].includes(kind) && latestRevision.current !== current)
    ) {
      await client.mutation(api.jobs.cancel, { id });
      throw new Error("Request cancelled.");
    }
    return new Promise((resolve, reject) => {
      let done = false;
      let unsubscribe = () => {};
      const finish = () => {
        done = true;
        clearTimeout(timer);
        unsubscribe();
        if (activeJobs.current.get(kind) === cancel)
          activeJobs.current.delete(kind);
      };
      const cancel = () => {
        if (done) return;
        finish();
        void client.mutation(api.jobs.cancel, { id }).catch(() => {});
        reject(new Error("Request cancelled."));
      };
      const timer = setTimeout(
        () => {
          cancel();
        },
        kind === "spatial" ? 660000 : 260000,
      );
      activeJobs.current.set(kind, cancel);
      const watcher = client.watchQuery(api.jobs.get, { id });
      unsubscribe = watcher.onUpdate(() => {
        try {
          const job = watcher.localQueryResult();
          if (done) return;
          if (job?.status === "succeeded") {
            finish();
            resolve({ ...JSON.parse(job.result || "{}"), jobId: id });
          } else if (job?.status === "failed" || job?.status === "cancelled") {
            finish();
            reject(new Error(job.error || "Request cancelled."));
          }
        } catch (error) {
          finish();
          reject(error);
        }
      });
    });
  }
  async function showSuggestion() {
    const current = revision;
    setSuggestion(true);
    setClipUrl(null);
    setClipPoster(null);
    setClipError(null);
    if (!connections.h3 || !cloud.client) {
      setClipLoading(false);
      setClipError("H3 Max Turbo is not connected.");
      return;
    }
    if (source === "camera" && !lockedLucyFrameUrl) {
      setClipLoading(false);
      setClipError("Hold steady while Roomie locks this Lucy layout.");
      return;
    }
    setClipLoading(true);
    setJobMessage("Creating your suggestion clip…");
    try {
      const targetFrame =
        source === "camera" ? lockedLucyFrameUrl : await capture(true);
      setClipPoster(targetFrame);
      const imageId = await uploadImage(cloud.client, targetFrame);
      const endImageId = imageId;
      const layoutDescription = items
        .map(
          (item) =>
            `${item.prompt} at ${Math.round(item.placement.x)}% from the left and ${Math.round(item.placement.y)}% from the top`,
        )
        .join("; ");
      const result = await runJob(
        "h3",
        {
          imageId,
          endImageId,
          prompt: `Keep the camera fixed and preserve the supplied frame exactly as the complete furniture layout. The full layout is: ${layoutDescription}. Add only subtle natural motion without changing any furniture's identity, appearance, size, position, count, or color. The first and last frame must match. Do not remove, replace, duplicate, or invent furniture.`,
        },
        current,
      );
      if (latestRevision.current !== current) return;
      if (typeof result.url !== "string")
        throw new Error("H3 Max Turbo completed without returning a clip.");
      setClipUrl(result.url);
    } catch (e) {
      if (latestRevision.current === current) {
        const message = (e as Error).message;
        setClipError(message);
        toast.error(message);
      }
    } finally {
      if (latestRevision.current === current) {
        setClipLoading(false);
        setJobMessage("");
      }
    }
  }
  async function findExperts() {
    if (!location.trim()) {
      toast.error("Enter a city or ZIP code.");
      return;
    }
    if (!connections.research) {
      toast.info(
        "Connect Firecrawl to find current, source-backed contacts. You can enter your own recipient.",
      );
      return;
    }
    setJobMessage("Finding local experts…");
    try {
      const result = await runJob("contacts", { prompt, location });
      setContacts((result.contacts || []) as Contact[]);
      if (!(result.contacts as Contact[])?.length)
        toast.info(
          "No public email addresses found. Try another city or enter your own contact.",
        );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setJobMessage("");
    }
  }
  async function uploadScan(file: File | undefined) {
    if (!file) return;
    if (file.size > 3_000_000 || !file.name.toLowerCase().endsWith(".ply")) {
      toast.error("Choose a PLY point cloud under 3 MB.");
      return;
    }
    if (!cloud.client || !connections.spatial) {
      toast.info("Connect the Modal spatial service to process a room scan.");
      return;
    }
    setJobMessage("Understanding your room scan…");
    const view = currentSceneKey();
    const scan = ++scanEpoch.current;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let raw = "";
      for (const byte of bytes) raw += String.fromCharCode(byte);
      const pointCloudId = await cloud.client.action(api.files.upload, {
        data: `data:application/octet-stream;base64,${btoa(raw)}`,
      });
      if (sceneKey.current !== view || scanEpoch.current !== scan) return;
      const result = await runJob("spatial", {
        pointCloudId,
        sceneKey: view,
        categories: ["chair", "sofa", "table", "window", "door"],
      });
      if (sceneKey.current !== view || scanEpoch.current !== scan) return;
      if (result.geometry) {
        setRoomSnapshot(
          parseSnapshot(JSON.stringify(result), "modal", Date.now()),
        );
        setSnapshotSelection({
          snapshotJobId: result.jobId as Id<"providerJobs">,
        });
        setRevision((n) => n + 1);
      }
      toast.success(
        result.geometry
          ? "Room understanding attached. Jev will review it with your current idea."
          : String(result.message || "Scan processed; alignment required."),
      );
    } catch (e) {
      if (sceneKey.current === view && scanEpoch.current === scan)
        toast.error((e as Error).message);
    } finally {
      if (scanEpoch.current === scan) setJobMessage("");
    }
  }
  async function importSnapshot(file: File | undefined) {
    if (!file) return;
    const view = currentSceneKey();
    const scan = ++scanEpoch.current;
    activeJobs.current.get("spatial")?.();
    setJobMessage("");
    try {
      if (file.size > 120000)
        throw new Error("Choose a SpatialLM JSON snapshot under 120 KB.");
      const text = await file.text();
      const parsed = parseSnapshot(text, "imported", Date.now());
      if (sceneKey.current !== view || scanEpoch.current !== scan) return;
      setRoomSnapshot(parsed);
      setSnapshotSelection({ snapshotImport: JSON.stringify(parsed) });
      setLiveEvaluation(null);
      setRevision((n) => n + 1);
      toast.success("Room snapshot attached to this view.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Invalid room snapshot.",
      );
    }
  }
  function stopScanCamera(discardRecording = true) {
    if (scanTimer.current) clearInterval(scanTimer.current);
    scanTimer.current = null;
    if (scanRecorder.current?.state === "recording") {
      if (discardRecording) scanRecorder.current.onstop = null;
      scanRecorder.current.stop();
    }
    scanRecorder.current = null;
    scanStream.current?.getTracks().forEach((track) => track.stop());
    scanStream.current = null;
    if (scanPreview.current) scanPreview.current.srcObject = null;
  }
  function openRoomScan(replace = false) {
    stopScanCamera();
    setScanError("");
    setScanSeconds(0);
    setScanStage("guide");
    if (replace) setJobMessage("");
    setDialog("scan");
  }
  async function requestScanCamera() {
    if (!connections.spatial) {
      setScanError("Modal room reconstruction is not connected.");
      setScanStage("failed");
      return;
    }
    setScanStage("permission");
    setScanError("");
    try {
      const captureStream = stream.current?.active
        ? new MediaStream(
            stream.current.getVideoTracks().map((track) => track.clone()),
          )
        : await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 720 },
              height: { ideal: 1280 },
            },
            audio: false,
          });
      scanStream.current = captureStream;
      setScanStage("preview");
      requestAnimationFrame(() => {
        if (scanPreview.current) {
          scanPreview.current.srcObject = captureStream;
          void scanPreview.current.play().catch(() => {});
        }
      });
    } catch {
      setScanError(
        "Camera access was blocked. Allow camera access in Chrome, then try again.",
      );
      setScanStage("failed");
    }
  }
  function startRoomRecording() {
    const captureStream = scanStream.current;
    if (!captureStream || typeof MediaRecorder === "undefined") {
      setScanError("This browser cannot record a room walkthrough.");
      setScanStage("failed");
      return;
    }
    const mimeType = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/mp4",
      "video/webm",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    try {
      const recorder = new MediaRecorder(captureStream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 1_200_000,
      });
      scanChunks.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) scanChunks.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(scanChunks.current, {
          type: recorder.mimeType || "video/webm",
        });
        stopScanCamera(false);
        void uploadRoomRecording(blob);
      };
      scanRecorder.current = recorder;
      scanStartedAt.current = Date.now();
      setScanSeconds(0);
      setScanStage("recording");
      recorder.start(1000);
      scanTimer.current = setInterval(() => {
        const seconds = Math.floor((Date.now() - scanStartedAt.current) / 1000);
        setScanSeconds(seconds);
        if (
          seconds >= scanMaximumSeconds &&
          scanRecorder.current?.state === "recording"
        )
          scanRecorder.current.stop();
      }, 250);
    } catch {
      setScanError("Chrome could not start the recording. Please try again.");
      setScanStage("failed");
    }
  }
  async function runRoomScanJob(
    scanId: Id<"roomScans">,
    videoId: Id<"_storage">,
  ) {
    if (!cloud.client) throw new Error("Cloud session is still connecting.");
    activeJobs.current.get("scan")?.();
    const client = cloud.client;
    const current = revision;
    const view = currentSceneKey();
    const requestId = crypto.randomUUID();
    const jobId = await client.mutation(api.jobs.start, {
      kind: "spatial",
      input: JSON.stringify({
        videoId,
        scanId,
        sceneKey: view,
        categories: ["chair", "sofa", "table", "window", "door"],
      }),
      revision: current,
      requestId,
    });
    await client.mutation(api.scans.attachJob, { id: scanId, jobId });
    setScanStage("reconstructing");
    return new Promise<void>((resolve, reject) => {
      let done = false;
      let unsubscribe = () => {};
      const finish = () => {
        done = true;
        clearTimeout(timeout);
        unsubscribe();
        if (activeJobs.current.get("scan") === cancel)
          activeJobs.current.delete("scan");
      };
      const cancel = () => {
        if (done) return;
        finish();
        void client.mutation(api.jobs.cancel, { id: jobId }).catch(() => {});
        reject(new Error("Room scan cancelled."));
      };
      const timeout = setTimeout(cancel, 1_260_000);
      activeJobs.current.set("scan", cancel);
      const watcher = client.watchQuery(api.jobs.get, { id: jobId });
      unsubscribe = watcher.onUpdate(() => {
        try {
          const job = watcher.localQueryResult();
          if (done || !job) return;
          if (job.phase === "analyzing") setScanStage("analyzing");
          else if (job.phase === "reconstructing")
            setScanStage("reconstructing");
          if (job.status === "succeeded") {
            const result = JSON.parse(job.result || "{}");
            if (!result.geometry)
              throw new Error("SpatialLM returned no room geometry.");
            const snapshot = parseSnapshot(
              JSON.stringify(result),
              "modal",
              Date.now(),
            );
            setRoomSnapshot(snapshot);
            setSnapshotSelection({ snapshotJobId: jobId });
            setLiveEvaluation(null);
            setRevision((value) => value + 1);
            setScanStage("ready");
            const elapsed = snapshot.performance?.totalSeconds;
            setSceneStatus(
              elapsed
                ? `Room scan ready in ${Math.round(elapsed)} seconds · Jev is reviewing visual fit`
                : "Room scan ready · Jev is reviewing visual fit",
            );
            finish();
            resolve();
          } else if (job.status === "failed" || job.status === "cancelled") {
            throw new Error(job.error || "Room reconstruction failed.");
          }
        } catch (error) {
          finish();
          reject(error);
        }
      });
    });
  }
  async function uploadRoomRecording(blob: Blob) {
    if (!cloud.client || !cloud.ready) {
      setScanError("Cloud session is still connecting. Please try again.");
      setScanStage("failed");
      return;
    }
    if (blob.size < 100_000 || blob.size > 60_000_000) {
      setScanError("The room recording must be between 100 KB and 60 MB.");
      setScanStage("failed");
      return;
    }
    setScanStage("uploading");
    setScanError("");
    const view = currentSceneKey();
    try {
      const uploadUrl = await cloud.client.mutation(
        api.scans.createUploadUrl,
        {},
      );
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": blob.type || "video/webm" },
        body: blob,
      });
      if (!response.ok) throw new Error("Room video upload failed.");
      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };
      const id = await cloud.client.mutation(api.scans.registerVideo, {
        storageId,
        sceneKey: view,
        requestId: crypto.randomUUID(),
      });
      setRoomScanId(id);
      setRoomSnapshot(null);
      setSnapshotSelection({});
      setLiveEvaluation(null);
      await runRoomScanJob(id, storageId);
      toast.success("Room reconstruction is ready for Jev.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Room reconstruction failed.";
      if (message === "Room scan cancelled.") return;
      setScanError(message);
      setScanStage("failed");
      toast.error(message);
    }
  }
  async function retryRoomScan() {
    if (!roomScanId || !cloud.client) return;
    setScanError("");
    setScanStage("reconstructing");
    try {
      const videoId = await cloud.client.mutation(api.scans.retrySource, {
        id: roomScanId,
      });
      await runRoomScanJob(roomScanId, videoId);
      toast.success("Room reconstruction is ready for Jev.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Room reconstruction failed.";
      if (message === "Room scan cancelled.") return;
      setScanError(message);
      setScanStage("failed");
    }
  }
  async function deleteRoomScan() {
    if (roomScanId && cloud.client)
      await cloud.client.mutation(api.scans.remove, { id: roomScanId });
    activeJobs.current.get("scan")?.();
    setRoomScanId(null);
    setRoomSnapshot(null);
    setSnapshotSelection({});
    setLiveEvaluation(null);
    setScanStage("guide");
    setRevision((value) => value + 1);
    setDialog(null);
    toast.success("Room scan and its snapshot were deleted.");
  }
  async function startLive(
    requestedItems: FurnitureItem[] = items,
    requestedActiveItemId: string | null = selectedItemId,
    forceProvider = false,
  ) {
    const layout = requestedItems.length
      ? requestedItems
      : prompt.trim()
        ? [
            {
              id: requestedActiveItemId || "active-item",
              prompt: prompt.trim(),
              placement,
              ...(reference ? { reference } : {}),
            },
          ]
        : [];
    const activeItem =
      layout.find((item) => item.id === requestedActiveItemId) ?? layout.at(-1);
    const instruction = lucyLayoutPrompt(layout, activeItem?.id ?? undefined);
    const activeReference = activeItem?.reference || "";
    if (lucyActive) {
      if (
        lucyLastInstruction.current === instruction &&
        lucyLastReference.current === activeReference
      )
        return;
      lucyLastInstruction.current = instruction;
      lucyLastReference.current = activeReference;
      beginLucySettling();
      lucy.current?.update(
        instruction,
        activeReference.startsWith("data:") ? activeReference : undefined,
      );
      return;
    }
    const activatePlaceholder = (reason = "") => {
      lucy.current?.close();
      lucy.current = null;
      setLucyActive(false);
      setLucySettling(false);
      setLucyState("placeholder");
      setPreferLucyPlaceholders(true);
      setLucyError(reason);
      setJobMessage("");
      lucyLastInstruction.current = "";
      lucyLastReference.current = "";
    };
    if ((preferLucyPlaceholders || !connections.lucy) && !forceProvider) {
      activatePlaceholder(
        connections.lucy
          ? "Lucy placeholder fallback remains active until you retry."
          : "Lucy is not connected, so Roomie is showing fallback placeholders.",
      );
      return;
    }
    if (lucyConnecting.current) return;
    if (!stream.current) {
      toast.error("Your camera is still starting. Try again in a moment.");
      return;
    }
    if (!cloud.client) {
      toast.error(
        "The cloud session is still connecting. Try again in a moment.",
      );
      return;
    }
    const attempt = ++lucyAttempt.current;
    lucyConnecting.current = true;
    setJobMessage("Connecting live room editing…");
    setLucyActive(false);
    setLucyState("connecting");
    setLucyError("");
    if (editedVideo.current) editedVideo.current.srcObject = null;
    let providerMessage = "";
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingSession: Promise<LucySession> | undefined;
    let receivedLucyStream = false;
    try {
      lucy.current?.close();
      lucy.current = null;
      lucyLastInstruction.current = instruction;
      lucyLastReference.current = activeReference;
      pendingSession = connectLucy(
        stream.current,
        async () => {
          const token = await cloud.client!.action(api.providers.lucyToken, {});
          if (!token) throw new Error("Lucy is not connected.");
          return token;
        },
        instruction,
        activeReference.startsWith("data:") ? activeReference : undefined,
        (s) => {
          if (lucyAttempt.current !== attempt || !mounted.current) return;
          receivedLucyStream = true;
          if (connectTimer) {
            clearTimeout(connectTimer);
            connectTimer = undefined;
          }
          if (editedVideo.current) {
            editedVideo.current.srcObject = s;
            void editedVideo.current.play();
          }
          setLucyActive(true);
          beginLucySettling(4_000);
          setLucyState("active");
          setPreferLucyPlaceholders(false);
          setLucyError("");
          setJobMessage("");
        },
        (error) => {
          if (
            lucyAttempt.current !== attempt ||
            !mounted.current ||
            /stale connect attempt/i.test(error)
          )
            return;
          if (receivedLucyStream) return;
          providerMessage = error;
          setLucyError(error);
          setJobMessage(`Lucy is retrying: ${error}`);
        },
      );
      const session = await Promise.race([
        pendingSession,
        new Promise<never>((_, reject) => {
          connectTimer = setTimeout(() => {
            if (receivedLucyStream) return;
            reject(
              new Error(
                providerMessage ||
                  "Lucy could not open a realtime session within 30 seconds.",
              ),
            );
          }, 30_000);
        }),
      ]);
      if (lucyAttempt.current !== attempt || !stream.current?.active) {
        session.close();
        return;
      }
      lucy.current = session;
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Lucy could not connect.";
      if (receivedLucyStream) return;
      if (
        lucyAttempt.current !== attempt ||
        !mounted.current ||
        /stale connect attempt/i.test(message)
      )
        return;
      pendingSession?.then((session) => session.close()).catch(() => {});
      if (lucyAttempt.current === attempt) lucyAttempt.current++;
      lucyConnecting.current = false;
      activatePlaceholder(message);
      toast.info(
        "Lucy is unavailable, so Roomie switched to demo placeholders.",
      );
    } finally {
      if (connectTimer) clearTimeout(connectTimer);
      if (lucyAttempt.current === attempt) lucyConnecting.current = false;
    }
  }

  function clearGeneratedSuggestion() {
    setSuggestion(false);
    setClipLoading(false);
    setClipError(null);
    setJobMessage("");
    setClipUrl(null);
    activeJobs.current.get("h3")?.();
  }
  const update = (change: Partial<Placement>, itemId = selectedItemId) => {
    setPlacement((p) => ({ ...p, ...change }));
    if (itemId)
      setItems((current) =>
        current.map((item) =>
          item.id === itemId
            ? { ...item, placement: { ...item.placement, ...change } }
            : item,
        ),
      );
    setRevision((n) => n + 1);
    clearGeneratedSuggestion();
  };
  function selectItem(item: FurnitureItem) {
    if (item.id === selectedItemId && !addingItem) return;
    setSelectedItemId(item.id);
    setPrompt(item.prompt);
    setReference(item.reference ?? "");
    setPlacement(item.placement);
    setPlaced(true);
    setAddingItem(false);
    setLiveEvaluation(null);
    setRevision((n) => n + 1);
    clearGeneratedSuggestion();
  }
  function beginAddItem() {
    if (items.length >= 8) {
      toast.info("This room already has the maximum of eight pieces.");
      return;
    }
    setAddingItem(true);
    setSelectedItemId(null);
    setPlaced(false);
    setPrompt("");
    setReference("");
    setPlacement(initialPlacement);
    setLiveEvaluation(null);
    clearGeneratedSuggestion();
  }
  function removeSelectedItem() {
    if (!selectedItemId) return;
    const remaining = items.filter((item) => item.id !== selectedItemId);
    setItems(remaining);
    const next = remaining.at(-1) ?? null;
    setSelectedItemId(next?.id ?? null);
    setPlaced(!!next);
    setAddingItem(false);
    setPrompt(next?.prompt ?? "");
    setReference(next?.reference ?? "");
    setPlacement(next?.placement ?? initialPlacement);
    setLiveEvaluation(null);
    setRevision((n) => n + 1);
    clearGeneratedSuggestion();
  }
  const toolState = useRef({ placement, source, revision, placed, prompt });
  toolState.current = { placement, source, revision, placed, prompt };
  const toolUpdate = useRef(update);
  toolUpdate.current = update;
  useEffect(
    () =>
      registerRoomTools(
        () => toolState.current,
        (p) => toolUpdate.current(p),
      ),
    [],
  );
  useEffect(() => {
    if (tab === "studio" && stream.current && video.current) {
      video.current.srcObject = stream.current;
      void video.current.play().catch(() => {});
    }
  }, [tab]);
  function stopCamera() {
    lucyAttempt.current++;
    lucyConnecting.current = false;
    lucy.current?.close();
    lucy.current = null;
    setLucyActive(false);
    setLucySettling(false);
    if (lucySettleTimer.current) {
      clearTimeout(lucySettleTimer.current);
      lucySettleTimer.current = null;
    }
    setLucyState("idle");
    setPreferLucyPlaceholders(false);
    setLucyError("");
    setLockedLucyFrame(null);
    lucyLastInstruction.current = "";
    lucyLastReference.current = "";
    if (editedVideo.current) editedVideo.current.srcObject = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCameraState("Camera off");
  }
  async function startCamera(selectedDevice?: string) {
    setCameraState("Opening camera…");
    try {
      stopCamera();
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(selectedDevice
            ? { deviceId: { exact: selectedDevice } }
            : { facingMode: { ideal: "environment" } }),
        },
        audio: false,
      });
      stream.current = s;
      if (!mounted.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play();
      }
      setSource("camera");
      resetScene();
      setCameraState("Camera live");
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((d) => d.kind === "videoinput"));
      setDeviceId(s.getVideoTracks()[0]?.getSettings().deviceId || "");
      setRevision((n) => n + 1);
    } catch {
      setCameraState("Camera unavailable · try a photo");
    }
  }
  useEffect(() => {
    try {
      if (!cloud.configured)
        // Hydrate the external browser store only after SSR has completed.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSaved(JSON.parse(localStorage.getItem("roomie-saved") || "[]"));
    } catch {
      toast.error("Saved rooms couldn’t be loaded.");
    }
    if (document.visibilityState === "visible") void startCamera();
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, []);
  function demo() {
    stopCamera();
    resetScene();
    setRoomImage("/room-demo.png");
    setSource("demo");
    setRevision((n) => n + 1);
  }
  async function upload(file: File | undefined, kind: "room" | "reference") {
    if (!file) return;
    if (
      !file.type.match(/^image\/(png|jpeg|webp)$/) ||
      file.size > 10 * 1024 * 1024
    ) {
      toast.error("Choose a JPG, PNG or WebP under 10 MB.");
      return;
    }
    let url: string;
    try {
      const bitmap = await createImageBitmap(file);
      const factor = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * factor);
      canvas.height = Math.round(bitmap.height * factor);
      canvas
        .getContext("2d")!
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      url = canvas.toDataURL(
        kind === "room" ? "image/jpeg" : "image/webp",
        0.86,
      );
    } catch {
      toast.error(
        "This image could not be read. Try another JPG, PNG, or WebP.",
      );
      return;
    }
    setSuggestion(false);
    setLiveEvaluation(null);
    activeJobs.current.get("h3")?.();
    if (kind === "room") {
      stopCamera();
      resetScene();
      setRoomImage(url);
      setSource("upload");
      setItems([]);
      setSelectedItemId(null);
      setRevision((n) => n + 1);
    } else {
      setReference(url);
      if (selectedItemId && !addingItem) {
        setItems((current) =>
          current.map((item) =>
            item.id === selectedItemId ? { ...item, reference: url } : item,
          ),
        );
        setPlaced(true);
      } else {
        setPlaced(false);
      }
      setRevision((n) => n + 1);
      toast.success(
        selectedItemId && !addingItem
          ? "Reference updated for this piece."
          : "Reference ready. Add it to your room.",
      );
    }
  }

  async function recordFurnitureRequest() {
    if (voiceState === "listening") {
      await finishVoiceRecording();
      return;
    }
    if (voiceState === "transcribing") return;
    if (!cloud.ready || !cloud.client) {
      toast.error("Your private cloud session is still connecting.");
      return;
    }
    if (!connections.speech) {
      toast.error("GMI speech recognition is not connected.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      toast.error("Voice input is not available in this browser.");
      return;
    }
    setVoiceError("");
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      const context = new AudioContext();
      await context.resume();
      const sourceNode = context.createMediaStreamSource(audioStream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      sourceNode.connect(processor);
      processor.connect(context.destination);
      voiceCapture.current = {
        context,
        source: sourceNode,
        processor,
        stream: audioStream,
        chunks,
      };
      setVoiceState("listening");
      voiceTimer.current = setTimeout(() => {
        void finishVoiceRecording();
      }, 8_000);
    } catch {
      setVoiceState("failed");
      setVoiceError("Microphone access is needed to describe furniture.");
    }
  }

  async function finishVoiceRecording() {
    if (voiceTimer.current) clearTimeout(voiceTimer.current);
    voiceTimer.current = null;
    const capture = voiceCapture.current;
    if (!capture) return;
    voiceCapture.current = null;
    capture.processor.onaudioprocess = null;
    capture.source.disconnect();
    capture.processor.disconnect();
    capture.stream.getTracks().forEach((track) => track.stop());
    await capture.context.close();
    let energy = 0;
    let sampleCount = 0;
    for (const chunk of capture.chunks) {
      sampleCount += chunk.length;
      for (const value of chunk) energy += value * value;
    }
    if (!sampleCount || Math.sqrt(energy / sampleCount) < 0.003) {
      setVoiceState("failed");
      setVoiceError("I couldn’t hear anything. Tap and try again.");
      return;
    }
    const blob = wavBlob(capture.chunks, capture.context.sampleRate);
    setVoiceState("transcribing");
    try {
      const audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Audio could not be read."));
        reader.readAsDataURL(blob);
      });
      const result = await cloud.client!.action(api.providers.transcribe, {
        audio,
        mimeType: "audio/wav",
      });
      setVoiceState("idle");
      setPrompt(result.text);
      await place(result.text);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Voice recognition failed. Try again.";
      setVoiceState("failed");
      setVoiceError(message);
      toast.error(message);
    }
  }

  async function place(requestedPrompt = prompt) {
    const description = requestedPrompt.trim();
    if (!description) {
      toast.error("Describe the item you’d like to try.");
      return;
    }
    const isNew = addingItem || !selectedItemId;
    if (isNew && items.length >= 8) {
      toast.error("A room can include up to eight furniture pieces.");
      return;
    }
    setBusy(true);
    const nextPlacement = isNew ? initialPlacement : placement;
    setPlacement(nextPlacement);
    const item: FurnitureItem = {
      id: isNew ? crypto.randomUUID() : selectedItemId!,
      prompt: description,
      ...(reference ? { reference } : {}),
      placement: nextPlacement,
    };
    const exists = items.some((existing) => existing.id === item.id);
    const nextItems = exists
      ? items.map((existing) => (existing.id === item.id ? item : existing))
      : [...items, item];
    setItems(nextItems);
    setSelectedItemId(item.id);
    setPrompt(description);
    setAddingItem(false);
    setLiveEvaluation(null);
    setRevision((n) => n + 1);
    setPlaced(true);
    setBefore(false);
    setBusy(false);
    if (source === "camera") void startLive(nextItems, item.id);
    toast.success(
      source === "camera"
        ? preferLucyPlaceholders || !connections.lucy
          ? "Lucy fallback placeholders are ready in your live camera."
          : "Connecting your camera directly to Decart Lucy."
        : reference
          ? "Your exact reference is ready to position."
          : `“${description}” is ready for Lucy to generate.`,
    );
  }
  async function captureLucyOutputFrame() {
    const media = editedVideo.current;
    if (!media?.videoWidth || !media.videoHeight)
      throw new Error("Lucy’s generated frame is not ready yet.");
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 800;
    const ratio = Math.max(
      canvas.width / media.videoWidth,
      canvas.height / media.videoHeight,
    );
    canvas
      .getContext("2d")!
      .drawImage(
        media,
        (canvas.width - media.videoWidth * ratio) / 2,
        (canvas.height - media.videoHeight * ratio) / 2,
        media.videoWidth * ratio,
        media.videoHeight * ratio,
      );
    return canvas.toDataURL("image/jpeg", 0.9);
  }
  async function capture(
    includeItem = true,
    transform = placement,
    preferLucyOutput = true,
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 800;
    const ctx = canvas.getContext("2d")!;
    const load = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.crossOrigin = "anonymous";
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("An image could not be loaded."));
        i.src = src;
      });
    const lockedLucyImage =
      includeItem && preferLucyOutput && lockedLucyFrameUrl
        ? await load(lockedLucyFrameUrl)
        : null;
    const useLiveLucyOutput =
      includeItem &&
      preferLucyOutput &&
      !lockedLucyImage &&
      lucyActive &&
      !!editedVideo.current?.videoWidth;
    const useLucyOutput = !!lockedLucyImage || useLiveLucyOutput;
    const bg = lockedLucyImage
      ? lockedLucyImage
      : useLiveLucyOutput
        ? editedVideo.current!
        : source === "camera" && video.current?.videoWidth
          ? video.current
          : await load(roomImage);
    const w = bg instanceof HTMLVideoElement ? bg.videoWidth : bg.width,
      h = bg instanceof HTMLVideoElement ? bg.videoHeight : bg.height;
    const ratio = Math.max(1200 / w, 800 / h);
    ctx.drawImage(
      bg,
      (1200 - w * ratio) / 2,
      (800 - h * ratio) / 2,
      w * ratio,
      h * ratio,
    );
    if (includeItem && !useLucyOutput) {
      for (const furniture of items) {
        const furniturePlacement =
          furniture.id === selectedItemId ? transform : furniture.placement;
        const iw = 330 * furniturePlacement.scale;
        ctx.save();
        ctx.translate(furniturePlacement.x * 12, furniturePlacement.y * 8);
        ctx.rotate((furniturePlacement.rotation * Math.PI) / 180);
        if (furniture.reference) {
          const item = await load(furniture.reference);
          const ih = (iw * item.height) / item.width;
          ctx.drawImage(item, -iw / 2, -ih / 2, iw, ih);
        } else if (lucyPlaceholder) {
          const ih = 112 * furniturePlacement.scale;
          ctx.fillStyle = "rgba(255, 250, 242, 0.92)";
          ctx.strokeStyle = "#8b3650";
          ctx.lineWidth = 4;
          ctx.setLineDash([12, 8]);
          ctx.fillRect(-iw / 2, -ih / 2, iw, ih);
          ctx.strokeRect(-iw / 2, -ih / 2, iw, ih);
          ctx.setLineDash([]);
          ctx.fillStyle = "#78263b";
          ctx.font = `600 ${Math.max(18, 22 * furniturePlacement.scale)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const label = furniture.prompt.slice(0, 42);
          ctx.fillText(label, 0, 0, iw - 28);
        }
        ctx.restore();
      }
    }
    ctx.fillStyle = "rgba(255,250,247,.9)";
    ctx.fillRect(0, 758, 1200, 42);
    ctx.fillStyle = "#78263b";
    ctx.font = "16px sans-serif";
    ctx.fillText("roomie  /  visual planning preview · not measured", 24, 785);
    return canvas.toDataURL("image/jpeg", 0.85);
  }
  async function captureVideoFrame(media: HTMLVideoElement) {
    if (!media.videoWidth || !media.videoHeight)
      throw new Error("The generated clip is not ready yet.");
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 800;
    const ctx = canvas.getContext("2d")!;
    const ratio = Math.max(1200 / media.videoWidth, 800 / media.videoHeight);
    ctx.drawImage(
      media,
      (1200 - media.videoWidth * ratio) / 2,
      (800 - media.videoHeight * ratio) / 2,
      media.videoWidth * ratio,
      media.videoHeight * ratio,
    );
    ctx.fillStyle = "rgba(255,250,247,.9)";
    ctx.fillRect(0, 758, 1200, 42);
    ctx.fillStyle = "#78263b";
    ctx.font = "16px sans-serif";
    ctx.fillText("roomie  /  H3 suggestion frame · visual estimate", 24, 785);
    return canvas.toDataURL("image/jpeg", 0.85);
  }
  async function captureH3Frame() {
    if (!clipUrl) throw new Error("No H3 clip is available.");
    if (h3Video.current?.videoWidth) return captureVideoFrame(h3Video.current);
    const media = document.createElement("video");
    media.crossOrigin = "anonymous";
    media.muted = true;
    media.playsInline = true;
    media.preload = "auto";
    media.src = clipUrl;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("The H3 clip took too long to load.")),
        8000,
      );
      media.onloadedmetadata = () => {
        const target = Number.isFinite(media.duration)
          ? Math.min(Math.max(media.duration * 0.72, 0), 3.8)
          : 0;
        if (target > 0) media.currentTime = target;
        else {
          window.clearTimeout(timeout);
          resolve();
        }
      };
      media.onseeked = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      media.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("The H3 clip could not be loaded."));
      };
    });
    const frame = await captureVideoFrame(media);
    media.removeAttribute("src");
    media.load();
    return frame;
  }
  async function persistRoom(screenshot: string, bg: string, name: string) {
    if (cloud.configured) {
      if (!cloud.ready || !cloud.client)
        throw new Error(
          "Your cloud session is still connecting. Please try again.",
        );
      const view = currentSceneKey();
      await syncScene();
      const [itemReferenceIds, roomImageId, screenshotId] = await Promise.all([
        Promise.all(
          items.map((item) =>
            item.reference
              ? uploadImage(cloud.client!, item.reference)
              : Promise.resolve(undefined),
          ),
        ),
        uploadImage(cloud.client, bg),
        uploadImage(cloud.client, screenshot),
      ]);
      const activeIndex = items.findIndex((item) => item.id === selectedItemId);
      const referenceId = itemReferenceIds[activeIndex >= 0 ? activeIndex : 0];
      if (latestRevision.current !== revision || sceneKey.current !== view)
        throw new Error("Room changed while saving. Please save again.");
      return cloud.client.mutation(api.rooms.save, {
        requestId: crypto.randomUUID(),
        name,
        prompt,
        placement,
        source: source === "camera" ? "upload" : source,
        revision,
        evaluation,
        ...(referenceId ? { referenceId } : {}),
        roomImageId,
        screenshotId,
        sceneKey: view,
        items: items.map((item, index) => ({
          id: item.id,
          prompt: item.prompt,
          placement: item.placement,
          ...(itemReferenceIds[index]
            ? { referenceId: itemReferenceIds[index] }
            : {}),
        })),
      });
    }
    const entry: SavedRoom = {
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
      placement,
      prompt,
      reference,
      roomImage: bg,
      screenshot,
      source: source === "camera" ? "upload" : source,
      revision,
      evaluation,
      items,
    };
    const next = [entry, ...saved];
    localStorage.setItem("roomie-saved", JSON.stringify(next));
    setSaved(next);
    return entry.id;
  }
  async function save() {
    if (!saveName.trim()) return;
    setBusy(true);
    try {
      await persistRoom(await capture(), await capture(false), saveName.trim());
      setDialog(null);
      toast.success(
        cloud.ready
          ? "Room saved privately to your studio."
          : "Room saved on this browser.",
      );
    } catch (e) {
      toast.error(
        (e as Error).message || "Couldn’t save. Download your view instead.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function removeSaved() {
    try {
      if (cloud.configured) {
        if (!cloud.ready || !cloud.client)
          throw new Error("Cloud connection unavailable.");
        await cloud.client.mutation(api.rooms.remove, {
          id: saveName as Id<"savedConfigurations">,
        });
      } else {
        const next = saved.filter((r) => r.id !== saveName);
        localStorage.setItem("roomie-saved", JSON.stringify(next));
        setSaved(next);
      }
      setDialog(null);
      toast.success("Saved room deleted.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function sendEmail() {
    if (!emailSnapshot) return;
    if (emailSnapshot.revision !== revision) {
      toast.error(
        "Your room changed. Close and reopen this handoff to review the updated screenshot.",
      );
      setApproved(false);
      return;
    }
    setBusy(true);
    try {
      if (!connections.email) {
        toast.info(
          "Handoff preview complete. No email was sent; AgentMail is not connected.",
        );
        return;
      }
      const configurationId = await persistRoom(
        emailSnapshot.screenshot,
        emailSnapshot.roomImage,
        "Expert handoff — living room",
      );
      const result = await cloud.client!.action(api.handoff.send, {
        requestId: emailRequestId,
        configurationId: configurationId as Id<"savedConfigurations">,
        recipient,
        subject: "A little help with my living room",
        text: emailBody,
        approved: true,
      });
      if (result.status === "sent") {
        toast.success("Your room brief was sent.");
        setDialog(null);
      } else if (result.status === "preview")
        toast.info("No email sent. Connect AgentMail first.");
      else {
        toast.error(
          "Delivery is unconfirmed. Check AgentMail before trying again to avoid duplicate mail.",
        );
        setApproved(false);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    try {
      const data = await capture(!before);
      const blob = await (await fetch(data)).blob();
      const file = new File([blob], "roomie-room.jpg", { type: "image/jpeg" });
      if (navigator.canShare?.({ files: [file] }))
        await navigator.share({ title: "My Roomie idea", files: [file] });
      else {
        await download();
        toast.info(
          "Image downloaded. You can attach it wherever you’d like to share.",
        );
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        toast.error("Could not share this view.");
    }
  }
  async function freezeCamera() {
    try {
      if (source === "camera" && video.current?.videoWidth)
        setRoomImage(await capture(false));
    } finally {
      stopCamera();
      setSource("upload");
      setRevision((n) => n + 1);
    }
  }
  useEffect(() => {
    const hide = () => {
      if (document.hidden && stream.current) void freezeCamera();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [source]);
  useEffect(() => {
    if (!lucyActive) return;
    const activeItem =
      items.find((item) => item.id === selectedItemId) ?? items.at(-1);
    const nextInstruction = lucyLayoutPrompt(items, activeItem?.id);
    const nextReference = activeItem?.reference?.startsWith("data:")
      ? activeItem.reference
      : "";
    if (
      lucyLastInstruction.current === nextInstruction &&
      lucyLastReference.current === nextReference
    )
      return;
    const timer = setTimeout(() => {
      lucyLastInstruction.current = nextInstruction;
      lucyLastReference.current = nextReference;
      beginLucySettling();
      return lucy.current?.update(nextInstruction, nextReference || undefined);
    }, 900);
    return () => clearTimeout(timer);
  }, [lucyActive, items, selectedItemId]);
  async function download() {
    try {
      const a = document.createElement("a");
      a.href = await capture(!before);
      a.download = "roomie-my-room.jpg";
      a.click();
      toast.success("Your room image is ready.");
    } catch {
      toast.error("Couldn’t capture this view. Please try again.");
    }
  }
  function reopen(room: SavedRoom) {
    stopCamera();
    resetScene();
    if (room.sceneState) {
      setRoomSnapshot((JSON.parse(room.sceneState) as SceneState).room);
      setSnapshotSelection({
        savedConfigurationId: room.id as Id<"savedConfigurations">,
      });
    }
    setSource(room.source);
    setRoomImage(room.roomImage);
    const restored = room.items?.length
      ? room.items.slice(0, 8).map((item) => ({
          ...item,
          placement: { ...item.placement },
        }))
      : [
          {
            id: crypto.randomUUID(),
            prompt: room.prompt,
            ...(room.reference ? { reference: room.reference } : {}),
            placement: { ...room.placement },
          },
        ];
    const active = restored[0];
    setItems(restored);
    setSelectedItemId(active.id);
    setPlacement(active.placement);
    setPrompt(active.prompt);
    setReference(active.reference ?? "");
    setPlaced(true);
    setAddingItem(false);
    setLiveEvaluation(null);
    setBefore(false);
    setRevision((n) => n + 1);
    setTab("studio");
    toast.success("Your room is ready to keep exploring.");
  }
  async function openEmail() {
    setEmailSnapshot(null);
    setEmailRequestId(crypto.randomUUID());
    try {
      let screenshot: string;
      let label: string;
      if (clipUrl) {
        try {
          screenshot = await captureH3Frame();
          label = "H3 Max Turbo suggestion frame";
        } catch {
          if (!clipPoster) throw new Error("H3 frame unavailable");
          screenshot = clipPoster;
          label = "H3 Max Turbo target frame";
        }
      } else if (clipPoster) {
        screenshot = clipPoster;
        label = "H3 Max Turbo target frame";
      } else {
        if (source === "camera" && !lucyVisualReady)
          throw new Error(
            "Start the Lucy live view or generate an H3 clip before preparing the email.",
          );
        screenshot = await capture();
        label =
          source === "camera"
            ? lucyPlaceholder
              ? "Lucy demo placeholder frame"
              : "Lucy live placement frame"
            : "Placement preview";
      }
      setEmailSnapshot({
        screenshot,
        roomImage: await capture(false),
        revision,
        label,
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn’t prepare the room screenshot.",
      );
      return;
    }
    setEmailBody(
      `Hi,\n\nI’m exploring a living-room update and would love your advice.\n\nItem: ${prompt}\nPlacement note: ${evaluation.explanation}\n\nThis is a visual concept, not a measured floor plan. Could you help me check the dimensions, fit, and options?\n\nThank you!`,
    );
    setApproved(false);
    setDialog("email");
  }
  return (
    <div className="app-shell">
      <Toaster position="bottom-center" richColors />
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Roomie home">
          <img src="/roomie.png" alt="" />
          <span>
            roomie<span className="brand-dot">.</span>
          </span>
        </Link>
        <Tabs
          value={tab}
          onValueChange={async (next) => {
            if (next === "saved" && stream.current) await freezeCamera();
            setTab(next);
          }}
        >
          <TabsList className="main-tabs">
            <TabsTrigger value="studio">
              <Layers2 />
              My studio
            </TabsTrigger>
            <TabsTrigger value="saved">
              <FolderHeart />
              Saved rooms
              {saved.length > 0 && (
                <span className="count">{saved.length}</span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="header-right">
          <span className="mode-pill">
            {cloud.ready ? "Private studio" : "Preview mode"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings and connections"
            onClick={() => setDialog("settings")}
          >
            <Settings2 />
          </Button>
          <div className="avatar">You</div>
        </div>
      </header>
      {tab === "studio" ? (
        <main className="workspace">
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">YOUR SPACE, REIMAGINED</div>
              <h1>Make a little room for possibility.</h1>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setAck(false);
                setSaveName("A warmer living room");
                setDialog("save");
              }}
              disabled={!hasItems || !selectedItemId || !prompt.trim() || busy}
            >
              <Bookmark />
              Save this room
            </Button>
          </div>
          <div className="studio-grid">
            <section className="view-column">
              <div className="room-toolbar">
                <div className="room-label">
                  Living room <span>/</span>{" "}
                  <span>
                    {source === "demo"
                      ? "The sunlit apartment"
                      : source === "camera"
                        ? "Your camera"
                        : "Your room photo"}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDialog("room")}
                >
                  <ImagePlus />
                  Change room
                </Button>
              </div>
              <div
                ref={stage}
                className={`room-stage ${
                  placed && !before && source === "camera"
                    ? `live-verdict-frame ${
                        jevRunState === "ready" && evaluation.fit === "green"
                          ? "yes"
                          : jevRunState === "ready" && evaluation.fit === "red"
                            ? "no"
                            : "checking"
                      }`
                    : ""
                }`}
                onPointerMove={(e) => {
                  if (!drag.current || !stage.current) return;
                  const b = stage.current.getBoundingClientRect();
                  update(
                    {
                      x: clamp(
                        drag.current.p.x +
                          ((e.clientX - drag.current.x) / b.width) * 100,
                        8,
                        92,
                      ),
                      y: clamp(
                        drag.current.p.y +
                          ((e.clientY - drag.current.y) / b.height) * 100,
                        15,
                        88,
                      ),
                    },
                    drag.current.id,
                  );
                }}
                onPointerUp={() => {
                  drag.current = null;
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
              >
                <img
                  className="room-background"
                  src={roomImage}
                  alt={
                    source === "demo"
                      ? "Sunlit living room with an ivory sofa and wooden floor"
                      : "Your uploaded room"
                  }
                  style={{
                    visibility: source === "camera" ? "hidden" : "visible",
                  }}
                />
                <video
                  ref={video}
                  muted
                  autoPlay
                  playsInline
                  className="room-background camera-feed"
                  style={{
                    visibility:
                      source === "camera" &&
                      (before || (!lucyActive && !lockedLucyFrameUrl))
                        ? "visible"
                        : "hidden",
                  }}
                />
                <video
                  ref={editedVideo}
                  muted
                  autoPlay
                  playsInline
                  className="room-background"
                  style={{
                    visibility:
                      lucyActive && !before && !lockedLucyFrameUrl
                        ? "visible"
                        : "hidden",
                  }}
                />
                {lockedLucyFrameUrl && (
                  <img
                    className="room-background"
                    src={lockedLucyFrameUrl}
                    alt="Locked Lucy furniture layout"
                    style={{ visibility: before ? "hidden" : "visible" }}
                  />
                )}
                <div className="stage-top">
                  <span className="glass-badge">
                    <span
                      className={
                        source === "camera" ? "live-dot" : "example-dot"
                      }
                    />
                    {source === "demo"
                      ? "EXAMPLE ROOM"
                      : source === "camera"
                        ? "LIVE CAMERA"
                        : "ROOM PHOTO"}
                  </span>
                  <span className="glass-badge subtle">
                    {lucyPlaceholder
                      ? "Lucy fallback · placeholders"
                      : lockedLucyFrameUrl
                        ? "Lucy layout · locked"
                        : lucyActive
                          ? lucySettling
                            ? "Hold steady · refining"
                            : "Lucy live · quick preview"
                          : "Visual planning"}
                  </span>
                </div>
                {hasItems &&
                  !before &&
                  items.map((item) => {
                    if (source === "camera" && !lucyPlaceholder) return null;
                    const selected = item.id === selectedItemId;
                    return (
                      <button
                        key={item.id}
                        className={`placed-item ${
                          selected ? evaluation.verdict : ""
                        } ${selected ? "selected" : ""} ${
                          lucyPlaceholder ? "lucy-placeholder-item" : ""
                        }`}
                        aria-label={`Select and move ${item.prompt}. Use arrow keys to adjust position.`}
                        aria-pressed={selected}
                        style={{
                          left: `${item.placement.x}%`,
                          top: `${item.placement.y}%`,
                          width: `${27.5 * item.placement.scale}%`,
                          transform: `translate(-50%,-50%) rotate(${item.placement.rotation}deg)`,
                        }}
                        onClick={() => {
                          if (!selected) selectItem(item);
                        }}
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          if (!selected) selectItem(item);
                          drag.current = {
                            id: item.id,
                            x: e.clientX,
                            y: e.clientY,
                            p: item.placement,
                          };
                        }}
                        onKeyDown={(e) => {
                          const dirs: Record<string, [number, number]> = {
                            ArrowLeft: [-1, 0],
                            ArrowRight: [1, 0],
                            ArrowUp: [0, -1],
                            ArrowDown: [0, 1],
                          };
                          if (dirs[e.key]) {
                            e.preventDefault();
                            if (!selected) selectItem(item);
                            update(
                              {
                                x: clamp(
                                  item.placement.x + dirs[e.key][0],
                                  8,
                                  92,
                                ),
                                y: clamp(
                                  item.placement.y + dirs[e.key][1],
                                  15,
                                  88,
                                ),
                              },
                              item.id,
                            );
                          }
                        }}
                      >
                        {item.reference ? (
                          <img
                            src={item.reference}
                            alt={item.prompt}
                            draggable={false}
                          />
                        ) : (
                          <span className="text-item-target">
                            <Sparkles size={15} />
                            <span>{item.prompt}</span>
                          </span>
                        )}
                        {selected && (
                          <>
                            <span className="item-handle tl" />
                            <span className="item-handle tr" />
                            <span className="item-handle bl" />
                            <span className="item-handle br" />
                            <span className="item-tag">
                              <Move size={12} /> Drag to find its place
                            </span>
                          </>
                        )}
                      </button>
                    );
                  })}
                {placed && !before && source === "camera" && (
                  <div
                    className={`live-frame-verdict-badge ${
                      jevRunState === "ready" && evaluation.fit === "green"
                        ? "yes"
                        : jevRunState === "ready"
                          ? "no"
                          : "checking"
                    }`}
                    aria-label={
                      jevRunState === "ready" && evaluation.fit === "green"
                        ? "Jev says yes to this placement"
                        : jevRunState === "ready"
                          ? "Jev says no to this placement"
                          : "Jev is checking this placement"
                    }
                  >
                    {jevRunState === "ready"
                      ? evaluation.fit === "green"
                        ? "Jev: YES"
                        : "Jev: NO"
                      : "Jev: CHECKING"}
                  </div>
                )}
                {!hasItems && (
                  <div className="stage-invitation">
                    <span className="invite-icon">
                      <Plus />
                    </span>
                    <span>
                      Your next favorite corner
                      <br />
                      <b>starts with one idea.</b>
                    </span>
                  </div>
                )}
                <div className="stage-bottom">
                  <span className="glass-badge">
                    {before
                      ? "Original room"
                      : hasItems
                        ? "Your new perspective"
                        : "A blank canvas for your ideas"}
                  </span>
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Expand room view"
                    onClick={() => {
                      if (!document.fullscreenElement)
                        void stage.current?.requestFullscreen();
                      else void document.exitFullscreen();
                    }}
                  >
                    <Maximize2 />
                  </Button>
                </div>
              </div>
              <div className="below-stage">
                <div className="view-toggle">
                  <Button
                    variant={before ? "ghost" : "secondary"}
                    size="sm"
                    onClick={() => setBefore(false)}
                  >
                    Your idea
                  </Button>
                  <Button
                    variant={before ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setBefore(true)}
                  >
                    <ArrowLeftRight />
                    Before
                  </Button>
                </div>
                <span>
                  <Move size={14} /> Drag to move · arrows to fine-tune
                </span>
                <Button variant="ghost" size="sm" onClick={download}>
                  <ArrowDownToLine />
                  Download
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Share room image"
                  onClick={share}
                >
                  <Share2 />
                </Button>
              </div>
              <div className="room-note">
                <ShieldCheck size={17} />
                <p>
                  Your room, your business. Camera access is optional.{" "}
                  <button onClick={() => setDialog("privacy")}>
                    How we handle your space
                  </button>
                </p>
              </div>
              {selectedItem && placed && (
                <div className="transform-card">
                  <div>
                    <div className="eyebrow">
                      SELECTED ·{" "}
                      {items.findIndex((item) => item.id === selectedItemId) +
                        1}{" "}
                      OF {items.length}
                    </div>
                    <h3>{selectedItem.prompt}</h3>
                  </div>
                  <div className="range-control">
                    <label>
                      Size <span>{Math.round(placement.scale * 100)}%</span>
                    </label>
                    <Slider
                      aria-label="Item size"
                      min={0.5}
                      max={1.8}
                      step={0.01}
                      value={[placement.scale]}
                      onValueChange={(v) => update({ scale: v[0] })}
                    />
                  </div>
                  <div className="range-control">
                    <label>
                      Rotation <span>{placement.rotation}°</span>
                    </label>
                    <Slider
                      aria-label="Item rotation"
                      min={-180}
                      max={180}
                      step={1}
                      value={[placement.rotation]}
                      onValueChange={(v) => update({ rotation: v[0] })}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Reset placement"
                    onClick={() => update(initialPlacement)}
                  >
                    <RotateCcw />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove item"
                    onClick={removeSelectedItem}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </section>
            <aside className="idea-panel">
              <div className="panel-intro">
                <div className="small-brand">
                  <img src="/roomie.png" alt="" />
                </div>
                <div>
                  <h2>A fresh perspective.</h2>
                  <p>Let’s see what feels like you.</p>
                </div>
              </div>
              <div className="prompt-block">
                <label htmlFor="furniture-voice">
                  {addingItem
                    ? "What would you like to add?"
                    : selectedItem
                      ? "Selected piece"
                      : "What are you imagining?"}
                </label>
                <button
                  id="furniture-voice"
                  className={`voice-request ${voiceState}`}
                  aria-pressed={voiceState === "listening"}
                  disabled={busy || voiceState === "transcribing"}
                  onClick={() => void recordFurnitureRequest()}
                >
                  <span className="voice-request-icon">
                    {voiceState === "listening" ? <Square /> : <Mic />}
                  </span>
                  <span>
                    <strong>
                      {voiceState === "listening"
                        ? "Listening… tap when you’re done"
                        : voiceState === "transcribing"
                          ? "GMI is transcribing…"
                          : voiceState === "failed"
                            ? "Tap to try again"
                            : prompt
                              ? "Say a different furniture piece"
                              : "Tap and say the furniture you want"}
                    </strong>
                    <small>
                      {voiceState === "listening"
                        ? "For example: a tall white bookshelf"
                        : "Roomie adds the transcript to Lucy automatically"}
                    </small>
                  </span>
                </button>
                {prompt && voiceState !== "listening" && (
                  <div className="voice-transcript" aria-live="polite">
                    <span>Heard</span>
                    <p>{prompt}</p>
                  </div>
                )}
                {voiceError && (
                  <p className="voice-error" role="alert">
                    {voiceError}
                  </p>
                )}
                <button
                  className="reference-button"
                  onClick={() => refFile.current?.click()}
                >
                  <ImagePlus size={18} />
                  <span>
                    {reference
                      ? "Reference added · change image"
                      : "Add an optional reference image"}
                  </span>
                  <Plus size={15} />
                </button>
                <p className="microcopy">
                  {voiceState === "transcribing"
                    ? "Your short voice clip is being sent to GMI for speech recognition."
                    : lucyActive
                      ? lucySettling
                        ? "Hold the camera steady while Lucy settles the furniture into the room."
                        : jevRunState === "ready"
                          ? "Jev checked the requested item in Lucy’s live output. Visual estimate only."
                          : "Lucy is generating your live view. Jev is checking whether the requested item appears."
                      : lucyPlaceholder
                        ? "Fallback placeholders preserve your exact furniture descriptions and positions after Lucy could not start."
                        : source === "camera"
                          ? connections.lucy
                            ? "Lucy uses your exact description. Add a reference only when you want a specific look."
                            : "Roomie will use demo placeholders until Decart Lucy is connected."
                          : reference
                            ? "Your uploaded image is the reference for this exact piece."
                            : "Your spoken description stays attached to this piece. Add a reference for a direct image preview."}
                </p>
                {source === "camera" && placed && lucyPlaceholder && (
                  <div className="lucy-placeholder-note" role="status">
                    <span>
                      <strong>Lucy fallback mode</strong>
                      Decart Lucy was unavailable, so Roomie switched to labeled
                      placeholders. These are not generated furniture.
                    </span>
                    {connections.lucy && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPreferLucyPlaceholders(false);
                          void startLive(items, selectedItemId, true);
                        }}
                      >
                        Retry real Lucy
                      </Button>
                    )}
                  </div>
                )}
                {source === "camera" && placed && lucyState === "failed" && (
                  <div className="lucy-retry" role="alert">
                    <span>{lucyError || "Lucy could not connect."}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void startLive()}
                    >
                      Retry Lucy
                    </Button>
                  </div>
                )}
              </div>
              {hasItems && (
                <section
                  className="layout-pieces"
                  aria-label="Furniture layout"
                >
                  <div className="layout-pieces-heading">
                    <span>Furniture layout</span>
                    <span>{items.length} / 8 pieces</span>
                  </div>
                  <div className="layout-piece-list">
                    {items.map((item, index) => (
                      <button
                        key={item.id}
                        className={item.id === selectedItemId ? "active" : ""}
                        aria-pressed={item.id === selectedItemId}
                        onClick={() => selectItem(item)}
                      >
                        {item.reference ? (
                          <img src={item.reference} alt="" />
                        ) : (
                          <span className="layout-piece-text-icon">
                            <Sparkles size={16} />
                          </span>
                        )}
                        <span>{item.prompt}</span>
                        <small>{index + 1}</small>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {hasItems && !addingItem && (
                <Button
                  variant="outline"
                  className="full add-furniture"
                  onClick={beginAddItem}
                  disabled={items.length >= 8}
                >
                  <Plus />
                  {items.length >= 8
                    ? "Room layout full · 8 pieces"
                    : "Add another piece"}
                </Button>
              )}
              {addingItem && hasItems && (
                <Button
                  variant="ghost"
                  className="full cancel-add-furniture"
                  onClick={() => selectItem(items[items.length - 1])}
                >
                  Cancel adding this piece
                </Button>
              )}
              <section
                className="scene-understanding"
                aria-label="Room understanding"
              >
                <div className="eyebrow">ROOM UNDERSTANDING</div>
                <p>
                  {roomSnapshot
                    ? roomSummary(roomSnapshot)
                    : "Give Jev a scan of the room around your idea."}
                </p>
                <small aria-live="polite">{sceneStatus}</small>
                <Button
                  className="full"
                  onClick={() => openRoomScan(!!roomSnapshot)}
                >
                  <Camera /> Scan this room
                </Button>
                {roomSnapshot && (
                  <Button
                    variant="outline"
                    className="full"
                    onClick={() => setDialog("settings")}
                  >
                    <Layers2 /> Manage room snapshot
                  </Button>
                )}
                <small>Room video is uploaded for GPU processing.</small>
              </section>
              {!selectedItem ? (
                <div className="empty-guidance">
                  <div className="eyebrow">A LITTLE INSPIRATION</div>
                  <h3>
                    {addingItem ? "Add another layer." : "Small change."}
                    <br />{" "}
                    {addingItem
                      ? "Keep the room you built."
                      : "Entirely new feeling."}
                  </h3>
                  <p>
                    {addingItem
                      ? "Describe or upload the next piece. Everything already in the room will stay in place."
                      : "Try one piece, move it around, and see your space in a different light."}
                  </p>
                  <button
                    className="inspiration-chip"
                    onClick={() => void place("A white bookshelf")}
                  >
                    Try a white bookshelf <ChevronRight size={16} />
                  </button>
                  <div className="mini-note">
                    <Sparkles size={16} />
                    No commitment. Just possibilities.
                  </div>
                </div>
              ) : (
                <div className="guidance">
                  <div className="guidance-heading">
                    <span className="eyebrow">ROOMIE’S TAKE</span>
                    <span
                      className={`verdict-label ${evaluation.fit || evaluation.verdict}`}
                    >
                      {jevRunState === "ready" && evaluation.fit
                        ? `${evaluation.fit === "green" ? "YES" : "NO"}${typeof evaluation.confidence === "number" && evaluation.confidence > 0 ? ` · ${Math.round(evaluation.confidence * 100)}%` : ""}`
                        : evaluation.verdict === "good"
                          ? "Nice fit"
                          : evaluation.verdict === "adjust"
                            ? "Try a tweak"
                            : roomSnapshot
                              ? "Needs alignment"
                              : "Needs a scan"}
                    </span>
                  </div>
                  <div
                    className={`jev-run-status ${jevRunState}`}
                    aria-live="polite"
                  >
                    {jevRunState === "checking" && (
                      <span className="jev-pulse" aria-hidden="true" />
                    )}
                    {jevRunState === "checking"
                      ? "Jev is checking this placement automatically…"
                      : jevRunState === "ready"
                        ? "Jev checked this placement automatically."
                        : jevRunState === "fallback"
                          ? connections.jev
                            ? "Jev is unavailable; showing local visual guidance."
                            : "Connect Jev to add automatic visual-fit feedback."
                          : "Place an item to have Jev check the fit automatically."}
                  </div>
                  <h3>{evaluation.title}</h3>
                  <p>{evaluation.explanation}</p>
                  <div className="checks">
                    {evaluation.checks.map((c) => (
                      <div key={c.label}>
                        <span className={`check-icon ${c.status}`}>
                          {c.status === "pass" ? (
                            <Check size={13} />
                          ) : c.status === "warn" ? (
                            <Move size={13} />
                          ) : (
                            <CircleHelp size={13} />
                          )}
                        </span>
                        {c.label}
                      </div>
                    ))}
                  </div>
                  <div className="evaluation-caption">
                    {evaluation.provider}
                  </div>
                  {evaluation.visualEstimate && (
                    <div className="visual-estimate-note">
                      Visual estimate only · metric calibration and
                      camera-to-scan alignment are not yet available.
                    </div>
                  )}
                  {evaluation.adjustment && (
                    <Button
                      className="full"
                      onClick={() => update(evaluation.adjustment!)}
                    >
                      <Check /> Apply suggested placement
                    </Button>
                  )}
                  {connections.h3 && (
                    <Button
                      variant="outline"
                      className="full"
                      onClick={showSuggestion}
                      disabled={
                        clipLoading ||
                        (source === "camera" && !lockedLucyFrameUrl)
                      }
                    >
                      <Video />
                      {clipLoading
                        ? "Generating with H3 Max Turbo…"
                        : source === "camera" && !lockedLucyFrameUrl
                          ? "Waiting for locked Lucy layout…"
                          : "Generate H3 suggestion clip"}
                    </Button>
                  )}
                  {suggestion && (
                    <div className="suggestion-preview">
                      {clipUrl ? (
                        <video
                          ref={h3Video}
                          className="generated-clip"
                          crossOrigin="anonymous"
                          src={clipUrl}
                          poster={clipPoster || undefined}
                          controls
                          autoPlay
                          muted
                          playsInline
                        />
                      ) : clipLoading ? (
                        <div className="h3-status" role="status">
                          H3 Max Turbo is generating the real suggestion clip…
                        </div>
                      ) : (
                        <div className="h3-status error" role="alert">
                          {clipError || "H3 Max Turbo did not return a clip."}
                        </div>
                      )}
                      <span>
                        {clipUrl
                          ? "H3 Max Turbo · generated suggestion"
                          : clipLoading
                            ? "H3 Max Turbo · generation in progress"
                            : "H3 Max Turbo · generation failed"}
                      </span>
                      {evaluation.adjustment && (
                        <Button
                          className="full"
                          onClick={() => update(evaluation.adjustment!)}
                        >
                          Apply this placement
                          <ArrowRight />
                        </Button>
                      )}
                    </div>
                  )}
                  {jobMessage && (
                    <div className="job-status" role="status">
                      {jobMessage}
                      <button
                        onClick={() => {
                          for (const cancel of activeJobs.current.values())
                            cancel();
                          setJobMessage("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  <details className="expert-guidance">
                    <summary>
                      Expert guidance <ChevronRight size={15} />
                    </summary>
                    <p>
                      Allow room to walk around furniture and operate doors.
                      This preview can’t verify actual dimensions.
                    </p>
                    <a
                      href="https://www.access-board.gov/ada/guides/chapter-4-accessible-routes/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      U.S. Access Board · accessible routes ↗
                    </a>
                    {sources.map((s) => (
                      <div className="source" key={s.url}>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.title} ↗
                        </a>
                        <p>{s.excerpt}</p>
                        <small>
                          Retrieved{" "}
                          {new Date(s.retrievedAt).toLocaleDateString()} ·
                          applicability unverified
                        </small>
                      </div>
                    ))}
                    <small>
                      Reference reading, not a claim of code compliance.
                    </small>
                  </details>
                  <button className="expert-link" onClick={openEmail}>
                    <Mail size={16} />
                    Get a second opinion
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </aside>
          </div>
          <footer className="workspace-footer">
            <span>Made for the way you want to live.</span>
            <button onClick={() => setDialog("settings")}>
              Preview connections <ChevronRight size={13} />
            </button>
          </footer>
        </main>
      ) : (
        <main className="gallery workspace">
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">IDEAS WORTH KEEPING</div>
              <h1>Your rooms, full of possibility.</h1>
            </div>
            <Button onClick={() => setTab("studio")}>
              <Plus />
              Back to the studio
            </Button>
          </div>
          {saved.length ? (
            <div className="saved-grid">
              {saved.map((room) => (
                <article className="saved-card" key={room.id}>
                  <button onClick={() => reopen(room)}>
                    <img src={room.screenshot} alt={room.name} />
                  </button>
                  <div>
                    <h3>{room.name}</h3>
                    <p>
                      {new Date(room.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      ·{" "}
                      {cloud.ready
                        ? "Private cloud save"
                        : "Saved on this browser"}
                      {" · "}
                      {room.items?.length || 1}{" "}
                      {(room.items?.length || 1) === 1 ? "piece" : "pieces"}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${room.name}`}
                      onClick={() => {
                        setSaveName(room.id);
                        setDialog("delete");
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="gallery-empty">
              <FolderHeart size={44} />
              <h2>A home for your favorite ideas.</h2>
              <p>
                Save a room from the studio and come back whenever inspiration
                strikes.
              </p>
              <Button onClick={() => setTab("studio")}>
                Create your first room
                <ArrowRight />
              </Button>
            </div>
          )}
        </main>
      )}
      <input
        ref={snapshotFile}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void importSnapshot(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={scanFile}
        type="file"
        accept=".ply"
        hidden
        onChange={(e) => {
          void uploadScan(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={roomFile}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          void upload(e.target.files?.[0], "room");
          e.target.value = "";
        }}
      />
      <input
        ref={refFile}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          void upload(e.target.files?.[0], "reference");
          e.target.value = "";
        }}
      />
      <DeleteRoom
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        onConfirm={removeSaved}
      />
      <Dialog
        open={dialog !== null && dialog !== "delete"}
        onOpenChange={(open) => {
          if (!open) {
            if (dialog === "scan") stopScanCamera();
            setDialog(null);
          }
        }}
      >
        <DialogContent
          className={
            dialog === "email" || dialog === "scan" ? "wide-dialog" : ""
          }
        >
          <DialogHeader>
            <DialogTitle>
              {
                (
                  {
                    room: "A new point of view",
                    save: "Keep this possibility",
                    email: "A second pair of eyes",
                    settings: "Your studio connections",
                    privacy: "A little privacy, by design",
                    scan: "Scan this room",
                    delete: "Delete this saved room?",
                  } as Record<string, string>
                )[dialog || ""]
              }
            </DialogTitle>
            <DialogDescription>
              {dialog === "room"
                ? "Use your camera, a photo, or our example living room."
                : dialog === "save"
                  ? "Save your view and all the details so you can come back to it."
                  : dialog === "email"
                    ? "Review your room brief before sharing it with an expert."
                    : dialog === "settings"
                      ? "You can explore the full visual workflow in preview mode."
                      : dialog === "scan"
                        ? "A slow walkthrough gives Roomie the room context Jev needs for visual-fit guidance."
                        : dialog === "delete"
                          ? "This permanently removes the saved configuration and its images."
                          : "You choose when your room leaves your device."}
            </DialogDescription>
          </DialogHeader>
          {dialog === "scan" && (
            <div className="room-scan-flow">
              <div className="scan-progress" aria-label="Room scan progress">
                {[
                  ["uploading", "Uploading"],
                  ["reconstructing", "Reconstructing"],
                  ["analyzing", "Analyzing"],
                  ["ready", "Ready"],
                ].map(([step, label]) => {
                  const order = [
                    "uploading",
                    "reconstructing",
                    "analyzing",
                    "ready",
                  ];
                  const current = order.indexOf(scanStage);
                  const index = order.indexOf(step);
                  return (
                    <div
                      key={step}
                      className={
                        scanStage === "failed"
                          ? ""
                          : current >= index
                            ? "active"
                            : ""
                      }
                    >
                      <span>
                        {current > index || scanStage === "ready"
                          ? "✓"
                          : index + 1}
                      </span>
                      {label}
                    </div>
                  );
                })}
              </div>
              {scanStage === "guide" && (
                <div className="scan-guide">
                  <div className="scan-illustration">
                    <Camera size={34} />
                    <span>30 sec</span>
                  </div>
                  <h3>Walk slowly around the whole living room.</h3>
                  <ul>
                    <li>Keep the phone upright and move at a steady pace.</li>
                    <li>
                      Show every wall, doorway, and large piece of furniture.
                    </li>
                    <li>Use bright, even light and avoid fast turns.</li>
                  </ul>
                  <div className="upload-disclosure">
                    <ShieldCheck size={18} />
                    <span>
                      Your room video is uploaded to Convex and sent to the
                      Modal GPU backend for SLAM3R reconstruction and SpatialLM
                      analysis. It is deleted after a successful scan; failed
                      uploads expire within 24 hours or can be deleted now.
                    </span>
                  </div>
                  <Button className="full" onClick={requestScanCamera}>
                    <Camera /> Allow camera and continue
                  </Button>
                </div>
              )}
              {scanStage === "permission" && (
                <div className="scan-state" role="status">
                  <div className="scan-spinner" />
                  <h3>Waiting for camera permission…</h3>
                  <p>Chrome may show a permission prompt.</p>
                </div>
              )}
              {(scanStage === "preview" || scanStage === "recording") && (
                <div className="scan-recorder">
                  <div className="scan-video-wrap">
                    <video ref={scanPreview} muted playsInline autoPlay />
                    {scanStage === "recording" && (
                      <span className="recording-badge">
                        <i /> REC {Math.min(scanSeconds, scanMaximumSeconds)}s
                      </span>
                    )}
                  </div>
                  {scanStage === "preview" ? (
                    <>
                      <p>
                        Start near a doorway, then pan and walk slowly around
                        the room. Recording stops automatically at 30 seconds.
                      </p>
                      <Button className="full" onClick={startRoomRecording}>
                        <Video /> Start walkthrough
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="scan-timer-track">
                        <span
                          style={{
                            width: `${Math.min(100, (scanSeconds / scanMaximumSeconds) * 100)}%`,
                          }}
                        />
                      </div>
                      <p>
                        {`${Math.max(0, scanMinimumSeconds - scanSeconds)} seconds remaining. Keep moving slowly; recording stops automatically.`}
                      </p>
                    </>
                  )}
                </div>
              )}
              {["uploading", "reconstructing", "analyzing"].includes(
                scanStage,
              ) && (
                <div className="scan-state" role="status" aria-live="polite">
                  <div className="scan-spinner" />
                  <h3>
                    {scanStage === "uploading"
                      ? "Uploading your walkthrough…"
                      : scanStage === "reconstructing"
                        ? "Reconstructing the room…"
                        : "SpatialLM is analyzing the room…"}
                  </h3>
                  <p>
                    {scanStage === "uploading"
                      ? "Keep this tab open while the encrypted upload completes."
                      : scanStage === "reconstructing"
                        ? "SLAM3R is converting video frames into a .ply point cloud on the Modal GPU."
                        : "SpatialLM is turning the point cloud into compact walls, openings, and furniture geometry."}
                  </p>
                  {roomScanId && (
                    <Button
                      variant="ghost"
                      onClick={() => void deleteRoomScan()}
                    >
                      <Trash2 /> Cancel and delete scan
                    </Button>
                  )}
                </div>
              )}
              {scanStage === "ready" && (
                <div className="scan-state ready" role="status">
                  <div className="ready-mark">
                    <Check />
                  </div>
                  <h3>Your room is ready.</h3>
                  <p>
                    {roomSnapshot
                      ? roomSummary(roomSnapshot)
                      : "The compact room snapshot is saved in Convex."}
                  </p>
                  {roomSnapshot?.performance?.totalSeconds !== undefined && (
                    <p className="scan-performance">
                      Ready in{" "}
                      {Math.round(roomSnapshot.performance.totalSeconds)}{" "}
                      seconds
                    </p>
                  )}
                  <div className="visual-estimate-note">
                    Jev guidance is a visual estimate until metric calibration
                    and camera-to-scan alignment are available.
                  </div>
                  <div className="scan-actions">
                    <Button
                      variant="outline"
                      onClick={() => openRoomScan(true)}
                    >
                      <RotateCcw /> Replace scan
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => void deleteRoomScan()}
                    >
                      <Trash2 /> Delete scan
                    </Button>
                  </div>
                </div>
              )}
              {scanStage === "failed" && (
                <div className="scan-state failed" role="alert">
                  <CircleHelp size={32} />
                  <h3>We couldn’t finish this scan.</h3>
                  <p>{scanError || "Try a slower, brighter walkthrough."}</p>
                  <div className="scan-actions">
                    {roomScanId && (
                      <Button onClick={() => void retryRoomScan()}>
                        <RotateCcw /> Retry processing
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => openRoomScan(true)}
                    >
                      <Camera /> Replace scan
                    </Button>
                    {roomScanId && (
                      <Button
                        variant="ghost"
                        onClick={() => void deleteRoomScan()}
                      >
                        <Trash2 /> Delete scan
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {dialog === "room" && (
            <div className="dialog-stack">
              <Button
                variant="outline"
                onClick={() => {
                  void startCamera();
                  setDialog(null);
                }}
              >
                <Camera />
                Use my camera
              </Button>
              <small>
                {cameraState}. Your browser will ask for permission.
              </small>
              {cameras.length > 1 && (
                <Select
                  value={deviceId}
                  onValueChange={(id) => void startCamera(id)}
                >
                  <SelectTrigger aria-label="Camera">
                    <SelectValue placeholder="Choose camera" />
                  </SelectTrigger>
                  <SelectContent>
                    {cameras.map((c, i) => (
                      <SelectItem key={c.deviceId} value={c.deviceId}>
                        {c.label || `Camera ${i + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  roomFile.current?.click();
                  setDialog(null);
                }}
              >
                <Upload />
                Upload a room photo
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  demo();
                  setDialog(null);
                }}
              >
                Explore the example room
              </Button>
              {source === "camera" && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    void freezeCamera();
                    setDialog(null);
                  }}
                >
                  Turn off camera
                </Button>
              )}
            </div>
          )}
          {dialog === "save" && (
            <div className="dialog-stack">
              <label htmlFor="save-name">Room name</label>
              <Input
                id="save-name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                maxLength={80}
              />
              <label className="checkbox-label">
                <Checkbox
                  checked={ack}
                  onCheckedChange={(v) => setAck(v === true)}
                />
                I understand this is a visual concept; measurements and
                clearances haven’t been verified.
              </label>
              <Button
                disabled={!ack || !saveName.trim() || busy}
                onClick={save}
              >
                <Bookmark />
                Save room
              </Button>
              <small>
                {cloud.ready
                  ? "Saved privately in your browser’s guest session. Keep this browser data to retain access; download a copy for safekeeping."
                  : "Cloud session is connecting. Your current view stays on this device until saved."}
              </small>
            </div>
          )}
          {dialog === "settings" && (
            <div className="dialog-stack connections">
              <section className="scene-understanding" aria-live="polite">
                <strong>Room understanding → Jev → Lucy</strong>
                <p>
                  {roomSnapshot
                    ? roomSummary(roomSnapshot)
                    : "Attach a scan of this room to give Jev spatial context."}
                </p>
                <small>
                  {sceneStatus}.{" "}
                  {roomSnapshot ? "Camera alignment and scale pending. " : ""}
                  Lucy’s requested placement is shared; generated pixels are not
                  yet verified.
                </small>
                {roomSnapshot && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      roomScanId
                        ? void deleteRoomScan()
                        : (() => {
                            scanEpoch.current++;
                            activeJobs.current.get("spatial")?.();
                            setJobMessage("");
                            setSnapshotSelection({});
                            setRoomSnapshot(null);
                            setRevision((n) => n + 1);
                          })()
                    }
                  >
                    {roomScanId ? "Delete room scan" : "Detach room snapshot"}
                  </Button>
                )}
              </section>
              {[
                ["Cloud saves · Convex", cloud.ready],
                ["Live room editing · Lucy 2.5", connections.lucy],
                ["Placement decisions · Jev", connections.jev],
                ["Suggestion clips · H3 Max Turbo", connections.h3],
                ["Room understanding · Modal / SpatialLM", connections.spatial],
                ["Voice input · GMI speech recognition", connections.speech],
                ["Expert research · Firecrawl", connections.research],
                ["Email handoff · AgentMail", connections.email],
              ].map(([name, ready]) => (
                <div key={String(name)}>
                  <span>{name}</span>
                  <span className="connection-state">
                    {ready
                      ? String(name).startsWith("Cloud")
                        ? "Connected"
                        : "Configured"
                      : "Not connected"}
                  </span>
                </div>
              ))}
              <p>
                Cloud saves belong to this browser’s private guest session. Live
                services become available when their credentials are connected.
              </p>
              <Button onClick={() => openRoomScan(!!roomSnapshot)}>
                <Camera /> Scan this room
              </Button>
              <small>
                Record a fixed 30-second walkthrough. The video is uploaded to
                Convex and sent to Modal for reconstruction and SpatialLM
                analysis.
              </small>
              <Button
                variant="outline"
                onClick={() => scanFile.current?.click()}
              >
                <Upload />
                Upload a PLY room scan
              </Button>
              <small>
                Use a reconstructed point cloud. A still webcam image is not a
                room scan. Scan geometry requires camera alignment before
                clearance checks.
              </small>
              <Button
                variant="outline"
                onClick={() => snapshotFile.current?.click()}
              >
                <Upload /> Attach SpatialLM JSON snapshot
              </Button>
              <small>
                Use a precomputed snapshot of the room currently shown. Changing
                rooms detaches it. Saved rooms retain their snapshot.
              </small>
              <Button variant="outline" onClick={() => setDialog("privacy")}>
                <ShieldCheck />
                Privacy & room data
              </Button>
            </div>
          )}
          {dialog === "privacy" && (
            <div className="dialog-stack privacy-copy">
              <p>
                Your camera is used only with browser permission. Camera frames
                and uploaded photos stay in your browser until you save or
                request a connected service. Saved rooms and their images are
                stored privately in Convex.
              </p>
              <p>
                When live services are enabled, relevant frames and descriptions
                will be processed by the connected providers to fulfill your
                request. Unsaved cloud captures expire after 24 hours; saved
                rooms remain until deleted.
              </p>
              <p>
                A room scan uploads the recorded walkthrough to private Convex
                storage, then sends it to the Modal GPU backend for SLAM3R and
                SpatialLM processing. The video is deleted after successful
                analysis. Failed scan videos expire within 24 hours or when you
                choose Delete scan.
              </p>
              <p>
                Roomie does not use your room for model training. Provider
                retention is subject to their policies. Emails are sent only
                after you review and approve them.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  void freezeCamera();
                  toast.success("Camera stopped.");
                }}
              >
                Turn off my camera
              </Button>
            </div>
          )}
          {dialog === "email" && (
            <div className="dialog-stack">
              <label htmlFor="expert-location">Find an expert near you</label>
              <div className="inline-form">
                <Input
                  id="expert-location"
                  placeholder="City or ZIP code"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
                <Button variant="outline" onClick={findExperts}>
                  Find experts
                </Button>
              </div>
              {contacts.map((c) => (
                <div className="contact-option" key={c.email}>
                  <button
                    onClick={() => {
                      setRecipient(c.email);
                      setApproved(false);
                    }}
                  >
                    {c.name}
                    <small>{c.email}</small>
                  </button>
                  <a href={c.url} target="_blank" rel="noreferrer">
                    Source ↗
                  </a>
                </div>
              ))}
              {jobMessage && <p role="status">{jobMessage}</p>}
              <label htmlFor="recipient">To</label>
              <Input
                id="recipient"
                type="email"
                value={recipient}
                onChange={(e) => {
                  setRecipient(e.target.value);
                  setApproved(false);
                }}
                placeholder="designer@example.com"
              />
              <label>Subject</label>
              <Input value="A little help with my living room" readOnly />
              <Textarea
                aria-label="Email message"
                rows={7}
                value={emailBody}
                onChange={(e) => {
                  setEmailBody(e.target.value);
                  setApproved(false);
                }}
              />
              {emailSnapshot && (
                <>
                  <img
                    className="email-snapshot"
                    src={emailSnapshot.screenshot}
                    alt="Generated room placement frame attached to this email"
                  />
                  <span className="attachment-source">
                    {emailSnapshot.label}
                  </span>
                </>
              )}
              <p className="attachment-note">
                <ImagePlus size={16} />
                Generated placement frame and room details
              </p>
              <label className="checkbox-label">
                <Checkbox
                  checked={approved}
                  onCheckedChange={(v) => setApproved(v === true)}
                />
                I’ve reviewed the recipient, message, and room details.
              </label>
              <Button
                disabled={
                  busy ||
                  !emailSnapshot ||
                  !approved ||
                  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)
                }
                onClick={sendEmail}
              >
                {busy
                  ? "Preparing…"
                  : connections.email
                    ? "Approve & send email"
                    : "Preview handoff"}
                <Mail />
              </Button>
              <small>
                {connections.email
                  ? "Sends only to the recipient above with the screenshot shown."
                  : "Preview mode · no email will be sent."}
              </small>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
