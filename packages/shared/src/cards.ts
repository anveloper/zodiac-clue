// 조디악(십이지신) 테마 카드 데이터 — "호랑이 생신 잔치" 컨셉.
// 무대: 호랑이 대감의 생신 잔치가 열린 대감집. 십이지 손님들 중
// 누군가 잔치 선물을 훔쳤다. 누가(동물) · 무엇으로(수법) · 어디서(장소)를 추리.
//
// 카드 ID는 로마자(ascii)로 유지하고, 화면 표기는 LABELS(한글)/EMOJI로만.

/** 십이지신 12캐릭터 (선택 UI 표시용). */
export const ZODIAC = [
  "rat",
  "ox",
  "tiger",
  "rabbit",
  "dragon",
  "snake",
  "horse",
  "sheep",
  "monkey",
  "rooster",
  "dog",
  "pig",
] as const;
export type Zodiac = (typeof ZODIAC)[number];

/** 잔치 주최자 = 호랑이. (후속 AI 증인/진범 반전 단계에서 특수 역할 예정.) */
export const HOST: Zodiac = "tiger";

/**
 * 용의자 = 플레이 가능한 십이지 손님 12명 (호랑이 포함).
 * 클루의 "누가?" 후보이자, 플레이어가 고르는 캐릭터.
 */
export const SUSPECTS = ZODIAC;
export type Suspect = (typeof SUSPECTS)[number];

/** 수법(흉기) — 대감집에 있을 법한 물건 6종. */
export const WEAPONS = [
  "candle",
  "dagger",
  "club",
  "gun",
  "rope",
  "poker",
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
  dragon: "🐲",
  snake: "🐍",
  horse: "🐴",
  sheep: "🐑",
  monkey: "🐵",
  rooster: "🐔",
  dog: "🐶",
  pig: "🐷",
};

export const emoji = (value: string): string => EMOJI[value] ?? "";

/** 화면 표기용 라벨(한글). 테마를 바꾸려면 이 매핑만 교체하면 된다. */
export const LABELS: Record<string, string> = {
  // 십이지 손님(용의자)
  rat: "생쥐 서생",
  ox: "황소 역사",
  tiger: "호랑이 대감",
  rabbit: "토끼 낭자",
  dragon: "용 도령",
  snake: "뱀 무녀",
  horse: "말 장수",
  sheep: "양 목동",
  monkey: "잔나비 광대",
  rooster: "닭 훈장",
  dog: "삽살 포교",
  pig: "돼지 객주",
  // 수법(흉기)
  candle: "놋촛대",
  dagger: "은장도",
  club: "다듬잇방망이",
  gun: "화승총",
  rope: "오랏줄",
  poker: "부지깽이",
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
};

export const label = (value: string): string => LABELS[value] ?? value;

/** 캐릭터별 성격 — 도감 표시 + NPC 대사 프롬프트에 공용으로 쓰인다. */
export const PERSONA: Record<string, string> = {
  rat: "약삭빠르고 잔꾀 많은 책상물림. 매사 이문부터 따진다.",
  ox: "우직하고 뚝심 있는 장사. 말수 적고 직설적이다.",
  tiger: "위엄 넘치고 오만한 잔치 주최자. 호령하듯 말한다.",
  rabbit: "영민하고 새침한 낭자. 말이 빠르고 눈치가 밝다.",
  dragon: "자존심 세고 허풍이 심한 도령. 과장이 몸에 뱄다.",
  snake: "음산하고 속을 알 수 없는 무녀. 늘 에둘러 말한다.",
  horse: "발 넓고 수다스러운 장돌뱅이. 소문에 훤하다.",
  sheep: "순박하고 겁 많은 목동. 매사 조심스럽다.",
  monkey: "익살맞고 촐랑대는 광대. 농을 즐긴다.",
  rooster: "깐깐하고 원칙주의 훈장. 훈계조로 말한다.",
  dog: "충직하고 우직한 포교. 딱딱한 공무 말투.",
  pig: "넉살 좋고 셈에 밝은 객주. 흥정하듯 말한다.",
};

export const persona = (value: string): string => PERSONA[value] ?? "";
