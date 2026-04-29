/**
 * Gemini REST client — narrow surface for the two operations we actually use:
 *   1. uploadFile(): push an mp4 / image to Gemini's Files API
 *   2. generateStructured<T>(): call generateContent with a function tool
 *      and return the parsed input
 *
 * Mirrors the Anthropic client.ts shape so the studio routes have a uniform
 * "callStructuredTool / callMultimodalStructured" surface for both providers.
 *
 * Why direct REST (no @google/genai SDK):
 * - The SDK pulls in a lot of code we don't need (gRPC fallbacks, Vertex AI
 *   auth, batch APIs). For the two endpoints we use, fetch+JSON is ~80 lines.
 * - Lockstep version compatibility with Anthropic's pattern matters more
 *   than SDK affordances we won't use.
 */

import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const UPLOAD_BASE = "https://generativelanguage.googleapis.com/upload/v1beta";

/** Default model for vision/video work. Flash is sufficient for retention
 *  review, scroll-test, and image analysis at our scope. Pro is reserved
 *  for multi-video comparison work that doesn't ship in this PR. */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export class GeminiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

async function ensureOk(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try {
    const text = await res.text();
    detail = text.length > 800 ? text.slice(0, 800) + "…" : text;
  } catch {
    /* ignore */
  }
  throw new GeminiError(
    `${label}: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
    res.status,
  );
}

// ── File upload ──────────────────────────────────────────────────────────────

export interface UploadedFile {
  /** "files/abc123" — used as `file_uri` in subsequent generateContent calls. */
  uri: string;
  /** Polled until "ACTIVE" before the file is usable in prompts. */
  state: "PROCESSING" | "ACTIVE" | "FAILED";
  mimeType: string;
  name: string;
  sizeBytes: number;
}

interface FilesApiResponse {
  file?: {
    name?: string;
    uri?: string;
    state?: "PROCESSING" | "ACTIVE" | "FAILED";
    mimeType?: string;
    sizeBytes?: string | number;
  };
}

/**
 * Upload a local file (mp4 / image) to Gemini's Files API. Uses the resumable
 * protocol: 1 init request to negotiate, then one body POST. The studio
 * server is on the trusted side of the project boundary so we read the file
 * synchronously — saves a stream wiring we don't need.
 *
 * Caller must poll `getFile()` until state === "ACTIVE" before using the
 * URI in a generateContent call. `uploadAndWait()` does that wait inline.
 */
export async function uploadFile(
  apiKey: string,
  filePath: string,
  mimeType: string,
): Promise<UploadedFile> {
  const stat = statSync(filePath);
  const sizeBytes = stat.size;
  const displayName = basename(filePath);

  // Step 1: init — get the upload URL.
  const initRes = await fetch(`${UPLOAD_BASE}/files?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(sizeBytes),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  await ensureOk(initRes, "uploadFile: init");
  const uploadUrl = initRes.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) {
    throw new GeminiError("uploadFile: server did not return X-Goog-Upload-URL header");
  }

  // Step 2: upload the bytes. We POST the whole file at once — fine for the
  // sub-100MB videos the studio renders.
  const bytes = readFileSync(filePath);
  const putRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(sizeBytes),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: new Uint8Array(bytes),
  });
  await ensureOk(putRes, "uploadFile: upload");
  const json = (await putRes.json()) as FilesApiResponse;
  if (!json.file?.uri) {
    throw new GeminiError("uploadFile: response missing file.uri");
  }
  return {
    uri: json.file.uri,
    state: json.file.state ?? "PROCESSING",
    mimeType: json.file.mimeType ?? mimeType,
    name: json.file.name ?? "",
    sizeBytes:
      typeof json.file.sizeBytes === "number"
        ? json.file.sizeBytes
        : Number.parseInt(String(json.file.sizeBytes ?? sizeBytes), 10),
  };
}

/**
 * Poll the Files API for a single file's state. Used by `uploadAndWait()` and
 * by callers that want to surface progress in the studio.
 */
export async function getFile(apiKey: string, fileName: string): Promise<UploadedFile> {
  const res = await fetch(`${API_BASE}/${fileName}?key=${encodeURIComponent(apiKey)}`);
  await ensureOk(res, "getFile");
  const json = (await res.json()) as FilesApiResponse["file"];
  if (!json?.uri) throw new GeminiError("getFile: response missing uri");
  return {
    uri: json.uri,
    state: json.state ?? "PROCESSING",
    mimeType: json.mimeType ?? "",
    name: json.name ?? "",
    sizeBytes:
      typeof json.sizeBytes === "number"
        ? json.sizeBytes
        : Number.parseInt(String(json.sizeBytes ?? 0), 10),
  };
}

/**
 * Upload + poll until ACTIVE. Backoff is geometric: 1s, 2s, 4s, max 30s
 * between polls; max 60s total wait. Throws GeminiError on FAILED or
 * timeout — callers should treat both as user-actionable errors.
 */
export async function uploadAndWait(
  apiKey: string,
  filePath: string,
  mimeType: string,
  opts: { maxWaitMs?: number } = {},
): Promise<UploadedFile> {
  const initial = await uploadFile(apiKey, filePath, mimeType);
  if (initial.state === "ACTIVE") return initial;
  if (initial.state === "FAILED") {
    throw new GeminiError(`uploadFile: server reported FAILED for ${initial.name}`);
  }
  const maxWait = opts.maxWaitMs ?? 60_000;
  const start = Date.now();
  let delay = 1000;
  let last = initial;
  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 30_000);
    last = await getFile(apiKey, last.name);
    if (last.state === "ACTIVE") return last;
    if (last.state === "FAILED") {
      throw new GeminiError(`uploadFile: server reported FAILED for ${last.name}`);
    }
  }
  throw new GeminiError(
    `uploadFile: timed out after ${maxWait}ms waiting for ${last.name} to reach ACTIVE`,
  );
}

// ── Structured tool call ─────────────────────────────────────────────────────

export interface ToolFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GenerateContentUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        functionCall?: {
          name: string;
          args: unknown;
        };
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: GenerateContentUsage;
}

export interface GeminiPart {
  text?: string;
  fileData?: { fileUri: string; mimeType: string };
  inlineData?: { mimeType: string; data: string }; // base64
}

/**
 * Call Gemini's generateContent endpoint with a single function declaration.
 * The model is forced to call the function; we parse and return its args.
 *
 * Mirrors callStructuredTool() from anthropic/client.ts so the storyline
 * routes can swap providers per task without learning two prompt shapes.
 */
export async function generateStructured<T>(
  apiKey: string,
  opts: {
    model?: string;
    parts: GeminiPart[];
    systemInstruction?: string;
    tool: ToolFunctionDeclaration;
    temperature?: number;
    maxOutputTokens?: number;
  },
): Promise<{ result: T; usage: GenerateContentUsage }> {
  const model = opts.model ?? DEFAULT_GEMINI_MODEL;
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: opts.parts }],
    tools: [{ functionDeclarations: [opts.tool] }],
    toolConfig: {
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: [opts.tool.name] },
    },
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
    },
  };
  if (opts.systemInstruction && opts.systemInstruction.trim().length > 0) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await ensureOk(res, "generateStructured");
  const json = (await res.json()) as GenerateContentResponse;
  const candidate = json.candidates?.[0];
  const fnCall = candidate?.content?.parts?.find((p) => p.functionCall);
  if (!fnCall?.functionCall || fnCall.functionCall.name !== opts.tool.name) {
    throw new GeminiError(
      `generateStructured: model did not return a "${opts.tool.name}" function call; finishReason=${candidate?.finishReason ?? "unknown"}`,
    );
  }
  return {
    result: fnCall.functionCall.args as T,
    usage: json.usageMetadata ?? {},
  };
}
