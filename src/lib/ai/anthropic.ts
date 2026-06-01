// Rate-limited Claude client for the EN 18031 assessment pipeline.
//
// - Reads ANTHROPIC_API_KEY from env (do not hardcode).
// - Prompt caching: the large static grounding/system block is marked
//   cache_control: ephemeral so it's written once and re-read across the ~150
//   per-requirement calls in a run (cuts input-token cost ~90%).
// - Rate limits: the SDK auto-retries 429/529 honoring `retry-after` (we raise
//   maxRetries); a local semaphore caps in-flight requests so we pace under the
//   per-minute token/request limits instead of firing all calls at once.
//
// Server-side only (uses the secret key). Never import into client components.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

// Default to Sonnet 4.6 (fast, capable) so per-call latency stays under the
// gateway timeout. Override with AI_MODEL (e.g. claude-opus-4-8) when wanted.
export const PIPELINE_MODEL = process.env.AI_MODEL ?? "claude-sonnet-4-6";

// Max concurrent in-flight requests. Keep small to stay under per-minute limits;
// the SDK handles backoff if we still hit 429.
const MAX_CONCURRENCY = Number(process.env.AI_MAX_CONCURRENCY ?? "4");

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  // maxRetries: SDK retries 429/5xx/529 with exponential backoff, honoring the
  // `retry-after` header. 8 gives generous headroom for a long pipeline run.
  client ??= new Anthropic({ maxRetries: 8 });
  return client;
}

// Simple FIFO semaphore — no external dependency.
class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

const limiter = new Semaphore(MAX_CONCURRENCY);

export type Effort = "low" | "medium" | "high" | "max";

export type StructuredCallOpts<T> = {
  /** Static grounding/system text — identical across calls in a run, so it is cached. */
  system: string;
  /** Per-call dynamic content (requirement slice + firmware findings). Not cached. */
  user: string;
  /** Zod schema the response is validated against. */
  schema: z.ZodType<T>;
  /** Schema name (helps the model + structured-output cache). */
  schemaName: string;
  effort?: Effort;
  maxTokens?: number;
};

// One structured Claude call, paced through the concurrency limiter, grounded on
// a cached system block, returning a schema-validated object.
export async function callStructured<T>(opts: StructuredCallOpts<T>): Promise<T> {
  const { system, user, schema, schemaName, effort = "medium", maxTokens = 8000 } = opts;
  return limiter.run(async () => {
    const res = await getClient().messages.parse({
      model: PIPELINE_MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: {
        effort,
        format: zodOutputFormat(schema),
      },
      system: [
        {
          type: "text",
          text: system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: user }],
    });
    if (res.parsed_output == null) {
      const reason = res.stop_reason ?? "unknown";
      throw new Error(
        `Structured output not parsed (stop_reason=${reason}) for ${schemaName}`,
      );
    }
    return res.parsed_output;
  });
}
