/**
 * 시드 RNG — **무상태(stateless) 해시 RNG**.
 *
 * ai-tech-doc §0.2-2("재현성이 없으면 검증도 없다")를 깨지 않고 봇 판단에 확률을 넣기 위한
 * 유일한 난수원이다. `Math.random()`·`Date.now()`를 **분기에 쓰지 않는다**.
 *
 * 왜 스트림이 아니라 해시인가:
 *   스트림 RNG(`rng()`를 계속 당기는 방식)는 **호출 순서**에 결과가 걸린다. 이 서버는
 *   타이머·LLM 왕복·재접속으로 호출 순서가 판마다 달라질 수 있어, 같은 시드를 넣어도
 *   같은 판이 재생되지 않는다. 대신 "결정 좌표"(판 시드 + 좌석 + 결정 일련번호)를
 *   해시해 [0,1)로 사상하면 **어떤 순서로 물어봐도 같은 좌표는 같은 답**이 나온다.
 *   → 오프라인 재생기가 서버의 타이밍을 흉내 낼 필요가 없다.
 */

/** FNV-1a 32bit — 짧은 문자열용 결정론 해시(플랫폼·버전 무관). */
const fnv1a = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // h *= 16777619 (32bit) — Math.imul로 오버플로 정의를 고정한다.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** 32bit 정수 → [0,1) 균등. mulberry32 1스텝(상태를 들고 있지 않는 형태). */
const unit32 = (n: number): number => {
  let t = (n + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * 결정 좌표 → [0,1). 같은 (시드, 좌표)면 **언제·어디서 물어도 같은 값**이다.
 * @param seed 판 시드(`gameSeed`)
 * @param parts 결정 좌표 — 좌석 id, 결정 일련번호, 용도 태그 등
 */
export const seededUnit = (
  seed: number,
  ...parts: (string | number)[]
): number => unit32(fnv1a(`${seed}|${parts.join("|")}`));

/** 판 시드를 강제하는 환경변수 이름 — 오프라인 재생·시뮬레이션용. */
export const SEED_ENV = "ZODIAC_SEED";

/**
 * 이번 판의 시드를 정한다.
 * 1) `ZODIAC_SEED`가 있으면 그 값(정수). → 재생·회귀 테스트에서 판을 고정한다.
 * 2) 없으면 새 시드를 **한 번** 뽑고 서버 로그에 남긴다.
 *
 * ⚠️ `Math.random()`은 여기서 **시드를 발행할 때 1회**만 쓰인다. 이후 모든 판단은
 *    발행된 정수 시드의 순수 함수이므로, 로그에 찍힌 시드를 `ZODIAC_SEED`로 되먹이면
 *    같은 딜에서 같은 판이 그대로 재생된다(§0.2-2 위배 없음).
 */
export const mintGameSeed = (): number => {
  const raw = process.env[SEED_ENV];
  if (raw !== undefined && raw !== "") {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return n >>> 0;
  }
  return Math.floor(Math.random() * 0x7fffffff) >>> 0;
};
