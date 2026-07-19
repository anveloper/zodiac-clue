// 기본 클루(Cluedo) 카드 데이터 — 용의자 6 · 흉기 6 · 장소 9 (총 21장).
// 조디악(띠) 테마 리스킨은 이후 단계. 지금은 정식 클루 룰 기준.

export const SUSPECTS = [
  "scarlett",
  "mustard",
  "white",
  "green",
  "peacock",
  "plum",
] as const;
export type Suspect = (typeof SUSPECTS)[number];

export const WEAPONS = [
  "candlestick",
  "dagger",
  "lead-pipe",
  "revolver",
  "rope",
  "wrench",
] as const;
export type Weapon = (typeof WEAPONS)[number];

export const ROOMS = [
  "kitchen",
  "ballroom",
  "conservatory",
  "dining",
  "billiard",
  "library",
  "lounge",
  "hall",
  "study",
] as const;
export type RoomName = (typeof ROOMS)[number];

/** 표시용 라벨 (한글). 테마 리스킨 시 이 매핑만 교체하면 됨. */
export const LABELS: Record<string, string> = {
  // suspects
  scarlett: "스칼렛",
  mustard: "머스타드",
  white: "화이트",
  green: "그린",
  peacock: "피콕",
  plum: "플럼",
  // weapons
  candlestick: "촛대",
  dagger: "단검",
  "lead-pipe": "납파이프",
  revolver: "권총",
  rope: "밧줄",
  wrench: "렌치",
  // rooms
  kitchen: "부엌",
  ballroom: "무도회장",
  conservatory: "온실",
  dining: "식당",
  billiard: "당구장",
  library: "서재",
  lounge: "라운지",
  hall: "홀",
  study: "서고",
};

export const label = (value: string): string => LABELS[value] ?? value;
