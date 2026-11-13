import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { OUTPUT_FORMAT, parseReply, toReplayContent } from "@/lib/tutor/engine";
import type { TutorReply } from "@/lib/types";

type Block = Anthropic.Beta.BetaContentBlock;

const reply: TutorReply = {
  speech: [
    { lang: "en", text: "Hello in Mandarin is", pinyin: "", english: "" },
    { lang: "zh", text: "你好", pinyin: "nǐ hǎo", english: "hello" },
  ],
  on_screen_note: "",
  practice: { hanzi: "你好", pinyin: "nǐ hǎo", english: "hello" },
  vocabulary: [{ hanzi: "你好", pinyin: "nǐ hǎo", english: "hello" }],
  learner_notes: null,
  unit_complete: false,
};

const thinking = (sig: string) => ({ type: "thinking", thinking: "", signature: sig }) as unknown as Block;
const text = (t: string) => ({ type: "text", text: t, citations: null, parsed_output: null }) as unknown as Block;
const fallback = () =>
  ({ type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } }) as unknown as Block;

describe("parseReply", () => {
  it("parses and normalizes the JSON reply", () => {
    const messy = { ...reply, speech: [...reply.speech, { lang: "en", text: "  ", pinyin: "x", english: "y" }] };
    expect(parseReply([thinking("a"), text(JSON.stringify(messy))])).toEqual(reply);
  });

  it("reads only the text after the last fallback boundary", () => {
    const content = [thinking("a"), text('{"speech": [{"lang": "en"'), fallback(), thinking("b"), text(JSON.stringify(reply))];
    expect(parseReply(content)).toEqual(reply);
  });

  it("returns null for invalid output", () => {
    expect(parseReply([text("not json")])).toBeNull();
    expect(parseReply([text('{"speech": []}')])).toBeNull();
    expect(parseReply([thinking("a")])).toBeNull();
  });
});

describe("toReplayContent", () => {
  it("keeps thinking and text, dropping SDK-only fields", () => {
    expect(toReplayContent([thinking("a"), text("{}")])).toEqual([
      { type: "thinking", thinking: "", signature: "a" },
      { type: "text", text: "{}" },
    ]);
  });

  it("drops the declining model's thinking before a fallback, keeping the boundary in place", () => {
    expect(toReplayContent([thinking("a"), text("{"), fallback(), thinking("b"), text("{}")])).toEqual([
      { type: "text", text: "{" },
      { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } },
      { type: "thinking", thinking: "", signature: "b" },
      { type: "text", text: "{}" },
    ]);
  });
});

describe("output schema", () => {
  it("is a strict JSON schema the API accepts", () => {
    expect(OUTPUT_FORMAT.type).toBe("json_schema");
    expect((OUTPUT_FORMAT.schema as { description?: string }).description).toBeUndefined();
    const visit = (node: unknown, path: string) => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "object") {
        expect(n.additionalProperties, `${path} additionalProperties`).toBe(false);
        expect(new Set(n.required as string[]), `${path} required`).toEqual(
          new Set(Object.keys(n.properties as object)),
        );
      }
      for (const key of ["minLength", "maxLength", "minimum", "maximum", "pattern"]) {
        expect(n[key], `${path} uses unsupported ${key}`).toBeUndefined();
      }
      for (const [k, v] of Object.entries(n)) visit(v, `${path}.${k}`);
    };
    visit(OUTPUT_FORMAT.schema, "$");
  });
});
