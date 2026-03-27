import "dotenv/config";
import cors from "cors";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const app = express();
app.use(express.json({ limit: "6mb" }));
app.use(
  cors({
    origin: (process.env.TEMPO_ALLOWED_ORIGINS ?? "http://127.0.0.1:4315")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  }),
);

const port = Number(process.env.PORT ?? 8080);
const strictBetaEnabled = (process.env.TEMPO_STRICT_BETA_ENABLED ?? "true") === "true";
const strictAllowGuest = (process.env.TEMPO_STRICT_ALLOW_GUEST ?? "true") === "true";
const geminiModel = process.env.TEMPO_GEMINI_MODEL ?? "gemini-2.5-flash";

const supabaseUrl = process.env.TEMPO_SUPABASE_URL ?? "";
const supabaseSecretKey = process.env.TEMPO_SUPABASE_SECRET_KEY ?? "";
const geminiApiKey = process.env.TEMPO_GEMINI_API_KEY ?? "";

const supabase = supabaseUrl && supabaseSecretKey
  ? createClient(supabaseUrl, supabaseSecretKey)
  : null;

const gemini = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

const sessionSchema = z.object({
  taskTitle: z.string().min(3).max(240),
  taskIntention: z.string().min(3).max(240),
  strictModeKind: z.literal("vision"),
});

const analyzeSchema = z.object({
  sessionId: z.string().uuid(),
  taskTitle: z.string().min(3).max(240),
  taskIntention: z.string().min(3).max(240),
  imageBase64: z.string().min(100),
  mimeType: z.enum(["image/jpeg", "image/png"]),
  recentClassifications: z.array(z.enum(["on_task", "off_task", "uncertain"])).max(3),
  enforcementLevel: z.number().int().min(0).max(5),
});

const eventSchema = z.object({
  sessionId: z.string().uuid(),
  eventType: z.string().min(3).max(48),
  taskTitle: z.string().min(3).max(240),
  detail: z.string().max(240).optional(),
});

const requestCounts = new Map<string, { windowStartedAt: number; count: number }>();

type StrictPrincipal = {
  id: string;
  email: string | null;
  isGuest: boolean;
};

function fail(res: express.Response, status: number, error: string) {
  res.status(status).json({ error });
}

async function requirePrincipal(req: express.Request, res: express.Response) {
  const authHeader = req.header("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!token && strictAllowGuest) {
    return {
      id: "guest",
      email: null,
      isGuest: true,
    } satisfies StrictPrincipal;
  }

  if (!token) {
    fail(res, 401, "Missing access token.");
    return null;
  }

  if (!supabase) {
    fail(res, 503, "Supabase is not configured.");
    return null;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    fail(res, 401, "Invalid or expired access token.");
    return null;
  }

  const now = Date.now();
  const bucket = requestCounts.get(data.user.id);
  if (!bucket || now - bucket.windowStartedAt > 60_000) {
    requestCounts.set(data.user.id, { windowStartedAt: now, count: 1 });
  } else {
    bucket.count += 1;
    if (bucket.count > 24) {
      fail(res, 429, "Strict beta rate limit exceeded.");
      return null;
    }
  }

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    isGuest: false,
  } satisfies StrictPrincipal;
}

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    strictBetaEnabled,
    strictAllowGuest,
    hasSupabase: Boolean(supabase),
    hasGemini: Boolean(gemini),
  });
});

app.post("/v1/strict/sessions", async (req, res) => {
  const principal = await requirePrincipal(req, res);
  if (!principal) {
    return;
  }

  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, parsed.error.issues[0]?.message ?? "Invalid session payload.");
    return;
  }

  if (!strictBetaEnabled) {
    res.json({
      enabled: false,
      sessionId: null,
      message: "Strict beta is temporarily disabled while Tempo is being tuned.",
      betaLabel: "beta",
      quotas: {
        capturesRemaining: 0,
        maxCaptureDimension: 1280,
      },
    });
    return;
  }

  res.json({
    enabled: true,
    sessionId: crypto.randomUUID(),
    message: principal.isGuest
      ? "Strict beta enabled in guest mode. Screenshots are analyzed and discarded."
      : `Strict beta enabled for ${principal.email ?? "your account"}. Screenshots are analyzed and discarded.`,
    betaLabel: "beta",
    quotas: {
      capturesRemaining: 180,
      maxCaptureDimension: 1280,
    },
  });
});

app.post("/v1/strict/analyze", async (req, res) => {
  const principal = await requirePrincipal(req, res);
  if (!principal) {
    return;
  }

  if (!gemini) {
    fail(res, 503, "Gemini is not configured.");
    return;
  }

  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, parsed.error.issues[0]?.message ?? "Invalid analysis payload.");
    return;
  }

  const prompt = [
    "You are Tempo strict mode.",
    "Classify whether the screenshot is on task for the active focus task.",
    `Task title: ${parsed.data.taskTitle}`,
    `Task intention: ${parsed.data.taskIntention}`,
    `Recent classifications: ${parsed.data.recentClassifications.join(", ") || "none"}`,
    `Current enforcement level: ${parsed.data.enforcementLevel}`,
    "Return JSON with keys: classification, reason, confidence, suggestedNudge, nextRecommendedCaptureDelayMs.",
    'classification must be one of: "on_task", "off_task", "uncertain".',
    "confidence must be between 0 and 1.",
    "reason must be 18 words or fewer.",
    "suggestedNudge must be short and actionable.",
    "nextRecommendedCaptureDelayMs should be 8000-15000.",
  ].join("\n");

  const response = await gemini.models.generateContent({
    model: geminiModel,
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: parsed.data.mimeType,
              data: parsed.data.imageBase64,
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
    },
  });

  const raw = response.text ?? "{}";
  let payload: {
    classification: "on_task" | "off_task" | "uncertain";
    reason: string;
    confidence: number;
    suggestedNudge: string;
    nextRecommendedCaptureDelayMs: number;
  };

  try {
    payload = JSON.parse(raw);
  } catch {
    fail(res, 502, "Gemini returned invalid JSON.");
    return;
  }

  const classification = payload.classification ?? "uncertain";
  res.json({
    classification,
    reason: String(payload.reason ?? "Unable to classify the current screen.").slice(0, 120),
    confidence: Math.max(0, Math.min(Number(payload.confidence ?? 0.5), 1)),
    suggestedNudge: String(payload.suggestedNudge ?? "Return to your focus task.").slice(0, 120),
    nextRecommendedCaptureDelayMs: Math.max(
      8_000,
      Math.min(Number(payload.nextRecommendedCaptureDelayMs ?? 10_000), 15_000),
    ),
  });
});

app.post("/v1/strict/events", async (req, res) => {
  const principal = await requirePrincipal(req, res);
  if (!principal) {
    return;
  }

  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, parsed.error.issues[0]?.message ?? "Invalid event payload.");
    return;
  }

  console.log(
    JSON.stringify({
      level: "info",
      scope: "strict-beta",
      userId: principal.id,
      guest: principal.isGuest,
      event: parsed.data.eventType,
      sessionId: parsed.data.sessionId,
      taskTitle: parsed.data.taskTitle,
      detail: parsed.data.detail ?? null,
      timestamp: new Date().toISOString(),
    }),
  );

  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Tempo strict backend listening on ${port}`);
});
