import { alignHanziPinyin } from "@/lib/pinyin";

/**
 * Characters coloured by tone, with pinyin above each one. Falls back to a
 * single pinyin line if the pinyin doesn't split one-syllable-per-character.
 */
export function ChineseText({
  hanzi,
  pinyin,
  showPinyin = true,
  size = "md",
}: {
  hanzi: string;
  pinyin: string;
  showPinyin?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const { aligned, chars } = alignHanziPinyin(hanzi, pinyin);

  if (!aligned) {
    return (
      <span className={`zh zh-${size}`} lang="zh-CN">
        {showPinyin && pinyin && <span className="zh-pinyin-line">{pinyin}</span>}
        <span className="zh-chars">{hanzi}</span>
      </span>
    );
  }

  return (
    <span className={`zh zh-${size}`} lang="zh-CN">
      {chars.map((c, i) =>
        c.pinyin ? (
          <ruby key={i} className={`tone tone-${c.tone}`}>
            {c.char}
            <rt className={showPinyin ? undefined : "hidden-rt"}>{c.pinyin}</rt>
          </ruby>
        ) : (
          <span key={i}>{c.char}</span>
        ),
      )}
    </span>
  );
}
