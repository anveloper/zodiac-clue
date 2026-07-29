#!/usr/bin/env node
/**
 * 밸런스 시뮬레이터 — 순수 규칙 엔진만 호출한다(서버·네트워크·LLM 없음).
 *
 * 목적: 로드맵 §7.5(사람 승률 3.9%) 결함의 두 축을 코드 변경 전/후로 실측한다.
 *   ① 즉시고발권(§7.5.1) — 사람도 자기 제안 직후 같은 턴에 고발할 수 있는가
 *   ② `revealed` 전역 공유 분리(§1.1) + 총 제안 상한 60(§7.5 정정본)
 *
 * 이식 원본: apps/server/src/rooms/clue-room.ts 의 규칙부
 *   - 덱 구성/딜, 공통 단서 2장(솔로), 시계방향 반증, 봇 추리 노트(BotKnowledge)와 eff(),
 *     미반증 제안 → 즉시 고발, 후보 1/1/1 → 고발, 오답 시 탈락(반증은 계속), 최후 생존 승리.
 *
 * 모델링 단순화(의도적 · 결과 해석에 필요):
 *   - 보드 이동·주사위·비밀통로·계략(엿보기)은 모델에 없다. 모든 좌석이 매 턴 "원하는 방"에서
 *     제안한다고 본다. 근거: 실서버에서 봇은 목표 방으로 순간이동하고, 같은 방 재제안 제한이
 *     없어 사람도 한 방에 눌러앉으면 매 턴 제안할 수 있다(§7.5.2). 로드맵 실측도
 *     "사람 행동 3.0회 / 3.1라운드" = 사실상 매 턴이다.
 *     → 이 단순화는 사람·봇에 **동일하게** 적용되므로 측정 대상(정보 비대칭·고발 시점)이 격리된다.
 *   - 계략은 로드맵 실측상 ±1.8%p(노이즈)라 제외했다.
 *
 * 실행: node scripts/sim-balance.mjs [판수]        # 전체 비교표(탐색용)
 *       node scripts/sim-balance.mjs --gate       # 회귀 판정만 (PASS/FAIL + 종료코드)
 *       node scripts/sim-balance.mjs --gate --json
 *       node scripts/sim-balance.mjs --gate --update-baseline --reason="…"
 *
 * 회귀 판정 기준·기준선은 이 파일이 아니라 scripts/gate-sim-regression.mjs ·
 * scripts/gate.config.mjs · scripts/gate.baseline.json 에 있다(규칙/판정/기준선 3분리).
 */

// ── 카드 (packages/shared/src/content/clue/cards.ts 미러) ────────────
// ⚠️ 예전 미러에는 `dragon`·`goat`가 있었다 — 실제 `cards.ts`는 `gecko`·`sheep`다.
//    이름만 다르고 규칙은 같아 지금까지 결과에 영향이 없었지만, 페르소나 상수
//    `BOT_NERVE`가 캐릭터 id로 조회되므로 여기서부터 실값과 맞춘다.
const SUSPECTS = [
  "rat", "ox", "tiger", "rabbit", "gecko", "snake",
  "horse", "sheep", "monkey", "rooster", "dog", "pig",
];

/** 캐릭터 배짱 — `packages/shared/src/content/clue/cards.ts`의 `BOT_NERVE` 미러. */
const BOT_NERVE = {
  rat: 0.3, ox: 0.45, tiger: 0.9, rabbit: 0.55,
  gecko: 0.8, snake: 0.2, horse: 0.65, sheep: 0.05,
  monkey: 0.75, rooster: 0.15, dog: 0.25, pig: 0.4,
};
const WEAPONS = ["japchae", "gift", "safe", "chopstick", "liquor", "tteok"];
const ROOMS = [
  "jeongji", "daecheong", "huwon", "sarangbang", "sarangchae",
  "seojae", "anbang", "haengnang", "byeoldang",
];

const SEATS = 6; // MAX_PLAYERS
const HUMAN = 0; // 사람은 방장 = 턴 순서 첫 번째(ids[0])
const COMMON_CARDS = 2; // 솔로(사람 1)일 때 공개되는 공통 단서
const SUGGEST_CAP_OLD = 60; // 로드맵 §1.1 + §7.5 정정본(재진입 규칙 이전 p95 51~53 기준)
/**
 * 재산정된 총 제안 상한. 재진입 규칙(§7.5.2) 투입 후 자연 분포는
 * p95 68 · p99 73 · p99.5 74 · 최대 76이라 60은 판의 17%를 강제 종료시킨다.
 * 상한은 **밸런스 손잡이가 아니라 무한 지연 백스톱**이므로 도달률 목표를 ≤1%로 두고
 * p99.5 바로 위인 75를 쓴다(실측 도달률 0.1% · 무승부 0.0%).
 */
const SUGGEST_CAP = 75;
const HARD_STOP = 1000; // 상한이 없는 변형에서 무한 루프를 막는 안전장치

// ── 시드 RNG(재현 가능) ─────────────────────────────────────────────
const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const makeRng = (seed) => {
  let s = seed;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    return mulberry32(s)();
  };
};

// ── 무상태 해시 RNG (apps/server/src/rules/rng.ts 미러) ─────────────
// 봇의 도박 고발은 스트림이 아니라 "결정 좌표 해시"를 쓴다 — 호출 순서에 결과가
// 걸리지 않아야 서버(타이머·LLM 왕복)와 시뮬(즉시 진행)이 **같은 답**을 내기 때문이다.
const fnv1a = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};
const unit32 = (n) => {
  let t = (n + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const seededUnit = (seed, ...parts) => unit32(fnv1a(`${seed}|${parts.join("|")}`));

// ── 도박 고발 (apps/server/src/rules/bot-accuse.ts 미러) ─────────────
const GAMBLE_MAX_COMBOS = 6;
const gambleChance = (nerve, combos) =>
  combos <= 1 || combos > GAMBLE_MAX_COMBOS ? 0 : nerve / combos;
const gambleAccusation = ({ seed, seat, decision, nerve, suspects, weapons, rooms }) => {
  if (!suspects.length || !weapons.length || !rooms.length) return null;
  const combos = suspects.length * weapons.length * rooms.length;
  const p = gambleChance(nerve, combos);
  if (p <= 0) return null;
  if (seededUnit(seed, seat, decision, "go") >= p) return null;
  let idx = Math.floor(seededUnit(seed, seat, decision, "pick") * combos);
  if (idx >= combos) idx = combos - 1;
  const s = idx % suspects.length;
  idx = Math.floor(idx / suspects.length);
  const w = idx % weapons.length;
  idx = Math.floor(idx / weapons.length);
  const r = idx % rooms.length;
  return { suspect: suspects[s], weapon: weapons[w], room: rooms[r], combos };
};

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const shuffle = (rng, arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
};

const cardMatches = (c, s) =>
  (c.kind === "suspect" && c.value === s.suspect) ||
  (c.kind === "weapon" && c.value === s.weapon) ||
  (c.kind === "room" && c.value === s.room);

/**
 * 한 판.
 * @param {object} opts
 * @param {boolean} opts.sharedRevealed  true = 현행(봇 전원이 반증 카드를 전역 공유)
 * @param {boolean} opts.humanInstantAccuse true = 사람도 제안한 턴에 고발(§7.5.1)
 * @param {number|null} opts.suggestCap  총 제안 상한(도달 후 제안마다 공통 단서 1장 추가 공개)
 * @param {boolean} opts.reentry  true = 재진입 규칙(§7.5.2): 같은 방에서 연속 제안 금지
 * @param {boolean} opts.gamble   true = 봇의 확률적 도박 고발(§7.5.3 · ④ §1.2 (b))
 * @param {number} gameSeed  이 판의 도박 판정 시드. **rng 스트림을 소비하지 않는다**
 *   (소비하면 변형마다 딜이 어긋나 ①~⑥의 기존 실측이 재현되지 않는다).
 */
const playGame = (rng, opts, gameSeed = 0) => {
  // 좌석 = 십이지 6종(참여자). 정답 용의자는 참여자 중에서 뽑힌다.
  const zodiac = [...SUSPECTS];
  shuffle(rng, zodiac);
  const suspectPool = zodiac.slice(0, SEATS);

  const solution = {
    suspect: pick(rng, suspectPool),
    weapon: pick(rng, WEAPONS),
    room: pick(rng, ROOMS),
  };

  const deck = [
    ...suspectPool.filter((s) => s !== solution.suspect).map((v) => ({ kind: "suspect", value: v })),
    ...WEAPONS.filter((w) => w !== solution.weapon).map((v) => ({ kind: "weapon", value: v })),
    ...ROOMS.filter((r) => r !== solution.room).map((v) => ({ kind: "room", value: v })),
  ];
  shuffle(rng, deck);

  // 공통 단서(전원 공개 · 정답 아님)
  const commonCards = [];
  for (let i = 0; i < Math.min(COMMON_CARDS, deck.length - SEATS); i++) {
    commonCards.push(deck.shift().value);
  }

  const hands = Array.from({ length: SEATS }, () => []);
  deck.forEach((c, i) => hands[i % SEATS].push(c));

  // 좌석별 시야: 자기 손패 + 공통 단서 (+ 자기 제안에 대한 반증 카드)
  const seen = hands.map((h) => new Set([...h.map((c) => c.value), ...commonCards]));
  // 현행 결함: 봇들만 공유하는 룸 전역 집합
  const globalRevealed = new Set(commonCards);

  // 좌석별 추리 노트
  const know = hands.map((h) => {
    const k = {
      suspects: new Set(suspectPool),
      weapons: new Set(WEAPONS),
      rooms: new Set(ROOMS),
    };
    const drop = (v) => {
      k.suspects.delete(v);
      k.weapons.delete(v);
      k.rooms.delete(v);
    };
    h.forEach((c) => drop(c.value));
    commonCards.forEach(drop);
    return k;
  });
  const dropFrom = (k, v) => {
    k.suspects.delete(v);
    k.weapons.delete(v);
    k.rooms.delete(v);
  };

  const eliminated = Array(SEATS).fill(false);
  const room = Array(SEATS).fill(null); // 현재 앉아 있는 방
  /** 재진입 규칙(§7.5.2) — 좌석별 "직전에 제안한 방". 방을 벗어나면 해제(서버와 동일). */
  const suggestedIn = Array(SEATS).fill(null);
  /** 좌석별로 제안을 시도한 서로 다른 방(보드가 장식인지 재는 지표 — 9개 중 몇 개). */
  const visited = Array.from({ length: SEATS }, () => new Set());
  let suggestCount = 0;
  let humanTurns = 0;
  let turn = 0;
  let winner = null; // 좌석 번호 · null = 무승부/미결
  /** 현행 규칙에서 사람이 "다음 자기 턴에" 하려고 미뤄둔 고발 */
  let pendingHumanAccuse = null;
  /** 도박 고발 계측 — [캐릭터, 적중여부] 목록(진실값 아님, 리포트용). */
  const gambles = [];

  const aliveSeats = () => {
    const out = [];
    for (let i = 0; i < SEATS; i++) if (!eliminated[i]) out.push(i);
    return out;
  };

  /** 봇/사람 공용: 자기 시야를 반영한 유효 후보(서버 eff()와 동일, 비면 원본 유지). */
  const eff = (seat, set) => {
    const view = opts.sharedRevealed && seat !== HUMAN ? globalRevealed : seen[seat];
    const c = [...set].filter((v) => !view.has(v));
    return c.length ? c : [...set];
  };

  const doAccuse = (seat, acc) => {
    const correct =
      acc.suspect === solution.suspect &&
      acc.weapon === solution.weapon &&
      acc.room === solution.room;
    if (correct) {
      winner = seat;
      return true;
    }
    eliminated[seat] = true; // 탈락(반증은 계속 가능 = 손패는 그대로 둔다)
    return false;
  };

  /** 상한 도달 시: 아직 공개되지 않은 비정답 카드 1장을 결정론적으로 추가 공개. */
  const revealCommonClue = () => {
    const already = new Set(commonCards);
    const order = [...suspectPool, ...WEAPONS, ...ROOMS];
    const next = order.find(
      (v) =>
        v !== solution.suspect &&
        v !== solution.weapon &&
        v !== solution.room &&
        !already.has(v),
    );
    if (!next) return false;
    commonCards.push(next);
    globalRevealed.add(next);
    for (let i = 0; i < SEATS; i++) {
      seen[i].add(next);
      dropFrom(know[i], next);
    }
    return true;
  };

  while (winner === null && suggestCount < HARD_STOP) {
    const alive = aliveSeats();
    if (alive.length <= 1) {
      winner = alive[0] ?? null; // 최후 생존 승리
      break;
    }
    const seat = alive[turn % alive.length];
    if (seat === HUMAN) humanTurns++;

    // 현행 규칙: 사람은 지난 턴에 확신한 고발을 이제서야 실행한다(봇 5턴 뒤).
    if (seat === HUMAN && pendingHumanAccuse) {
      const acc = pendingHumanAccuse;
      pendingHumanAccuse = null;
      if (doAccuse(HUMAN, acc)) break;
      turn++;
      continue;
    }

    const k = know[seat];
    // 방 선택 — 현재 방이 아직 후보면 눌러앉고, 아니면 후보 방으로 옮긴다(서버 runBotTurn 동일).
    // 재진입 규칙이 켜지면 "직전에 제안한 방"에는 눌러앉을 수 없다(§7.5.2).
    const blocked = opts.reentry ? suggestedIn[seat] : null;
    if (!room[seat] || !k.rooms.has(room[seat]) || room[seat] === blocked) {
      const cands = [...k.rooms].filter((r) => r !== blocked);
      const pool = cands.length ? cands : ROOMS.filter((r) => r !== blocked);
      const next = pool.length ? pick(rng, pool) : pick(rng, ROOMS);
      if (next !== room[seat]) suggestedIn[seat] = null; // 방을 벗어나면 잠금 해제
      room[seat] = next;
    }
    const suggestion = {
      suspect: pick(rng, eff(seat, k.suspects)),
      weapon: pick(rng, eff(seat, k.weapons)),
      room: room[seat],
    };
    suggestCount++;
    visited[seat].add(room[seat]);
    suggestedIn[seat] = room[seat];

    // 시계방향 반증(탈락자도 손패로 반증한다 — 서버와 동일)
    let shown = null;
    for (let i = 1; i < SEATS; i++) {
      const other = (seat + i) % SEATS;
      const match = hands[other].find((c) => cardMatches(c, suggestion));
      if (match) {
        shown = match;
        break;
      }
    }

    if (shown) {
      seen[seat].add(shown.value); // 반증 카드는 제안자만 본다
      globalRevealed.add(shown.value); // 현행 결함: 봇 전원이 공유
      dropFrom(k, shown.value);
    } else {
      // 아무도 반증 못 했고 내가 3장 다 안 갖고 있으면 그 셋이 정답 → 고발
      const holdsAny = hands[seat].some((c) => cardMatches(c, suggestion));
      if (!holdsAny) {
        if (seat === HUMAN && !opts.humanInstantAccuse) {
          pendingHumanAccuse = suggestion; // 자기 턴이 다시 올 때까지 못 한다
        } else {
          if (doAccuse(seat, suggestion)) break;
          turn++;
          continue;
        }
      }
    }

    // 후보가 각 1개로 좁혀졌으면 고발
    const fs = eff(seat, k.suspects);
    const fw = eff(seat, k.weapons);
    const fr = eff(seat, k.rooms);
    if (fs.length === 1 && fw.length === 1 && fr.length === 1) {
      const acc = { suspect: fs[0], weapon: fw[0], room: fr[0] };
      if (seat === HUMAN && !opts.humanInstantAccuse) {
        pendingHumanAccuse = acc;
      } else {
        if (doAccuse(seat, acc)) break;
        turn++;
        continue;
      }
    }

    // 확률적 도박 고발(§7.5.3) — 봇 좌석만. 확신은 없지만 후보가 좁혀졌을 때
    // 페르소나 배짱 × 시드 RNG로 지른다. 틀리면 봇도 탈락한다.
    if (opts.gamble && seat !== HUMAN) {
      const g = gambleAccusation({
        seed: gameSeed,
        seat: String(seat),
        decision: suggestCount, // 서버의 `suggestSeq`와 같은 결정 좌표
        nerve: BOT_NERVE[suspectPool[seat]] ?? 0.4,
        suspects: fs,
        weapons: fw,
        rooms: fr,
      });
      if (g) {
        const hit = doAccuse(seat, g);
        gambles.push([suspectPool[seat], hit]);
        if (hit) break;
        turn++;
        continue;
      }
    }

    // 총 제안 상한 — 도달 후 제안마다 공통 단서 1장 추가 공개, 소진되면 무승부 종료
    if (opts.suggestCap && suggestCount >= opts.suggestCap) {
      if (!revealCommonClue()) break; // 무승부
    }

    turn++;
  }

  return {
    winner,
    humanWin: winner === HUMAN,
    rounds: humanTurns,
    suggestions: suggestCount,
    draw: winner === null,
    humanRooms: visited[HUMAN].size,
    /** 이 판에서 봇이 한 명이라도 탈락했는가 — ④ §1.2 (b)가 "0.0%"라 지목한 지표. */
    botEliminated: eliminated.some((e, i) => e && i !== HUMAN),
    gambles,
    /** 이 판에서 **봇이 맡은** 캐릭터들 — 십이지별 고발 횟수를 출전 수로 정규화한다. */
    botLineup: suspectPool.filter((_, i) => i !== HUMAN),
  };
};

const pct = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};
const p95 = (arr) => pct(arr, 0.95);
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

const run = (name, opts, games, seed) => {
  const rng = makeRng(seed);
  let humanWins = 0;
  let draws = 0;
  const seatWins = Array(SEATS).fill(0);
  const rounds = [];
  const suggestions = [];
  const humanRooms = [];
  let botElimGames = 0;
  let gambleTotal = 0;
  let gambleHit = 0;
  const gambleByZodiac = {};
  const appearByZodiac = {};
  for (let i = 0; i < games; i++) {
    // 판 시드는 (실행 시드, 판 번호)의 순수 함수 — rng 스트림을 건드리지 않으므로
    // 도박을 켜고 꺼도 딜 생성 순서가 그대로다.
    const r = playGame(rng, opts, (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    if (r.humanWin) humanWins++;
    if (r.draw) draws++;
    else if (r.winner !== null) seatWins[r.winner]++;
    rounds.push(r.rounds);
    suggestions.push(r.suggestions);
    humanRooms.push(r.humanRooms);
    if (r.botEliminated) botElimGames++;
    for (const z of r.botLineup) appearByZodiac[z] = (appearByZodiac[z] ?? 0) + 1;
    for (const [z, hit] of r.gambles) {
      gambleTotal++;
      if (hit) gambleHit++;
      gambleByZodiac[z] = (gambleByZodiac[z] ?? 0) + 1;
    }
  }
  // 상한 도달률은 **그 변형이 실제로 건 상한**으로 잰다.
  // (예전에는 전역 SUGGEST_CAP으로 재서, 상한이 없는 변형 ①②의 도달률이 잘못 나왔다.)
  const cap = opts.suggestCap ?? null;
  return {
    name,
    games,
    humanWinPct: (humanWins / games) * 100,
    drawPct: (draws / games) * 100,
    avgRounds: mean(rounds),
    avgSuggestions: mean(suggestions),
    avgHumanRooms: mean(humanRooms),
    p95Suggestions: p95(suggestions),
    maxSuggestions: Math.max(...suggestions),
    capHitPct: cap
      ? (suggestions.filter((s) => s >= cap) .length / games) * 100
      : 0,
    suggestions,
    seatWinPct: seatWins.map((w) => (w / games) * 100),
    botElimPct: (botElimGames / games) * 100,
    gambleTotal,
    gambleHitPct: gambleTotal ? (gambleHit / gambleTotal) * 100 : 0,
    gambleByZodiac,
    appearByZodiac,
  };
};

// 판수는 **플래그가 아닌 첫 인자**로만 받는다(--gate 등이 NaN이 되지 않도록).
const games = Number(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? 2000);
const SEED = 20260728;

const variants = [
  [
    "① 변경 전 (현행)",
    { sharedRevealed: true, humanInstantAccuse: false, suggestCap: null },
  ],
  [
    "② 즉시고발권만 (§7.5.1)",
    { sharedRevealed: true, humanInstantAccuse: true, suggestCap: null },
  ],
  [
    "③ revealed 분리 + 상한 60만 (§1.1)",
    { sharedRevealed: false, humanInstantAccuse: false, suggestCap: SUGGEST_CAP_OLD },
  ],
  [
    "④ 직전 상태 (①+②+③)",
    { sharedRevealed: false, humanInstantAccuse: true, suggestCap: SUGGEST_CAP_OLD },
  ],
  [
    "⑤ ④ + 재진입 규칙 (§7.5.2) · 상한 60",
    {
      sharedRevealed: false,
      humanInstantAccuse: true,
      suggestCap: SUGGEST_CAP_OLD,
      reentry: true,
    },
  ],
  [
    "⑥ ⑤ + 상한 재산정 75 (변경 전)",
    {
      sharedRevealed: false,
      humanInstantAccuse: true,
      suggestCap: SUGGEST_CAP,
      reentry: true,
    },
  ],
  [
    "⑦ ⑥ + 봇 도박 고발 (§7.5.3 · 변경 후)",
    {
      sharedRevealed: false,
      humanInstantAccuse: true,
      suggestCap: SUGGEST_CAP,
      reentry: true,
      gamble: true,
    },
  ],
];

// ── 회귀 게이트 모드 (`--gate`) ─────────────────────────────────────
// 위 표는 **탐색용**(왜 지금 규칙인가의 근거)이고, 게이트가 지키는 것은 **현재 규칙 하나**다.
// 규약: `variants`는 시간순이며 **마지막 항목이 현재 서버 규칙**이다.
//       변형을 추가할 때 탐색용 후보를 맨 뒤에 붙이지 말 것 — 게이트가 그것을 잰다.
//       (게이트 출력이 잰 변형 이름을 항상 인쇄하므로 잘못 잡히면 즉시 보인다.)
const CURRENT_VARIANT = variants[variants.length - 1];
if (process.argv.includes("--gate")) {
  const { runSimGate } = await import("./gate-sim-regression.mjs");
  process.exit(
    runSimGate({
      run,
      rules: CURRENT_VARIANT[1],
      variantName: CURRENT_VARIANT[0],
      argv: process.argv.slice(2),
    }),
  );
}

const results = variants.map(([name, opts]) => run(name, opts, games, SEED));

const pad = (s, n) => String(s).padEnd(n);
const num = (v, d = 1) => v.toFixed(d);

console.log(`\n판 수: ${games} · 시드: ${SEED} · 6인(사람 1 + NPC 5) · 공정 몫 16.7%\n`);
console.log(
  pad("변형", 40) + pad("사람 승률", 11) + pad("봇 탈락 판", 12) + pad("무승부", 9) +
  pad("평균 라운드", 13) + pad("평균 제안", 11) + pad("제안 p95", 10) +
  pad("제안 최대", 11) + pad("상한 도달", 11) + pad("방문 방/9", 10),
);
console.log("-".repeat(138));
for (const r of results) {
  console.log(
    pad(r.name, 40) +
      pad(`${num(r.humanWinPct)}%`, 11) +
      pad(`${num(r.botElimPct)}%`, 12) +
      pad(`${num(r.drawPct)}%`, 9) +
      pad(num(r.avgRounds, 2), 13) +
      pad(num(r.avgSuggestions, 1), 11) +
      pad(r.p95Suggestions, 10) +
      pad(r.maxSuggestions, 11) +
      pad(`${num(r.capHitPct)}%`, 11) +
      pad(num(r.avgHumanRooms, 2), 10),
  );
}
console.log("\n좌석별 승률(%) — 0번이 사람, 1~5번이 NPC");
for (const r of results) {
  console.log(pad(r.name, 40) + r.seatWinPct.map((v) => num(v).padStart(6)).join(" "));
}

// ── 페르소나가 의사결정에 반영됐는지 — 십이지별 도박 고발 횟수 ──────────
// 각 캐릭터는 6좌석 중 무작위로 뽑히므로 **출전 판 수**로 나눠 정규화해야 비교가 된다.
for (const r of results) {
  if (!r.gambleTotal) continue;
  console.log(
    `\n── 십이지별 도박 고발 (${r.name}) · 총 ${r.gambleTotal}회 · 적중률 ${num(r.gambleHitPct)}% ──`,
  );
  console.log(
    pad("캐릭터", 12) + pad("nerve", 9) + pad("고발", 8) + pad("봇 출전", 9) +
    pad("100판당", 10),
  );
  const rows = SUSPECTS.map((z) => {
    const n = r.gambleByZodiac[z] ?? 0;
    const a = r.appearByZodiac[z] ?? 0;
    return [z, n, a, a ? (n / a) * 100 : 0];
  }).sort((x, y) => y[3] - x[3]);
  const top = rows[0][3] || 1;
  for (const [z, n, a, per] of rows) {
    const bar = "█".repeat(Math.round((per / top) * 30));
    console.log(
      pad(z, 12) + pad(BOT_NERVE[z].toFixed(2), 9) +
      pad(n, 8) + pad(a, 9) + pad(num(per, 1), 10) + bar,
    );
  }
}

// ── 총 제안 상한 재산정 (로드맵 §7.5 2차 실측) ──────────────────────────
// 상한 60은 "재진입 규칙 이전의 p95 = 51~53"을 근거로 고른 값이다. 재진입 규칙(§7.5.2)이
// 들어가면서 p95가 65가 되어 상한이 판의 16%에서 작동한다 — 근거가 무너졌다.
// 기준은 로드맵과 같다: **정상 게임을 자르지 않는 선**.
// 상한이 없을 때의 자연 분포를 뽑고, 후보값별 도달률·승률·판 길이를 함께 본다.
const natural = run(
  "⑦ 재진입 · 상한 없음(자연 분포)",
  { sharedRevealed: false, humanInstantAccuse: true, suggestCap: null, reentry: true },
  games,
  SEED,
);
const s = natural.suggestions;
console.log("\n── 총 제안 수 자연 분포(상한 없음 · 재진입 규칙 적용) ──");
console.log(
  `평균 ${num(mean(s), 1)} · p50 ${pct(s, 0.5)} · p90 ${pct(s, 0.9)} · p95 ${pct(s, 0.95)}` +
    ` · p98 ${pct(s, 0.98)} · p99 ${pct(s, 0.99)} · p99.5 ${pct(s, 0.995)} · 최대 ${Math.max(...s)}`,
);

console.log("\n── 상한 후보 스윕(같은 시드 · 재진입 규칙 적용) ──");
console.log(
  pad("상한", 8) + pad("도달률", 10) + pad("무승부", 9) +
  pad("사람 승률", 11) + pad("평균 라운드", 13) + pad("평균 제안", 11) + pad("제안 p95", 10),
);
console.log("-".repeat(72));
for (const capCand of [60, 70, 75, 80, 85, 90, 100]) {
  const r = run(
    `cap${capCand}`,
    {
      sharedRevealed: false,
      humanInstantAccuse: true,
      suggestCap: capCand,
      reentry: true,
    },
    games,
    SEED,
  );
  const natHit = (s.filter((v) => v >= capCand).length / games) * 100;
  console.log(
    pad(capCand, 8) +
      pad(`${num(natHit)}%`, 10) +
      pad(`${num(r.drawPct)}%`, 9) +
      pad(`${num(r.humanWinPct)}%`, 11) +
      pad(num(r.avgRounds, 2), 13) +
      pad(num(r.avgSuggestions, 1), 11) +
      pad(r.p95Suggestions, 10),
  );
}
console.log("");
