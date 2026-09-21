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
  Move,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
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
  lucyPrompt,
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
export default function Studio() {
  const cloud = useCloud();
  const [connections, setConnections] = useState<Connections>({
    jev: false,
    h3: false,
    lucy: false,
    research: false,
    spatial: false,
    email: false,
  });
  const [liveEvaluation, setLiveEvaluation] = useState<Evaluation | null>(null),
    [sources, setSources] = useState<ResearchSource[]>([]),
    [contacts, setContacts] = useState<Contact[]>([]),
    [jobMessage, setJobMessage] = useState("");
  const [clipUrl, setClipUrl] = useState<string | null>(null),
    [clipLoading, setClipLoading] = useState(false),
    [clipError, setClipError] = useState<string | null>(null),
    [lucyActive, setLucyActive] = useState(false),
    [emailSnapshot, setEmailSnapshot] = useState<{
      screenshot: string;
      roomImage: string;
      revision: number;
    } | null>(null),
    [emailRequestId, setEmailRequestId] = useState("");
  const activeJobs = useRef(new Map<string, () => void>()),
    latestRevision = useRef(0),
    lucy = useRef<LucySession | null>(null),
    editedVideo = useRef<HTMLVideoElement>(null),
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
  const [prompt, setPrompt] = useState("A sculptural terracotta accent chair"),
    [reference, setReference] = useState("/chair.png"),
    [placed, setPlaced] = useState(false),
    [placement, setPlacement] = useState<Placement>(initialPlacement),
    [revision, setRevision] = useState(0),
    [before, setBefore] = useState(false);
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
    drag = useRef<{ x: number; y: number; p: Placement } | null>(null);
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
  function resetScene() {
    scanEpoch.current++;
    sceneKey.current = crypto.randomUUID();
    activeJobs.current.get("spatial")?.();
    activeJobs.current.get("jev")?.();
    setRoomSnapshot(null);
    setSnapshotSelection({});
    setLiveEvaluation(null);
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
    if (!cloud.ready) return;
    const current = revision;
    const view = currentSceneKey();
    let valid = true;
    const timer = setTimeout(() => {
      setSceneStatus("Updating room understanding…");
      void syncScene()
        .then((state) => {
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
          return runJob("jev", { sceneKey: view }, current);
        })
        .then((r) => {
          if (
            valid &&
            sceneKey.current === view &&
            latestRevision.current === current &&
            r?.evaluation
          ) {
            setLiveEvaluation(r.evaluation as Evaluation);
            setSceneStatus(`Jev reviewed scene revision ${current}`);
          }
        })
        .catch((e) => {
          if (valid && latestRevision.current === current) {
            setSceneStatus("Review unavailable · showing local guidance");
            toast.error(e.message);
          }
        });
    }, 650);
    return () => {
      valid = false;
      clearTimeout(timer);
      activeJobs.current.get("jev")?.();
    };
  }, [revision, placed, cloud.ready, connections.jev]);
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
      lucy.current?.close();
      stopScanCamera();
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
    setClipError(null);
    if (!connections.h3 || !cloud.client) {
      setClipLoading(false);
      setClipError("H3 Max Turbo is not connected.");
      return;
    }
    if (source === "camera" && !lucyActive) {
      setClipLoading(false);
      setClipError("Wait for Lucy's generated stream before creating a clip.");
      return;
    }
    setClipLoading(true);
    setJobMessage("Creating your suggestion clip…");
    try {
      const imageId = await uploadImage(cloud.client, await capture(false));
      const endImageId = await uploadImage(
        cloud.client,
        await capture(true, evaluation.adjustment || placement),
      );
      const result = await runJob(
        "h3",
        {
          imageId,
          endImageId,
          prompt: `Keep the camera fixed and room unchanged. Move only this item: ${prompt}. Show the change from the first frame to the supplied last frame. Do not add other furniture.`,
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
        if (seconds >= 60 && scanRecorder.current?.state === "recording")
          scanRecorder.current.stop();
      }, 250);
    } catch {
      setScanError("Chrome could not start the recording. Please try again.");
      setScanStage("failed");
    }
  }
  function finishRoomRecording() {
    if (scanSeconds < 30 || scanRecorder.current?.state !== "recording") return;
    scanRecorder.current.stop();
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
            setSceneStatus("Room scan ready · Jev is reviewing visual fit");
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
  async function startLive() {
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
    setJobMessage("Connecting live room editing…");
    setLucyActive(false);
    if (editedVideo.current) editedVideo.current.srcObject = null;
    try {
      lucy.current?.close();
      lucy.current = await connectLucy(
        stream.current,
        async () => {
          const token = await cloud.client!.action(api.providers.lucyToken, {});
          if (!token) throw new Error("Lucy is not connected.");
          return token;
        },
        lucyPrompt(prompt, initialPlacement),
        reference.startsWith("data:") ? reference : undefined,
        (s) => {
          if (editedVideo.current) {
            editedVideo.current.srcObject = s;
            void editedVideo.current.play();
          }
          setLucyActive(true);
          setJobMessage("");
        },
        (error) => {
          toast.error(error);
          lucy.current?.close();
          setLucyActive(false);
          setJobMessage("");
        },
      );
    } catch (e) {
      toast.error((e as Error).message);
      setJobMessage("");
    }
  }

  const update = (change: Partial<Placement>) => {
    setPlacement((p) => ({ ...p, ...change }));
    setRevision((n) => n + 1);
    setSuggestion(false);
    setClipLoading(false);
    setClipError(null);
    setJobMessage("");
    setClipUrl(null);
    activeJobs.current.get("h3")?.();
  };
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
    lucy.current?.close();
    setLucyActive(false);
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
          ...(selectedDevice ? { deviceId: { exact: selectedDevice } } : {}),
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
    void startCamera();
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
      setRevision((n) => n + 1);
    } else {
      setReference(url);
      setPlaced(false);
      setRevision((n) => n + 1);
      toast.success("Reference ready. Place it in your room.");
    }
  }
  async function place() {
    if (!prompt.trim()) {
      toast.error("Describe the item you’d like to try.");
      return;
    }
    setBusy(true);
    setPlacement(initialPlacement);
    setRevision((n) => n + 1);
    setPlaced(true);
    setBefore(false);
    setBusy(false);
    if (source === "camera" && connections.lucy) void startLive();
    toast.success(
      source === "camera"
        ? connections.lucy
          ? "Connecting your camera directly to Decart Lucy."
          : "Lucy is not connected. Check the Decart credential."
        : reference === "/chair.png"
          ? "Example chair placed. Upload a reference to try your own item."
          : "Reference placed. Drag it to explore your layout.",
    );
  }
  async function capture(includeItem = true, transform = placement) {
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
    const useLucyOutput =
      includeItem && lucyActive && !!editedVideo.current?.videoWidth;
    const bg = useLucyOutput
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
    if (includeItem && placed && !useLucyOutput && source !== "camera") {
      const item = await load(reference);
      const iw = 330 * transform.scale,
        ih = (iw * item.height) / item.width;
      ctx.save();
      ctx.translate(transform.x * 12, transform.y * 8);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.drawImage(item, -iw / 2, -ih / 2, iw, ih);
      ctx.restore();
    }
    ctx.fillStyle = "rgba(255,250,247,.9)";
    ctx.fillRect(0, 758, 1200, 42);
    ctx.fillStyle = "#78263b";
    ctx.font = "16px sans-serif";
    ctx.fillText("roomie  /  visual planning preview · not measured", 24, 785);
    return canvas.toDataURL("image/jpeg", 0.85);
  }
  async function persistRoom(screenshot: string, bg: string, name: string) {
    if (cloud.configured) {
      if (!cloud.ready || !cloud.client)
        throw new Error(
          "Your cloud session is still connecting. Please try again.",
        );
      const view = currentSceneKey();
      await syncScene();
      const [referenceId, roomImageId, screenshotId] = await Promise.all([
        uploadImage(cloud.client, reference),
        uploadImage(cloud.client, bg),
        uploadImage(cloud.client, screenshot),
      ]);
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
        referenceId,
        roomImageId,
        screenshotId,
        sceneKey: view,
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
    const timer = setTimeout(
      () =>
        lucy.current?.update(
          lucyPrompt(prompt, placement),
          reference.startsWith("data:") ? reference : undefined,
        ),
      500,
    );
    return () => clearTimeout(timer);
  }, [lucyActive, prompt, placement, reference]);
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
    setReference(room.reference);
    setPlacement(room.placement);
    setPrompt(room.prompt);
    setPlaced(true);
    setBefore(false);
    setRevision((n) => n + 1);
    setTab("studio");
    toast.success("Your room is ready to keep exploring.");
  }
  async function openEmail() {
    setEmailSnapshot(null);
    setEmailRequestId(crypto.randomUUID());
    try {
      setEmailSnapshot({
        screenshot: await capture(),
        roomImage: await capture(false),
        revision,
      });
    } catch {
      toast.error("Couldn’t prepare the room screenshot.");
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
              disabled={!placed || busy}
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
                className="room-stage"
                onPointerMove={(e) => {
                  if (!drag.current || !stage.current) return;
                  const b = stage.current.getBoundingClientRect();
                  update({
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
                  });
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
                    visibility: source === "camera" ? "visible" : "hidden",
                  }}
                />
                <video
                  ref={editedVideo}
                  muted
                  autoPlay
                  playsInline
                  className="room-background"
                  style={{
                    visibility: lucyActive && !before ? "visible" : "hidden",
                  }}
                />
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
                  <span className="glass-badge subtle">Visual planning</span>
                </div>
                {placed && !before && source !== "camera" && (
                  <button
                    className={`placed-item ${evaluation.verdict}`}
                    aria-label="Move placed item. Use arrow keys to adjust position."
                    style={{
                      left: `${placement.x}%`,
                      top: `${placement.y}%`,
                      width: `${27.5 * placement.scale}%`,
                      transform: `translate(-50%,-50%) rotate(${placement.rotation}deg)`,
                    }}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      drag.current = {
                        x: e.clientX,
                        y: e.clientY,
                        p: placement,
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
                        update({
                          x: clamp(placement.x + dirs[e.key][0], 8, 92),
                          y: clamp(placement.y + dirs[e.key][1], 15, 88),
                        });
                      }
                    }}
                  >
                    <img src={reference} alt={prompt} draggable={false} />
                    <span className="item-handle tl" />
                    <span className="item-handle tr" />
                    <span className="item-handle bl" />
                    <span className="item-handle br" />
                    <span className="item-tag">
                      <Move size={12} />
                      Drag to find its place
                    </span>
                  </button>
                )}
                {!placed && (
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
                      : placed
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
              {placed && (
                <div className="transform-card">
                  <div>
                    <div className="eyebrow">MAKE IT YOURS</div>
                    <h3>Find the right fit.</h3>
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
                    onClick={() => {
                      setPlaced(false);
                      setSuggestion(false);
                    }}
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
                <label htmlFor="idea">What are you imagining?</label>
                <Textarea
                  id="idea"
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    setRevision((n) => n + 1);
                    setSuggestion(false);
                  }}
                  maxLength={1000}
                  placeholder="A cozy chair, a bold new sofa…"
                />
                <button
                  className="reference-button"
                  onClick={() => refFile.current?.click()}
                >
                  <ImagePlus size={18} />
                  <span>
                    {reference.startsWith("data:")
                      ? "Reference added · change image"
                      : "Add a reference image"}
                  </span>
                  <Plus size={15} />
                </button>
                <Button
                  className="place-button"
                  onClick={place}
                  disabled={busy}
                >
                  <Sparkles />
                  {busy
                    ? "Finding its place…"
                    : placed
                      ? "Try this idea again"
                      : "Place it in my room"}
                  <ArrowRight />
                </Button>
                <p className="microcopy">
                  {lucyActive
                    ? "Lucy is generating your live view. Placement is requested; its rendered position is unverified."
                    : source === "camera"
                      ? connections.lucy
                        ? "Your camera remains unchanged until Decart Lucy returns its generated stream."
                        : "Connect Decart to generate furniture in the live camera view."
                      : reference === "/chair.png"
                        ? "Preview uses an example chair. Add your own image to swap it."
                        : "Your image becomes an editable reference in the room."}
                </p>
              </div>
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
              {!placed ? (
                <div className="empty-guidance">
                  <div className="eyebrow">A LITTLE INSPIRATION</div>
                  <h3>
                    Small change.
                    <br />
                    Entirely new feeling.
                  </h3>
                  <p>
                    Try one piece, move it around, and see your space in a
                    different light.
                  </p>
                  <button
                    className="inspiration-chip"
                    onClick={() => {
                      setPrompt("A sculptural terracotta accent chair");
                      void place();
                    }}
                  >
                    A cozy reading corner <ChevronRight size={16} />
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
                      {evaluation.fit
                        ? `${evaluation.fit.toUpperCase()}${typeof evaluation.confidence === "number" && evaluation.confidence > 0 ? ` · ${Math.round(evaluation.confidence * 100)}%` : ""}`
                        : evaluation.verdict === "good"
                          ? "Nice fit"
                          : evaluation.verdict === "adjust"
                            ? "Try a tweak"
                            : roomSnapshot
                              ? "Needs alignment"
                              : "Needs a scan"}
                    </span>
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
                  {roomSnapshot && (
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
                        clipLoading || (source === "camera" && !lucyActive)
                      }
                    >
                      <Video />
                      {clipLoading
                        ? "Generating with H3 Max Turbo…"
                        : source === "camera" && !lucyActive
                          ? "Waiting for Lucy output…"
                          : "Generate H3 suggestion clip"}
                    </Button>
                  )}
                  {suggestion && (
                    <div className="suggestion-preview">
                      {clipUrl ? (
                        <video
                          className="generated-clip"
                          src={clipUrl}
                          controls
                          autoPlay
                          muted
                          loop
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
                    <span>30–60 sec</span>
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
                        <i /> REC {Math.min(scanSeconds, 60)}s
                      </span>
                    )}
                  </div>
                  {scanStage === "preview" ? (
                    <>
                      <p>
                        Start near a doorway, then pan and walk slowly around
                        the room. Keep recording for at least 30 seconds.
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
                            width: `${Math.min(100, (scanSeconds / 60) * 100)}%`,
                          }}
                        />
                      </div>
                      <p>
                        {scanSeconds < 30
                          ? `${30 - scanSeconds} seconds until you can finish`
                          : "Enough coverage captured. Continue toward 60 seconds for more detail."}
                      </p>
                      <Button
                        className="full"
                        onClick={finishRoomRecording}
                        disabled={scanSeconds < 30}
                      >
                        <Check /> Finish scan
                      </Button>
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
                Record a 30–60 second walkthrough. The video is uploaded to
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
                <img
                  className="email-snapshot"
                  src={emailSnapshot.screenshot}
                  alt="Exact room screenshot attached to this email"
                />
              )}
              <p className="attachment-note">
                <ImagePlus size={16} />
                Room screenshot and placement details
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
