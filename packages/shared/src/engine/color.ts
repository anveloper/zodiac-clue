// 색 유틸 — **엔진 층.** 16진 색값을 다루는 순수 함수뿐이라 주제를 모른다.
//
// 원래 `packages/shared/src/view-consts.ts` §1.4에 보드 팔레트(`BOARD`)와 같은 절에 있었다.
// 팔레트는 클루 보드고 이 함수들은 아니다
// (docs/design/20260729-mafia-content-design.md §1.2-⑤ — `shade`/`desaturate`를 «순수 엔진»으로 판정).
// 값·주석은 그대로 옮기기만 했다.

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

export const rgbOf = (hex: number): { r: number; g: number; b: number } => ({
  r: (hex >> 16) & 0xff,
  g: (hex >> 8) & 0xff,
  b: hex & 0xff,
});

export const packRgb = (r: number, g: number, b: number): number =>
  (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);

/** `#rrggbb` 문자열(CSS·Phaser 텍스트 스타일용). */
export const hexString = (hex: number): string =>
  `#${(hex >>> 0).toString(16).padStart(6, "0")}`;

/** 명도만 조절: amt>0이면 흰쪽, amt<0이면 검은쪽. 색상·채도 관계는 보존한다. */
export const shade = (hex: number, amt: number): number => {
  const { r, g, b } = rgbOf(hex);
  if (amt >= 0) {
    return packRgb(
      r + (255 - r) * amt,
      g + (255 - g) * amt,
      b + (255 - b) * amt,
    );
  }
  const k = 1 + amt;
  return packRgb(r * k, g * k, b * k);
};

/** 채도만 낮춘다. `keep`=1 원색, 0 완전 회색. 명도(상대휘도)는 유지. */
export const desaturate = (hex: number, keep: number): number => {
  const { r, g, b } = rgbOf(hex);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return packRgb(
    y + (r - y) * keep,
    y + (g - y) * keep,
    y + (b - y) * keep,
  );
};
