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
 * 실행: node scripts/sim-balance.mjs [판수]
 */

// ── 카드 (packages/shared/src/cards.ts 미러) ─────────────────────────
const SUSPECTS = [
  "rat", "ox", "tiger", "rabbit", "dragon", "snake",
  "horse", "goat", "monkey", "rooster", "dog", "pig",
];
const WEAPONS = ["japchae", "gift", "safe", "chopstick", "liquor", "tteok"];
const ROOMS = [
  "jeongji", "daecheong", "huwon", "sarangbang", "sarangchae",
  "seojae", "anbang", "haengnang", "byeoldang",
];

const SEATS = 6; // MAX_PLAYERS
const HUMAN = 0; // 사람은 방장 = 턴 순서 첫 번째(ids[0])
const COMMON_CARDS = 2; // 솔로(사람 1)일 때 공개되는 공통 단서
const SUGGEST_CAP = 60; // 로드맵 §1.1 + §7.5 정정본
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
 */
const playGame = (rng, opts) => {
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
  let suggestCount = 0;
  let humanTurns = 0;
  let turn = 0;
  let winner = null; // 좌석 번호 · null = 무승부/미결
  /** 현행 규칙에서 사람이 "다음 자기 턴에" 하려고 미뤄둔 고발 */
  let pendingHumanAccuse = null;

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
    if (!room[seat] || !k.rooms.has(room[seat])) {
      const cands = [...k.rooms];
      room[seat] = cands.length ? pick(rng, cands) : pick(rng, ROOMS);
    }
    const suggestion = {
      suspect: pick(rng, eff(seat, k.suspects)),
      weapon: pick(rng, eff(seat, k.weapons)),
      room: room[seat],
    };
    suggestCount++;

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
  };
};

const p95 = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
};
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

const run = (name, opts, games, seed) => {
  const rng = makeRng(seed);
  let humanWins = 0;
  let draws = 0;
  const seatWins = Array(SEATS).fill(0);
  const rounds = [];
  const suggestions = [];
  for (let i = 0; i < games; i++) {
    const r = playGame(rng, opts);
    if (r.humanWin) humanWins++;
    if (r.draw) draws++;
    else if (r.winner !== null) seatWins[r.winner]++;
    rounds.push(r.rounds);
    suggestions.push(r.suggestions);
  }
  return {
    name,
    games,
    humanWinPct: (humanWins / games) * 100,
    drawPct: (draws / games) * 100,
    avgRounds: mean(rounds),
    avgSuggestions: mean(suggestions),
    p95Suggestions: p95(suggestions),
    maxSuggestions: Math.max(...suggestions),
    capHitPct:
      (suggestions.filter((s) => s >= SUGGEST_CAP).length / games) * 100,
    seatWinPct: seatWins.map((w) => (w / games) * 100),
  };
};

const games = Number(process.argv[2] ?? 2000);
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
    { sharedRevealed: false, humanInstantAccuse: false, suggestCap: SUGGEST_CAP },
  ],
  [
    "④ 변경 후 (①+②+③)",
    { sharedRevealed: false, humanInstantAccuse: true, suggestCap: SUGGEST_CAP },
  ],
];

const results = variants.map(([name, opts]) => run(name, opts, games, SEED));

const pad = (s, n) => String(s).padEnd(n);
const num = (v, d = 1) => v.toFixed(d);

console.log(`\n판 수: ${games} · 시드: ${SEED} · 6인(사람 1 + NPC 5) · 공정 몫 16.7%\n`);
console.log(
  pad("변형", 36) + pad("사람 승률", 11) + pad("무승부", 9) +
  pad("평균 라운드", 13) + pad("평균 제안", 11) + pad("제안 p95", 10) +
  pad("제안 최대", 11) + pad("상한 도달", 10),
);
console.log("-".repeat(110));
for (const r of results) {
  console.log(
    pad(r.name, 36) +
      pad(`${num(r.humanWinPct)}%`, 11) +
      pad(`${num(r.drawPct)}%`, 9) +
      pad(num(r.avgRounds, 2), 13) +
      pad(num(r.avgSuggestions, 1), 11) +
      pad(r.p95Suggestions, 10) +
      pad(r.maxSuggestions, 11) +
      pad(`${num(r.capHitPct)}%`, 10),
  );
}
console.log("\n좌석별 승률(%) — 0번이 사람, 1~5번이 NPC");
for (const r of results) {
  console.log(pad(r.name, 36) + r.seatWinPct.map((v) => num(v).padStart(6)).join(" "));
}
console.log("");
