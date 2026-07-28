import { Room, type Client } from "colyseus";
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  MAX_PLAYERS,
  ROOM_REGIONS,
  ROOMS,
  SUSPECTS,
  WEAPONS,
  botNerve,
  bubbleLifeMs,
  canCross,
  inFeast,
  label,
  passageOf,
  persona,
  regionOf,
  roomAt,
  roomCenter,
  voice,
  type AiStats,
  type Card,
  type SayAi,
  type Solution,
  type SuggestEntry,
  type Suggestion,
} from "@zodiac-clue/shared";
import {
  GameState,
  HelperToken,
  Player,
  WeaponToken,
} from "../schema/game-state";
import {
  LINE_BUDGET_SUGGEST,
  fallbackLine,
  narrate,
  type NarrationInput,
} from "../ai/narrator";
import { AiCounter, logAi, recordAi } from "../ai/telemetry";
import { gambleAccusation } from "../rules/bot-accuse";
import { SEED_ENV, mintGameSeed, seededUnit } from "../rules/rng";

type JoinOptions = { character?: string };
type CreateOptions = { isPublic?: boolean };

/** 봇의 추리 노트 — 각 카테고리에서 아직 남은(정답 후보) 값들. */
type BotKnowledge = {
  suspects: Set<string>;
  weapons: Set<string>;
  rooms: Set<string>;
};

// NPC 행동 딜레이 = 사용자 평균 턴 시간의 절반 (클램프). 데이터 없으면 기본값.
// 상한은 로드맵 §7.5.4 — `revealed` 분리로 판이 3.0 → 5.6라운드가 되어 7000은 판을
// 3.8분 밖으로 밀어낸다. 하한은 상한보다 작아야 클램프가 성립한다(§7.5.4 미지정 값).
const NPC_DELAY_DEFAULT = 3000;
const NPC_DELAY_MIN = 800;
const NPC_DELAY_MAX = 1600;
/**
 * 라운드 예산(§1.4) — 남은 봇 수로 나눠 "내 턴 사이 간격"을 12초 안에 묶는다.
 * 봇이 많을수록 개별 딜레이가 짧아진다(봇 5명이면 2400 → 상한 1600이 먼저 걸린다).
 */
const NPC_ROUND_BUDGET_MS = 12000;
// 봇 턴 내 '이동 → (쉬고) → 제안' 사이 간격 (카메라 이동·인지 시간) — §7.5.4 1300→600
// §8.2는 다인(사람≥2)에서 700을 지시하지만 그것은 1300 기준의 **감축안**이다.
// 현재 값 600은 그보다 짧아 지시의 목적(다인 페이싱 단축)을 이미 만족하므로 분기하지 않는다.
const BOT_ACT_GAP = 600;
/**
 * 라운드 예산에서 빼는 **제안 대사 홀드 추정치**. 실제 홀드는 문장 길이로 정해지지만
 * (`speakHold`), 딜레이는 대사가 나오기 **전에** 정해야 하므로 규약 상한값으로 잡는다.
 * `LINE_BUDGET_SUGGEST`(25자)는 제안 대사 길이의 하드 상한이라 이 추정은 보수적이다.
 */
const EST_SPEAK_HOLD_MS = bubbleLifeMs("가".repeat(LINE_BUDGET_SUGGEST));

/**
 * 즉시고발권(로드맵 §7.5.1): 사람이 자기 제안 직후 같은 턴에 고발할 수 있는 제한 시간.
 * 시간이 지나면 자동으로 턴이 넘어간다(봇은 말풍선 홀드 안에서 이미 같은 턴에 고발한다).
 */
const ACCUSE_WINDOW_MS = 30000;
/**
 * 턴 스코프 타이머 키. 턴이 바뀌거나 판이 끝나면 반드시 취소된다.
 * 즉시고발 창·봇 행동 딜레이가 모두 이 키를 쓴다(한 턴에 한 개만 살아 있음).
 */
const TURN_TIMER = "turn";
/**
 * 턴 클럭(§8.2) 키 — `TURN_TIMER`와 **반드시 다른 키**여야 한다.
 * 같은 키를 쓰면 `armTimer`의 "같은 key면 이전 타이머 자동 취소" 규칙 때문에
 * 즉시고발 창을 여는 순간 턴 클럭이 사라지고(또는 그 반대) 둘 중 하나가 조용히 죽는다.
 * 대신 **겹치는 구간에서는 명시적으로 한쪽을 끈다** — 즉시고발 창이 열리면
 * 그 30초가 곧 턴 마감이므로 턴 클럭을 취소한다(`handleSuggest`).
 */
const TURN_CLOCK = "turnClock";
/** 사람 턴 제한(§8.2). AFK 1명이 판을 무한 정지시키는 것을 막는 유일한 장치다. */
const TURN_LIMIT_HUMAN_MS = 45000;
/** 접속이 끊긴(재접속 대기 중) 좌석의 턴 제한(§8.2) — 45초를 다 기다리지 않는다. */
const TURN_LIMIT_AWAY_MS = 8000;
/**
 * 이탈 후 대리 NPC 인계까지의 유예(§8.2). 재접속 허용은 120초로 늘리되
 * 20초 시점에 좌석을 대리 NPC가 이어받아 **판이 멈추는 시간은 20초로 묶는다**.
 */
const HANDOVER_GRACE_MS = 20000;
/** 비자발적 이탈 시 재접속 허용 시간(초) — §8.2: 60 → 120. */
const RECONNECT_WINDOW_SEC = 120;
/**
 * 총 제안 상한 — 판이 무한히 늘어지는 것을 막는 **백스톱**(밸런스 손잡이가 아니다).
 * 상한 도달 이후에는 제안마다 공통 단서를 1장씩 결정론적으로 추가 공개해 수렴을 강제하고,
 * 더 공개할 카드가 없으면 무승부로 종료한다.
 *
 * 60 → 75 재산정(`scripts/sim-balance.mjs` · 3,000판 · 시드 20260728).
 * 60은 재진입 규칙(§7.5.2) **이전**의 총 제안 p95 51~53을 근거로 고른 값이었다.
 * 재진입 규칙이 들어간 뒤 자연 분포는 p95 68 · p99 73 · p99.5 74 · 최대 76이라
 * 60은 정상 게임의 **17.0%**를 강제 종료시킨다 — 로드맵이 상한을 고를 때 세운 기준
 * ("정상 게임을 자르지 않는 선")을 그대로 적용하면 도달률 목표는 ≤1%이고,
 * 그 조건을 만족하는 최솟값이 75다(실측 도달률 0.1% · 무승부 0.0% · 평균 라운드 7.27).
 */
const SUGGEST_CAP = 75;

// 고정 NPC(계략) 배치 후보. 모서리(강한 이익) 1~2 + 건물 사이 중앙 근처에서 랜덤.
const HELPER_CORNERS = [
  { x: 0, y: 0 },
  { x: GRID_WIDTH - 1, y: 0 },
  { x: 0, y: GRID_HEIGHT - 1 },
  { x: GRID_WIDTH - 1, y: GRID_HEIGHT - 1 },
];
// 방↔방 사이 벽면(외곽 링의 복도 틈)에만 배치 — 중앙 잔치상 가장자리는 제외.
const HELPER_MIDS = [
  { x: 7, y: 3 }, //  정지 ↔ 대청
  { x: 16, y: 3 }, // 대청 ↔ 후원
  { x: 3, y: 7 }, //  정지 ↔ 사랑방
  { x: 20, y: 7 }, // 후원 ↔ 사랑채
  { x: 3, y: 16 }, // 사랑방 ↔ 안방
  { x: 20, y: 13 }, // 사랑채 ↔ 서재
  { x: 7, y: 20 }, //  안방 ↔ 행랑
  { x: 16, y: 20 }, // 행랑 ↔ 별당
];
const CENTER = { x: 11, y: 11 };

const pick = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];

const shuffle = <T>(arr: T[]): void => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
};

/** 취소 가능한 타이머 핸들(colyseus `Delayed`와 구조적으로 호환). */
type Cancelable = { clear: () => void };

const cardMatches = (c: Card, s: Suggestion): boolean =>
  (c.kind === "suspect" && c.value === s.suspect) ||
  (c.kind === "weapon" && c.value === s.weapon) ||
  (c.kind === "room" && c.value === s.room);

export class ClueRoom extends Room<GameState> {
  maxClients = MAX_PLAYERS;

  // 서버 전용 비밀 상태 (동기화하지 않음)
  private solution: Solution | null = null;
  private hands = new Map<string, Card[]>();
  private botKnowledge = new Map<string, BotKnowledge>();
  private botSeq = 0;
  /** 로그 sid 생성용 — 방 단위로 단조 증가(리매치해도 재사용하지 않는다). */
  private suggestSeq = 0;
  /** 이번 판의 총 제안 수 — SUGGEST_CAP 판정용(판마다 0으로). */
  private suggestCount = 0;
  /** 이번 판 용의자 후보 = 참여자 6명의 캐릭터. */
  private suspectPool: string[] = [];
  /**
   * 참가자별 "정답이 아님을 실제로 본" 카드값(로드맵 §1.1 — 정보 대칭성).
   * 들어가는 것은 **자기 손패 · 공통 단서(전원 공개) · 자기 제안에 대한 반증으로 자기에게
   * 보인 카드** 뿐이다. 예전의 룸 전역 `revealed`(모든 봇이 공유해 사람보다 더 알던 집합)를
   * 대체한다 — 봇 추리도 반드시 이 맵에서 자기 id의 집합만 읽는다.
   */
  private seenNotSolution = new Map<string, Set<string>>();
  /** 이번 턴에 이미 제안한 플레이어 id(즉시고발 창이 열려 있는 동안 재제안 금지). */
  private suggestedTurnBy = "";
  /**
   * 재진입 규칙(로드맵 §7.5.2) — 좌석별 "직전에 제안한 방".
   * 같은 방에 눌러앉아 매 턴 제안하면 2d6·9개 방·비밀통로가 전부 장식이 된다
   * (실측: 사람이 판당 방문하는 방 2.1개 / 9개). 그 방을 **벗어나면 해제**되므로
   * "방에 들어온 턴에 1회"라는 정통 클루 규칙과 같은 효과가 된다.
   * 사람·봇 모두 같은 규칙을 받는다(봇 경로는 `runBotTurn`의 방 선택에서 적용).
   */
  private suggestedIn = new Map<string, string>();
  /**
   * 진행 중인 판에 들어온 **관전자**의 sessionId(로드맵 §8.3 (c)).
   *
   * 관전자는 `state.players`에 **넣지 않는다**. §8.3이 경고한 "유령 몸통이 문을 막는 봉쇄
   * 버그"의 세 지점(`freeCellIn` 점유 집합 · `handleMove` 충돌 검사 · 소환 대상 탐색)은
   * 전부 `state.players`를 순회하므로, 좌석 자체를 만들지 않으면 **구조적으로** 제외된다
   * (세 곳에 필터를 다는 것보다 빠뜨릴 여지가 없다). 보드 위 토큰도 생기지 않는다.
   * 관전자는 동기화 상태와 브로드캐스트 로그만 받는다 — 손패·정답은 어느 경로로도 가지 않는다.
   * 다음 판(`startGame`)에서 빈 자리·순수 NPC 자리로 좌석을 받는다.
   */
  private spectators = new Set<string>();
  /**
   * 이번 판의 AI 경로 집계(④ §4) — 칩이 그리는 `AiStats`의 원본.
   * **운영 메타데이터이며 게임 상태가 아니다** → `GameState` 스키마에 넣지 않고
   * `broadcast("aiStats")`로 내보낸다. 스키마에 넣으면 ① 진실값과 같은 채널에
   * 섞여 "AI가 판정에 관여한다"는 오독을 만들고 ② 리매치마다 스키마 diff가 튀며
   * ③ 관전자·재접속자에게도 자동 동기화돼 전송 시점을 통제할 수 없다.
   */
  private ai = new AiCounter();
  /** 직전에 방송한 집계 — 값이 바뀔 때만 브로드캐스트하기 위한 비교본. */
  private aiSent = "";
  /**
   * 제안 기록(로드맵 §1.2 + §8.3 b) — **자료구조 한 벌**로
   * ①실시간 브로드캐스트(`suggestLog`) ②재접속·관전 리플레이(`suggestLogAll`)를 모두 덮는다.
   * 담기는 값은 전부 공개 정보다(누가·무엇을 제안했고 **누가** 반증했는가).
   * 반증 **카드 값**은 여기 들어오지 않는다 — 제안자에게만 가는 `disprove`가 유일한 경로다.
   */
  private suggestLog: SuggestEntry[] = [];
  /**
   * 판이 **어떻게** 끝났는가(ui-copy §7.0 — 결과 오버레이 6종의 분기 축).
   * `state.winner`만으로는 「고발 성공」과 「최후 생존」을 구분할 수 없다(둘 다 승자가 있다).
   * 진행 중에는 `null`이고, 종료 분기 3곳이 각자 값을 넣은 **직후에만** 전송에 쓰인다.
   * 동기화 상태가 아니라 메시지로 나가는 이유는 정답 봉투와 같다 — 전송 시점을 통제해야 한다.
   */
  private endReason: "accuse" | "survivor" | "draw" | null = null;
  /**
   * 좌석별 **실패한 고발**(ui-copy §7.1 4번 «내 지목 / 정답 봉투» 대조).
   * 남의 오답 조합은 "그 조합은 정답이 아니다"라는 진실값이므로 **절대 브로드캐스트하지 않는다** —
   * 판이 끝난 뒤 **본인에게만** 되돌려준다(본인은 이미 아는 값이라 정보량이 0이다).
   * 새로고침해도 4번 화면이 성립하도록 서버가 들고 있는다(클라 지역 기억은 재접속에서 사라진다).
   */
  private failedAccusations = new Map<string, Suggestion>();
  /** 방이 파기됐는지 — 파기 후 도착한 비동기 콜백이 타이머를 되살리지 못하게 한다. */
  private disposed = false;

  /**
   * 이번 판의 시드(`rules/rng.ts`). 봇의 확률적 도박 고발이 쓰는 **유일한 난수원**이며
   * 판이 시작될 때 한 번 정해지고 그동안 불변이다. 시드는 진실값이 아니라 판단의
   * 입력이므로 동기화 상태에 넣지 않는다(비밀 정보는 아니지만 클라가 쓸 일도 없다).
   */
  private gameSeed = 0;

  /**
   * 방 생성 시의 공개 여부. 판이 끝나 목록에 되돌릴 때(`setPrivate(false)`)
   * **원래 비공개로 만든 방을 공개로 바꿔버리지 않기 위해** 기억해 둔다.
   */
  private createdPublic = true;
  /** 키별 취소 가능한 타이머(§7.5.1 즉시고발 창 · §8.2 턴 클럭 공용 프리미티브). */
  private timers = new Map<string, Cancelable>();
  // 사용자 턴 시간 이동평균(ms) + 현재 턴 시작 시각(clock)
  private avgHumanTurnMs = 0;
  private turnStartedAt = 0;

  onCreate(options: CreateOptions = {}): void {
    this.setState(new GameState());

    // 공개/비공개: 비공개면 목록(getAvailableRooms)에서 숨김(코드 참가는 가능).
    // 공개방은 기본 노출 → 판이 도는 동안만 `setListed(false)`로 감췄다가 종료 시 복귀한다.
    const isPublic = options.isPublic !== false;
    this.createdPublic = isPublic;
    if (!isPublic) void this.setPrivate(true);
    void this.setMetadata({ hostName: "", count: 0, isPublic });

    this.onMessage("move", (client, msg: { dx: number; dy: number }) =>
      this.handleMove(client, msg),
    );
    this.onMessage("character", (client, msg: { value: string }) =>
      this.handleChooseCharacter(client, msg),
    );
    this.onMessage("start", (client) => this.handleStart(client));
    this.onMessage("suggest", (client, msg: Suggestion) =>
      this.handleSuggest(client, msg),
    );
    this.onMessage("accuse", (client, msg: Suggestion) =>
      this.handleAccuse(client, msg),
    );
    this.onMessage("endTurn", (client) => this.handleEndTurn(client));
    this.onMessage("passage", (client) => this.handlePassage(client));
    this.onMessage("rematch", (client) => this.handleRematch(client));
    this.onMessage("useBonus", (client) => this.handleUseBonus(client));
  }

  onDispose(): void {
    // 방이 사라질 때 살아 있는 타이머를 전부 회수한다(타이머 누수 금지).
    this.disposed = true;
    this.cancelAllTimers();
  }

  // ── 공용 타이머 프리미티브 ────────────────────────────────────────────
  /**
   * 지속시간·만료 콜백·취소를 인자로 받는 단일 타이머 프리미티브.
   * 실행계획 §7.2 ⑦: 즉시고발 창(§7.5.1)과 턴 클럭 `armTurnClock`(§8.2)은 **같은 프리미티브**다.
   * 전용 타이머를 따로 짜지 말고 이 함수에 (key, durationMs, onExpire)를 넘길 것.
   *
   * - 같은 key로 다시 걸면 이전 타이머는 자동 취소된다(중복 방지).
   * - 반환된 핸들의 `cancel()` 또는 `cancelTimer(key)`로 언제든 취소할 수 있다.
   * - 턴 전환(`advanceTurn`) · 판 종료 · 플레이어 이탈 · 방 종료(`onDispose`)에서 반드시 취소된다.
   */
  private armTimer(
    key: string,
    durationMs: number,
    onExpire: () => void,
  ): { cancel: () => void } {
    this.cancelTimer(key);
    if (this.disposed) return { cancel: () => undefined };
    const handle = this.clock.setTimeout(() => {
      this.timers.delete(key);
      onExpire();
    }, durationMs);
    this.timers.set(key, handle);
    return { cancel: () => this.cancelTimer(key) };
  }

  private cancelTimer(key: string): void {
    const t = this.timers.get(key);
    if (!t) return;
    t.clear();
    this.timers.delete(key);
  }

  private cancelAllTimers(): void {
    this.timers.forEach((t) => t.clear());
    this.timers.clear();
    // 턴 클럭도 함께 사라지므로 화면에 남은 마감 시각을 반드시 지운다
    // (판 종료·무승부·리매치에서 카운트다운이 계속 도는 것을 막는다).
    this.state.turnEndsAt = 0;
  }

  // ── 참가자별 시야(정보 대칭성 §1.1) ──────────────────────────────────
  /** 해당 참가자가 "정답 아님"을 실제로 확인한 카드값 집합(없으면 생성). */
  private seenOf(id: string): Set<string> {
    let s = this.seenNotSolution.get(id);
    if (!s) {
      s = new Set<string>();
      this.seenNotSolution.set(id, s);
    }
    return s;
  }

  /** 특정 참가자에게만 "이 카드는 정답이 아니다"를 기록한다(반증 카드는 제안자에게만). */
  private markSeen(id: string, value: string): void {
    this.seenOf(id).add(value);
  }

  /**
   * 방을 옮기면 재진입 잠금이 풀린다(§7.5.2 "방을 벗어나면 해제").
   * 이동·비밀통로·소환 등 **방이 바뀌는 모든 경로**가 이 함수를 지난다.
   */
  private clearSuggestedIn(id: string): void {
    this.suggestedIn.delete(id);
  }

  /** 공통 단서처럼 전원이 동시에 보는 정보만 여기로(공개 정보 → 비대칭 아님). */
  private markSeenForAll(value: string): void {
    this.state.players.forEach((_p, id) => this.markSeen(id, value));
  }

  // 공개방 목록(getAvailableRooms) 표시용 메타데이터 갱신 — 방장명·인원.
  private syncMeta(): void {
    const host = this.state.host
      ? this.state.players.get(this.state.host)
      : undefined;
    void this.setMetadata({
      hostName: host?.name ?? "",
      count: this.state.players.size,
    });
  }

  // ── 비밀 통로: 현재 방 → 연결된 방으로 이동(주사위 없이). 이동만 소진, 턴은 유지해 그 방에서 제안 가능 ──
  private handlePassage(client: Client): void {
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.eliminated) return;
    if (this.state.currentTurn !== client.sessionId) {
      client.send("log", { text: "지금은 내 차례가 아니에요." });
      return;
    }
    const dest = player.room ? passageOf(player.room) : undefined;
    if (!dest) {
      client.send("log", {
        text: "이 방에는 비밀 통로가 없어요. (통로는 3쌍)",
      });
      return;
    }
    const c = this.freeCellIn(dest, player.id);
    player.x = c.x;
    player.y = c.y;
    player.room = dest;
    this.clearSuggestedIn(player.id); // 통로로 방을 옮겼다 → 새 방에서 제안 가능(§7.5.2)
    this.state.stepsLeft = 0; // 통로로 방 도착 = 이동 소진(방 진입 턴엔 이탈 불가). 턴은 유지.
    this.broadcast("log", {
      text: `🚪 비밀 통로 — ${player.name} → ${label(dest)} · 제안 또는 턴 종료`,
      kind: "move",
    });
  }

  // ── 고정 NPC(계략): 인접 시 보너스 사용 — 엿보기 + 이동 보너스(거리 비례). 턴 유지. ──
  private handleUseBonus(client: Client): void {
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.eliminated) return;
    if (this.state.currentTurn !== client.sessionId) {
      client.send("log", { text: "지금은 내 차례가 아니에요." });
      return;
    }
    let helper: HelperToken | undefined;
    this.state.helpers.forEach((h) => {
      if (
        !h.used &&
        Math.max(Math.abs(h.x - player.x), Math.abs(h.y - player.y)) <= 1
      ) {
        helper = h;
      }
    });
    if (!helper) {
      client.send("log", {
        text: "계략을 줄 이가 근처에 없어요. 보드 가장자리의 NPC 곁으로.",
      });
      return;
    }
    helper.used = true;

    // 이동 보너스: 중앙에서 먼 거리에 비례(멀수록 크게 → 돌아올 껀덕지)
    const dist = Math.max(
      Math.abs(helper.x - CENTER.x),
      Math.abs(helper.y - CENTER.y),
    );
    const refund = Math.max(2, Math.round(dist / 2));
    this.state.stepsLeft += refund;

    // 엿보기: 상대들이 가진(정답 아닌) 카드 중 랜덤 공개 (모서리=2장)
    const n = helper.bonus === "peek2" ? 2 : 1;
    const pool: Card[] = [];
    this.state.players.forEach((_p, id) => {
      if (id !== client.sessionId) {
        (this.hands.get(id) ?? []).forEach((c) => pool.push(c));
      }
    });
    shuffle(pool);
    const seen = pool.slice(0, n);
    // 엿본 카드는 사용자 본인만 본 정보 → 본인 시야에만 기록.
    seen.forEach((c) => this.markSeen(client.sessionId, c.value));
    client.send("peek", { from: label(helper.value), cards: seen });
    this.broadcast("log", {
      text: `🃏 계략 — ${player.name} · ${label(
        helper.value,
      )}에게서 엿보기 ${n} · 이동 +${refund}`,
      kind: "info",
    });
    // 계략 NPC의 귓속말: 당사자에게만 전문, 타인에겐 "(귓속말)"만 보인다.
    void this.helperWhisper(client, helper.value, seen);
  }

  /**
   * 계략을 준 고정 NPC가 은밀히 대사를 흘린다.
   * - 계략을 쓴 당사자(client)에게만 실제 대사(+엿본 단서)를 `say`로 보냄
   *   → 헬퍼 토큰(id=zodiac 값) 위에 말풍선. 헬퍼는 인접해 있어 카메라는 그대로.
   * - 나머지 참가자에겐 "(귓속말)"만 브로드캐스트(내용 비공개).
   */
  private async helperWhisper(
    client: Client,
    value: string,
    seen: Card[],
  ): Promise<void> {
    const v = voice(value);
    const hint = seen.map((c) => label(c.value)).join(" · ");
    const input: NarrationInput = {
      name: label(value),
      action: "scheme",
      suspect: "",
      weapon: "",
      room: "",
      hint,
      persona: persona(value),
      tone: v?.tone,
      intro: v?.intro,
      outro: v?.outro,
    };
    const { text, ai } = await this.narrateWithMeta(input, client.sessionId);
    if (this.state.phase !== "playing") return;
    // 당사자: 전문 (헬퍼 토큰 위 말풍선)
    client.send("say", { id: value, from: label(value), text, ai });
    // 타인: 귓속말 표시만. **계측 메타는 동일**하다 — 같은 1건의 발화이고,
    // `except`로 한 사람당 정확히 한 통만 가므로 칩이 중복으로 세지 않는다.
    this.broadcast(
      "say",
      { id: value, from: label(value), text: "(귓속말)", ai },
      { except: client },
    );
  }

  onJoin(client: Client, options: JoinOptions = {}): void {
    // 진행 중인 판에는 좌석을 만들지 않고 **관전**으로 들인다(§8.3 (c)).
    // 예전에는 이 분기가 로그만 찍고 그대로 좌석을 만들었지만, `handleStart`가 즉시
    // `lock()`을 걸어 애초에 도달할 수 없는 죽은 코드였다. 잠금을 `setPrivate(true)`로
    // 바꾸면서 실제로 도달 가능해졌으므로 관전 처리를 구현한다.
    if (this.state.phase !== "lobby") {
      this.spectators.add(client.sessionId);
      client.send("log", {
        text: "이미 진행 중인 판이에요. 관전으로 들어갑니다.",
      });
      // 관전자도 공개 정보(제안 기록·AI 집계)는 처음부터 본다 — 손패는 어느 경로로도 가지 않는다.
      this.sendSuggestLog(client);
      client.send("aiStats", this.ai.snapshot());
      // 이미 끝난 판에 들어왔다면 결과 화면이 빈 채로 뜨지 않도록 봉투를 보낸다.
      // (`phase !== "lobby"`에는 `"playing"`도 포함되므로 게이트는 `sendSolutionTo` 안에 있다.)
      this.sendSolutionTo(client);
      return;
    }
    this.seatPlayer(client, options.character);
  }

  /** 대기실 좌석 생성(최초 입장·관전자 승격 공용). */
  private seatPlayer(client: Client, requested?: string): void {
    const used = new Set(
      [...this.state.players.values()].map((p) => p.suspect),
    );
    const wanted =
      requested &&
      (SUSPECTS as readonly string[]).includes(requested) &&
      !used.has(requested)
        ? requested
        : undefined;
    const suspect = wanted ?? SUSPECTS.find((s) => !used.has(s)) ?? SUSPECTS[0];

    const player = new Player();
    player.id = client.sessionId;
    player.suspect = suspect;
    player.name = label(suspect);
    const spawn = this.spawnPoint(this.state.players.size);
    player.x = spawn.x;
    player.y = spawn.y;
    player.room = roomAt(player.x, player.y) ?? "";

    this.state.players.set(client.sessionId, player);
    if (!this.state.host) {
      this.state.host = client.sessionId;
    }
    this.broadcast("log", { text: `🎎 입장 — ${player.name} 님` });
    this.syncMeta();
  }

  /**
   * 다음 판이 시작될 때 관전자에게 좌석을 준다(§8.3 (c)).
   * 자리가 없으면 **순수 NPC(대리 중이 아닌 봇)** 한 자리를 비워 사람을 우선한다 —
   * 그러지 않으면 관전자는 영원히 관전자로 남는다.
   */
  private seatSpectators(): void {
    for (const sid of [...this.spectators]) {
      const client = this.clients.find((c) => c.sessionId === sid);
      if (!client) {
        this.spectators.delete(sid);
        continue;
      }
      if (this.state.players.size >= MAX_PLAYERS && !this.evictOneBot()) break;
      this.spectators.delete(sid);
      this.seatPlayer(client);
    }
  }

  /** 순수 NPC 좌석 1개를 제거한다(대리 중인 사람 자리 `awayBot`은 건드리지 않는다). */
  private evictOneBot(): boolean {
    const bot = [...this.state.players.values()].find(
      (p) => p.isBot && !p.awayBot,
    );
    if (!bot) return false;
    this.state.players.delete(bot.id);
    this.hands.delete(bot.id);
    this.botKnowledge.delete(bot.id);
    this.seenNotSolution.delete(bot.id);
    this.suggestedIn.delete(bot.id);
    return true;
  }

  /**
   * 손패 개별 전송(§8.3 (a)). `startGame`과 **재접속** 양쪽이 쓴다.
   * 예전에는 `startGame` 한 곳에서만 보내서, 새로고침 한 번이면 클라 `myCards`가
   * 빈 채로 남아 증거노트가 자기 카드를 정답 후보로 표시하고 자멸 고발까지 가능했다.
   * ⚠️ 손패는 비밀 정보 — 반드시 `client.send`로 당사자에게만(동기화 상태 금지).
   */
  private sendHand(id: string): void {
    const player = this.state.players.get(id);
    if (!player || player.isBot) return;
    const target = this.clients.find((c) => c.sessionId === id);
    target?.send("hand", { cards: this.hands.get(id) ?? [] });
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    this.spectators.delete(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    // 끊긴 좌석이 턴을 쥐고 있으면 45초가 아니라 8초 클럭으로 갈아탄다(§8.2).
    if (this.state.currentTurn === client.sessionId) this.armTurnClock();

    // 게임 중 비자발적 이탈만 재접속을 기다린다(대기실에선 즉시 제거).
    if (!consented && this.state.phase === "playing") {
      this.broadcast("log", {
        text: `📡 연결 끊김 — ${player?.name ?? "누군가"} 님 · 재접속 대기`,
      });
      // §8.2 — 재접속 창은 120초로 늘리되 **20초 시점에 대리 NPC가 좌석을 이어받는다.**
      // 예전엔 60초 창 동안 `currentTurn`이 이탈자에게 고정돼 판이 최대 60초 완전 정지했다.
      const grace = this.armTimer(`away:${client.sessionId}`, HANDOVER_GRACE_MS, () =>
        this.handoverToBot(client.sessionId),
      );
      try {
        const back = await this.allowReconnection(client, RECONNECT_WINDOW_SEC);
        grace.cancel();
        this.restoreSeat(back);
        return;
      } catch {
        grace.cancel();
        // 시간 초과 → 아래에서 제거(이미 대리 인계됐으면 `handoverToBot`이 중복을 막는다)
      }
    }
    // 진행 중인 판이면 좌석을 **지우지 않고 봇에게 인계**한다(§8.1).
    // `hands`·`turnOrder`를 지우면 이탈자의 카드가 영구히 반증 불가능해져
    // ("유령 카드") 봇들이 연쇄 오답 고발로 판을 사고사시킨다.
    if (this.state.phase === "playing") this.handoverToBot(client.sessionId);
    else this.removePlayer(client.sessionId);
  }

  /**
   * 이탈 좌석을 대리 NPC로 전환한다(로드맵 §8.1).
   * - `hands`·`turnOrder`는 **절대 건드리지 않는다** — 반증 순환이 유지돼야 유령 카드가 없다.
   * - 좌석 시야(`seenNotSolution`)를 그대로 물려받는다. `revealed` 전역 공유는 §1.1에서
   *   이미 제거됐으므로 §8.1이 말한 `awayBot` 예외는 필요 없다(실행계획 §7.2 ⑧).
   */
  private handoverToBot(sessionId: string): void {
    const p = this.state.players.get(sessionId);
    if (!p) return;
    if (p.isBot) {
      // 이미 봇이 대리 중인 좌석 — 중복 인계 방지.
      p.connected = false;
      return;
    }
    p.isBot = true;
    p.awayBot = true;
    p.connected = false;
    this.initBotKnowledge(sessionId); // 기존 손패 + 지금까지 본 카드로 추리 노트 재구성
    this.broadcast("log", {
      text: `💤 대리 시작 — ${p.name} 님 이탈 · NPC가 자리를 이어받았어요 (손패 유지)`,
      kind: "info",
    });
    // 방장은 사람에게만 의미가 있다(시작·리매치 버튼).
    if (this.state.host === sessionId) {
      this.state.host =
        [...this.state.players.values()].find((q) => !q.isBot)?.id ?? "";
    }
    // 자기 턴을 쥔 채 나갔다면 그 턴을 대리 NPC가 이어서 진행한다(무한 정지 방지).
    if (this.state.currentTurn === sessionId) {
      this.cancelTimer(TURN_TIMER);
      // 좌석이 봇이 된 이상 사람 턴 클럭은 의미가 없다(§8.2 — 봇은 스스로 턴을 넘긴다).
      this.cancelTimer(TURN_CLOCK);
      this.state.turnEndsAt = 0;
      this.suggestedTurnBy = "";
      this.scheduleBotIfNeeded();
    }
    this.syncMeta();
  }

  /**
   * 재접속한 좌석을 사람에게 되돌린다(§8.3 (a) · §8.2).
   * - **손패를 다시 개별 전송**한다 — 이게 없으면 새로고침 한 번에 "재접속 지원"이 거짓이 된다.
   * - 대리 NPC가 이어받고 있었다면(`awayBot`) 좌석을 반환하고 봇 추리 노트를 버린다.
   *   `hands`·`turnOrder`·`seenNotSolution`은 인계 때도 건드리지 않았으므로 그대로 이어진다.
   */
  private restoreSeat(client: Client): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    p.connected = true;
    if (p.awayBot) {
      p.isBot = false;
      p.awayBot = false;
      this.botKnowledge.delete(p.id);
      // 대리 NPC가 진행 중이던 행동(이동 후 제안 등)은 사람이 돌아왔으니 회수한다.
      if (this.state.currentTurn === p.id) this.cancelTimer(TURN_TIMER);
    }
    if (!this.state.host) this.state.host = p.id;
    this.sendHand(p.id);
    // §8.3 (b) — 추리 기록은 `#log` DOM에만 있어 새로고침 한 번에 통째로 사라졌다.
    // 실시간 브로드캐스트와 **같은 배열**을 그대로 되돌려준다.
    this.sendSuggestLog(client);
    client.send("aiStats", this.ai.snapshot()); // 칩도 이번 판 값으로 복구
    // 판이 이미 끝난 뒤의 새로고침 — 결과 오버레이가 봉투 없이 뜨지 않게 다시 보낸다.
    // 진행 중이면 `sendSolutionTo`가 첫 줄에서 스스로 막는다.
    this.sendSolutionTo(client);
    this.broadcast("log", { text: `🙋 재접속 — ${p.name} 님` });
    // 8초(끊김) 클럭으로 돌던 턴을 사람 기준(45초)으로 다시 건다.
    if (this.state.currentTurn === p.id) this.armTurnClock();
  }

  private removePlayer(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (player) this.broadcast("log", { text: `🚪 퇴장 — ${player.name} 님` });
    this.state.players.delete(sessionId);
    this.hands.delete(sessionId);
    this.botKnowledge.delete(sessionId);
    this.seenNotSolution.delete(sessionId);
    this.suggestedIn.delete(sessionId);
    // 이탈자가 자기 턴(즉시고발 창·턴 클럭 포함)을 쥐고 있었다면 타이머를 회수한다.
    if (this.state.currentTurn === sessionId) {
      this.cancelTimer(TURN_TIMER);
      this.cancelTimer(TURN_CLOCK);
      this.state.turnEndsAt = 0;
    }
    if (this.state.players.size === 0) this.cancelAllTimers();
    if (this.state.host === sessionId) {
      this.state.host = [...this.state.players.keys()][0] ?? "";
    }
    if (
      this.state.phase === "playing" &&
      this.state.currentTurn === sessionId
    ) {
      this.advanceTurn();
    }
    this.syncMeta();
  }

  // ── 이동 (그리드 한 칸, 서버 검증) — 정통 클루: 자기 턴 + 이동 한도 내에서만 ──
  private handleMove(client: Client, msg: { dx: number; dy: number }): void {
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.eliminated) return;
    // 자기 턴이 아니면 이동 불가
    if (this.state.currentTurn !== client.sessionId) return;

    const nx = Math.max(
      0,
      Math.min(GRID_WIDTH - 1, player.x + Math.sign(msg.dx ?? 0)),
    );
    const ny = Math.max(
      0,
      Math.min(GRID_HEIGHT - 1, player.y + Math.sign(msg.dy ?? 0)),
    );
    // 벽/경계로 실제 이동이 없으면 무시
    if (nx === player.x && ny === player.y) return;
    // 방 경계는 입구로만 출입 (벽)
    if (!canCross(player.x, player.y, nx, ny)) return;
    // P5: 다른 말이 있는 칸으로는 이동 불가 (입구 칸이 막히면 진입 불가 = 문 봉쇄)
    // §8.3 관전자 제외 ②/③ — 관전자는 `state.players`에 없으므로 충돌 대상이 아니다.
    const occupied = [...this.state.players.values()].some(
      (p) => p.id !== client.sessionId && !p.eliminated && p.x === nx && p.y === ny,
    );
    if (occupied) return;

    // 방에 들어간 턴엔 그 방에서 나가지 못한다(정통 클루). 방 안 이동은 자유.
    const fromRoom = roomAt(player.x, player.y) !== null;
    const toCorridor = roomAt(nx, ny) === null && !inFeast(nx, ny);
    if (fromRoom && toCorridor && this.state.stepsLeft <= 0) return;

    // 방 안·잔치상 위 이동은 자유(한도 무관). 복도 이동만 한도 소모.
    const free = fromRoom || inFeast(player.x, player.y);
    if (!free && this.state.stepsLeft <= 0) return;
    player.x = nx;
    player.y = ny;
    if (!free) this.state.stepsLeft -= 1;

    const nextRoom = roomAt(nx, ny) ?? "";
    const enteredRoom = nextRoom !== "" && nextRoom !== player.room;
    if (nextRoom !== player.room) {
      player.room = nextRoom;
      this.clearSuggestedIn(player.id); // 방을 벗어났다 → 재진입 잠금 해제(§7.5.2)
      if (nextRoom) {
        this.broadcast("log", {
          text: `🚪 진입 — ${player.name} → ${label(nextRoom)}`,
          kind: "move",
        });
      }
    }
    // P2(정통 클루): 방에 들어서면 그 턴의 이동은 종료된다.
    if (enteredRoom) this.state.stepsLeft = 0;
  }

  // ── 대기실에서 캐릭터 변경 (중복 거부) ──
  private handleChooseCharacter(
    client: Client,
    msg: { value: string },
  ): void {
    if (this.state.phase !== "lobby") return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const value = msg.value;
    if (!(SUSPECTS as readonly string[]).includes(value)) return;
    const takenByOther = [...this.state.players.values()].some(
      (p) => p.id !== player.id && p.suspect === value,
    );
    if (takenByOther) {
      client.send("log", { text: `이미 선택된 캐릭터예요 — ${label(value)}` });
      return;
    }
    player.suspect = value;
    player.name = label(value);
  }

  // ── 게임 시작: NPC 충원 + 정답 봉투 + 카드 분배 ──
  private handleStart(client: Client): void {
    if (this.state.phase !== "lobby") return;
    if (this.state.host !== client.sessionId) {
      client.send("log", { text: "방장만 잔치를 시작할 수 있어요." });
      return;
    }

    // NPC 충원은 `startGame`이 한다(실행계획 §7.2 ⑨) — 리매치에도 같은 규칙이 걸려야
    // 3인 판(덱 구성·공통 단서가 어긋남)이 나오지 않는다.
    //
    // 목록 숨김(`setPrivate(true)`)은 `startGame()`이 한다 — 리매치도 같은 경로를 타야
    // 두 번째 판이 "진행 중인데 공개 목록에 뜨는" 상태가 되지 않는다(아래 §복귀 주석).
    this.startGame();
  }

  // ── 다시 하기(리매치): 종료 상태에서 같은 방으로 새 판 ──
  private handleRematch(client: Client): void {
    if (this.state.phase !== "ended") return;
    const p = this.state.players.get(client.sessionId);
    this.broadcast("log", {
      text: `🔄 다시 하기 — ${p?.name ?? "누군가"} 님 · 새 판을 시작합니다`,
      kind: "info",
    });
    this.startGame();
  }

  /**
   * 공개방 목록 노출 토글 — 판이 도는 동안만 숨긴다.
   *
   * §8.3 (c) — `lock()`이 아니라 `setPrivate()`다. `lock()`은 `joinById`까지 **거부**해서
   * 초대 링크 재입장이 막히고(어디에서도 `unlock()`하지 않았다), 심사자 두 명이 동시에
   * 들어오는 동선도 끊겼다. `setPrivate`는 공개방 목록에서만 감추고 코드 참가는 허용한다 —
   * 진행 중 입장은 `onJoin`이 관전으로 받는다.
   *
   * **복귀 지점(문서 미규정 → 판단 근거)**: `startGame()`에서 숨기고 **판이 끝날 때** 되돌린다.
   *  - 리매치는 `startGame()`을 그대로 다시 타므로 두 번째 판도 자동으로 숨겨진다
   *    (예전처럼 `handleStart`에만 걸어두면 리매치 판이 목록에 뜬 채로 돌았다).
   *  - "전원 이탈"은 복귀 지점이 될 수 없다 — 마지막 클라이언트가 나가면 Colyseus가 방을
   *    폐기(`onDispose`)하므로 되돌릴 대상 자체가 사라진다.
   *  - `ended`에서 되돌리는 것이 안전한 이유: 이때 들어오는 사람은 `onJoin`이 관전으로 받고,
   *    다음 판 시작 시 `seatSpectators()`가 (필요하면 순수 NPC를 밀어내고) 좌석을 준다.
   *    즉 "목록 → 참여"가 실제로 성립하는 상태다.
   *  - 원래 비공개로 만든 방(`createdPublic === false`)은 공개로 바꾸지 않는다.
   */
  private setListed(listed: boolean): void {
    if (!this.createdPublic) return; // 비공개로 만든 방은 계속 비공개
    void this.setPrivate(!listed);
  }

  // ── 판 시작 코어(최초 시작·리매치 공용): 위치/상태 리셋 + 딜 + 턴 개시 ──
  private startGame(): void {
    // 판이 도는 동안 공개방 목록에서 감춘다(최초 시작·리매치 공용 — 위 `setListed` 주석).
    this.setListed(false);
    // 관전자를 먼저 좌석에 앉힌다(§8.3 (c)) — NPC 충원보다 **앞**이어야 사람이 우선된다.
    this.seatSpectators();
    // 빈 자리를 NPC로 6인까지 충원 — 최초 시작과 리매치 **양쪽**에서 돈다(실행계획 §7.2 ⑨).
    // 이탈자가 봇으로 인계(§8.1)되면 자리가 비지 않으므로 대개 아무것도 하지 않는다.
    while (this.state.players.size < MAX_PLAYERS) {
      if (!this.addBot()) break;
    }

    // 위치·탈락 상태 리셋 (사람=중앙 잔치상, 봇=방)
    let hIdx = 0;
    let bIdx = 0;
    this.state.players.forEach((p) => {
      p.eliminated = false;
      if (p.isBot) {
        const r = ROOM_REGIONS[bIdx % ROOM_REGIONS.length];
        p.x = r.x + Math.floor(r.w / 2);
        p.y = r.y + Math.floor(r.h / 2);
        p.room = r.name;
        bIdx++;
      } else {
        const s = this.spawnPoint(hIdx);
        p.x = s.x;
        p.y = s.y;
        p.room = "";
        hIdx++;
      }
    });
    this.state.winner = "";

    // 장물(훔친 것) 토큰을 서로 다른 방 구석에 배치 (제안 시 해당 방으로 이동)
    this.state.weapons.clear();
    WEAPONS.forEach((w, idx) => {
      const r = ROOM_REGIONS[idx % ROOM_REGIONS.length];
      const t = new WeaponToken();
      t.value = w;
      t.x = r.x + 1;
      t.y = r.y + 1;
      t.room = r.name;
      this.state.weapons.set(w, t);
    });

    const ids = [...this.state.players.keys()];
    // 용의자 후보 = 실제 참여자 6명의 캐릭터만 (경우의 수 축소 · 정통 클루)
    const suspectPool = ids.map(
      (id) => this.state.players.get(id)?.suspect ?? "",
    );
    this.suspectPool = suspectPool;

    // 고정 NPC(계략): 선택 안 된 십이지(12−참여6) 배치. 모서리 강함 + 중앙근처 랜덤.
    this.state.helpers.clear();
    const leftover = (SUSPECTS as readonly string[]).filter(
      (z) => !suspectPool.includes(z),
    );
    const corners = [...HELPER_CORNERS];
    shuffle(corners);
    const mids = [...HELPER_MIDS];
    shuffle(mids);
    const nCorner = Math.min(2, leftover.length);
    const spots = [
      ...corners.slice(0, nCorner).map((s) => ({ ...s, strong: true })),
      ...mids
        .slice(0, leftover.length - nCorner)
        .map((s) => ({ ...s, strong: false })),
    ];
    leftover.forEach((z, i) => {
      const spot = spots[i];
      if (!spot) return;
      const h = new HelperToken();
      h.value = z;
      h.x = spot.x;
      h.y = spot.y;
      h.bonus = spot.strong ? "peek2" : "peek";
      this.state.helpers.set(z, h);
    });

    const solution: Solution = {
      suspect: pick(suspectPool) as Solution["suspect"],
      weapon: pick(WEAPONS),
      room: pick(ROOMS),
    };
    this.solution = solution;

    const deck: Card[] = [
      ...suspectPool
        .filter((s) => s !== solution.suspect)
        .map((v): Card => ({ kind: "suspect", value: v })),
      ...WEAPONS.filter((w) => w !== solution.weapon).map(
        (v): Card => ({ kind: "weapon", value: v }),
      ),
      ...ROOMS.filter((r) => r !== solution.room).map(
        (v): Card => ({ kind: "room", value: v }),
      ),
    ];
    shuffle(deck);

    // 공통 단서: 솔로(사람1 + 봇들)일 때 추리 보조로 2장 앞면 공개(정답 아님).
    // 근거: 6인 꽉차면 딜이 딱 나눠떨어져 남는 카드가 없음 → 솔로 난이도 완화용 변형 룰.
    this.state.commonCards.clear();
    this.seenNotSolution.clear();
    this.suggestedIn.clear(); // 재진입 잠금은 판마다 새로 센다(§7.5.2)
    this.suggestedTurnBy = "";
    this.suggestCount = 0; // 총 제안 상한(SUGGEST_CAP)은 판마다 새로 센다
    this.suggestLog = []; // 제안 기록·리플레이도 판 단위(§1.2 · §8.3 b)
    // 종료 사유·실패한 고발은 **판 단위**다. 여기서 비우지 않으면 새 판이 진행 중인데도
    // `sendSolutionTo()`의 두 번째 관문이 열려 있는 상태가 되고, 지난 판의 «내 지목»이
    // 다음 판 결과 화면에 섞인다.
    this.endReason = null;
    this.failedAccusations.clear();
    // 판 시드 — 봇의 확률적 도박 고발(§7.5.3)이 쓰는 유일한 난수원. 판마다 새로 뽑고
    // **반드시 로그로 남긴다**: 이 값을 `ZODIAC_SEED`로 되먹이면 같은 판이 재생된다.
    this.gameSeed = mintGameSeed();
    console.log(`[rng] game seed ${this.gameSeed} (replay: ${SEED_ENV}=${this.gameSeed})`);
    // AI 계측도 판 단위로 센다 — 칩이 말하는 "이번 판 LLM n건"의 n이 이것이다.
    this.ai.reset();
    this.aiSent = "";
    this.pushAiStats(); // 새 판 시작 = 0으로 초기화된 칩을 즉시 내려준다
    this.cancelAllTimers();
    const humanCount = ids.filter(
      (id) => !this.state.players.get(id)?.isBot,
    ).length;
    if (humanCount === 1) {
      const n = Math.min(2, Math.max(0, deck.length - ids.length)); // 딜 유지 위해 여유분만
      for (let j = 0; j < n; j++) {
        const c = deck.shift();
        if (c) {
          this.state.commonCards.push(c.value);
          // 공통 단서는 동기화 상태로 전원에게 보이는 공개 정보 → 전원 시야에 기록.
          this.markSeenForAll(c.value);
        }
      }
      if (this.state.commonCards.length > 0) {
        this.broadcast("log", {
          text: `📢 공통 단서 — 모두 공개 · 정답 아님: ${([...this.state.commonCards] as string[])
            .map((v) => label(v))
            .join(", ")}`,
          kind: "info",
        });
      }
    }

    this.hands.clear();
    ids.forEach((id) => this.hands.set(id, []));
    deck.forEach((card, i) => {
      this.hands.get(ids[i % ids.length])?.push(card);
    });
    // 자기 손패는 자기만 아는 "정답 아님" 정보 → 본인 시야에만 기록.
    ids.forEach((id) => {
      (this.hands.get(id) ?? []).forEach((c) => this.markSeen(id, c.value));
    });

    // 사람에게만 손패 private 전송, 봇은 추리 노트 초기화
    this.botKnowledge.clear();
    for (const id of ids) {
      const player = this.state.players.get(id);
      if (player?.isBot) {
        this.initBotKnowledge(id);
      } else {
        this.sendHand(id); // 재접속 경로와 **같은 헬퍼**로만 보낸다(§8.3 (a))
      }
    }

    this.state.turnOrder.clear();
    ids.forEach((id) => this.state.turnOrder.push(id));
    this.state.currentTurn = ids[0];
    this.state.stepsLeft = this.rollSteps();
    this.state.phase = "playing";
    this.turnStartedAt = this.clock.currentTime;

    const botCount = [...this.state.players.values()].filter(
      (p) => p.isBot,
    ).length;
    const first = this.state.players.get(ids[0]);
    this.broadcast("log", {
      text: `🎊 잔치 시작 — 정답 봉투 봉인 · NPC ${botCount}명 합류`,
    });
    this.broadcast("log", { text: `⏳ ${first?.name} 님의 턴` });
    this.scheduleBotIfNeeded();
    this.armTurnClock();
  }

  private addBot(): boolean {
    const used = new Set(
      [...this.state.players.values()].map((p) => p.suspect),
    );
    const suspect = SUSPECTS.find((s) => !used.has(s));
    if (!suspect) return false;
    const id = `bot-${++this.botSeq}`;
    const bot = new Player();
    bot.id = id;
    bot.isBot = true;
    bot.suspect = suspect;
    bot.name = label(suspect);
    // 봇은 서로 다른 방의 빈 칸에서 시작 (복도가 아니라 방, 겹침 없이)
    const region = ROOM_REGIONS[(this.botSeq - 1) % ROOM_REGIONS.length];
    const cell = this.freeCellIn(region.name, id);
    bot.x = cell.x;
    bot.y = cell.y;
    bot.room = region.name;
    this.state.players.set(id, bot);
    return true;
  }

  /** 방 안에서 다른 말과 겹치지 않는 빈 칸을 찾는다(없으면 중심). */
  private freeCellIn(name: string, excludeId: string): { x: number; y: number } {
    const r = regionOf(name);
    if (!r) return { x: 0, y: 0 };
    const occ = new Set<string>();
    // §8.3 관전자 제외 ①/③ — 관전자는 좌석 자체가 없어 점유 집합에 들어오지 않는다
    // (§8.3이 경고한 "유령 몸통이 문을 막는 봉쇄 버그"가 구조적으로 불가능하다).
    this.state.players.forEach((p, id) => {
      if (id !== excludeId) occ.add(`${p.x},${p.y}`);
    });
    // 문(입구) 칸엔 소환하지 않는다 — 소환 토큰이 문에 앉으면 그 방의 모두가
    // 못 나가는 봉쇄가 생긴다(문은 유일한 출구, 점유 칸은 이동 불가).
    occ.add(`${r.door.x},${r.door.y}`);
    // 방마다 지정된 소환 앵커(문 반대쪽 구석)에서 가까운 순으로 채운다 → 소환
    // 토큰이 한곳에 모여 이동·출입을 방해하지 않음. 명패행(r.y)은 뒤로 미룸.
    const a = r.summon;
    const cells: { x: number; y: number; d: number }[] = [];
    for (let yy = r.y; yy < r.y + r.h; yy++) {
      for (let xx = r.x; xx < r.x + r.w; xx++) {
        const plaque = yy === r.y ? 100 : 0; // 명패행은 최후순위
        // 벽(방 외곽 링)은 뒤로 미룸 → 내부 칸부터 채워 벽에 붙지 않게.
        const wall =
          xx === r.x || xx === r.x + r.w - 1 || yy === r.y || yy === r.y + r.h - 1
            ? 10
            : 0;
        cells.push({
          x: xx,
          y: yy,
          d: Math.abs(xx - a.x) + Math.abs(yy - a.y) + plaque + wall,
        });
      }
    }
    cells.sort((p, q) => p.d - q.d);
    for (const c of cells) {
      if (!occ.has(`${c.x},${c.y}`)) return { x: c.x, y: c.y };
    }
    return roomCenter(name);
  }

  /** 이번 턴 이동 한도(주사위 2d6) — 2~12칸. 방 안 이동은 무료라 실효 이동은 더 큼. */
  private rollSteps(): number {
    const d = (): number => 1 + Math.floor(Math.random() * 6);
    return d() + d();
  }

  private initBotKnowledge(id: string): void {
    const k: BotKnowledge = {
      suspects: new Set<string>(this.suspectPool),
      weapons: new Set<string>(WEAPONS),
      rooms: new Set<string>(ROOMS),
    };
    // 자기 시야(자기 손패 + 전원 공개된 공통 단서)만 소거한다.
    // 다른 좌석이 본 반증 카드는 여기 들어오지 않는다 — 사람과 같은 조건.
    for (const v of this.seenOf(id)) this.eliminateValue(k, v);
    this.botKnowledge.set(id, k);
  }

  private eliminate(k: BotKnowledge, card: Card): void {
    if (card.kind === "suspect") k.suspects.delete(card.value);
    else if (card.kind === "weapon") k.weapons.delete(card.value);
    else k.rooms.delete(card.value);
  }

  /** 카테고리를 모르는 카드값 소거(값은 세 카테고리에서 유일하다). */
  private eliminateValue(k: BotKnowledge, value: string): void {
    k.suspects.delete(value);
    k.weapons.delete(value);
    k.rooms.delete(value);
  }

  // ── 제안(Suggestion) + 시계방향 반증 (사람/봇 공용) ──
  private doSuggestion(
    suggesterId: string,
    suggestion: Suggestion,
  ): { by: string | null; card: Card | null } {
    const suggester = this.state.players.get(suggesterId);
    const sid = `s${++this.suggestSeq}`;
    this.suggestCount += 1;
    // 카테고리별 명확 표기
    this.broadcast("log", {
      text:
        `🔍 제안 — ${suggester?.name} · 용의자: ${label(suggestion.suspect)}` +
        ` · 훔친 것: ${label(suggestion.weapon)} · 장소: ${label(suggestion.room)}`,
      kind: "suggest",
      sid,
    });

    // 지목된 용의자 토큰을 그 방으로 소환 (다음 본인 턴에 그 방에서 시작)
    // §8.3 관전자 제외 ③/③ — 소환 대상 탐색도 `state.players`만 본다(관전자는 없다).
    const target = [...this.state.players.values()].find(
      (p) => p.suspect === suggestion.suspect,
    );
    if (target) {
      const c = this.freeCellIn(suggestion.room, target.id);
      const moved = target.room !== suggestion.room;
      target.x = c.x;
      target.y = c.y;
      target.room = suggestion.room;
      // 소환도 "방이 바뀐" 이동이다 → 끌려온 좌석의 재진입 잠금은 풀린다(§7.5.2).
      // 자기 자신을 지목한 경우(같은 방)엔 바뀐 게 없으므로 잠금을 유지한다.
      if (moved) this.clearSuggestedIn(target.id);
      this.broadcast("log", {
        text: `🔔 소환 — ${label(suggestion.suspect)} → ${label(
          suggestion.room,
        )}`,
        kind: "move",
      });
    }
    // 지목된 장물(훔친 것) 토큰도 그 방으로 이동 (용의자 소환과 대칭)
    const wt = this.state.weapons.get(suggestion.weapon);
    const wr = regionOf(suggestion.room);
    if (wt && wr) {
      // 인물 소환과 **같은 앵커**를 쓴다(`ROOM_REGIONS[].summon`).
      // 예전에는 방 우하단 안쪽 칸으로 고정했는데, 9방 중 6방에서 인물 소환 자리와
      // 어긋나 "제안하면 인물과 물건이 같이 끌려온다"는 서사가 화면에서 깨졌다.
      // 4뷰가 이제 이 칸에 🔔 앵커를 그리므로, 어긋나면 보드 표기가 거짓말이 된다.
      wt.x = wr.summon.x;
      wt.y = wr.summon.y;
      wt.room = suggestion.room;
    }

    // 재진입 규칙(§7.5.2) — 이 방에서는 이 좌석이 다시 제안할 수 없다(방을 벗어나면 해제).
    this.suggestedIn.set(suggesterId, suggestion.room);

    const order = [...this.state.turnOrder] as string[];
    const start = order.indexOf(suggesterId);
    let byId: string | null = null;
    let card: Card | null = null;
    for (let i = 1; i < order.length; i++) {
      const otherId = order[(start + i) % order.length];
      const match = (this.hands.get(otherId) ?? []).find((c) =>
        cardMatches(c, suggestion),
      );
      if (match) {
        byId = otherId;
        card = match;
        break;
      }
    }

    if (byId && card) {
      const other = this.state.players.get(byId);
      // 반증 카드는 **제안자에게만** 보인다(§1.1). 반증자는 자기 손패라 이미 알고 있고,
      // 나머지 좌석은 "누가 반증했는가"라는 공개 정보만 얻는다.
      this.markSeen(suggesterId, card.value);
      this.broadcast("log", {
        text: `🛡 반증 — ${other?.name} 님`,
        kind: "disprove",
        sid,
        disproved: true,
      });
    } else {
      this.broadcast("log", {
        text: "❗ 아무도 반증하지 못함 — 정답 후보!",
        kind: "disprove",
        sid,
        disproved: false,
      });
    }

    // 제안 기록 1건 — 로그 두 줄(제안·반증)과 **같은 사건**을 하나의 행으로 남긴다.
    // ⚠️ `card`(반증 카드 값)는 절대 넣지 않는다. 이 배열은 리플레이로 전원에게
    //    통째로 전송되므로, 여기 한 번 새면 판 전체의 손패가 새는 것과 같다.
    this.recordSuggestEntry(suggesterId, suggestion, byId);

    this.enforceSuggestCap();
    return {
      by: byId ? (this.state.players.get(byId)?.name ?? byId) : null,
      card,
    };
  }

  /**
   * 제안 기록표(§1.2)와 재접속 리플레이(§8.3 b)가 공유하는 **단일 자료구조**에 1건 추가.
   * 실시간 브로드캐스트도 여기서 함께 나간다 — 두 경로가 갈라지면 재접속한 사람이
   * 실시간으로 보던 것과 다른 표를 보게 된다.
   */
  private recordSuggestEntry(
    suggesterId: string,
    suggestion: Suggestion,
    disprovedById: string | null,
  ): void {
    const by = this.state.players.get(suggesterId);
    const dis = disprovedById
      ? this.state.players.get(disprovedById)
      : undefined;
    const entry: SuggestEntry = {
      seq: this.suggestCount, // 판 시작 시 0 → 이 제안에서 이미 +1 됐다(1부터 증가)
      byId: suggesterId,
      byName: by?.name ?? suggesterId,
      suspect: label(suggestion.suspect),
      weapon: label(suggestion.weapon),
      room: label(suggestion.room),
      disprovedById: disprovedById,
      disprovedByName: dis?.name ?? (disprovedById ? disprovedById : null),
    };
    this.suggestLog.push(entry);
    this.broadcast("suggestLog", entry);
  }

  /**
   * 제안 기록 전체를 개별 전송한다(재접속·관전 입장 → §8.3 b 리플레이).
   * 공개 정보만 담긴 배열이라 관전자에게 보내도 비밀이 새지 않는다.
   */
  private sendSuggestLog(client: Client): void {
    if (this.suggestLog.length === 0) return;
    client.send("suggestLogAll", this.suggestLog);
  }

  /**
   * 정답 봉투 개봉 — **판이 끝난 뒤에만** 나가는 유일한 경로(ui-copy §7.0 선행 조건).
   *
   * 결과 오버레이 6종(§7.1)은 전부 정답 봉투를 화면에 실어야 하는데, 07-28까지 봉투가
   * 나가는 곳은 「고발 성공」·「무승부」의 **로그 문장**뿐이라 클라가 값을 쓸 수 없었고
   * 「최후 생존」에서는 아예 공개되지 않았다. 여기서 세 경로를 하나로 합친다.
   *
   * ⚠️ **누설 방지 불변식** — 이 방에서 `this.solution`을 클라로 내보내는 코드는
   *    `sendSolutionTo()` 하나뿐이고, 그 첫 줄이 `phase !== "ended"`를 막는다.
   *    `endReason`도 종료 분기에서만 채워지므로 진행 중에는 두 겹으로 닫혀 있다.
   */
  private revealSolution(): void {
    for (const client of this.clients) this.sendSolutionTo(client);
  }

  /**
   * 한 명에게 정답 봉투를 보낸다(재접속·뒤늦은 입장의 복구 경로도 이 함수를 탄다).
   * `mine`은 **받는 사람 자신의** 실패한 고발이다 — 남의 것은 어느 경우에도 담지 않는다.
   */
  private sendSolutionTo(client: Client): void {
    if (this.state.phase !== "ended") return; // ← 진행 중 누설 차단(유일한 관문)
    if (!this.solution || !this.endReason) return;
    const mine = this.failedAccusations.get(client.sessionId) ?? null;
    client.send("solution", {
      reason: this.endReason,
      suspect: this.solution.suspect,
      weapon: this.solution.weapon,
      room: this.solution.room,
      // 무승부 부제("제안 75회에 이르도록 …")의 75 — 클라가 서버 상수를 베끼지 않게 실어 보낸다.
      suggestCap: SUGGEST_CAP,
      mine: mine
        ? { suspect: mine.suspect, weapon: mine.weapon, room: mine.room }
        : null,
    });
  }

  /**
   * 총 제안 상한(§1.1 · §7.5 정정본 60) — 판이 무한히 늘어지는 것을 막는다.
   * 상한에 도달하면 제안마다 공통 단서를 1장씩 **결정론적으로** 추가 공개해 후보를 강제 수렴시키고,
   * 더 공개할 카드가 없으면 무승부로 종료하며 정답 봉투를 공개한다(가장 보수적인 백스톱).
   */
  private enforceSuggestCap(): void {
    if (this.state.phase !== "playing") return;
    if (this.suggestCount < SUGGEST_CAP) return;
    if (this.revealCommonClue()) return;
    this.endInDraw();
  }

  /**
   * 아직 공개되지 않은 비정답 카드 1장을 공통 단서로 추가 공개한다(결정론적 선택).
   * 카드 "값"만 공개하므로 누가 들고 있는지는 드러나지 않는다(손패 비밀 유지).
   */
  private revealCommonClue(): boolean {
    if (!this.solution) return false;
    const already = new Set<string>([...this.state.commonCards] as string[]);
    const order: string[] = [
      ...this.suspectPool,
      ...(WEAPONS as readonly string[]),
      ...(ROOMS as readonly string[]),
    ];
    const next = order.find(
      (v) =>
        v !== "" &&
        v !== this.solution?.suspect &&
        v !== this.solution?.weapon &&
        v !== this.solution?.room &&
        !already.has(v),
    );
    if (!next) return false;
    this.state.commonCards.push(next);
    this.markSeenForAll(next);
    this.botKnowledge.forEach((k) => this.eliminateValue(k, next));
    this.broadcast("log", {
      text: `📢 공통 단서 — 모두 공개 · 정답 아님: ${label(next)}`,
      kind: "info",
    });
    return true;
  }

  /** 무승부 종료 — 승자 없음 + 정답 봉투 공개. */
  private endInDraw(): void {
    if (!this.solution) return;
    this.state.phase = "ended";
    this.state.winner = "";
    this.endReason = "draw";
    this.cancelAllTimers();
    this.setListed(true); // 판이 끝났다 → 공개방 목록으로 복귀
    this.logAiSummary();
    this.broadcast("log", {
      // 확정 문안(UI 문안 명세 §8.1 · 07-28 확정). 실측 발생률 0.0%지만 백스톱이라 남긴다.
      text: `🏳 무승부 — 제안 ${SUGGEST_CAP}회 도달 · 판을 종료합니다`,
      kind: "win",
    });
    this.broadcast("log", {
      text: `📜 정답 봉투 — ${label(this.solution.suspect)} · ${label(
        this.solution.weapon,
      )} · 📍 ${label(this.solution.room)}`,
      kind: "win",
    });
    this.revealSolution(); // 결과 오버레이 5번(무승부)이 봉투를 화면에 싣는다
  }

  private handleSuggest(client: Client, msg: Suggestion): void {
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.currentTurn !== player.id) {
      client.send("log", { text: "지금은 내 차례가 아니에요." });
      return;
    }
    if (!player.room) {
      client.send("log", {
        text: "방 안에서만 제안할 수 있어요. 입구(🚪)로 들어가세요.",
      });
      return;
    }
    // 즉시고발 창이 열려 있는 동안(같은 턴) 재제안 금지 — 남은 선택은 [고발] 또는 [턴 종료].
    if (this.suggestedTurnBy === player.id) {
      client.send("log", {
        text: "지금 고발할 수 있어요. 넘기려면 [턴 종료].",
      });
      return;
    }
    // 재진입 규칙(§7.5.2) — 같은 방에서 눌러앉아 매 턴 제안하는 것을 막는다.
    // (즉시고발 창 안내가 더 구체적이므로 그 검사 뒤에 온다 — ui-copy §5.1 우선순위 5)
    if (this.suggestedIn.get(player.id) === player.room) {
      client.send("log", {
        text: "이 방에서는 이미 제안했어요. 다른 방으로 옮기세요.",
      });
      return;
    }
    // ⚠️ 지목 값은 **자기 손패여도 허용**한다(§7.5.2 "제안에서 자기 손패도 지목 허용").
    // 클루 최강 전술("내 카드를 지목해 반증자를 통제")이라 서버가 막으면 안 된다 —
    // 실제로 여기에 손패 검증은 원래부터 없다. 되살리지 말 것.
    const suggestion: Suggestion = {
      suspect: msg.suspect,
      weapon: msg.weapon,
      room: player.room as Suggestion["room"],
    };
    const result = this.doSuggestion(player.id, suggestion);
    client.send("disprove", {
      by: result.by,
      card: result.card,
      suggestion,
    });
    // 상한 도달로 판이 끝났을 수 있다(§1.1 SUGGEST_CAP).
    if (this.state.phase !== "playing") return;

    // ── 즉시고발권(§7.5.1) ──────────────────────────────────────────────
    // 예전에는 여기서 무조건 advanceTurn()이라 사람만 봇 5턴을 기다려야 고발할 수 있었다.
    // 이제 사람도 자기 제안 직후 같은 턴에 고발한다(봇은 SPEAK_HOLD 안에서 이미 그렇게 한다).
    // 이동은 소진하고(stepsLeft=0) 재제안은 잠근 뒤, 제한 시간이 지나면 자동으로 턴을 넘긴다.
    this.state.stepsLeft = 0;
    this.suggestedTurnBy = player.id;
    // 같은 문장을 로그로도 보내면 제안자는 턴 배너 부제와 로그에서 두 번 읽는다
    // (UI 문안 명세 §11 "같은 사건이 두 줄" 위반). 카운트다운은 부제가 전담한다.
    client.send("canAccuse", { ms: ACCUSE_WINDOW_MS, suggestion });
    // 즉시고발 창이 곧 이 턴의 마감이다 — 턴 클럭(§8.2)과 **동시에 살려두지 않는다.**
    // (키가 서로 달라 자동 취소되지 않으므로 여기서 명시적으로 끈다. 켜둔 채로 두면
    //  45초 클럭이 30초 창 뒤에 한 번 더 `advanceTurn`을 때려 남의 턴을 넘긴다.)
    this.cancelTimer(TURN_CLOCK);
    this.state.turnEndsAt = this.clock.currentTime + ACCUSE_WINDOW_MS;
    this.armTimer(TURN_TIMER, ACCUSE_WINDOW_MS, () => {
      // 만료 시점에 여전히 같은 사람의 턴일 때만 넘긴다(고발·턴 종료로 이미 넘어갔으면 무시).
      if (this.state.phase !== "playing") return;
      if (this.state.currentTurn !== player.id) return;
      this.advanceTurn();
    });
  }

  // ── 고발(Accusation) (사람/봇 공용) ──
  private doAccusation(playerId: string, accusation: Suggestion): void {
    if (!this.solution) return;
    const player = this.state.players.get(playerId);
    if (!player) return;

    const correct =
      accusation.suspect === this.solution.suspect &&
      accusation.weapon === this.solution.weapon &&
      accusation.room === this.solution.room;

    this.broadcast("accuseResult", { player: player.name, correct });

    if (correct) {
      this.state.phase = "ended";
      this.state.winner = playerId;
      this.endReason = "accuse";
      this.cancelAllTimers();
      this.setListed(true); // 판이 끝났다 → 공개방 목록으로 복귀
      this.logAiSummary();
      this.broadcast("log", {
        text: `🎉 사건 해결 — ${player.name} 님`,
        kind: "win",
      });
      this.broadcast("log", {
        text: `📜 정답 봉투 — ${label(this.solution.suspect)} · ${label(
          this.solution.weapon,
        )} · 📍 ${label(this.solution.room)}`,
        kind: "win",
      });
      this.revealSolution(); // 결과 오버레이 1·2번이 봉투를 화면에 싣는다
    } else {
      player.eliminated = true;
      // 본인 화면(§7.1 4번)의 «내 지목» 대조용. 브로드캐스트하지 않는다 —
      // 오답 조합은 "정답이 아니다"라는 진실값이라 남에게 가면 판이 기울어진다.
      this.failedAccusations.set(playerId, {
        suspect: accusation.suspect,
        weapon: accusation.weapon,
        room: accusation.room,
      });
      this.broadcast("log", {
        text: `❌ 고발 실패 — ${player.name} 님 탈락 · 반증만 가능`,
        kind: "accuse",
      });
      this.advanceTurn();
    }
  }

  private handleAccuse(client: Client, msg: Suggestion): void {
    if (this.state.phase !== "playing" || !this.solution) return;
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.currentTurn !== player.id) {
      client.send("log", { text: "지금은 내 차례가 아니에요." });
      return;
    }
    this.doAccusation(player.id, msg);
  }

  private handleEndTurn(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.currentTurn !== player.id) return;
    this.advanceTurn();
  }

  // ── NPC 턴 1박자: 방으로 이동 (제안은 잠시 뒤 별도) ──
  private runBotTurn(id: string): void {
    if (this.state.phase !== "playing" || this.state.currentTurn !== id) return;
    const bot = this.state.players.get(id);
    if (!bot || !bot.isBot) return;
    const k = this.botKnowledge.get(id);
    if (!k) {
      this.advanceTurn();
      return;
    }

    // 1) 소환/현재 방이 아직 후보면 거기서 진행(소환 존중). 아니면 후보 방을 노려 이동.
    //    단 재진입 규칙(§7.5.2)은 봇에도 동일하게 적용된다 — 이미 제안한 방이면 반드시 옮긴다.
    const blocked = this.suggestedIn.get(id) ?? "";
    const stay = !!bot.room && k.rooms.has(bot.room) && bot.room !== blocked;
    const others = [...k.rooms].filter((r) => r !== blocked && r !== bot.room);
    const anyRoom = (ROOMS as readonly string[]).filter(
      (r) => r !== blocked && r !== bot.room,
    );
    const targetRoom = stay
      ? bot.room
      : others.length > 0
        ? pick(others)
        : anyRoom.length > 0
          ? pick(anyRoom)
          : pick(ROOMS);
    const region = regionOf(targetRoom) ?? pick(ROOM_REGIONS);
    const cell = this.freeCellIn(region.name, id);
    bot.x = cell.x;
    bot.y = cell.y;
    if (bot.room !== region.name) {
      bot.room = region.name;
      this.clearSuggestedIn(id); // 방을 옮겼다 → 재진입 잠금 해제(§7.5.2)
      this.broadcast("log", {
        text: `🚪 진입 — ${bot.name} → ${label(region.name)}`,
        kind: "move",
      });
    }

    // 2) 한 박자 쉬고 제안 (사용자 인지 시간) — 턴 스코프 타이머
    this.armTimer(TURN_TIMER, BOT_ACT_GAP, () =>
      this.botSuggestPhase(id, region.name),
    );
  }

  // ── NPC 턴 2박자: 제안/추리 → 확신 시 고발 ──
  private botSuggestPhase(id: string, roomName: string): void {
    if (this.state.phase !== "playing" || this.state.currentTurn !== id) return;
    const bot = this.state.players.get(id);
    const k = this.botKnowledge.get(id);
    if (!bot || !k) {
      this.advanceTurn();
      return;
    }

    // 이 봇이 **자기 눈으로 본** 카드만 제외하고 제안한다(§1.1 정보 대칭성).
    // 룸 전역 공유 집합은 존재하지 않는다 — 다른 좌석이 본 반증은 여기 들어오지 않는다.
    const seen = this.seenOf(id);
    const eff = (set: Set<string>): string[] => {
      const c = [...set].filter((v) => !seen.has(v));
      return c.length ? c : [...set];
    };
    const es = eff(k.suspects);
    const ew = eff(k.weapons);
    const suggestion: Suggestion = {
      suspect: (pick(es) ?? pick(this.suspectPool)) as Suggestion["suspect"],
      weapon: (pick(ew) ?? pick(WEAPONS)) as Suggestion["weapon"],
      room: roomName as Suggestion["room"],
    };
    const result = this.doSuggestion(id, suggestion);
    // 상한 도달로 판이 끝났으면 대사·후속 타이머를 걸지 않는다(§1.1 SUGGEST_CAP).
    if (this.state.phase !== "playing") return;

    // 제안 대사가 타이핑되는 동안엔 턴을 넘기지 않는다(카메라 튐 방지).
    // 홀드 길이는 **실제 대사 길이**로만 정해지므로(spec §1.3), 문장이 도착한 뒤에
    // 타이머를 건다. 그 사이(LLM 왕복 ≤ 4s)에도 턴은 이 봇이 쥐고 있어 카메라는 고정이다.
    void this.speak(id, {
      name: bot.name,
      persona: persona(bot.suspect),
      action: "suggest",
      suspect: label(suggestion.suspect),
      weapon: label(suggestion.weapon),
      room: label(suggestion.room),
      disproved: !!result.card,
    }).then((line) => this.afterBotSpeak(id, k, suggestion, result, line));
  }

  /**
   * NPC 제안 대사가 실제로 방송된 뒤 — 말풍선 수명만큼 홀드하고 결정을 수행한다.
   * 턴 스코프 타이머(즉시고발 창과 같은 프리미티브)이며 턴이 바뀌면 함께 회수된다.
   */
  private afterBotSpeak(
    id: string,
    k: BotKnowledge,
    suggestion: Suggestion,
    result: { by: string | null; card: Card | null },
    line: string,
  ): void {
    if (this.state.phase !== "playing" || this.state.currentTurn !== id) return;
    const bot = this.state.players.get(id);
    if (!bot) return;
    const eff = (set: Set<string>): string[] => {
      const seen = this.seenOf(id);
      const c = [...set].filter((v) => !seen.has(v));
      return c.length ? c : [...set];
    };

    this.armTimer(TURN_TIMER, this.speakHold(line), () => {
      if (this.state.phase !== "playing" || this.state.currentTurn !== id) return;

      if (result.card) {
        // 반증받은 카드는 정답 아님 → 후보에서 제거
        this.eliminate(k, result.card);
      } else {
        // 아무도 반증 못했고 내가 3장 다 안 갖고 있으면 → 그 셋이 정답
        const holdsAny = (this.hands.get(id) ?? []).some((c) =>
          cardMatches(c, suggestion),
        );
        if (!holdsAny) {
          void this.speak(id, {
            name: bot.name,
            persona: persona(bot.suspect),
            action: "accuse",
            suspect: label(suggestion.suspect),
            weapon: label(suggestion.weapon),
            room: label(suggestion.room),
          });
          this.doAccusation(id, suggestion);
          return;
        }
      }

      // 3) 유효 후보(공유 지식 반영)가 각 1개로 좁혀졌으면 고발
      const fs = eff(k.suspects);
      const fw = eff(k.weapons);
      const fr = eff(k.rooms);
      if (fs.length === 1 && fw.length === 1 && fr.length === 1) {
        const acc: Suggestion = {
          suspect: fs[0] as Suggestion["suspect"],
          weapon: fw[0] as Suggestion["weapon"],
          room: fr[0] as Suggestion["room"],
        };
        void this.speak(id, {
          name: bot.name,
          persona: persona(bot.suspect),
          action: "accuse",
          suspect: label(acc.suspect),
          weapon: label(acc.weapon),
          room: label(acc.room),
        });
        this.doAccusation(id, acc);
        return;
      }

      // 4) 확신은 없지만 후보가 좁혀졌다 → **페르소나 배짱 + 시드 RNG로 도박 고발**
      //    (ai-tech-doc §1.2 (b) · roadmap §7.5.3). 틀리면 봇도 탈락한다 —
      //    탈락 리스크를 사람만 지던 결함이 여기서 닫힌다.
      //    판정은 순수 규칙 함수(`rules/bot-accuse.ts`)가 하고, 대사는 그 **뒤에** 붙는다.
      const gamble = gambleAccusation({
        seed: this.gameSeed,
        seat: id,
        // 결정 좌표 = 이 판의 제안 일련번호. 같은 시드·같은 판이면 같은 값이 나온다.
        decision: this.suggestSeq,
        nerve: botNerve(bot.suspect),
        suspects: fs,
        weapons: fw,
        rooms: fr,
        unit: seededUnit,
      });
      if (gamble) {
        const acc: Suggestion = {
          suspect: gamble.suspect as Suggestion["suspect"],
          weapon: gamble.weapon as Suggestion["weapon"],
          room: gamble.room as Suggestion["room"],
        };
        void this.speak(id, {
          name: bot.name,
          persona: persona(bot.suspect),
          action: "accuse",
          suspect: label(acc.suspect),
          weapon: label(acc.weapon),
          room: label(acc.room),
        });
        this.doAccusation(id, acc);
        return;
      }

      this.advanceTurn();
    });
  }

  /**
   * NPC 대사: 결정된 정보만 넘겨 LLM 대사 생성, 실패 시 규칙 폴백 → 브로드캐스트.
   * **실제로 방송한 문장을 반환한다** — 호출부가 그 길이로 말풍선 홀드를 계산한다
   * (4뷰 계약 spec §1.3: 서버 홀드 < `bubbleLifeMs`면 말하는 도중 턴이 넘어간다).
   * 방송하지 못했으면 `""`(홀드 불필요).
   */
  private async speak(id: string, input: NarrationInput): Promise<string> {
    // 캐릭터 말투(voice)를 주입해 페르소나를 대사에 뚜렷이 반영.
    const suspect = this.state.players.get(id)?.suspect;
    const v = suspect ? voice(suspect) : undefined;
    const enriched: NarrationInput = v
      ? {
          ...input,
          persona: input.persona ?? persona(suspect as string),
          tone: v.tone,
          intro: v.intro,
          outro: v.outro,
        }
      : input;

    const { text, ai } = await this.narrateWithMeta(enriched, id);
    if (!this.state.players.has(id)) return "";
    this.broadcast("say", { id, from: input.name, text, ai });
    return text;
  }

  /**
   * `narrate()` 호출 + 계측 1건 확정 — **문장이 나가는 모든 경로가 여기 하나를 지난다.**
   * 폴백 대체·경로 기록·서버 로그·집계 브로드캐스트를 한곳에 모아, 호출부가 늘어도
   * "계측을 빼먹은 경로"가 생기지 않게 한다(07-27 장애의 재발 조건이 그것이다).
   */
  private async narrateWithMeta(
    input: NarrationInput,
    seat: string,
  ): Promise<{ text: string; ai: SayAi }> {
    const r = await narrate(input); // narrate는 throw하지 않는다(사유가 사라지므로)
    const ai: SayAi = {
      source: r.source,
      ms: r.ms,
      model: r.model,
      ...(r.reason ? { reason: r.reason } : {}),
    };
    const text = r.text ?? fallbackLine(input);
    this.ai.record(ai);
    recordAi(ai); // 프로세스 누적(`GET /health`)
    logAi(
      { seat, name: input.name, action: input.action, textLen: text.length },
      ai,
    );
    this.pushAiStats();
    return { text, ai };
  }

  /** 이번 판 누적 집계 — **값이 바뀔 때만** 브로드캐스트(칩 전용, 게임 상태 아님). */
  private pushAiStats(): void {
    const stats: AiStats = this.ai.snapshot();
    const key = JSON.stringify(stats);
    if (key === this.aiSent) return;
    this.aiSent = key;
    this.broadcast("aiStats", stats);
  }

  /** 판 종료 집계 한 줄(④ §4) — 경로별 건수·평균 지연·폴백 사유 분포. */
  private logAiSummary(): void {
    if (this.ai.total === 0) return;
    console.log(`[ai] game summary ${this.ai.summaryLine()}`);
  }

  /**
   * 말풍선이 화면에 살아 있는 시간(ms) — 클라 `bubbleLifeMs`와 **같은 함수**로 계산한다.
   * 예전 고정값 `SPEAK_HOLD = 2400`은 클라 최솟값 2600보다도 짧아 **모든 대사에서**
   * 서버가 먼저 턴을 넘겼다(spec §1.3 위반). 대사를 받은 뒤에 타이머를 걸어야
   * "실제 대사 길이"가 들어간다 — 그래서 `speak()`가 문장을 반환한다.
   */
  private speakHold(text: string): number {
    return text ? bubbleLifeMs(text) : 0;
  }

  /**
   * NPC 행동 딜레이 = 사용자 평균 턴 시간의 절반 (클램프 + 라운드 예산).
   * 로드맵 §1.4·§7.5.4: 규약("평균의 절반")은 **기준값**으로 유지하고, 그 위에
   * ① 라운드 예산(`12000 / 남은 봇 수`) ② 상한 1600 을 얹어 판 길이를 묶는다.
   * 판이 5.6라운드로 길어진 뒤에는 상한이 사실상 항상 이긴다(§7.5.4).
   */
  private npcDelay(): number {
    // §8.2 다인 페이싱 — `avgHumanTurnMs`는 **모든 사람의 단일 EMA**라 사람이 늘수록
    // 한 바퀴가 길어지는데 봇 딜레이는 그대로였다. 규약("사용자 평균의 절반")을
    // **1인당 해석**으로 읽어 사람 수로 나눈다(사람 1명이면 기존과 완전히 동일).
    const humans = Math.max(1, this.humanSeats());
    const base =
      this.avgHumanTurnMs > 0
        ? this.avgHumanTurnMs / (2 * humans)
        : NPC_DELAY_DEFAULT;
    const bots = [...this.state.players.values()].filter(
      (p) => p.isBot && !p.eliminated,
    ).length;
    // 라운드 예산(§1.4)은 "내 턴 사이 간격"을 묶는 장치다. 그런데 봇 1턴의 비용은
    // 딜레이만이 아니라 `BOT_ACT_GAP` + 대사 홀드까지다 — 딜레이에만 예산을 걸면
    // 예산이 사실상 아무것도 하지 않는다(5봇 기준 2400 > 상한 1600이라 항상 무시됐다).
    // 예산에서 **나머지 비용을 먼저 뺀** 몫만 딜레이에 준다.
    const budget =
      NPC_ROUND_BUDGET_MS / Math.max(1, bots) - (BOT_ACT_GAP + EST_SPEAK_HOLD_MS);
    return Math.max(
      NPC_DELAY_MIN,
      Math.min(NPC_DELAY_MAX, budget, base),
    );
  }

  /** 떠나는 턴이 사람이면 소요시간을 EMA로 기록. */
  private recordTurnDuration(): void {
    const leaving = this.state.players.get(this.state.currentTurn);
    if (leaving && !leaving.isBot && this.turnStartedAt > 0) {
      const dur = this.clock.currentTime - this.turnStartedAt;
      if (dur > 0 && dur < 120000) {
        this.avgHumanTurnMs =
          this.avgHumanTurnMs === 0
            ? dur
            : this.avgHumanTurnMs * 0.6 + dur * 0.4;
      }
    }
  }

  /** 이 방에서 좌석을 가진 **사람**의 수(대리 NPC로 넘어간 자리는 사람이 아니다). */
  private humanSeats(): number {
    return [...this.state.players.values()].filter((p) => !p.isBot).length;
  }

  /**
   * 턴 클럭(로드맵 §8.2) — AFK 1명이 판 전체를 무한 정지시키는 것을 막는다.
   * `handleEndTurn`은 당사자만 호출할 수 있어서, 사람이 아무것도 하지 않으면
   * 예전에는 **아무도 판을 진행시킬 수 없었다**(사람 턴 타임아웃 0개).
   *
   * - 전용 타이머를 새로 만들지 않고 공용 프리미티브 `armTimer`에 인자만 넘긴다.
   * - **사람이 1명뿐이면 걸지 않는다** — 솔로 심사 동선에서 45초 압박은 손해다(§8.2).
   * - 시간값: 접속 중 45초 / 접속 끊김 8초(§8.2).
   * - 봇 턴에는 걸지 않는다(봇은 자기 타이머로 반드시 턴을 넘긴다).
   */
  private armTurnClock(): void {
    this.cancelTimer(TURN_CLOCK);
    this.state.turnEndsAt = 0;
    if (this.state.phase !== "playing") return;
    const id = this.state.currentTurn;
    const p = this.state.players.get(id);
    if (!p || p.isBot || p.eliminated) return;
    if (this.humanSeats() < 2) return; // 솔로 = 클럭 없음
    const ms = p.connected ? TURN_LIMIT_HUMAN_MS : TURN_LIMIT_AWAY_MS;
    if (!p.connected) {
      this.broadcast("log", { text: `⏳ 접속 대기 8초 — ${p.name} 님` });
    }
    this.state.turnEndsAt = this.clock.currentTime + ms;
    this.armTimer(TURN_CLOCK, ms, () => {
      if (this.state.phase !== "playing") return;
      if (this.state.currentTurn !== id) return;
      this.broadcast("log", {
        text: "⌛ 시간 초과 — 다음 사람에게 넘어갔어요",
        kind: "info",
      });
      this.advanceTurn();
    });
  }

  private scheduleBotIfNeeded(): void {
    if (this.state.phase !== "playing") return;
    const cur = this.state.players.get(this.state.currentTurn);
    if (cur?.isBot) {
      // 턴 스코프 타이머 — 턴이 바뀌거나 방이 닫히면 함께 취소된다.
      this.armTimer(TURN_TIMER, this.npcDelay(), () => this.runBotTurn(cur.id));
    }
  }

  private advanceTurn(): void {
    // 턴 스코프 타이머(즉시고발 창·봇 행동·턴 클럭)는 턴을 넘기는 순간 반드시 회수한다.
    this.cancelTimer(TURN_TIMER);
    this.cancelTimer(TURN_CLOCK);
    this.state.turnEndsAt = 0;
    this.suggestedTurnBy = "";
    this.recordTurnDuration();
    const order = ([...this.state.turnOrder] as string[]).filter((id) => {
      const p = this.state.players.get(id);
      return p && !p.eliminated;
    });
    if (order.length === 0) return;
    if (order.length === 1) {
      this.state.phase = "ended";
      this.state.winner = order[0];
      this.endReason = "survivor";
      this.cancelAllTimers();
      this.setListed(true); // 판이 끝났다 → 공개방 목록으로 복귀
      this.logAiSummary();
      const w = this.state.players.get(order[0]);
      this.broadcast("log", {
        text: `🎉 최후 생존 — ${w?.name} 님 승리!`,
        kind: "win",
      });
      // 여기까지 정답이 **어디에도** 공개되지 않던 유일한 종료 경로였다(ui-copy §7.0).
      // 다른 두 종료와 같은 2줄 구성(결과 + 봉투)으로 맞추고, 오버레이 3·3′번용으로도 보낸다.
      if (this.solution) {
        this.broadcast("log", {
          text: `📜 정답 봉투 — ${label(this.solution.suspect)} · ${label(
            this.solution.weapon,
          )} · 📍 ${label(this.solution.room)}`,
          kind: "win",
        });
      }
      this.revealSolution();
      return;
    }
    const cur = order.indexOf(this.state.currentTurn);
    const next = order[(cur + 1) % order.length];
    this.state.currentTurn = next;
    this.state.stepsLeft = this.rollSteps();
    this.turnStartedAt = this.clock.currentTime;
    const np = this.state.players.get(next);
    this.broadcast("log", { text: `⏳ ${np?.name} 님의 턴` });
    this.scheduleBotIfNeeded();
    this.armTurnClock();
  }

  // 사람 플레이어 초기 위치 = 중앙 잔치상 주변 (봇은 addBot에서 방 스폰)
  private spawnPoint(index: number): { x: number; y: number } {
    const pts = [
      { x: 11, y: 11 },
      { x: 13, y: 11 },
      { x: 11, y: 13 },
      { x: 13, y: 13 },
      { x: 12, y: 10 },
      { x: 12, y: 14 },
    ];
    return pts[index % pts.length];
  }
}
