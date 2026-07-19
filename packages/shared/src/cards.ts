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

/** 잔치 주최자 = 호랑이. 플레이 불가(후속 AI 증인/반전용). */
export const HOST: Zodiac = "tiger";

/**
 * 용의자 = 플레이 가능한 손님 11지신 (호랑이 제외).
 * 클루의 "누가?" 후보이자, 플레이어가 고르는 캐릭터.
 */
export const SUSPECTS = [
  "rat",
  "ox",
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
