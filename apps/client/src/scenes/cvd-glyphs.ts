import type { ZodiacCue, ZodiacFamily } from "@zodiac-clue/shared";

/**
 * 색각(CVD) 대체 표기 글리프 — 색에 의존하지 않는 십이지 구분 축.
 *
 * **왜 필요한가**: 십이지 12색은 색상환으로 갈렸지만 회색조 단독으로는 12점이 분리되지
 * 않는다. 따라서 **색과 독립인 축**이 하나 더 있어야 한다 — 계열 바(4방향) + 명도 핍(개수)이
 * 그 축이다. 색은 호출부가 **흰색 고정**으로 칠한다(색 대체 표기가 색에 의존하면 의미가 없다).
 *
 * ⚠ 이 파일에는 **진실값이 없다.** 전부 `suspect` 키에서 파생되는 표기이며,
 *   판정·정답은 서버 규칙 엔진에만 있다.
 *
 * 📍 유래: 구 `pixel-glyphs.ts`. 그 파일은 뷰4(도트) 전용 글리프 사전(십이지 배지 12종 ·
 *    장물 스탬프 6종 · 소환 마크)과 이 CVD 표기를 함께 담고 있었는데, 2026-08-25에
 *    뷰2·3·4를 제거하면서 **뷰4 전용분만 사라지고 여기가 남았다.**
 *    (원본은 `git log -- apps/client/src/scenes/pixel-glyphs.ts`)
 */

/** 도트 사각형(단위 좌표). `cvdCueDots`가 8×8 셀 좌표로 돌려준다. */
export type DotRect = { x: number; y: number; w: number; h: number };

/** 색각 대체 표기 셀 한 변(도트 단위). */
export const CVD_CELL = 8;

/** 계열 바 — 적 ▌좌변 · 벽 ▀상변 · 자 ▐우변 · 청 ▄하변, 두께 2도트. */
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
 * 대체 표기를 **8×8 셀 좌표의 사각형 목록**으로 돌려준다.
 * (0,0)이 좌상단, (8,8)이 우하단. 호출부가 도트 크기·원점만 곱하면 된다.
 *
 * 계열 바 1개 + 명도 핍 `tier+1`개.
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
