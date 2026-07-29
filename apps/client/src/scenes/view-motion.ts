import {
  timingOf,
  type MotionProfile,
  type ViewTiming,
} from "@zodiac-clue/shared";

// 감속 프로파일·색각 대체 표기의 **클라이언트 측 결정**만 담당한다.
// 값 자체는 전부 `@zodiac-clue/shared`(engine/view-timing)에 있다(단일 소스).
// DOM을 읽어야 해서 shared에 둘 수 없는 부분만 여기 있다.

const param = (key: string): string | null => {
  try {
    return new URLSearchParams(window.location.search).get(key);
  } catch {
    return null;
  }
};

const stored = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const store = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 저장 불가(프라이빗 모드 등) — 세션 한정으로 동작 */
  }
};

/**
 * 감속 프로파일 결정 — `?motion=full|reduced` > `prefers-reduced-motion` > `full`.
 * 촬영 환경은 full이므로 reduced의 `TYPE_MS=0`이 증거성을 깎지 않는다.
 */
export const resolveMotion = (): MotionProfile => {
  const q = param("motion");
  if (q === "full" || q === "reduced") return q;
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return "reduced";
    }
  } catch {
    /* matchMedia 미지원 */
  }
  return "full";
};

/** 현재 프로파일의 타이밍 표. */
export const currentTiming = (): ViewTiming => timingOf(resolveMotion());

/**
 * 색각 대체 표기(§4.3) 활성 여부 — `?cvd=1`.
 * 색을 **끄지 않고 보강**한다. 한 번 켜면 `localStorage`에 남아 재접속에도 유지된다
 * (URL 파라미터를 매번 붙이게 하지 않는다).
 */
export const cvdMode = (): boolean => {
  const q = param("cvd");
  if (q === "1" || q === "0") {
    store("zc_cvd", q);
    return q === "1";
  }
  return stored("zc_cvd") === "1";
};
