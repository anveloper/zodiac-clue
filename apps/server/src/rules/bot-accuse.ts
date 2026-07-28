/**
 * 봇의 **확률적 도박 고발** — 순수 규칙 함수.
 *
 * 배경(ai-tech-doc §1.2 (b) · improvement-roadmap §7.5.3): 봇의 소거에서 빠지는 값은
 * 전부 "정답 아님"이 확인된 카드뿐이라 **정답은 항상 후보에 남는다** → 봇 고발은 100%
 * 정답이고 **봇 탈락 판 0.0%**였다. 탈락 리스크를 사람만 지는 것은 "AI가 치트한다"로
 * 읽히는 밸런스 결함이다.
 *
 * 조치: 후보가 좁혀졌을 때(`combos <= GAMBLE_MAX_COMBOS`) **페르소나 배짱**(`BOT_NERVE`)과
 * **시드 RNG**로 확률적으로 고발을 지른다. 틀리면 봇도 탈락한다.
 *
 * 규약 준수:
 *  - **진실값은 여기(규칙 엔진)에서만 정한다.** LLM은 이 판단에 참여하지 않는다 —
 *    호출부는 결정이 끝난 뒤에야 `speak()`로 대사를 만든다.
 *  - `Math.random()`·`Date.now()`를 쓰지 않는다. 입력이 같으면 출력이 같다(§0.2-2).
 */

/**
 * 도박이 열리는 최대 조합 수(improvement-roadmap §7.5.3의 `combos<=6`).
 * 7 이상이면 성공률이 14% 미만이라 "도박"이 아니라 자멸이다 — 아예 열지 않는다.
 */
export const GAMBLE_MAX_COMBOS = 6;

export type GambleDecision = {
  suspect: string;
  weapon: string;
  room: string;
  /** 이때의 조합 수 — 로그·시뮬 계측용(진실값 아님). */
  combos: number;
};

export type GambleInput = {
  /** 판 시드(`mintGameSeed()`). */
  seed: number;
  /** 좌석 id — 같은 판·같은 턴이라도 좌석마다 다른 값이 나오게 한다. */
  seat: string;
  /** 결정 일련번호(제안 시퀀스). 좌석 × 이 값이 결정 좌표다. */
  decision: number;
  /** 페르소나 배짱 `BOT_NERVE[suspect]` (0..1). */
  nerve: number;
  /** 이 봇이 아직 배제하지 못한 후보(각 카테고리). */
  suspects: readonly string[];
  weapons: readonly string[];
  rooms: readonly string[];
  /** [0,1) 난수 — `seededUnit(seed, ...coords)`를 주입한다(테스트 대체 가능). */
  unit: (seed: number, ...parts: (string | number)[]) => number;
};

/**
 * 도박 고발 확률.
 *
 *   p = nerve × (1 / combos)
 *
 * `1/combos`는 **무작위로 하나를 골랐을 때 실제로 맞을 확률**(= 봇이 가진 확신도)이고,
 * `nerve`는 그 확신도를 행동으로 옮기는 페르소나 계수다. 곱으로 두면
 *  ① 후보가 넓을수록 급격히 줄고(6조합이면 최대 15%),
 *  ② 성급한 캐릭터일수록 커지며,
 *  ③ 임의의 마법상수가 하나도 없다 — 두 항 모두 의미가 있는 값이다.
 * `combos === 1`은 도박이 아니라 확정이므로 여기서 다루지 않는다(호출부의 확신 고발 경로).
 */
export const gambleChance = (nerve: number, combos: number): number =>
  combos <= 1 || combos > GAMBLE_MAX_COMBOS ? 0 : nerve / combos;

/**
 * 도박 고발을 할지, 한다면 어떤 3장으로 할지 결정한다.
 * 하지 않으면 `null`.
 */
export const gambleAccusation = (input: GambleInput): GambleDecision | null => {
  const { seed, seat, decision, nerve, suspects, weapons, rooms, unit } = input;
  if (suspects.length === 0 || weapons.length === 0 || rooms.length === 0) {
    return null;
  }
  const combos = suspects.length * weapons.length * rooms.length;
  const p = gambleChance(nerve, combos);
  if (p <= 0) return null;
  // ① 지를 것인가 — 좌표 태그 "go"
  if (unit(seed, seat, decision, "go") >= p) return null;
  // ② 어느 조합인가 — 좌표 태그 "pick". 조합 인덱스를 자릿수 분해해 균등하게 고른다.
  let idx = Math.floor(unit(seed, seat, decision, "pick") * combos);
  if (idx >= combos) idx = combos - 1; // 부동소수 경계 방어
  const s = idx % suspects.length;
  idx = Math.floor(idx / suspects.length);
  const w = idx % weapons.length;
  idx = Math.floor(idx / weapons.length);
  const r = idx % rooms.length;
  return {
    suspect: suspects[s],
    weapon: weapons[w],
    room: rooms[r],
    combos,
  };
};
