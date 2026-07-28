import type { ZodiacCue, ZodiacFamily } from "@zodiac-clue/shared";

/**
 * 도트 글리프 사전 — 뷰4(도트) 실루엣 축소판 + 4뷰 공용 색각 대체 표기.
 *
 * **근거**: roadmap §2.3 "축소판(1~2h): 머리 위 3×3 도트 문장 배지 12종 +
 * 장물 스탬프 6종만 → 정보 결손의 8할 해소" / spec §4.3(대체 표기 글리프 어휘).
 *
 * ⚠ **컷 항목과의 경계**: 같은 §2.3의 풀버전(`귀 4형 × 볏 2형 × 꼬리 3형`,
 *   `LOOT_DOTS` 8×8 6벌)은 execution-plan §5.1에서 **본행사 백로그로 이관**됐다.
 *   여기 있는 것은 **3×3 격자 두 벌뿐**이고, 크리터 실루엣 자체는 손대지 않는다.
 *
 * ⚠ 이 파일에는 **진실값이 없다**. 전부 `suspect`/`value` 키에서 파생되는 표기이며,
 *   판정·정답은 서버 규칙 엔진에만 있다.
 */

/** 3×3 도트 격자. 문자열 3행, `#` = 켠 도트. */
export type DotGrid = readonly [string, string, string];

/** 도트 사각형(단위 좌표). `cvdCueDots`가 8×8 셀 좌표로 돌려준다. */
export type DotRect = { x: number; y: number; w: number; h: number };

/**
 * 십이지 문장(紋章) 배지 12종 — 머리 위 3×3.
 *
 * **왜 배지인가**: 색은 12색으로 갈렸지만(spec §4) 회색조 단독으로는 12점이
 * 분리되지 않는다(spec §4.1 마지막 경고). 따라서 **색과 독립인 축**이 하나 더 필요하고,
 * 3×3 이진 격자가 도트 문법을 깨지 않는 가장 싼 축이다.
 *
 * **검증(색을 빼고도 구분되는가)**: 12개 전수 66쌍에서
 * ① 해밍 거리 ≥ 3/9칸 ② 3행 중 **2행 이상이 통째로 다름**.
 * ②를 넣은 이유 — 해밍 3이어도 "한 행만 다른" 쌍(예: 윗줄만 다른 두 배지)은
 * 9px 크기에서 같은 문장으로 읽힌다. 행 단위 차이가 실제 판독 단위다.
 */
export const ZODIAC_BADGE: Record<string, DotGrid> = {
  // 생쥐 — 작은 귀 둘 + 코. 12종 중 가장 성긴 배지(3점).
  rat: ["#.#", ".#.", "..."],
  // 황소 — 뿔 둘 + 넓은 몸통.
  ox: ["#.#", "###", ".#."],
  // 호랑이 — 이마의 王. 12종 중 가장 빽빽한 배지(7점) = 잔치 주최자.
  tiger: ["###", ".#.", "###"],
  // 토끼 — 2단으로 선 긴 귀.
  rabbit: ["#.#", "#.#", "..#"],
  // 게코 — 벽을 타고 오르는 사선 + 붙은 발.
  gecko: ["..#", ".#.", "##."],
  // 뱀 — S자 지그재그.
  snake: ["##.", "..#", ".##"],
  // 말 — 갈기 + 가로로 뻗은 몸통.
  horse: ["#..", "###", "#.."],
  // 양 — 말린 뿔의 십자.
  sheep: [".#.", "###", "..#"],
  // 잔나비 — 네 귀퉁이 X(가운데가 비어 있는 유일한 배지).
  monkey: ["#.#", "...", "#.#"],
  // 닭 — 볏 + 두 다리.
  rooster: [".#.", "#.#", "###"],
  // 삽살개 — 늘어진 귀(ㄱ).
  dog: ["###", "..#", "..."],
  // 돼지 — 통통한 아랫배.
  pig: ["..#", "..#", "###"],
};

/**
 * 장물 스탬프 6종 — 도트 상자 앞면 3×3.
 * 뷰1의 이모지(🍜🎁💰🥢🍶🍡)와 **같은 정보**를 도트 문법으로 옮긴 것이다
 * (spec §5 행 13 — 뷰4만 "전부 동일한 상자"였다).
 *
 * 배지 12종과 같은 기준(해밍 ≥ 3 · 2행 이상 상이)으로 6종 15쌍 전수 검증.
 * 배지와 스탬프는 서로 다른 오브젝트(머리 위 명판 vs 상자 앞면)에 붙으므로
 * 두 사전 사이의 거리는 제약이 아니다 — 다만 **완전 일치는 배제**했다.
 */
export const LOOT_STAMP: Record<string, DotGrid> = {
  // 잡채 — 면발 물결.
  japchae: [".##", "##.", ".##"],
  // 잔치 선물 — 십자 리본.
  gift: [".#.", "###", ".#."],
  // 금고 — 문틀 + 다이얼 + 손잡이 둘.
  safe: ["###", ".#.", "#.#"],
  // 젓가락 — 나란히 선 두 짝.
  chopstick: ["#.#", "#.#", "#.#"],
  // 술동이 — 좁은 목 + 넓은 배.
  liquor: [".#.", ".#.", "###"],
  // 떡시루 — 2층으로 앉힌 시루.
  tteok: ["###", "..#", "###"],
};

/**
 * 3×3 격자를 도트 좌표로 편다. `(col, row)`는 0..2, 중심은 `(1,1)`.
 * 렌더러는 `(col - 1) * d`, `(row - 1) * d`로 중앙 정렬만 하면 된다.
 */
export const gridCells = (
  g: DotGrid | undefined,
): readonly { col: number; row: number }[] => {
  if (!g) return [];
  const out: { col: number; row: number }[] = [];
  for (let row = 0; row < 3; row++) {
    const line = g[row] ?? "";
    for (let col = 0; col < 3; col++) {
      if (line[col] === "#") out.push({ col, row });
    }
  }
  return out;
};

export const zodiacBadge = (suspect: string): DotGrid | undefined =>
  ZODIAC_BADGE[suspect];

export const lootStamp = (value: string): DotGrid | undefined =>
  LOOT_STAMP[value];

/** 색각 대체 표기 셀 한 변(도트 단위) — spec §4.3의 "8×8 도트 셀". */
export const CVD_CELL = 8;

/** 계열 바 — 적 ▌좌변 · 벽 ▀상변 · 자 ▐우변 · 청 ▄하변, 두께 2도트(spec §4.3). */
const FAMILY_BAR: Record<ZodiacFamily, DotRect> = {
  red: { x: 0, y: 0, w: 2, h: CVD_CELL },
  jade: { x: 0, y: 0, w: CVD_CELL, h: 2 },
  violet: { x: CVD_CELL - 2, y: 0, w: 2, h: CVD_CELL },
  blue: { x: 0, y: CVD_CELL - 2, w: CVD_CELL, h: 2 },
};

/** 명도 핍 한 변(도트 단위)과 간격. 좌·우 계열 바(폭 2)와 0.2도트 이상 띄운다. */
const PIP = 0.8;
const PIP_GAP = 0.6;

/**
 * spec §4.3 대체 표기를 **8×8 셀 좌표의 사각형 목록**으로 돌려준다.
 * (0,0)이 좌상단, (8,8)이 우하단. 뷰마다 도트 크기·원점만 곱하면 된다 —
 * **글리프 어휘의 단일 소스**를 4뷰가 공유하기 위한 형태다.
 *
 * 계열 바 1개 + 명도 핍 `tier+1`개. 색은 호출부가 **흰색 고정**으로 칠한다
 * (색 대체 표기가 색에 의존하면 의미가 없다 — spec §4.3).
 */
export const cvdCueDots = (cue: ZodiacCue): readonly DotRect[] => {
  const out: DotRect[] = [FAMILY_BAR[cue.family]];
  const n = cue.tier + 1;
  const span = n * PIP + (n - 1) * PIP_GAP;
  const mid = CVD_CELL / 2;
  for (let i = 0; i < n; i++) {
    out.push({
      x: mid - span / 2 + i * (PIP + PIP_GAP),
      y: mid - PIP / 2,
      w: PIP,
      h: PIP,
    });
  }
  return out;
};
