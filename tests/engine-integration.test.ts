import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TutorReply } from "@/lib/types";

// Runs the real engine (SDK streaming included) against a local stand-in for
// the Messages API, to check the request we send and how we read the stream.

const reply: TutorReply = {
  speech: [
    { lang: "en", text: "Thank you in Mandarin is", pinyin: "", english: "" },
    { lang: "zh", text: "谢谢", pinyin: "xiè xie", english: "thank you" },
  ],
  on_screen_note: "xiè = 4th tone: sharp fall",
  practice: { hanzi: "谢谢", pinyin: "xiè xie", english: "thank you" },
  vocabulary: [{ hanzi: "谢谢", pinyin: "xiè xie", english: "thank you" }],
  learner_notes: null,
  unit_complete: false,
};

let server: Server;
let captured: { headers: IncomingHttpHeaders; body: Record<string, unknown> } | null = null;
let respondWith: "ok" | "refusal" = "ok";

function sse(events: unknown[]): string {
  return events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      captured = { headers: req.headers, body: JSON.parse(raw) };
      const json = JSON.stringify(reply);
      const events =
        respondWith === "refusal"
          ? [
              { type: "message_start", message: { id: "msg_r", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } },
              { type: "message_delta", delta: { stop_reason: "refusal", stop_sequence: null, stop_details: { type: "refusal", category: null, explanation: null } }, usage: { output_tokens: 0 } },
              { type: "message_stop" },
            ]
          : [
              { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } } },
              { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
              { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-abc" } },
              { type: "content_block_stop", index: 0 },
              { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
              { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: json.slice(0, 40) } },
              { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: json.slice(40) } },
              { type: "content_block_stop", index: 1 },
              { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 180 } },
              { type: "message_stop" },
            ];
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(sse(events));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = "test-key";
});

afterAll(() => {
  server.close();
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
});

describe("runTutorTurn against a mock Messages API", () => {
  it("sends the expected request and parses the streamed reply", async () => {
    const { runTutorTurn } = await import("@/lib/tutor/engine");
    const { buildSystemPrompt, STATIC_SYSTEM_PROMPT } = await import("@/lib/tutor/prompt");
    const systemPrompt = buildSystemPrompt({
      now: "Friday",
      sessionCount: 0,
      lastSessionDate: null,
      currentUnit: 1,
      tutorNotes: "",
      wordsLearned: [],
      dueForReview: [],
      recentAverage: null,
      weakest: [],
    });

    const history = [
      { role: "user" as const, content: "[Session start] The learner has opened the app and is ready to begin." },
      {
        role: "assistant" as const,
        content: [
          { type: "thinking" as const, thinking: "", signature: "sig-prev" },
          { type: "text" as const, text: "{}" },
        ],
      },
    ];
    const turn = await runTutorTurn({ systemPrompt, history, userContent: "[spoken] How do I say thank you?" });

    expect(turn.reply).toEqual(reply);
    expect(turn.model).toBe("claude-opus-5-5");
    expect(turn.assistantContent).toEqual([
      { type: "thinking", thinking: "", signature: "sig-abc" },
      { type: "text", text: JSON.stringify(reply) },
    ]);

    const { headers, body } = captured!;
    expect(String(headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    expect(String(headers["anthropic-beta"])).toContain("thinking-binding-controls-2026-08-01");
    expect(headers.authorization).toBe("Bearer test-key");
    expect(body).toMatchObject({
      model: "claude-opus-5-5",
      stream: true,
      fallbacks: "default",
      thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      output_config: { effort: "low", format: { type: "json_schema" } },
      cache_control: { type: "ephemeral" },
    });
    expect(body.betas).toBeUndefined(); // sent as a header, not in the body
    const system = body.system as Array<{ text: string; cache_control?: unknown }>;
    expect(system[0]).toEqual({ type: "text", text: STATIC_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } });
    expect(system[1]!.text.startsWith("<learner_snapshot>")).toBe(true);
    // History is replayed verbatim, then the new turn.
    expect(body.messages).toEqual([...history, { role: "user", content: "[spoken] How do I say thank you?" }]);
  });

  it("turns a refusal into a friendly error", async () => {
    respondWith = "refusal";
    const { runTutorTurn, TutorError } = await import("@/lib/tutor/engine");
    await expect(runTutorTurn({ systemPrompt: "x", history: [], userContent: "hi" })).rejects.toBeInstanceOf(TutorError);
    respondWith = "ok";
  });
});
