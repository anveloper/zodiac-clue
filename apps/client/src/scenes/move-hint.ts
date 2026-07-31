// 데스크톱 이동 발견성(다희 스펙 2026-07-30) — 첫 이동 전까지만 #dpad를 데스크톱에도 노출.
// 마우스 사용자에게는 화면에 이동 방법을 알려주는 클릭 요소가 없던 문제를 해소한다.
// 순환참조를 피하려 main·씬이 함께 import하는 독립 모듈로 둔다(다른 모듈 import 0).

const KEY = "zc_move_hint_seen";

const seen = (): boolean => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false; // localStorage 불가 → 매번 노출(안전한 쪽으로 fail)
  }
};

/** 게임 진입 시: 아직 이동한 적이 없으면 발견용 패드를 포인터 종류와 무관하게 띄운다. */
export const showMoveHint = (): void => {
  if (seen()) return;
  document.getElementById("dpad")?.classList.add("dp-discover");
};

/** 첫 이동(키보드·클릭 무관) 시: 패드를 접고 다시는 안 뜨게 기억한다. */
export const markMovedOnce = (): void => {
  if (seen()) return;
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* localStorage 불가 시 무시 */
  }
  document.getElementById("dpad")?.classList.remove("dp-discover");
};
