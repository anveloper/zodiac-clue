// 조디악(십이지신) 테마 카드 데이터 — "호랑이 생신 잔치" 컨셉.
// 무대: 호랑이 대감의 생신 잔치가 열린 대감집. 십이지 손님들 중
// 누군가 잔치 선물을 훔쳤다. 누가(동물) · 무엇을(훔친 것) · 어디서(장소)를 추리.
//
// 카드 ID는 로마자(ascii)로 유지하고, 화면 표기는 LABELS(한글)/EMOJI로만.

/** 십이지신 12캐릭터 (선택 UI 표시용). */
export const ZODIAC = [
  "rat",
  "ox",
  "tiger",
  "rabbit",
  "gecko",
  "snake",
  "horse",
  "sheep",
  "monkey",
  "rooster",
  "dog",
  "pig",
] as const;
export type Zodiac = (typeof ZODIAC)[number];

/** 잔치 주최자 = 호랑이. 다른 십이지와 동일하게 플레이 가능한 손님. */
export const HOST: Zodiac = "tiger";

/**
 * 십이지 고유색 — view-contract-spec §4에서 CIEDE2000·색각 시뮬레이션으로 확정한 12색.
 *
 * 키가 `suspect`(로비에서 확정, 판 중 불변)이므로 **결정론적**이다.
 * (구 `PLAYER_COLORS[ids.indexOf(id) % 6]`은 접속 순서 기반이라 봇 충원·재접속으로
 *  판 도중에도 색이 바뀌었다.)
 *
 * 설계: 오방정색 적(赤)·청(靑) + 오간색 벽(碧)·자(紫) 4계 × 명도 3단을 라틴방진으로 배치.
 * 황(黃) 계열을 뺀 것이 금색 현재-턴 링과의 충돌을 원천 제거한다.
 * 검증: 66쌍 전수 최소 ΔE00 — 정상 10.0 / 2형 9.6 / 1형 9.6. 충돌(<6) 0쌍.
 * ⚠ 회색조 단독으로는 분리되지 않는다(1차원에 12점을 넣는 문제의 수학적 한계).
 *    따라서 **색 단독 식별 금지** — 아웃라인·이름표 스트라이프·이모지/아트가 함께 붙는다.
 */
export const ZODIAC_COLOR: Record<Zodiac, number> = {
  rat: 0xb94d48, // 적 T0
  ox: 0x69b0a4, // 벽 T1
  tiger: 0xefc8f0, // 자 T2
  rabbit: 0x017cb6, // 청 T0
  gecko: 0xfe887f, // 적 T2
  snake: 0x4b9186, // 벽 T0
  horse: 0xa683a8, // 자 T1
  sheep: 0x6abcfb, // 청 T2
  monkey: 0xd96861, // 적 T1
  rooster: 0x8ed6c8, // 벽 T2
  dog: 0x866488, // 자 T0
  pig: 0x419ad7, // 청 T1
};

/** 색을 못 찾은 값(장물·미지 id)에 쓰는 중립색. 진실값과 무관한 표기 폴백. */
export const NEUTRAL_COLOR = 0x9aa0a6;

/** 십이지 고유색(숫자). 알 수 없는 값이면 중립색. */
export const zodiacColor = (value: string): number =>
  ZODIAC_COLOR[value as Zodiac] ?? NEUTRAL_COLOR;

/** 십이지 고유색(`#rrggbb`) — CSS·Phaser 텍스트 스타일용. */
export const zodiacColorHex = (value: string): string =>
  `#${zodiacColor(value).toString(16).padStart(6, "0")}`;

/** 팔레트 계열 — 적(赤)·벽(碧)·자(紫)·청(靑). */
export type ZodiacFamily = "red" | "jade" | "violet" | "blue";

/**
 * 색각이상 대체 표기(§4.3)의 인코딩 좌표.
 * 색을 **끄지 않고 보강**한다: 계열(4) × 명도단(3) — 최대 3개만 세면 된다.
 * `family` = 8×8 셀의 어느 변에 2px 바를 그릴지, `tier` = 중앙 가로열의 핍 개수-1.
 */
export type ZodiacCue = { family: ZodiacFamily; tier: 0 | 1 | 2 };

const CUE_FAMILY: readonly ZodiacFamily[] = ["red", "jade", "violet", "blue"];

/** 라틴방진 배치: family = i % 4, tier = (i + ⌊i/4⌋) % 3. */
export const ZODIAC_CUE: Record<Zodiac, ZodiacCue> = ZODIAC.reduce(
  (acc, id, i) => {
    acc[id] = {
      family: CUE_FAMILY[i % 4],
      tier: ((i + Math.floor(i / 4)) % 3) as 0 | 1 | 2,
    };
    return acc;
  },
  {} as Record<Zodiac, ZodiacCue>,
);

/** 대체 표기 좌표. 알 수 없는 값이면 undefined(표기를 생략한다). */
export const zodiacCue = (value: string): ZodiacCue | undefined =>
  ZODIAC_CUE[value as Zodiac];

/**
 * 용의자 = 플레이 가능한 십이지 손님 12명 (호랑이 포함).
 * 클루의 "누가?" 후보이자, 플레이어가 고르는 캐릭터.
 */
export const SUSPECTS = ZODIAC;
export type Suspect = (typeof SUSPECTS)[number];

/** 훔친 것(범죄 내용·장물) — 잔치에서 도둑맞은 물건 6종. */
export const WEAPONS = [
  "japchae",
  "gift",
  "safe",
  "chopstick",
  "liquor",
  "tteok",
] as const;
export type Weapon = (typeof WEAPONS)[number];

/** 장소 — 대감집(한옥)의 방 9곳. */
export const ROOMS = [
  "jeongji",
  "daecheong",
  "huwon",
  "sarangbang",
  "sarangchae",
  "seojae",
  "anbang",
  "haengnang",
  "byeoldang",
] as const;
export type RoomName = (typeof ROOMS)[number];

/** 캐릭터 이모지. */
export const EMOJI: Record<string, string> = {
  rat: "🐭",
  ox: "🐮",
  tiger: "🐯",
  rabbit: "🐰",
  gecko: "🦎",
  snake: "🐍",
  horse: "🐴",
  sheep: "🐑",
  monkey: "🐵",
  rooster: "🐔",
  dog: "🐶",
  pig: "🐷",
  // 훔친 것(장물) — 보드 토큰 표시용
  japchae: "🍜",
  gift: "🎁",
  safe: "💰",
  chopstick: "🥢",
  liquor: "🍶",
  tteok: "🍡",
  // 팀 카메오 계략 NPC (비-십이지) — 보드 토큰 표시용
  quokka: "🦫",
  android: "🤖",
};

export const emoji = (value: string): string => EMOJI[value] ?? "";

/** 화면 표기용 라벨(한글). 테마를 바꾸려면 이 매핑만 교체하면 된다. */
export const LABELS: Record<string, string> = {
  // 십이지 손님(용의자)
  rat: "생쥐 서생",
  ox: "황소 역사",
  tiger: "호랑이 대감",
  rabbit: "토끼 낭자",
  gecko: "게코 도령",
  snake: "뱀 무녀",
  horse: "말 장수",
  sheep: "양 목동",
  monkey: "잔나비 광대",
  rooster: "닭 훈장",
  dog: "삽살 포교",
  pig: "돼지 객주",
  // 훔친 것(장물)
  japchae: "잡채",
  gift: "잔치 선물",
  safe: "금고",
  chopstick: "젓가락",
  liquor: "술동이",
  tteok: "떡시루",
  // 장소(대감집)
  jeongji: "정지(부엌)",
  daecheong: "대청마루",
  huwon: "후원",
  sarangbang: "사랑방",
  sarangchae: "사랑채",
  seojae: "서재",
  anbang: "안방",
  haengnang: "행랑채",
  byeoldang: "별당",
  // 팀 카메오 계략 NPC
  quokka: "쿼카 아씨",
  android: "안드로이드",
};

export const label = (value: string): string => LABELS[value] ?? value;

/**
 * 캐릭터 직업(생소한 사극 용어) 풀이 — UI·도감·문서에 "설명"으로 노출한다.
 * term = 라벨의 직업 단어, gloss = 한 줄 뜻풀이.
 */
export const JOB: Record<string, { term: string; gloss: string }> = {
  rat: { term: "서생", gloss: "글공부하는 선비(학생)" },
  ox: { term: "역사(力士)", gloss: "힘이 아주 센 장사" },
  tiger: { term: "대감", gloss: "높은 벼슬아치·귀족 어른" },
  rabbit: { term: "낭자", gloss: "젊은 여인·아가씨" },
  gecko: { term: "도령", gloss: "장가 안 든 양반집 도련님" },
  snake: { term: "무녀", gloss: "굿을 하는 여자 무당" },
  horse: { term: "장수", gloss: "물건을 파는 장사꾼(말 장수=말 상인)" },
  sheep: { term: "목동", gloss: "가축을 치는 아이(목자)" },
  monkey: { term: "광대", gloss: "재주·연희를 펼치는 놀이꾼(배우)" },
  rooster: { term: "훈장", gloss: "서당의 글 선생님" },
  dog: { term: "포교", gloss: "죄인을 잡던 포도청 관리(순검)" },
  pig: { term: "객주", gloss: "상인에게 숙식·중개를 해주던 상인" },
  // 팀 카메오 — 쿼카만 칭호를 둔다(게코 도령 대구). 안드로이드는 칭호 없음.
  quokka: { term: "아씨", gloss: "양반집 젊은 아가씨를 이르던 말" },
};

export const job = (
  value: string,
): { term: string; gloss: string } | undefined => JOB[value];

/** 캐릭터별 성격 — 도감 표시 + NPC 대사 프롬프트에 공용으로 쓰인다. */
export const PERSONA: Record<string, string> = {
  rat: "약삭빠르고 잔꾀 많은 책상물림. 매사 이문부터 따진다.",
  ox: "우직하고 뚝심 있는 장사. 말수 적고 직설적이다.",
  tiger: "위엄 넘치고 오만한 잔치 주최자. 호령하듯 말한다.",
  rabbit: "영민하고 새침한 낭자. 말이 빠르고 눈치가 밝다.",
  gecko: "자존심 세고 허풍이 심한 도령. 게코붙이답게 벽 타듯 능청맞고 과장이 몸에 뱄다.",
  snake: "음산하고 속을 알 수 없는 무녀. 늘 에둘러 말한다.",
  horse: "발 넓고 수다스러운 장돌뱅이. 소문에 훤하다.",
  sheep: "순박하고 겁 많은 목동. 매사 조심스럽다.",
  monkey: "익살맞고 촐랑대는 광대. 농을 즐긴다.",
  rooster: "깐깐하고 원칙주의 훈장. 훈계조로 말한다.",
  dog: "충직하고 우직한 포교. 딱딱한 공무 말투.",
  pig: "넉살 좋고 셈에 밝은 객주. 흥정하듯 말한다.",
  // 팀 카메오 계략 NPC — 엿보기 귓속말 톤용
  quokka:
    "세상에서 가장 행복한 얼굴로 웃는 쿼카 아씨. 낯선 땅에서 왔지만 누구에게나 방긋 웃으며 스스럼없이 다가가, 저도 모르게 아는 것을 흘리고 만다.",
  android:
    "칭호도 족보도 없이 잔치에 끼어든 안드로이드. 사람 흉내를 내보려 하지만 결정적인 순간에 꼭 계측값부터 읊어 분위기를 깬다.",
};

export const persona = (value: string): string => PERSONA[value] ?? "";

/**
 * 캐릭터 말투(voice) — 페르소나를 대사에 뚜렷이 입히기 위한 데이터.
 * - tone: LLM 프롬프트에 넣는 "이렇게 말하라" 지시.
 * - intro/outro: LLM 없이 폴백 대사를 만들 때 앞뒤에 붙이는 캐릭터 추임새.
 */
export type Voice = { tone: string; intro: string; outro: string };

export const VOICE: Record<string, Voice> = {
  rat: { tone: "잔꾀 섞어 이문 따지듯", intro: "허, ", outro: " 셈속이 그러하렷다." },
  ox: { tone: "말수 적고 직설적으로", intro: "", outro: " 에두를 것 없네." },
  tiger: { tone: "위엄 있게 호령하듯", intro: "어험— ", outro: " 감히 누구 앞이라고!" },
  rabbit: { tone: "새침하고 빠르게 쏘아붙이듯", intro: "어머, ", outro: " 눈치 못 챌 줄 알고?" },
  gecko: { tone: "허풍 섞어 과장되게", intro: "핫핫, ", outro: " 내 눈은 못 속이지!" },
  snake: { tone: "음산하게 에둘러", intro: "스으…, ", outro: "… 두고 보면 알겠지." },
  horse: { tone: "수다스럽게 소문 옮기듯", intro: "그거 아나, ", outro: " 소문이 파다하더군!" },
  sheep: { tone: "조심스럽고 겁먹은 듯", intro: "저, 저기… ", outro: "… 아니면 말고요." },
  monkey: { tone: "익살맞게 농치듯", intro: "낄낄, ", outro: " 이거 아주 볼만하구먼!" },
  rooster: { tone: "훈계조로 꾸짖듯", intro: "쯧쯧, ", outro: " 마땅히 그러하렷다." },
  dog: { tone: "딱딱한 공무 말투로", intro: "고하오— ", outro: " 지체 없이 밝히겠소." },
  pig: { tone: "넉살 좋게 흥정하듯", intro: "어이구, ", outro: " 밑질 거래는 아니지 않소?" },
  // 팀 카메오 계략 NPC
  quokka: { tone: "해맑게 방긋 웃으며", intro: "히힛, ", outro: " 도움이 됐으면 좋겠다!" },
  android: { tone: "기계처럼 담담하게", intro: "삐빅, ", outro: " 연산 완료." },
};

export const voice = (value: string): Voice =>
  VOICE[value] ?? { tone: "무난하게", intro: "", outro: "" };

/**
 * 캐릭터 배짱(nerve) — **의사결정에 쓰는 페르소나 상수**(0..1).
 * `PERSONA`/`VOICE`가 대사에만 걸리던 페르소나를 **추리 판단**까지 확장한다
 * (ai-tech-doc §1.2 (b) · improvement-roadmap §7.5.3).
 *
 * 의미: "후보가 좁혀졌지만 아직 확정이 아닐 때, 도박으로 고발을 지를 배짱".
 * 1에 가까울수록 성급하고, 0에 가까울수록 확증 전까지 절대 지르지 않는다.
 * ⚠️ 값 자체는 진실값이 아니다 — 판정은 `rules/bot-accuse.ts`의 순수 규칙 함수가 한다.
 *    LLM은 이 값을 보지도, 바꾸지도 않는다.
 *
 * 배정 근거는 **위 `PERSONA` 문장 한 줄**이며 그것과 모순되지 않아야 한다:
 *  - tiger 0.90 "위엄 넘치고 **오만**한 주최자" → 확증 없이 호령하듯 지른다(문서가 지정한 최상단)
 *  - gecko 0.80 "자존심 세고 **허풍**이 심한"    → 못 속인다며 먼저 지른다
 *  - monkey 0.75 "익살맞고 **촐랑대는**"         → 판을 키우려 지른다
 *  - horse 0.65 "발 넓고 **수다스러운**·소문에 훤한" → 소문(미확정 정보)으로 움직인다
 *  - rabbit 0.55 "**영민**하고 새침·눈치가 밝다"  → 눈치로 앞서가되 영민해 무모하진 않다
 *  - ox 0.45 "**우직**하고 뚝심 있는"            → 뚝심으로 밀지만 성급하진 않다
 *  - pig 0.40 "**셈에 밝은** 객주"               → 승산을 계산해 밑지는 거래는 안 한다
 *  - rat 0.30 "**매사 이문부터 따진다**"         → 손해(탈락) 계산이 먼저다
 *  - dog 0.25 "**충직**하고 우직한 포교"         → 증거 없이 잡아들이지 않는 공무 감각
 *  - snake 0.20 "**늘 에둘러** 말한다"           → 단정을 피한다
 *  - rooster 0.15 "깐깐하고 **원칙주의**"        → 원칙상 확증 전엔 고발하지 않는다
 *  - sheep 0.05 "순박하고 **겁 많은**·매사 조심" → 사실상 안 한다(문서가 지정한 최하단)
 */
export const BOT_NERVE: Record<Zodiac, number> = {
  rat: 0.3,
  ox: 0.45,
  tiger: 0.9,
  rabbit: 0.55,
  gecko: 0.8,
  snake: 0.2,
  horse: 0.65,
  sheep: 0.05,
  monkey: 0.75,
  rooster: 0.15,
  dog: 0.25,
  pig: 0.4,
};

/** 배짱 값. 알 수 없는 캐릭터는 중간값(0.4)으로 — 판단이 멈추지는 않게. */
export const botNerve = (value: string): number =>
  BOT_NERVE[value as Zodiac] ?? 0.4;
