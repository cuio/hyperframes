/**
 * Minimal Anthropic Messages API client. Uses node:fetch — no SDK dependency.
 * Supports text + tool_use to coerce structured JSON output.
 */

const API_BASE = "https://api.anthropic.com/v1";
const API_VERSION = "2023-06-01";

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export class AnthropicError extends Error {
  status?: number;
  type?: string;
  constructor(message: string, status?: number, type?: string) {
    super(message);
    this.name = "AnthropicError";
    this.status = status;
    this.type = type;
  }
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface MessagesRequest {
  model?: string;
  max_tokens?: number;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tools?: ToolDefinition[];
  tool_choice?: { type: "tool"; name: string } | { type: "auto" } | { type: "any" };
  temperature?: number;
}

export interface MessagesResponse {
  id: string;
  model: string;
  stop_reason: string;
  content: Array<
    { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  usage: { input_tokens: number; output_tokens: number };
}

async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return;
  let detail = "";
  let type: string | undefined;
  try {
    const data = (await res.json()) as { error?: { message?: string; type?: string } };
    detail = data.error?.message ?? "";
    type = data.error?.type;
  } catch {
    /* ignore */
  }
  throw new AnthropicError(
    `Anthropic API: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
    res.status,
    type,
  );
}

export async function createMessage(
  apiKey: string,
  req: MessagesRequest,
): Promise<MessagesResponse> {
  const body = {
    model: req.model ?? DEFAULT_MODEL,
    max_tokens: req.max_tokens ?? 4096,
    system: req.system,
    messages: req.messages,
    tools: req.tools,
    tool_choice: req.tool_choice,
    temperature: req.temperature,
  };
  const res = await fetch(`${API_BASE}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  return (await res.json()) as MessagesResponse;
}

/**
 * Force the model to emit a single tool call and return its parsed input.
 * Throws if the response doesn't include a matching tool_use block.
 */
export async function callStructuredTool<T>(
  apiKey: string,
  opts: {
    model?: string;
    system: string;
    user: string;
    tool: ToolDefinition;
    maxTokens?: number;
    temperature?: number;
  },
): Promise<{ result: T; usage: MessagesResponse["usage"] }> {
  const res = await createMessage(apiKey, {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    tools: [opts.tool],
    tool_choice: { type: "tool", name: opts.tool.name },
    temperature: opts.temperature ?? 0.7,
  });

  const toolBlock = res.content.find(
    (b): b is { type: "tool_use"; id: string; name: string; input: unknown } =>
      b.type === "tool_use" && b.name === opts.tool.name,
  );
  if (!toolBlock) {
    throw new AnthropicError(
      `Model did not return a tool_use for "${opts.tool.name}". stop_reason=${res.stop_reason}`,
    );
  }
  return { result: toolBlock.input as T, usage: res.usage };
}
