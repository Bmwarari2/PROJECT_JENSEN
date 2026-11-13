import { describe, expect, it } from "vitest";
import { buildSsml, escapeXml, SINGLE_WORD_RATE, SLOW_CHINESE_RATE } from "@/lib/speech/ssml";

const voices = { voiceEn: "en-US-AvaMultilingualNeural", voiceZh: "zh-CN-XiaoxiaoNeural" };

describe("buildSsml", () => {
  it("uses the right voice per language and slows Chinese", () => {
    const ssml = buildSsml(
      [
        { lang: "en", text: "Hello in Mandarin is" },
        { lang: "zh", text: "你好" },
        { lang: "en", text: "Say it after me." },
      ],
      { ...voices, slowChinese: true },
    );
    expect(ssml.startsWith('<speak version="1.0"')).toBe(true);
    expect(ssml).toContain('<voice name="en-US-AvaMultilingualNeural">Hello in Mandarin is</voice>');
    expect(ssml).toContain(`<voice name="zh-CN-XiaoxiaoNeural"><break time="250ms"/><prosody rate="${SLOW_CHINESE_RATE}">你好</prosody>`);
    expect(ssml.match(/<voice /g)).toHaveLength(3);
  });

  it("merges consecutive segments of the same language", () => {
    const ssml = buildSsml(
      [
        { lang: "zh", text: "你好" },
        { lang: "zh", text: "谢谢" },
      ],
      { ...voices, slowChinese: false },
    );
    expect(ssml.match(/<voice /g)).toHaveLength(1);
    expect(ssml).toContain('你好<break time="400ms"/>谢谢');
    expect(ssml).not.toContain("prosody");
  });

  it("plays a single word on its own even more slowly", () => {
    const single = buildSsml([{ lang: "zh", text: "妈" }], { ...voices, slowChinese: true });
    expect(single).toContain(`<prosody rate="${SINGLE_WORD_RATE}">妈</prosody>`);
    expect(SINGLE_WORD_RATE).toBe("-50%");
    expect(SLOW_CHINESE_RATE).toBe("-40%");
    const normal = buildSsml([{ lang: "zh", text: "妈" }], { ...voices, slowChinese: false });
    expect(normal).not.toContain("prosody");
  });

  it("escapes XML and skips empty segments", () => {
    const ssml = buildSsml(
      [
        { lang: "en", text: 'Tom & "Jerry" <3' },
        { lang: "zh", text: "  " },
      ],
      { ...voices, slowChinese: true },
    );
    expect(ssml).toContain("Tom &amp; &quot;Jerry&quot; &lt;3");
    expect(ssml.match(/<voice /g)).toHaveLength(1);
  });

  it("escapes apostrophes", () => {
    expect(escapeXml("it's")).toBe("it&apos;s");
  });
});
