import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getAccessToken, supabaseClient } from "./lib/supabase";
import {
  analyzeStrictVisionFrame,
  createStrictVisionSession,
  getStrictVisionBackendHealth,
  hasStrictVisionBackend,
  sendStrictVisionEvent,
  type StrictVisionAnalysis,
  type StrictVisionClassification,
} from "./lib/strict-vision";

type Phase = "idle" | "running" | "paused" | "completed";
type TaskStatus = "pending" | "active" | "done";
type HistoryStatus = "completed" | "interrupted";
type StrictModeKind = "allowlist" | "vision";
type ThemeMode = "mono" | "mist";
type AppearanceMode = "auto" | "light" | "dark";
type ResolvedAppearance = "light" | "dark";

type Task = {
  id: string;
  title: string;
  plannedSeconds: number;
  status: TaskStatus;
  createdAt: number;
  completedAt?: number;
};

type StrictModeSessionConfig = {
  enabled: boolean;
  kind: StrictModeKind;
  sessionId?: string | null;
};

type FocusSession = {
  taskId: string;
  startedAt: number;
  plannedSeconds: number;
  secondsLeft: number;
  strictModeEnabled: boolean;
  strictModeKind: StrictModeKind;
  strictSessionId: string | null;
  lastAnalysisResult: StrictVisionAnalysis | null;
  analysisCooldownUntil: number;
};

type HistoryEntry = {
  id: string;
  taskId: string;
  taskTitle: string;
  intention: string;
  plannedSeconds: number;
  focusedSeconds: number;
  startedAt: number;
  endedAt: number;
  reflection: string;
  neededMoreTime: boolean;
  status: HistoryStatus;
  strictModeEnabled: boolean;
};

type Preferences = {
  playMusicOnStart: boolean;
  notificationsEnabled: boolean;
  alwaysOnTop: boolean;
  recentAllowedApps: string[];
  recentAllowedSites: string[];
  strictModeDefault: boolean;
  musicUrl: string;
  lastActiveTaskId: string | null;
  themeMode: ThemeMode;
  appearanceMode: AppearanceMode;
};

type StrictViolationState = {
  consecutive: number;
  lastMessageAt: number;
  recentClassifications: StrictVisionClassification[];
};

type StrictIntroState = {
  consentChecked: boolean;
  error: string | null;
  submitting: boolean;
  backendMessage: string | null;
};

type HoverHint = {
  title: string;
  body: string;
  left: number;
  top: number;
};

type InputValidationMessage = {
  title: string;
  body: string;
};

type MiniWindowState = {
  active: boolean;
  taskTitle: string;
  timeLabel: string;
  durationLabel: string;
  progressRatio: number;
  phase: Phase;
  pinned: boolean;
  themeMode: ThemeMode;
  appearance: ResolvedAppearance;
};

type SoundCloudWidget = {
  bind: (event: string, callback: () => void) => void;
  play: () => void;
  pause: () => void;
};

const TASKS_STORAGE_KEY = "reactive_timer_tasks_v1";
const HISTORY_STORAGE_KEY = "reactive_timer_history_v1";
const PREFS_STORAGE_KEY = "reactive_timer_preferences_v1";

const DEFAULT_PREFS: Preferences = {
  playMusicOnStart: true,
  notificationsEnabled: false,
  alwaysOnTop: true,
  recentAllowedApps: [],
  recentAllowedSites: [],
  strictModeDefault: false,
  musicUrl: "https://soundcloud.com/wearetwolanes/two-lanes-essence",
  lastActiveTaskId: null,
  themeMode: "mono",
  appearanceMode: "auto",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours} hr ${minutes} min`;
  }
  return `${Math.max(1, minutes)} min`;
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function parseTaskLine(line: string) {
  const raw = line.trim();
  if (!raw) {
    return { title: "", durationSeconds: 0 };
  }

  const hourMatch = raw.match(/(\d{1,2})\s*(?:hours?|hrs?|hr|h)\b/i);
  const minMatch = raw.match(/(\d{1,3})\s*(?:minutes?|mins?|min|m)\b/i);
  const secMatch = raw.match(/(\d{1,3})\s*(?:seconds?|secs?|sec|s)\b/i);

  const hours = hourMatch ? Number(hourMatch[1]) : 0;
  const mins = minMatch ? Number(minMatch[1]) : 0;
  const secs = secMatch ? Number(secMatch[1]) : 0;
  const parsedDuration = clamp(hours * 3600 + mins * 60 + secs, 0, 4 * 3600);

  const title = raw
    .replace(/^\s*i\s+will\s+/i, "")
    .replace(/\b(?:in|for)\s+\d{1,2}\s*(?:hours?|hrs?|hr|h)\b/gi, "")
    .replace(/\b(?:in|for)\s+\d{1,3}\s*(?:minutes?|mins?|min|m)\b/gi, "")
    .replace(/\b(?:in|for)\s+\d{1,3}\s*(?:seconds?|secs?|sec|s)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: title || raw,
    durationSeconds: parsedDuration,
  };
}

function getInputValidationMessage(rawLine: string): InputValidationMessage | null {
  const raw = rawLine.trim();
  const parsed = parseTaskLine(rawLine);
  const vagueTitles = new Set(["task", "work", "thing", "project", "stuff", "todo"]);

  if (!raw) {
    return {
      title: "Complete the task description",
      body: "Write a specific task and estimate the time you want to take for it.",
    };
  }

  if (!parsed.title || parsed.title.length < 4 || vagueTitles.has(parsed.title.toLowerCase())) {
    return {
      title: "Write a specific task",
      body: "Name the actual thing you want to finish, not just a general placeholder.",
    };
  }

  if (parsed.durationSeconds <= 0) {
    return {
      title: "Estimate the time",
      body: "Determine the time it takes for you to finish this, like 'Write landing page copy for 25 min'.",
    };
  }

  return null;
}

function buildTimeline(durationSeconds: number) {
  const checkpointCount = durationSeconds >= 45 * 60 ? 5 : 4;
  const checkpoints = Array.from({ length: checkpointCount }, (_, index) => {
    const step = (index + 1) / (checkpointCount + 1);
    const jitter = (Math.random() - 0.5) * 0.18;
    const ratio = clamp(step + jitter, 0.08, 0.92);
    return clamp(Math.floor(durationSeconds * ratio), 15, Math.max(durationSeconds - 10, 15));
  });
  return Array.from(new Set(checkpoints)).sort((a, b) => a - b);
}

function createNudge(taskTitle: string, progress: number, remainingSeconds: number) {
  const remainingMin = Math.max(1, Math.ceil(remainingSeconds / 60));
  if (progress < 0.2) {
    return {
      title: "Start now",
      body: `Begin ${taskTitle} with one clear first action.`,
    };
  }
  if (progress < 0.7) {
    return {
      title: "Stay with it",
      body: `${remainingMin} min left. Keep going on ${taskTitle}.`,
    };
  }
  return {
    title: "Time is running out",
    body: `${remainingMin} min left. Do you need more time for ${taskTitle}?`,
  };
}

function formatConfidenceLabel(confidence: number) {
  if (confidence >= 0.82) {
    return "high confidence";
  }
  if (confidence >= 0.58) {
    return "medium confidence";
  }
  return "low confidence";
}

function getSoundCloudEmbedUrl(rawUrl: string, autoplay: boolean) {
  try {
    const url = new URL(rawUrl.trim());
    if (!url.hostname.includes("soundcloud.com")) {
      return null;
    }
    const params = new URLSearchParams({
      url: rawUrl.trim(),
      auto_play: autoplay ? "true" : "false",
      visual: "false",
      show_comments: "false",
      show_user: "true",
      buying: "false",
      sharing: "false",
      download: "false",
    });
    return `https://w.soundcloud.com/player/?${params.toString()}`;
  } catch {
    return null;
  }
}

function getMusicLabel(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const slug = url.pathname.split("/").filter(Boolean).pop() ?? "track";
    return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  } catch {
    return "Focus soundtrack";
  }
}

function loadLocal<T>(key: string, fallback: T) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveLocal<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures and keep runtime state.
  }
}

function resolveAppearancePreference(
  appearanceMode: AppearanceMode,
  prefersDarkMode: boolean,
): ResolvedAppearance {
  if (appearanceMode === "light") {
    return "light";
  }
  if (appearanceMode === "dark") {
    return "dark";
  }
  return prefersDarkMode ? "dark" : "light";
}

function playAlertTone(level: number) {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = level >= 2 ? 760 : 620;
    gainNode.gain.value = level >= 2 ? 0.08 : 0.05;
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.22);
    oscillator.onended = () => void context.close();
  } catch {
    // Ignore audio failures.
  }
}

function DockGlyph({
  kind,
  className,
}: {
  kind:
    | "pin"
    | "nudges"
    | "strict"
    | "history"
    | "music"
    | "settings"
    | "play"
    | "pause"
    | "open"
    | "hide"
    | "done"
    | "stop";
  className?: string;
}) {
  if (kind === "pin") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M8 4.5h8v3.5l2 2v1H6v-1l2-2V4.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M12 11v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "nudges") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="7.2" stroke="currentColor" strokeWidth="1.8" strokeDasharray="1.2 2.4" />
      </svg>
    );
  }

  if (kind === "strict") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="7.6" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="12" cy="12" r="3.3" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }

  if (kind === "history") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="7.4" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 8v4.2l2.8 1.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "settings") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 6h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M7 12h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M7 18h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="10" cy="6" r="2.2" fill="white" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="14" cy="12" r="2.2" fill="white" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="9" cy="18" r="2.2" fill="white" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }

  if (kind === "play") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M9 7.2v9.6l7.6-4.8L9 7.2Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "pause") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M9 7v10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M15 7v10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "open") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M13 6h5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18 6l-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path
          d="M16 13.5V17a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 17V9.5A1.5 1.5 0 0 1 7 8h3.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "hide") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 7l10 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M17 7L7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "done") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M6.5 12.5 10 16l7.5-8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "stop") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 7L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M17 7L7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10 18V8.5c0-.9.7-1.5 1.6-1.4l6.1.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8.5" cy="18" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="16.8" cy="16.1" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function MainApp() {
  const [tasks, setTasks] = useState<Task[]>(() => loadLocal(TASKS_STORAGE_KEY, [] as Task[]));
  const [history, setHistory] = useState<HistoryEntry[]>(
    () => loadLocal(HISTORY_STORAGE_KEY, [] as HistoryEntry[]),
  );
  const [prefs, setPrefs] = useState<Preferences>(() => ({
    ...DEFAULT_PREFS,
    ...loadLocal<Partial<Preferences>>(PREFS_STORAGE_KEY, {}),
  }));

  const [phase, setPhase] = useState<Phase>("idle");
  const [inputLine, setInputLine] = useState("");
  const [inputError, setInputError] = useState<InputValidationMessage | null>(null);
  const [activeSession, setActiveSession] = useState<FocusSession | null>(null);
  const [timeline, setTimeline] = useState<number[]>([]);
  const [lastPrompt, setLastPrompt] = useState("Set a task and time to begin.");

  const [showHistory, setShowHistory] = useState(false);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [reflectionOpen, setReflectionOpen] = useState(false);
  const [reflectionText, setReflectionText] = useState("");
  const [pendingHistoryEntry, setPendingHistoryEntry] = useState<HistoryEntry | null>(null);

  const [strictSetupOpen, setStrictSetupOpen] = useState(false);
  const [strictSetupTaskId, setStrictSetupTaskId] = useState<string | null>(null);
  const [screenPermissionStatus, setScreenPermissionStatus] = useState("unknown");
  const [hoverHint, setHoverHint] = useState<HoverHint | null>(null);
  const [desktopCapabilities, setDesktopCapabilities] = useState<DesktopCapabilities>({
    screenshotStrictModeAvailable: false,
    screenRecordingPermissionStatus: "unknown",
    appStoreBuild: false,
  });
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [strictIntroState, setStrictIntroState] = useState<StrictIntroState>({
    consentChecked: false,
    error: null,
    submitting: false,
    backendMessage: null,
  });
  const [strictBackendHealth, setStrictBackendHealth] = useState<{
    reachable: boolean;
    message: string | null;
  }>({
    reachable: false,
    message: hasStrictVisionBackend() ? "Checking Tempo backend..." : "Tempo backend URL is not configured.",
  });

  const [musicOpen, setMusicOpen] = useState(false);
  const [musicAutoplayNonce, setMusicAutoplayNonce] = useState(0);
  const [musicReady, setMusicReady] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [prefersDarkMode, setPrefersDarkMode] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false,
  );

  const tickStartedAt = useRef<number | null>(null);
  const pausedRemaining = useRef(0);
  const firedMarkers = useRef<Set<number>>(new Set());
  const completionHandled = useRef(false);
  const strictViolation = useRef<StrictViolationState>({
    consecutive: 0,
    lastMessageAt: 0,
    recentClassifications: [],
  });

  const widgetRef = useRef<HTMLDivElement | null>(null);
  const dragOffset = useRef<{ x: number; y: number } | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const soundCloudFrameRef = useRef<HTMLIFrameElement | null>(null);
  const soundCloudWidgetRef = useRef<SoundCloudWidget | null>(null);

  const isDesktop = Boolean(window.desktopBridge?.isDesktop);
  const figmaState = new URLSearchParams(window.location.search).get("figmaState");
  const isFigmaPreview = Boolean(figmaState);
  const parsedInput = parseTaskLine(inputLine);
  const activeTask = activeSession
    ? tasks.find((task) => task.id === activeSession.taskId) ?? null
    : null;
  const visibleTasks = tasks.filter((task) => task.status !== "done").slice(0, 4);
  const hiddenTaskCount = tasks.filter((task) => task.status !== "done").length - visibleTasks.length;
  const runningNeedsExtension =
    activeSession !== null &&
    phase === "running" &&
    activeSession.secondsLeft <= Math.max(60, Math.floor(activeSession.plannedSeconds * 0.15));
  const soundCloudUrl = getSoundCloudEmbedUrl(prefs.musicUrl, musicAutoplayNonce > 0);
  const musicLabel = getMusicLabel(prefs.musicUrl);
  const totalFocusedSeconds = history.reduce((sum, entry) => sum + entry.focusedSeconds, 0);
  const progressRatio =
    activeSession && activeSession.plannedSeconds > 0
      ? clamp(
          (activeSession.plannedSeconds - activeSession.secondsLeft) / activeSession.plannedSeconds,
          0,
          1,
        )
      : 0;
  const resolvedAppearance = resolveAppearancePreference(prefs.appearanceMode, prefersDarkMode);
  const strictVisionReady =
    isDesktop &&
    desktopCapabilities.screenshotStrictModeAvailable &&
    hasStrictVisionBackend() &&
    strictBackendHealth.reachable;

  useEffect(() => {
    if (isFigmaPreview) {
      return;
    }
    saveLocal(TASKS_STORAGE_KEY, tasks);
  }, [isFigmaPreview, tasks]);

  useEffect(() => {
    if (isFigmaPreview) {
      return;
    }
    saveLocal(HISTORY_STORAGE_KEY, history);
  }, [history, isFigmaPreview]);

  useEffect(() => {
    if (isFigmaPreview) {
      return;
    }
    saveLocal(PREFS_STORAGE_KEY, prefs);
  }, [isFigmaPreview, prefs]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const syncPreference = (event?: MediaQueryListEvent) => {
      setPrefersDarkMode(event?.matches ?? mediaQuery.matches);
    };

    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);
    return () => mediaQuery.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("theme-mist", prefs.themeMode === "mist");
    document.body.classList.toggle("theme-dark", resolvedAppearance === "dark");
    return () => {
      document.body.classList.remove("theme-mist", "theme-dark");
    };
  }, [prefs.themeMode, resolvedAppearance]);

  useEffect(() => {
    if (!figmaState) {
      return;
    }

    const now = Date.now();
    const sampleTasks: Task[] = [
      {
        id: "preview-active",
        title: "Finish the onboarding draft",
        plannedSeconds: 25 * 60,
        status: "active",
        createdAt: now - 60_000,
      },
      {
        id: "preview-next",
        title: "Reply to the investor notes",
        plannedSeconds: 15 * 60,
        status: "pending",
        createdAt: now - 40_000,
      },
      {
        id: "preview-third",
        title: "Review push notification copy",
        plannedSeconds: 10 * 60,
        status: "pending",
        createdAt: now - 20_000,
      },
    ];

    const sampleHistory: HistoryEntry[] = [
      {
        id: "history-1",
        taskId: "h1",
        taskTitle: "Ship the mini timer window",
        intention: "Ship the mini timer window",
        plannedSeconds: 1800,
        focusedSeconds: 1680,
        startedAt: now - 7_200_000,
        endedAt: now - 5_520_000,
        reflection: "The flow feels clear now. Need one more pass on icon balance.",
        neededMoreTime: true,
        status: "completed",
        strictModeEnabled: false,
      },
      {
        id: "history-2",
        taskId: "h2",
        taskTitle: "Write strict mode copy",
        intention: "Write strict mode copy",
        plannedSeconds: 900,
        focusedSeconds: 720,
        startedAt: now - 4_200_000,
        endedAt: now - 3_480_000,
        reflection: "Good direction, but the onboarding text should be calmer.",
        neededMoreTime: false,
        status: "interrupted",
        strictModeEnabled: true,
      },
    ];

    const sampleSession: FocusSession = {
      taskId: "preview-active",
      startedAt: now - 8 * 60_000,
      plannedSeconds: 25 * 60,
      secondsLeft: 11 * 60 + 24,
      strictModeEnabled: figmaState === "strict",
      strictModeKind: "vision",
      strictSessionId: "preview-session",
      lastAnalysisResult: {
        classification: "uncertain",
        reason: "Looks like a transition between focus screens.",
        confidence: 0.58,
        suggestedNudge: "Return to the onboarding draft if you are done switching.",
        nextRecommendedCaptureDelayMs: 9000,
      },
      analysisCooldownUntil: now + 9000,
    };

    setTasks(sampleTasks);
    setHistory(sampleHistory);
    setInputLine("Plan onboarding email for 18 min");
    setInputError(null);
    setLastPrompt("Stay with it. 12 min left. Keep going on Finish the onboarding draft.");
    setShowHistory(figmaState === "history");
    setShowAllTasks(false);
    setShowSettings(figmaState === "settings");
    setReflectionOpen(figmaState === "reflection");
    setReflectionText("The work moved forward, but I want 5 more min to tighten the copy.");
    setPendingHistoryEntry({
      id: "pending-preview",
      taskId: "preview-active",
      taskTitle: "Finish the onboarding draft",
      intention: "Finish the onboarding draft",
      plannedSeconds: 1500,
      focusedSeconds: 1500,
      startedAt: now - 1_500_000,
      endedAt: now,
      reflection: "",
      neededMoreTime: false,
      status: "completed",
      strictModeEnabled: false,
    });
    setStrictSetupOpen(figmaState === "strict");
    setStrictSetupTaskId("preview-active");
    setScreenPermissionStatus("granted");
    setDesktopCapabilities({
      screenshotStrictModeAvailable: true,
      screenRecordingPermissionStatus: "granted",
      appStoreBuild: false,
    });
    setStrictIntroState({
      consentChecked: true,
      error: null,
      submitting: false,
      backendMessage: "Beta access enabled. Screenshots are analyzed and then discarded.",
    });
    setHoverHint(null);
    setMusicOpen(figmaState === "music");
    setMusicAutoplayNonce(0);
    setActiveSession(figmaState === "notifications" ? sampleSession : sampleSession);
    setPhase(figmaState === "reflection" ? "completed" : "running");
    setTimeline(buildTimeline(sampleSession.plannedSeconds));
    pausedRemaining.current = sampleSession.secondsLeft;
    firedMarkers.current = new Set();

    const hintMap: Record<string, InputValidationMessage> = {
      "hint-pin": {
        title: "Pin on top",
        body: "Keeps the mini timer floating above your other apps while you work.",
      },
      "hint-nudges": {
        title: "Nudges",
        body: "Enables gentle notifications and check-ins while your focus session is running.",
      },
      "hint-strict": {
        title: "Strict mode",
        body: "Captures periodic screenshots during a focus block, checks them with Gemini, and escalates if you drift.",
      },
      "hint-history": {
        title: "History",
        body: "Shows saved focus sessions, reflections, and totals stored locally on this Mac.",
      },
      "hint-music": {
        title: "Music",
        body: "Shows or hides the compact player for the current session.",
      },
      "hint-settings": {
        title: "Settings",
        body: "Adjust the app theme and soundtrack behavior without changing the player view.",
      },
    };

    if (hintMap[figmaState]) {
      const buttonIndex = {
        "hint-pin": 0,
        "hint-nudges": 1,
        "hint-strict": 2,
        "hint-history": 3,
        "hint-music": 4,
        "hint-settings": 5,
      }[figmaState] ?? 0;

      setHoverHint({
        ...hintMap[figmaState],
        left: 96 + buttonIndex * 96,
        top: window.innerHeight - 118,
      });
    }
  }, [figmaState]);

  useEffect(() => {
    if (!window.desktopBridge) {
      return;
    }
    void Promise.all([
      window.desktopBridge.getMiniAlwaysOnTop(),
      window.desktopBridge.getDesktopCapabilities(),
    ]).then(([isPinned, capabilities]) => {
      setPrefs((current) => ({ ...current, alwaysOnTop: isPinned }));
      setDesktopCapabilities(capabilities);
      setScreenPermissionStatus(capabilities.screenRecordingPermissionStatus);
    });
  }, []);

  useEffect(() => {
    if (!supabaseClient) {
      return;
    }

    void supabaseClient.auth.getSession().then(({ data, error }) => {
      if (error) {
        setAuthError(error.message);
        return;
      }
      setAuthSession(data.session);
      if (data.session?.user.email) {
        setAuthEmail(data.session.user.email);
      }
    });

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      setAuthSession(session);
      if (session?.user.email) {
        setAuthEmail(session.user.email);
      }
      setAuthError(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!hasStrictVisionBackend()) {
      setStrictBackendHealth({
        reachable: false,
        message: "Tempo backend URL is not configured.",
      });
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;

    const checkHealth = async () => {
      const health = await getStrictVisionBackendHealth();
      if (cancelled) {
        return;
      }

      setStrictBackendHealth({
        reachable: health.ok,
        message: health.message,
      });

      if (!health.ok) {
        retryTimer = window.setTimeout(() => {
          void checkHealth();
        }, 1500);
      }
    };

    void checkHealth();

    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, []);

  useEffect(() => {
    if (!soundCloudUrl || typeof window === "undefined") {
      return;
    }

    if (document.getElementById("soundcloud-widget-api")) {
      return;
    }

    const script = document.createElement("script");
    script.id = "soundcloud-widget-api";
    script.src = "https://w.soundcloud.com/player/api.js";
    script.async = true;
    document.body.appendChild(script);
  }, [soundCloudUrl]);

  useEffect(() => {
    if (!soundCloudUrl || !soundCloudFrameRef.current) {
      return;
    }

    const attachWidget = () => {
      const soundCloud = (window as Window & {
        SC?: {
          Widget: ((iframe: HTMLIFrameElement) => SoundCloudWidget) & {
            Events?: Record<string, string>;
          };
        };
      }).SC;

      if (!soundCloud?.Widget) {
        window.setTimeout(attachWidget, 250);
        return;
      }

      const widget = soundCloud.Widget(soundCloudFrameRef.current!);
      soundCloudWidgetRef.current = widget;
      const readyEvent = soundCloud.Widget.Events?.READY ?? "ready";
      const playEvent = soundCloud.Widget.Events?.PLAY ?? "play";
      const pauseEvent = soundCloud.Widget.Events?.PAUSE ?? "pause";
      const finishEvent = soundCloud.Widget.Events?.FINISH ?? "finish";

      widget.bind(readyEvent, () => {
        setMusicReady(true);
        if (musicOpen) {
          widget.play();
        }
      });
      widget.bind(playEvent, () => setMusicPlaying(true));
      widget.bind(pauseEvent, () => setMusicPlaying(false));
      widget.bind(finishEvent, () => {
        if (musicOpen) {
          widget.play();
          return;
        }
        setMusicPlaying(false);
      });
    };

    setMusicReady(false);
    setMusicPlaying(false);
    attachWidget();
  }, [soundCloudUrl, musicAutoplayNonce, musicOpen]);

  useEffect(() => {
    if (!window.desktopBridge?.updateMiniState) {
      return;
    }
    const nextState: MiniWindowState = activeTask && activeSession
      ? {
          active: true,
          taskTitle: activeTask.title,
          timeLabel: formatTime(activeSession.secondsLeft),
          durationLabel: formatDuration(activeSession.plannedSeconds),
          progressRatio,
          phase,
          pinned: prefs.alwaysOnTop,
          themeMode: prefs.themeMode,
          appearance: resolvedAppearance,
        }
      : {
          active: false,
          taskTitle: "",
          timeLabel: "00:00",
          durationLabel: "",
          progressRatio: 0,
          phase: "idle",
          pinned: prefs.alwaysOnTop,
          themeMode: prefs.themeMode,
          appearance: resolvedAppearance,
        };

    window.desktopBridge.updateMiniState(nextState);
  }, [
    activeSession,
    activeTask,
    phase,
    prefs.alwaysOnTop,
    prefs.themeMode,
    progressRatio,
    resolvedAppearance,
  ]);

  useEffect(() => {
    if (phase !== "running" || !activeSession) {
      return;
    }

    tickStartedAt.current = Date.now();
    const anchorRemaining = pausedRemaining.current;

    const intervalId = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - (tickStartedAt.current ?? Date.now())) / 1000);
      const nextRemaining = Math.max(anchorRemaining - elapsed, 0);
      setActiveSession((current) =>
        current ? { ...current, secondsLeft: nextRemaining } : current,
      );

      if (nextRemaining === 0) {
        setPhase("completed");
        pausedRemaining.current = 0;
        window.clearInterval(intervalId);
      }
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [phase, activeSession?.taskId]);

  useEffect(() => {
    if (phase !== "running" || !activeSession || !activeTask) {
      return;
    }

    for (const marker of timeline) {
      if (
        activeSession.secondsLeft > activeSession.plannedSeconds - marker ||
        firedMarkers.current.has(marker)
      ) {
        continue;
      }

      firedMarkers.current.add(marker);
      const progress =
        activeSession.plannedSeconds === 0
          ? 0
          : (activeSession.plannedSeconds - activeSession.secondsLeft) / activeSession.plannedSeconds;
      const nudge = createNudge(activeTask.title, progress, activeSession.secondsLeft);
      setLastPrompt(`${nudge.title}: ${nudge.body}`);
      if (prefs.notificationsEnabled && "Notification" in window) {
        new Notification(nudge.title, { body: nudge.body, silent: false });
      }
    }
  }, [activeSession, activeTask, phase, prefs.notificationsEnabled, timeline]);

  useEffect(() => {
    if (
      phase !== "running" ||
      !activeSession ||
      !activeTask ||
      !activeSession.strictModeEnabled ||
      activeSession.strictModeKind !== "vision" ||
      !activeSession.strictSessionId ||
      !window.desktopBridge ||
      !strictVisionReady
    ) {
      strictViolation.current = { consecutive: 0, lastMessageAt: 0, recentClassifications: [] };
      return;
    }

    if (screenPermissionStatus !== "granted") {
      setLastPrompt("Strict beta is paused until Screen Recording permission is granted.");
      return;
    }

    let cancelled = false;
    const delayMs = Math.max(
      8_000,
      activeSession.analysisCooldownUntil > Date.now()
        ? activeSession.analysisCooldownUntil - Date.now()
        : 8_000,
    );

    const timeoutId = window.setTimeout(async () => {
      try {
        const token = await getAccessToken(authSession);

        const capture = await window.desktopBridge?.captureVisionFrame({
          maxDimension: 1280,
          format: "jpeg",
          quality: 0.72,
        });

        if (!capture || cancelled) {
          return;
        }

        const strictSessionId = activeSession.strictSessionId;
        if (!strictSessionId) {
          return;
        }

        const analysis = await analyzeStrictVisionFrame(token, {
          sessionId: strictSessionId,
          taskTitle: activeTask.title,
          taskIntention: activeTask.title,
          imageBase64: capture.imageBase64,
          mimeType: capture.mimeType,
          recentClassifications: strictViolation.current.recentClassifications,
          enforcementLevel: strictViolation.current.consecutive,
        });

        if (cancelled) {
          return;
        }

        strictViolation.current.recentClassifications = [
          ...strictViolation.current.recentClassifications.slice(-2),
          analysis.classification,
        ];

        setActiveSession((current) =>
          current && current.strictSessionId === activeSession.strictSessionId
            ? {
                ...current,
                lastAnalysisResult: analysis,
                analysisCooldownUntil: Date.now() + Math.max(8_000, analysis.nextRecommendedCaptureDelayMs),
              }
            : current,
        );

        const confidenceLabel = formatConfidenceLabel(analysis.confidence);

        if (analysis.classification === "on_task") {
          strictViolation.current = {
            consecutive: 0,
            lastMessageAt: Date.now(),
            recentClassifications: strictViolation.current.recentClassifications,
          };
          setLastPrompt(analysis.suggestedNudge || `On track. ${activeTask.title} is still the focus.`);
          return;
        }

        if (analysis.classification === "uncertain") {
          setLastPrompt(`Strict beta: ${analysis.reason} (${confidenceLabel}).`);
          return;
        }

        const nextConsecutive = strictViolation.current.consecutive + 1;
        strictViolation.current = {
          consecutive: nextConsecutive,
          lastMessageAt: Date.now(),
          recentClassifications: strictViolation.current.recentClassifications,
        };

        const message = `${analysis.reason} (${confidenceLabel}). ${analysis.suggestedNudge}`;
        setLastPrompt(`Strict beta: ${message}`);

        if (prefs.notificationsEnabled && "Notification" in window) {
          new Notification("Strict beta", {
            body: message,
            silent: nextConsecutive === 1,
          });
        }

        void sendStrictVisionEvent(token, {
          sessionId: strictSessionId,
          eventType: nextConsecutive >= 2 ? "strict_alert" : "strict_warning",
          taskTitle: activeTask.title,
          detail: analysis.reason,
        }).catch(() => {});

        if (nextConsecutive >= 2) {
          playAlertTone(nextConsecutive);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Strict beta analysis failed.";
          setLastPrompt(`Strict beta: ${message}`);
        }
      }
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    activeSession,
    activeTask,
    phase,
    prefs.notificationsEnabled,
    screenPermissionStatus,
    strictVisionReady,
  ]);

  useEffect(() => {
    if (phase !== "completed" || !activeSession || !activeTask) {
      completionHandled.current = false;
      return;
    }
    if (completionHandled.current) {
      return;
    }
    completionHandled.current = true;

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      taskId: activeTask.id,
      taskTitle: activeTask.title,
      intention: activeTask.title,
      plannedSeconds: activeSession.plannedSeconds,
      focusedSeconds: activeSession.plannedSeconds,
      startedAt: activeSession.startedAt,
      endedAt: Date.now(),
      reflection: "",
      neededMoreTime: false,
      status: "completed",
      strictModeEnabled: activeSession.strictModeEnabled,
    };

    setPendingHistoryEntry(entry);
    setReflectionText("");
    setReflectionOpen(true);
    setLastPrompt("Nice work. How did it go? Need more time?");

    if (prefs.notificationsEnabled && "Notification" in window) {
      new Notification("Session complete", {
        body: "Nice work. How did it go? Need more time?",
      });
    }
  }, [activeSession, activeTask, phase, prefs.notificationsEnabled]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragOffset.current || !widgetRef.current) {
        return;
      }
      const width = widgetRef.current.offsetWidth;
      const height = widgetRef.current.offsetHeight;
      const nextX = clamp(event.clientX - dragOffset.current.x, 8, window.innerWidth - width - 8);
      const nextY = clamp(event.clientY - dragOffset.current.y, 8, window.innerHeight - height - 8);
      widgetRef.current.style.left = `${nextX}px`;
      widgetRef.current.style.top = `${nextY}px`;
      widgetRef.current.style.right = "auto";
    };
    const up = () => {
      dragOffset.current = null;
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  function updatePrefs(next: Partial<Preferences>) {
    setPrefs((current) => ({ ...current, ...next }));
  }

  function updateTasks(updater: (current: Task[]) => Task[]) {
    setTasks((current) => updater(current));
  }

  function appendHistory(entry: HistoryEntry) {
    setHistory((current) => [entry, ...current].slice(0, 200));
  }

  async function togglePin() {
    if (!window.desktopBridge) {
      return;
    }
    const next = await window.desktopBridge.setMiniAlwaysOnTop(!prefs.alwaysOnTop);
    updatePrefs({ alwaysOnTop: next });
  }

  async function toggleNotifications() {
    if (!("Notification" in window)) {
      return;
    }
    const permission = await Notification.requestPermission();
    updatePrefs({ notificationsEnabled: permission === "granted" });
  }

  function toggleHistoryPanel() {
    setShowHistory((current) => !current);
  }

  function toggleMusicPanel() {
    setMusicOpen((current) => !current);
  }

  function toggleSettingsPanel() {
    setShowSettings((current) => !current);
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!widgetRef.current || isDesktop) {
      return;
    }
    const rect = widgetRef.current.getBoundingClientRect();
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function queueHoverHint(
    event: ReactPointerEvent<HTMLButtonElement>,
    title: string,
    body: string,
  ) {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
    }
    const buttonRect = event.currentTarget.getBoundingClientRect();
    hoverTimer.current = window.setTimeout(() => {
      const tooltipWidth = 230;
      const sidePadding = 18;
      const centerX = buttonRect.left + buttonRect.width / 2;
      const left = clamp(
        centerX,
        tooltipWidth / 2 + sidePadding,
        window.innerWidth - tooltipWidth / 2 - sidePadding,
      );
      const top =
        buttonRect.bottom + 12 + 96 > window.innerHeight
          ? buttonRect.top - 104
          : buttonRect.bottom + 12;

      setHoverHint({
        title,
        body,
        left,
        top,
      });
    }, 1000);
  }

  function clearHoverHint() {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHoverHint(null);
  }

  function endCurrentSession(status: HistoryStatus) {
    if (!activeSession || !activeTask) {
      return;
    }

    const focusedSeconds = Math.max(activeSession.plannedSeconds - activeSession.secondsLeft, 0);
    if (focusedSeconds > 0) {
      appendHistory({
        id: crypto.randomUUID(),
        taskId: activeTask.id,
        taskTitle: activeTask.title,
        intention: activeTask.title,
        plannedSeconds: activeSession.plannedSeconds,
        focusedSeconds,
        startedAt: activeSession.startedAt,
        endedAt: Date.now(),
        reflection: "",
        neededMoreTime: false,
        status,
        strictModeEnabled: activeSession.strictModeEnabled,
      });
    }

    updateTasks((current) =>
      current.map((task) =>
        task.id === activeTask.id
          ? { ...task, status: status === "completed" ? "done" : "pending" }
          : task.status === "active"
            ? { ...task, status: "pending" }
            : task,
      ),
    );

    setActiveSession(null);
    setPhase("idle");
    setTimeline([]);
    pausedRemaining.current = 0;
    firedMarkers.current = new Set();

    if (
      activeSession.strictModeEnabled &&
      activeSession.strictModeKind === "vision" &&
      activeSession.strictSessionId &&
      authSession
    ) {
      const strictSessionId = activeSession.strictSessionId;
      void (async () => {
        try {
          const token = await getAccessToken(authSession);
          if (!token) {
            return;
          }
          await sendStrictVisionEvent(token, {
            sessionId: strictSessionId,
            eventType: status === "completed" ? "session_completed" : "session_interrupted",
            taskTitle: activeTask.title,
          });
        } catch {
          // Ignore strict beta session end telemetry failures.
        }
      })();
    }
  }

  function startTask(taskId: string, strictConfig?: StrictModeSessionConfig) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return;
    }

    if (activeSession && activeSession.taskId !== taskId && phase !== "completed") {
      endCurrentSession("interrupted");
    }

    updateTasks((current) =>
      current.map((item) => ({
        ...item,
        status: item.id === taskId ? "active" : item.status === "active" ? "pending" : item.status,
      })),
    );

    const nextSession: FocusSession = {
      taskId,
      startedAt: Date.now(),
      plannedSeconds: task.plannedSeconds,
      secondsLeft: task.plannedSeconds,
      strictModeEnabled: strictConfig?.enabled ?? false,
      strictModeKind: strictConfig?.kind ?? "vision",
      strictSessionId: strictConfig?.sessionId ?? null,
      lastAnalysisResult: null,
      analysisCooldownUntil: Date.now() + 8_000,
    };

    setActiveSession(nextSession);
    setPhase("running");
    setTimeline(buildTimeline(task.plannedSeconds));
    pausedRemaining.current = task.plannedSeconds;
    firedMarkers.current = new Set();
    updatePrefs({ lastActiveTaskId: taskId });
    setLastPrompt(`Great. Start now: ${task.title}`);

    if (prefs.playMusicOnStart && prefs.musicUrl.trim()) {
      setMusicOpen(true);
      setMusicAutoplayNonce((current) => current + 1);
    }
  }

  async function signInToStrictBeta() {
    if (!supabaseClient) {
      setAuthError("Supabase is not configured for this build.");
      return;
    }
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError("Enter your email and password to use strict beta.");
      return;
    }

    setAuthBusy(true);
    setAuthError(null);
    const { error } = await supabaseClient.auth.signInWithPassword({
      email: authEmail.trim(),
      password: authPassword,
    });
    setAuthBusy(false);
    if (error) {
      setAuthError(error.message);
    }
  }

  async function signOutOfStrictBeta() {
    if (!supabaseClient) {
      return;
    }
    await supabaseClient.auth.signOut();
    setAuthPassword("");
  }

  async function launchStrictSetup(taskId: string) {
    const status = await window.desktopBridge?.getScreenPermissionStatus();
    const resolvedStatus = status ?? "unknown";
    setScreenPermissionStatus(resolvedStatus);
    setStrictSetupTaskId(taskId);
    setStrictIntroState({
      consentChecked: false,
      error: null,
      submitting: false,
      backendMessage: strictVisionReady
        ? "Beta mode analyzes screenshots while strict mode is running, then discards them."
        : strictBackendHealth.message ??
          "Strict beta is unavailable until desktop capture and the Tempo backend are configured.",
    });
    setStrictSetupOpen(true);
  }

  async function handleStartFromInput() {
    const validationMessage = getInputValidationMessage(inputLine);
    if (validationMessage) {
      setInputError(validationMessage);
      setLastPrompt(validationMessage.body);
      return;
    }

    const newTask: Task = {
      id: crypto.randomUUID(),
      title: parsedInput.title,
      plannedSeconds: parsedInput.durationSeconds,
      status: "pending",
      createdAt: Date.now(),
    };

    updateTasks((current) => [newTask, ...current]);
    setInputLine("");
    setInputError(null);

    if (prefs.strictModeDefault) {
      await launchStrictSetup(newTask.id);
      return;
    }

    startTask(newTask.id);
  }

  async function handleStartExistingTask(taskId: string) {
    if (!prefs.strictModeDefault) {
      startTask(taskId);
      return;
    }
    await launchStrictSetup(taskId);
  }

  async function confirmStrictSetup() {
    if (!strictSetupTaskId) {
      return;
    }

    if (!strictVisionReady) {
      setStrictIntroState((current) => ({
        ...current,
        error:
          strictBackendHealth.message ??
          "Strict beta is unavailable in this build. Configure Supabase, the Tempo API, and the macOS helper first.",
      }));
      return;
    }

    if (screenPermissionStatus !== "granted") {
      setStrictIntroState((current) => ({
        ...current,
        error: "Grant Screen Recording permission before starting strict beta.",
      }));
      return;
    }

    if (!strictIntroState.consentChecked) {
      setStrictIntroState((current) => ({
        ...current,
        error: "You need to explicitly opt in to screenshot analysis for strict beta.",
      }));
      return;
    }

    try {
      setStrictIntroState((current) => ({ ...current, submitting: true, error: null }));
      const token = await getAccessToken(authSession);
      const task = tasks.find((item) => item.id === strictSetupTaskId);
      if (!task) {
        throw new Error("Unable to create the strict beta session.");
      }

      const session = await createStrictVisionSession(token, task.title, task.title);
      if (!session.enabled || !session.sessionId) {
        setStrictIntroState((current) => ({
          ...current,
          submitting: false,
          backendMessage: session.message,
          error: session.message,
        }));
        return;
      }

      setStrictSetupOpen(false);
      startTask(strictSetupTaskId, {
        enabled: true,
        kind: "vision",
        sessionId: session.sessionId,
      });
      setStrictIntroState({
        consentChecked: false,
        error: null,
        submitting: false,
        backendMessage: session.message,
      });
      setStrictSetupTaskId(null);
    } catch (error) {
      setStrictIntroState((current) => ({
        ...current,
        submitting: false,
        error: error instanceof Error ? error.message : "Unable to start strict beta.",
      }));
    }
  }

  function pauseSession() {
    if (!activeSession) {
      return;
    }
    pausedRemaining.current = activeSession.secondsLeft;
    setPhase("paused");
    setLastPrompt("Paused. Resume when ready.");
  }

  function resumeSession() {
    if (!activeSession) {
      return;
    }
    pausedRemaining.current = activeSession.secondsLeft;
    setPhase("running");
    setLastPrompt(`Back in: ${activeTask?.title ?? "your task"}`);
  }

  function resetSession() {
    endCurrentSession("interrupted");
    setLastPrompt("Set a task and time to begin.");
  }

  function completeSessionNow() {
    if (!activeSession || !activeTask) {
      return;
    }

    const focusedSeconds = Math.max(activeSession.plannedSeconds - activeSession.secondsLeft, 0);
    appendHistory({
      id: crypto.randomUUID(),
      taskId: activeTask.id,
      taskTitle: activeTask.title,
      intention: activeTask.title,
      plannedSeconds: activeSession.plannedSeconds,
      focusedSeconds,
      startedAt: activeSession.startedAt,
      endedAt: Date.now(),
      reflection: "",
      neededMoreTime: false,
      status: "completed",
      strictModeEnabled: activeSession.strictModeEnabled,
    });

    updateTasks((current) =>
      current.map((task) =>
        task.id === activeTask.id
          ? { ...task, status: "done", completedAt: Date.now() }
          : task.status === "active"
            ? { ...task, status: "pending" }
            : task,
      ),
    );

    setPendingHistoryEntry(null);
    setReflectionOpen(false);
    setReflectionText("");
    setActiveSession(null);
    setPhase("idle");
    setTimeline([]);
    pausedRemaining.current = 0;
    firedMarkers.current = new Set();
    setLastPrompt(`Marked ${activeTask.title} done early.`);
  }

  function toggleMusicPlayback() {
    if (!soundCloudWidgetRef.current || !musicReady) {
      return;
    }
    if (musicPlaying) {
      soundCloudWidgetRef.current.pause();
      return;
    }
    soundCloudWidgetRef.current.play();
  }

  function openMusicSource() {
    window.open(prefs.musicUrl, "_blank", "noopener,noreferrer");
  }

  function markTaskDone(taskId: string) {
    updateTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? { ...task, status: "done", completedAt: Date.now() }
          : task,
      ),
    );

    if (activeSession?.taskId === taskId) {
      endCurrentSession("completed");
    }
  }

  function deleteTask(taskId: string) {
    if (activeSession?.taskId === taskId) {
      endCurrentSession("interrupted");
    }
    updateTasks((current) => current.filter((task) => task.id !== taskId));
  }

  function extendSession(minutes: number) {
    if (!activeSession || !activeTask) {
      return;
    }

    if (pendingHistoryEntry) {
      appendHistory({
        ...pendingHistoryEntry,
        reflection: reflectionText.trim(),
        neededMoreTime: true,
      });
      setPendingHistoryEntry(null);
      setReflectionOpen(false);
      setReflectionText("");
    }

    const extraSeconds = minutes * 60;
    const plannedSeconds = extraSeconds;

    updateTasks((current) =>
      current.map((task) =>
        task.id === activeTask.id
          ? { ...task, plannedSeconds }
          : task,
      ),
    );

    setActiveSession({
      ...activeSession,
      plannedSeconds,
      secondsLeft: extraSeconds,
    });
    setTimeline(buildTimeline(extraSeconds));
    pausedRemaining.current = extraSeconds;
    firedMarkers.current = new Set();
    setPhase("running");
    setLastPrompt(`Added ${minutes} more min for ${activeTask.title}.`);
  }

  function saveReflection() {
    if (!pendingHistoryEntry) {
      setReflectionOpen(false);
      return;
    }

    appendHistory({
      ...pendingHistoryEntry,
      reflection: reflectionText.trim(),
      neededMoreTime: false,
    });
    updateTasks((current) =>
      current.map((task) =>
        task.id === pendingHistoryEntry.taskId
          ? { ...task, status: "done", completedAt: Date.now() }
          : task,
      ),
    );
    setPendingHistoryEntry(null);
    setReflectionOpen(false);
    setReflectionText("");
    setActiveSession(null);
    setPhase("idle");
    setTimeline([]);
  }

  useEffect(() => {
    if (!window.desktopBridge?.onMiniCommand) {
      return;
    }
    return window.desktopBridge.onMiniCommand((command) => {
      if (command === "pause" && phase === "running") {
        pauseSession();
      } else if (command === "resume" && phase === "paused") {
        resumeSession();
      } else if (command === "done") {
        completeSessionNow();
      } else if (command === "stop") {
        resetSession();
      } else if (command === "toggle-pin") {
        void togglePin();
      }
    });
  }, [phase, activeSession, prefs.alwaysOnTop]);

  return (
    <main className={isDesktop ? "stage desktop-stage" : "stage"}>
      <section
        className={[
          "lucid-shell",
          musicOpen && soundCloudUrl ? "has-music-footer" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        ref={widgetRef}
      >
        <header className="lucid-header" onPointerDown={beginDrag}>
          <h1>Tempo</h1>
        </header>

        <section className="control-dock control-dock-top">
          <button
            className={prefs.alwaysOnTop ? "icon-chip dock-chip is-active no-drag" : "icon-chip dock-chip no-drag"}
            onClick={togglePin}
            onPointerEnter={(event) =>
              queueHoverHint(
                event,
                "Pin on top",
                "Keeps the mini timer floating above your other apps while you work.",
              )
            }
            onPointerLeave={clearHoverHint}
          >
            <DockGlyph className="chip-icon" kind="pin" />
            <span className="chip-label">Pin</span>
          </button>
          <button
            className={prefs.notificationsEnabled ? "icon-chip dock-chip is-active no-drag" : "icon-chip dock-chip no-drag"}
            onClick={toggleNotifications}
            onPointerEnter={(event) =>
              queueHoverHint(
                event,
                "Nudges",
                "Enables gentle notifications and check-ins while your focus session is running.",
              )
            }
            onPointerLeave={clearHoverHint}
          >
            <DockGlyph className="chip-icon" kind="nudges" />
            <span className="chip-label">Nudges</span>
          </button>
          <button
            className={prefs.strictModeDefault ? "icon-chip dock-chip is-active no-drag" : "icon-chip dock-chip no-drag"}
            disabled={!strictVisionReady}
            onClick={() => updatePrefs({ strictModeDefault: !prefs.strictModeDefault })}
            onPointerEnter={(event) =>
              queueHoverHint(
                event,
                "Strict mode",
                strictVisionReady
                  ? "Beta screenshot analysis checks whether you are staying on task and escalates if you drift."
                  : desktopCapabilities.appStoreBuild
                    ? "Strict beta is unavailable in the App Store build."
                    : "Configure Supabase auth, the Tempo API, and the macOS capture helper to enable strict beta.",
              )
            }
            onPointerLeave={clearHoverHint}
          >
            <DockGlyph className="chip-icon" kind="strict" />
            <span className="chip-label">Strict</span>
          </button>
          <button
            className={showHistory ? "icon-chip dock-chip is-active no-drag" : "icon-chip dock-chip no-drag"}
            onClick={toggleHistoryPanel}
            onPointerEnter={(event) =>
              queueHoverHint(
                event,
                "History",
                "Shows saved focus sessions, reflections, and totals stored locally on this Mac.",
              )
            }
            onPointerLeave={clearHoverHint}
          >
            <DockGlyph className="chip-icon" kind="history" />
            <span className="chip-label">History</span>
          </button>
          <button
            className={musicOpen ? "icon-chip dock-chip is-active no-drag" : "icon-chip dock-chip no-drag"}
            onClick={toggleMusicPanel}
            onPointerEnter={(event) =>
              queueHoverHint(
                event,
                "Music",
                "Shows or hides the compact player for the current session.",
              )
            }
            onPointerLeave={clearHoverHint}
          >
            <DockGlyph className="chip-icon" kind="music" />
            <span className="chip-label">Music</span>
          </button>
          <button
            className={showSettings ? "icon-chip dock-chip is-active no-drag" : "icon-chip dock-chip no-drag"}
            onClick={toggleSettingsPanel}
            onPointerEnter={(event) =>
              queueHoverHint(
                event,
                "Settings",
                "Adjust the app theme and soundtrack behavior without changing the player view.",
              )
            }
            onPointerLeave={clearHoverHint}
          >
            <DockGlyph className="chip-icon" kind="settings" />
            <span className="chip-label">Settings</span>
          </button>
        </section>

        {hoverHint && (
          <div
            className="hover-hint"
            style={{ left: `${hoverHint.left}px`, top: `${hoverHint.top}px` }}
          >
            <strong>{hoverHint.title}</strong>
            <span>{hoverHint.body}</span>
          </div>
        )}

        {figmaState === "notifications" && (
          <section className="notification-stack-preview">
            <article className="notification-card">
              <div className="notification-mark">RT</div>
              <div className="notification-copy">
                <strong>Tempo</strong>
                <span>Stay with it. Keep going on Finish the onboarding draft.</span>
              </div>
            </article>
            <article className="notification-card">
              <div className="notification-mark">RT</div>
              <div className="notification-copy">
                <strong>Tempo</strong>
                <span>Time is running out. Do you need 5 more min for the onboarding draft?</span>
              </div>
            </article>
            <article className="notification-card">
              <div className="notification-mark">RT</div>
              <div className="notification-copy">
                <strong>Tempo</strong>
                <span>Strict beta: this looks off-task. Return to the onboarding draft.</span>
              </div>
            </article>
          </section>
        )}

        {figmaState === "hint-gallery" && (
          <section className="hint-gallery-preview">
            <article className="hover-hint gallery-hint" style={{ left: "86px", top: "52px" }}>
              <strong>Pin on top</strong>
              <span>Keeps the mini timer floating above your other apps while you work.</span>
            </article>
            <article className="hover-hint gallery-hint" style={{ left: "212px", top: "52px" }}>
              <strong>Nudges</strong>
              <span>Enables gentle notifications and check-ins while your focus session is running.</span>
            </article>
            <article className="hover-hint gallery-hint" style={{ left: "338px", top: "52px" }}>
              <strong>Strict mode</strong>
              <span>Analyzes periodic screenshots during a focus block and escalates if you drift.</span>
            </article>
            <article className="hover-hint gallery-hint" style={{ left: "464px", top: "52px" }}>
              <strong>History</strong>
              <span>Shows saved focus sessions, reflections, and totals stored locally on this Mac.</span>
            </article>
            <article className="hover-hint gallery-hint" style={{ left: "590px", top: "52px" }}>
              <strong>Music</strong>
              <span>Shows or hides the compact player for the current session.</span>
            </article>
            <article className="hover-hint gallery-hint" style={{ left: "702px", top: "52px" }}>
              <strong>Settings</strong>
              <span>Adjust the app theme and soundtrack behavior without changing the player view.</span>
            </article>
          </section>
        )}

        <div className="intent-row">
          <input
            value={inputLine}
            onChange={(event) => {
              setInputLine(event.target.value);
              if (inputError) {
                setInputError(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleStartFromInput();
              }
            }}
            placeholder="Write landing page copy for 25 min"
          />
        </div>

        {inputError && (
          <section className="input-error-pop" role="alert" aria-live="polite">
            <strong>{inputError.title}</strong>
            <span>{inputError.body}</span>
          </section>
        )}

        {activeTask && activeSession && (
          <section className="focus-strip">
            <div className="focus-strip-copy">
              <p className="focus-strip-label">
                {phase === "paused" ? "Paused focus block" : "Current focus"}
              </p>
              <p className="focus-strip-task">{activeTask.title}</p>
              <p className="focus-strip-nudge">{lastPrompt}</p>
              {activeSession.strictModeEnabled && activeSession.lastAnalysisResult && (
                <p className="focus-strip-vision">
                  Strict beta: {activeSession.lastAnalysisResult.reason} ({formatConfidenceLabel(activeSession.lastAnalysisResult.confidence)})
                </p>
              )}
            </div>
            <div className="focus-strip-meta">
              <strong>{formatTime(activeSession.secondsLeft)}</strong>
              <span>{formatDuration(activeSession.plannedSeconds)}</span>
            </div>
            {runningNeedsExtension && phase === "running" && (
              <div className="extension-row">
                <span>Need more time?</span>
                <button className="icon-chip" onClick={() => extendSession(5)}>
                  +5 min
                </button>
                <button className="icon-chip" onClick={() => extendSession(10)}>
                  +10 min
                </button>
              </div>
            )}
          </section>
        )}

        <section className="queue-panel">
          <div className="queue-head">
            <h2>Queue</h2>
            {hiddenTaskCount > 0 && (
              <button className="icon-chip" onClick={() => setShowAllTasks(true)}>
                View all
              </button>
            )}
          </div>

          <div className="queue-list">
            {visibleTasks.length === 0 && <p className="queue-empty">No tasks yet.</p>}
            {visibleTasks.map((task) => (
              <article
                className={
                  task.status === "active"
                    ? "queue-item is-active"
                    : activeTask
                      ? "queue-item is-muted"
                      : "queue-item"
                }
                key={task.id}
              >
                <button className="queue-main" onClick={() => void handleStartExistingTask(task.id)}>
                  <strong>{task.title}</strong>
                  <span>{formatDuration(task.plannedSeconds)}</span>
                </button>
                <div className="queue-actions">
                  {task.status !== "done" && (
                    <button className="mini-chip" onClick={() => markTaskDone(task.id)}>
                      Done
                    </button>
                  )}
                  <button className="mini-chip" onClick={() => deleteTask(task.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        {musicOpen && soundCloudUrl && (
          <section className="music-controller">
            <div className="music-controller-copy">
              <strong>{musicLabel}</strong>
              <span>{musicPlaying ? "Playing in the background" : musicReady ? "Paused" : "Loading player"}</span>
            </div>
            <div className="music-controller-actions">
              <button className="mini-chip" onClick={toggleMusicPlayback} disabled={!musicReady}>
                <DockGlyph className="mini-chip-icon" kind={musicPlaying ? "pause" : "play"} />
                <span>{musicPlaying ? "Pause" : "Play"}</span>
              </button>
              <button className="mini-chip" onClick={openMusicSource}>
                <DockGlyph className="mini-chip-icon" kind="open" />
                <span>Open</span>
              </button>
              <button className="mini-chip" onClick={() => setMusicOpen(false)}>
                <DockGlyph className="mini-chip-icon" kind="hide" />
                <span>Hide</span>
              </button>
            </div>
            <iframe
              key={`${soundCloudUrl}-${musicAutoplayNonce}`}
              ref={soundCloudFrameRef}
              className="soundcloud-host"
              src={soundCloudUrl}
              title="Hidden focus music player"
              allow="autoplay; encrypted-media; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              tabIndex={-1}
            />
          </section>
        )}

        {showSettings && (
          <section className="settings-panel floating-drawer">
            <div className="settings-group">
              <span className="settings-label">Appearance</span>
              <div className="settings-segment">
                <button
                  className={prefs.appearanceMode === "auto" ? "mini-chip is-active" : "mini-chip"}
                  onClick={() => updatePrefs({ appearanceMode: "auto" })}
                >
                  Auto
                </button>
                <button
                  className={prefs.appearanceMode === "light" ? "mini-chip is-active" : "mini-chip"}
                  onClick={() => updatePrefs({ appearanceMode: "light" })}
                >
                  Light
                </button>
                <button
                  className={prefs.appearanceMode === "dark" ? "mini-chip is-active" : "mini-chip"}
                  onClick={() => updatePrefs({ appearanceMode: "dark" })}
                >
                  Dark
                </button>
              </div>
            </div>

            <div className="settings-group">
              <span className="settings-label">Palette</span>
              <div className="settings-segment">
                <button
                  className={prefs.themeMode === "mono" ? "mini-chip is-active" : "mini-chip"}
                  onClick={() => updatePrefs({ themeMode: "mono" })}
                >
                  Monochrome
                </button>
                <button
                  className={prefs.themeMode === "mist" ? "mini-chip is-active" : "mini-chip"}
                  onClick={() => updatePrefs({ themeMode: "mist" })}
                >
                  Mist
                </button>
              </div>
            </div>

            <div className="settings-group">
              <span className="settings-label">Music</span>
              <label>
                Music URL
                <input
                  value={prefs.musicUrl}
                  onChange={(event) => updatePrefs({ musicUrl: event.target.value })}
                  placeholder="SoundCloud track URL"
                />
              </label>
              <button
                className={prefs.playMusicOnStart ? "icon-chip is-active" : "icon-chip"}
                onClick={() => updatePrefs({ playMusicOnStart: !prefs.playMusicOnStart })}
              >
                Autoplay on Start
              </button>
            </div>
          </section>
        )}

        {strictSetupOpen && (
          <section className="overlay">
            <article className="modal">
              <h3>Strict beta setup</h3>
              <p>
                Strict beta captures periodic screenshots while your focus session is active, sends
                them to Tempo for Gemini analysis, and discards them after analysis.
              </p>
              <p>Screen Recording permission: {screenPermissionStatus}</p>
              <p>{strictIntroState.backendMessage ?? "No screenshots are retained by default."}</p>
              <div className="modal-actions">
                <button className="icon-chip" onClick={() => void window.desktopBridge?.requestScreenPermission().then(setScreenPermissionStatus)}>
                  Request Access
                </button>
                <button className="icon-chip" onClick={() => void window.desktopBridge?.openScreenPermissionSettings()}>
                  Open Settings
                </button>
                <button className="icon-chip" onClick={() => void window.desktopBridge?.getScreenPermissionStatus().then(setScreenPermissionStatus)}>
                  Refresh
                </button>
              </div>

              {!authSession ? (
                <>
                  <p className="modal-note">
                    Sign-in is optional right now. You can start strict beta as a guest, or sign in
                    if you want to test the account flow too.
                  </p>
                  <label>
                    Tempo beta email
                    <input
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      placeholder="Your password"
                    />
                  </label>
                  <div className="modal-actions">
                    <button className="icon-chip is-active" onClick={() => void signInToStrictBeta()} disabled={authBusy}>
                      {authBusy ? "Signing in..." : "Sign in"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="strict-session-summary">
                  <strong>{authSession.user.email}</strong>
                  <span>Strict beta uses your account so Tempo can rate-limit and protect Gemini usage.</span>
                  <button className="mini-chip" onClick={() => void signOutOfStrictBeta()}>
                    Sign out
                  </button>
                </div>
              )}

              <label className="strict-consent">
                <input
                  type="checkbox"
                  checked={strictIntroState.consentChecked}
                  onChange={(event) =>
                    setStrictIntroState((current) => ({
                      ...current,
                      consentChecked: event.target.checked,
                      error: null,
                    }))
                  }
                />
                <span>I understand Tempo will analyze screenshots during this strict beta session and will not retain them by default.</span>
              </label>
              {authError && <p className="modal-note">{authError}</p>}
              {strictIntroState.error && <p className="modal-note">{strictIntroState.error}</p>}
              <div className="modal-actions">
                <button className="icon-chip" onClick={() => setStrictSetupOpen(false)}>
                  Cancel
                </button>
                <button className="icon-chip is-active" onClick={() => void confirmStrictSetup()} disabled={strictIntroState.submitting}>
                  {strictIntroState.submitting ? "Starting..." : "Start strict beta"}
                </button>
              </div>
            </article>
          </section>
        )}

        {showAllTasks && (
          <section className="overlay">
            <article className="modal">
              <div className="modal-head">
                <h3>All tasks</h3>
                <button className="icon-chip" onClick={() => setShowAllTasks(false)}>
                  Close
                </button>
              </div>
              <div className="modal-list">
                {tasks.map((task) => (
                  <article className="queue-item" key={task.id}>
                    <button className="queue-main" onClick={() => void handleStartExistingTask(task.id)}>
                      <strong>{task.title}</strong>
                      <span>{task.status} | {formatDuration(task.plannedSeconds)}</span>
                    </button>
                    <div className="queue-actions">
                      {task.status !== "done" && (
                        <button className="mini-chip" onClick={() => markTaskDone(task.id)}>
                          Done
                        </button>
                      )}
                      <button className="mini-chip" onClick={() => deleteTask(task.id)}>
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </article>
          </section>
        )}

        {showHistory && (
          <section className="overlay">
            <article className="modal">
              <div className="modal-head">
                <h3>History</h3>
                <button className="icon-chip" onClick={() => setShowHistory(false)}>
                  Close
                </button>
              </div>
              <p className="modal-note">Saved locally on this device only.</p>
              <p className="modal-note">Total focused: {Math.round(totalFocusedSeconds / 60)} min</p>
              <div className="modal-list">
                {history.length === 0 && <p className="modal-note">No sessions yet.</p>}
                {history.map((entry) => (
                  <article className="history-item" key={entry.id}>
                    <strong>{entry.taskTitle}</strong>
                    <span>
                      {Math.round(entry.focusedSeconds / 60)} / {Math.round(entry.plannedSeconds / 60)} min
                    </span>
                    <span>{formatDate(entry.endedAt)}</span>
                    <span>{entry.strictModeEnabled ? "Strict mode" : "Normal mode"}</span>
                    {entry.reflection && <span>{entry.reflection}</span>}
                  </article>
                ))}
              </div>
            </article>
          </section>
        )}
      </section>

      {reflectionOpen && (
        <section className="overlay">
          <article className="modal">
            <h3>How did it go?</h3>
            <p>Quick reflection before you continue.</p>
            <textarea
              rows={4}
              value={reflectionText}
              onChange={(event) => setReflectionText(event.target.value)}
              placeholder="One quick note..."
            />
            <div className="modal-actions">
              <button className="icon-chip" onClick={() => extendSession(5)}>
                +5 min
              </button>
              <button className="icon-chip" onClick={() => extendSession(10)}>
                +10 min
              </button>
              <button className="icon-chip is-active" onClick={saveReflection}>
                Save reflection
              </button>
            </div>
          </article>
        </section>
      )}
    </main>
  );
}

function MiniApp() {
  const [miniState, setMiniState] = useState<MiniWindowState>({
    active: false,
    taskTitle: "",
    timeLabel: "00:00",
    durationLabel: "",
    progressRatio: 0,
    phase: "idle",
    pinned: true,
    themeMode: "mono",
    appearance: "light",
  });

  useEffect(() => {
    const previousBackground = document.body.style.background;
    document.body.style.background = "transparent";
    return () => {
      document.body.style.background = previousBackground;
    };
  }, []);

  useEffect(() => {
    if (!window.desktopBridge?.getMiniState) {
      return;
    }
    void window.desktopBridge.getMiniState().then((state) => {
      if (state) {
        setMiniState(state);
      }
    });
    return window.desktopBridge.onMiniState?.((state) => {
      setMiniState(state);
    });
  }, []);

  useEffect(() => {
    document.body.classList.toggle("theme-mist", miniState.themeMode === "mist");
    document.body.classList.toggle("theme-dark", miniState.appearance === "dark");
    document.body.classList.add("mini-window");
    return () => {
      document.body.classList.remove("theme-mist", "theme-dark", "mini-window");
    };
  }, [miniState.appearance, miniState.themeMode]);

  const ringRadius = 72;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - miniState.progressRatio);

  function sendMiniControl(command: "pause" | "resume" | "stop" | "done" | "toggle-pin") {
    window.desktopBridge?.sendMiniControl(command);
  }

  return (
    <main className="mini-stage">
      <section className="mini-shell">
        <div className="mini-ring-wrap">
          <svg className="mini-ring" viewBox="0 0 180 180">
            <circle className="timer-ring-track" cx="90" cy="90" r={ringRadius} />
            <circle
              className="timer-ring-progress"
              cx="90"
              cy="90"
              r={ringRadius}
              strokeDasharray={ringCircumference}
              strokeDashoffset={ringOffset}
            />
          </svg>
          <div className="mini-center">
            <strong>{miniState.timeLabel}</strong>
            {miniState.active && <span>{miniState.durationLabel}</span>}
          </div>
        </div>

        <div className="mini-copy">
          <p>{miniState.active ? miniState.taskTitle : "No active focus task"}</p>
        </div>

        <div className="mini-actions">
          <button
            className="mini-fab"
            aria-label={miniState.phase === "paused" ? "Resume timer" : "Pause timer"}
            onClick={() =>
              sendMiniControl(miniState.phase === "paused" ? "resume" : "pause")
            }
          >
            <DockGlyph
              className="mini-fab-icon"
              kind={miniState.phase === "paused" ? "play" : "pause"}
            />
          </button>
          <button
            className="mini-fab mini-fab-done"
            aria-label="Mark session done"
            onClick={() => sendMiniControl("done")}
          >
            <DockGlyph className="mini-fab-icon" kind="done" />
          </button>
          <button className="mini-fab" aria-label="Stop timer" onClick={() => sendMiniControl("stop")}>
            <DockGlyph className="mini-fab-icon" kind="stop" />
          </button>
          <button
            className={miniState.pinned ? "mini-fab is-active" : "mini-fab"}
            aria-label={miniState.pinned ? "Unpin mini timer" : "Pin mini timer"}
            onClick={() => sendMiniControl("toggle-pin")}
          >
            <DockGlyph className="mini-fab-icon" kind="pin" />
          </button>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const mode = new URLSearchParams(window.location.search).get("mode");
  return mode === "mini" ? <MiniApp /> : <MainApp />;
}
