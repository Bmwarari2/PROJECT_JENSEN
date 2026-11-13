// A beginner Mandarin course (roughly HSK 1). The tutor follows it loosely:
// it adapts to what the learner asks, but always knows where they are.

export interface Unit {
  number: number;
  title: string;
  goals: string;
  /** Core items, "hanzi pinyin = meaning". */
  core: string[];
}

export const CURRICULUM: readonly Unit[] = [
  {
    number: 1,
    title: "Sounds and tones",
    goals:
      "Hear and say the four tones and the neutral tone; understand that pinyin spells sounds and tone marks show pitch; say a first greeting.",
    core: ["妈 mā = mum", "麻 má = hemp", "马 mǎ = horse", "骂 mà = to scold", "你好 nǐ hǎo = hello"],
  },
  {
    number: 2,
    title: "Greetings and courtesy",
    goals: "Greet people, say goodbye, thank, apologise, and respond politely.",
    core: [
      "您好 nín hǎo = hello (polite)",
      "再见 zài jiàn = goodbye",
      "谢谢 xiè xie = thank you",
      "不客气 bú kè qi = you're welcome",
      "对不起 duì bu qǐ = sorry",
      "没关系 méi guān xi = it's okay",
      "早上好 zǎo shang hǎo = good morning",
    ],
  },
  {
    number: 3,
    title: "Introducing yourself",
    goals: "Say your name, ask someone's name, and say nice to meet you.",
    core: [
      "我 wǒ = I, me",
      "你 nǐ = you",
      "叫 jiào = to be called",
      "什么 shén me = what",
      "名字 míng zi = name",
      "我叫… wǒ jiào… = my name is…",
      "很高兴认识你 hěn gāo xìng rèn shi nǐ = nice to meet you",
    ],
  },
  {
    number: 4,
    title: "Where are you from?",
    goals: "Say where you are from and ask others; form yes/no questions with 吗 and negatives with 不.",
    core: [
      "是 shì = to be",
      "不是 bú shì = is not",
      "人 rén = person",
      "哪国人 nǎ guó rén = which nationality",
      "中国 zhōng guó = China",
      "吗 ma = question particle",
    ],
  },
  {
    number: 5,
    title: "Numbers",
    goals: "Count 0–100, say your age and a phone number; learn the tone changes of 一 and 不.",
    core: [
      "一 yī = one … 十 shí = ten",
      "零 líng = zero",
      "百 bǎi = hundred",
      "几 jǐ = how many (small numbers)",
      "岁 suì = years old",
      "你几岁？ nǐ jǐ suì = how old are you?",
    ],
  },
  {
    number: 6,
    title: "Family",
    goals: "Talk about family members; use 有 and 没有; use the measure word 个 and 口.",
    core: [
      "家 jiā = family, home",
      "爸爸 bà ba = dad",
      "妈妈 mā ma = mum",
      "哥哥 gē ge = older brother",
      "姐姐 jiě jie = older sister",
      "有 yǒu = to have",
      "没有 méi yǒu = not have",
    ],
  },
  {
    number: 7,
    title: "Time and dates",
    goals: "Say today/tomorrow/yesterday, days of the week, and tell the time.",
    core: [
      "今天 jīn tiān = today",
      "明天 míng tiān = tomorrow",
      "昨天 zuó tiān = yesterday",
      "星期 xīng qī = week",
      "现在 xiàn zài = now",
      "几点 jǐ diǎn = what time",
    ],
  },
  {
    number: 8,
    title: "Food and drink",
    goals: "Order food and drinks and say what you like to eat.",
    core: [
      "吃 chī = to eat",
      "喝 hē = to drink",
      "茶 chá = tea",
      "水 shuǐ = water",
      "米饭 mǐ fàn = rice",
      "我要… wǒ yào… = I want…",
      "好吃 hǎo chī = tasty",
    ],
  },
  {
    number: 9,
    title: "Shopping and money",
    goals: "Ask prices, understand numbers in prices, and point to things.",
    core: [
      "多少钱 duō shao qián = how much money",
      "块 kuài = yuan (spoken)",
      "买 mǎi = to buy",
      "这个 zhè ge = this one",
      "那个 nà ge = that one",
      "太贵了 tài guì le = too expensive",
    ],
  },
  {
    number: 10,
    title: "Places and directions",
    goals: "Ask where something is and understand simple directions.",
    core: [
      "在 zài = to be at",
      "哪儿 nǎr = where",
      "这儿 zhèr = here",
      "左 zuǒ = left",
      "右 yòu = right",
      "厕所 cè suǒ = toilet",
    ],
  },
  {
    number: 11,
    title: "Likes and daily life",
    goals: "Say what you like and want to do; talk about daily activities.",
    core: [
      "喜欢 xǐ huan = to like",
      "想 xiǎng = to want to",
      "去 qù = to go",
      "工作 gōng zuò = to work",
      "学习 xué xí = to study",
      "中文 zhōng wén = Chinese language",
    ],
  },
  {
    number: 12,
    title: "Putting it together",
    goals:
      "Hold a short real conversation combining everything: greetings, introductions, questions with 吗 and 呢, and describing with 很.",
    core: ["呢 ne = and you? / what about…", "很 hěn = very", "也 yě = also", "都 dōu = all, both"],
  },
];

export const TOTAL_UNITS = CURRICULUM.length;

export function unitInfo(number: number) {
  const unit = CURRICULUM[Math.min(Math.max(number, 1), TOTAL_UNITS) - 1]!;
  return { number: unit.number, title: unit.title };
}
