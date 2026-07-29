/**
 * 시드 RNG — **무상태(stateless) 해시 RNG**.
 *
 * ai-tech-doc §0.2-2("재현성이 없으면 검증도 없다")를 깨지 않기 위한 **판 전체의 유일한
 * 난수원**이다. 정답 봉투·덱 셔플·딜·주사위·봇 판단이 모두 여기를 지난다.
 * `Math.random()`·`Date.now()`를 **분기에 쓰지 않는다**(시드 발행 1회만 예외).
 *
 * 왜 스트림이 아니라 해시인가:
 *   스트림 RNG(`rng()`를 계속 당기는 방식)는 **호출 순서**에 결과가 걸린다. 이 서버는
 *   타이머·LLM 왕복·재접속으로 호출 순서가 판마다 달라질 수 있어, 같은 시드를 넣어도
 *   같은 판이 재생되지 않는다. 대신 "결정 좌표"(판 시드 + 좌석 + 결정 일련번호)를
 *   해시해 [0,1)로 사상하면 **어떤 순서로 물어봐도 같은 좌표는 같은 답**이 나온다.
 *   → 오프라인 재생기가 서버의 타이밍을 흉내 낼 필요가 없다.
 *
 *   판 시작(`startGame`)의 셔플·딜은 호출 순서가 고정된 동기 구간이라 스트림도 **안전할 수
 *   있었지만** 쓰지 않았다. ① 그 구간에 뽑기를 하나만 끼워 넣어도 이후 전부가 밀려
 *   과거 시드의 판이 전멸한다(회귀 비교가 불가능해진다) ② "여기는 스트림, 저기는 해시"라는
 *   경계는 사람이 지켜야 하는 규칙이고, 판 시작 코드에 비동기가 한 줄 들어오는 순간
 *   조용히 깨진다. 좌표를 이름으로 주면 그 경계 자체가 필요 없다.
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

/**
 * 결정 좌표 → `[0, n)` 정수. 부동소수 경계에서 `n`이 나오지 않도록 잘라낸다.
 * `n <= 0`이면 0(호출부가 빈 배열을 넘긴 경우 — 기존 `Math.floor(random*0)`와 같은 값).
 */
export const seededInt = (
  n: number,
  seed: number,
  ...parts: (string | number)[]
): number =>
  n <= 0 ? 0 : Math.min(n - 1, Math.floor(seededUnit(seed, ...parts) * n));

/** 결정 좌표로 배열에서 하나 고른다(균등). 빈 배열이면 `undefined`. */
export const seededPick = <T>(
  arr: readonly T[],
  seed: number,
  ...parts: (string | number)[]
): T => arr[seededInt(arr.length, seed, ...parts)];

/**
 * 결정 좌표 기반 Fisher–Yates(제자리 셔플).
 *
 * i번째 교환이 **자기 좌표**(`...parts, i`)를 쓰므로 스트림 상태가 없다 —
 * 같은 (시드, 좌표, 길이)면 언제 불러도 같은 순열이고, 다른 셔플이 몇 번 돌았는지에
 * 영향을 받지 않는다. 균등성은 표준 Fisher–Yates 그대로다(각 i에서 `[0, i]` 균등).
 */
export const seededShuffle = <T>(
  arr: T[],
  seed: number,
  ...parts: (string | number)[]
): void => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = seededInt(i + 1, seed, ...parts, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
};

/** 주사위 1개(1..6). 2d6는 좌표를 달리해 두 번 부른다. */
export const seededDie = (
  seed: number,
  ...parts: (string | number)[]
): number => 1 + seededInt(6, seed, ...parts);

/**
 * 결정론 지문(8자리 hex) — **재생 검증 전용**.
 *
 * 정답 봉투·딜 결과가 두 실행에서 같은지 비교하려면 그 값을 밖으로 내야 하는데,
 * 값 자체를 로그에 찍으면 서버 콘솔이 손패 유출 경로가 된다. 해시는 역산이 불가능하므로
 * **"같다/다르다"만** 남기고 내용은 남기지 않는다.
 */
export const digest = (s: string): string =>
  fnv1a(s).toString(16).padStart(8, "0");

/** 판 시드를 강제하는 환경변수 이름 — 오프라인 재생·시뮬레이션용. */
export const SEED_ENV = "ZODIAC_SEED";

/**
 * 이번 판의 시드를 정한다.
 * 1) `ZODIAC_SEED`가 있으면 그 값(정수). → 재생·회귀 테스트에서 판을 고정한다.
 * 2) 없으면 새 시드를 **한 번** 뽑고 서버 로그에 남긴다.
 *
 * ⚠️ `Math.random()`은 여기서 **시드를 발행할 때 1회**만 쓰인다. 이후 모든 판단은
 *    발행된 정수 시드의 순수 함수다.
 *
 * **재생 범위**: 정답 봉투 · 덱 셔플과 딜 · 공통 단서 · 계략 NPC 배치 · 주사위(2d6) ·
 *    봇의 방/제안 선택 · 봇의 확률적 오답 고발 — 판의 모든 무작위가 이 시드에서 파생된다.
 *    같은 시드 + 같은 좌석 구성(참가 순서·캐릭터)이면 **같은 판이 재생된다.**
 *    검증 지점: 판 시작마다 서버가 `[rng] game seed …` 와 `[rng] deal …`(지문)을 찍는다.
 *
 * ⚠️ `ZODIAC_SEED`가 걸려 있으면 리매치도 **매번 같은 판**이 된다(그것이 강제 시드의 뜻이다).
 *    운영 배포에는 걸지 않는다 — 없을 때는 판마다 새 시드를 뽑아 실질 무작위다.
 */
export const mintGameSeed = (): number => {
  const raw = process.env[SEED_ENV];
  if (raw !== undefined && raw !== "") {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return n >>> 0;
  }
  return Math.floor(Math.random() * 0x7fffffff) >>> 0;
};
