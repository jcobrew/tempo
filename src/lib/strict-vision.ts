export type StrictVisionClassification = "on_task" | "off_task" | "uncertain";

export type StrictVisionAnalysis = {
  classification: StrictVisionClassification;
  reason: string;
  confidence: number;
  suggestedNudge: string;
  nextRecommendedCaptureDelayMs: number;
};

export type StrictVisionSessionResponse = {
  enabled: boolean;
  sessionId: string | null;
  message: string;
  betaLabel: string;
  quotas: {
    capturesRemaining: number;
    maxCaptureDimension: number;
  };
};

const API_BASE_URL = import.meta.env.VITE_TEMPO_API_BASE_URL?.trim().replace(/\/$/, "") ?? "";

export function hasStrictVisionBackend() {
  return Boolean(API_BASE_URL);
}

export async function getStrictVisionBackendHealth() {
  if (!API_BASE_URL) {
    return { ok: false, message: "Tempo backend URL is not configured." };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/healthz`);
    if (!response.ok) {
      return { ok: false, message: `Tempo backend returned ${response.status}.` };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      strictBetaEnabled?: boolean;
      hasGemini?: boolean;
    };

    if (!payload.ok) {
      return { ok: false, message: "Tempo backend health check failed." };
    }
    if (!payload.strictBetaEnabled) {
      return { ok: false, message: "Strict beta is disabled on the Tempo backend." };
    }
    if (!payload.hasGemini) {
      return { ok: false, message: "Tempo backend is up, but Gemini is not configured." };
    }

    return { ok: true, message: null };
  } catch {
    return { ok: false, message: "Tempo backend is unreachable." };
  }
}

async function requestJson<T>(path: string, token: string, body: unknown) {
  if (!API_BASE_URL) {
    throw new Error("Tempo backend URL is not configured.");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }
  return payload;
}

export async function createStrictVisionSession(
  token: string,
  taskTitle: string,
  taskIntention: string,
) {
  return requestJson<StrictVisionSessionResponse>("/v1/strict/sessions", token, {
    taskTitle,
    taskIntention,
    strictModeKind: "vision",
  });
}

export async function analyzeStrictVisionFrame(
  token: string,
  body: {
    sessionId: string;
    taskTitle: string;
    taskIntention: string;
    imageBase64: string;
    mimeType: string;
    recentClassifications: StrictVisionClassification[];
    enforcementLevel: number;
  },
) {
  return requestJson<StrictVisionAnalysis>("/v1/strict/analyze", token, body);
}

export async function sendStrictVisionEvent(
  token: string,
  body: {
    sessionId: string;
    eventType: string;
    taskTitle: string;
    detail?: string;
  },
) {
  return requestJson<{ ok: true }>("/v1/strict/events", token, body);
}
