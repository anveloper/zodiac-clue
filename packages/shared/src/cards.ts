// 조디악(십이지) 테마 카드 데이터 — "호랑이 생신 잔치" 컨셉.
// 무대: 호랑이 대감의 생신 잔치가 열린 대감집. 손님(십이지 동물)들 중
// 누군가 잔치 선물을 훔쳤다. 누가(동물) · 무엇으로(수법) · 어디서(장소)를 추리.
// (호랑이=진범 반전은 이후 AI 증인 단계에서. 지금은 기본 클루 6인 구조.)
//
// 카드 ID는 로마자(ascii)로 유지하고, 화면 표기는 LABELS(한글)로만 바꾼다.

/** 용의자 — 잔치에 초대된 십이지 손님 6인 (호랑이 대감은 주최자라 제외). */
export const SUSPECTS = [
  "rat",
  "ox",
  "rabbit",
  "snake",
  "monkey",
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

/** 화면 표기용 라벨(한글). 테마를 바꾸려면 이 매핑만 교체하면 된다. */
export const LABELS: Record<string, string> = {
  // 용의자(동물 손님)
  rat: "생쥐 서생",
  ox: "황소 역사",
  rabbit: "토끼 낭자",
  snake: "구렁이 대감",
  monkey: "잔나비 광대",
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
