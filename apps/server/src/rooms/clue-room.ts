import { Room, type Client } from "colyseus";
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  MAX_PLAYERS,
  ROOM_REGIONS,
  ROOMS,
  SUSPECTS,
  WEAPONS,
  canCross,
  inFeast,
  label,
  passageOf,
  persona,
  regionOf,
  roomAt,
  roomCenter,
  voice,
  type Card,
  type Solution,
  type Suggestion,
} from "@zodiac-clue/shared";
import {
  GameState,
  HelperToken,
  Player,
  WeaponToken,
} from "../schema/game-state";
import { fallbackLine, narrate, type NarrationInput } from "../ai/narrator";

type JoinOptions = { character?: string };
type CreateOptions = { isPublic?: boolean };

/** 봇의 추리 노트 — 각 카테고리에서 아직 남은(정답 후보) 값들. */
type BotKnowledge = {
  suspects: Set<string>;
  weapons: Set<string>;
  rooms: Set<string>;
};

// NPC 행동 딜레이 = 사용자 평균 턴 시간의 절반 (클램프). 데이터 없으면 기본값.
// 사용자가 흐름을 인지할 수 있게 넉넉히.
const NPC_DELAY_DEFAULT = 3000;
const NPC_DELAY_MIN = 1800;
const NPC_DELAY_MAX = 7000;
// 봇 턴 내 '이동 → (쉬고) → 제안' 사이 간격 (카메라 이동·인지 시간)
const BOT_ACT_GAP = 1300;
// 제안 대사가 타이핑되는 동안 턴을 넘기지 않고 대기 (카메라 튐 방지)
const SPEAK_HOLD = 2400;

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

const pickFromSet = (s: Set<string>): string | undefined =>
  s.size === 0 ? undefined : [...s][Math.floor(Math.random() * s.size)];

const shuffle = <T>(arr: T[]): void => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
};

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
  private suggestSeq = 0;
  /** 이번 판 용의자 후보 = 참여자 6명의 캐릭터. */
  private suspectPool: string[] = [];
  /** 반증으로 드러난(=정답 아님) 카드값. NPC들이 공유해 추리 가속. */
  private revealed = new Set<string>();
  // 사용자 턴 시간 이동평균(ms) + 현재 턴 시작 시각(clock)
  private avgHumanTurnMs = 0;
  private turnStartedAt = 0;

  onCreate(options: CreateOptions = {}): void {
    this.setState(new GameState());

    // 공개/비공개: 비공개면 목록(getAvailableRooms)에서 숨김(코드 참가는 가능).
    // 공개방은 기본 노출. 시작 시 lock()으로 목록에서 자동 제외된다.
    const isPublic = options.isPublic !== false;
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
      client.send("log", { text: "당신의 턴이 아닙니다." });
      return;
    }
    const dest = player.room ? passageOf(player.room) : undefined;
    if (!dest) {
      client.send("log", { text: "이 방엔 비밀 통로가 없습니다." });
      return;
    }
    const c = this.freeCellIn(dest, player.id);
    player.x = c.x;
    player.y = c.y;
    player.room = dest;
    this.state.stepsLeft = 0; // 통로로 방 도착 = 이동 소진(방 진입 턴엔 이탈 불가). 턴은 유지.
    this.broadcast("log", {
      text: `🚪 ${player.name} 님이 비밀 통로로 ${label(dest)}에 이동! (제안 또는 턴 종료)`,
      kind: "move",
    });
  }

  // ── 고정 NPC(계략): 인접 시 보너스 사용 — 엿보기 + 이동 보너스(거리 비례). 턴 유지. ──
  private handleUseBonus(client: Client): void {
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.eliminated) return;
    if (this.state.currentTurn !== client.sessionId) {
      client.send("log", { text: "당신의 턴이 아닙니다." });
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
      client.send("log", { text: "가까이에 계략을 줄 이가 없습니다." });
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
    client.send("peek", { from: label(helper.value), cards: seen });
    this.broadcast("log", {
      text: `🃏 ${player.name} 님이 ${label(
        helper.value,
      )}의 계략(엿보기 ${n}·이동 +${refund}) 사용`,
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
    let text: string | null = null;
    try {
      text = await narrate(input);
    } catch {
      text = null;
    }
    if (!text) text = fallbackLine(input);
    if (this.state.phase !== "playing") return;
    // 당사자: 전문 (헬퍼 토큰 위 말풍선)
    client.send("say", { id: value, from: label(value), text });
    // 타인: 귓속말 표시만
    this.broadcast(
      "say",
      { id: value, from: label(value), text: "(귓속말)" },
      { except: client },
    );
  }

  onJoin(client: Client, options: JoinOptions = {}): void {
    if (this.state.phase !== "lobby") {
      client.send("log", { text: "이미 진행 중인 게임입니다 (관전)." });
    }
    const used = new Set(
      [...this.state.players.values()].map((p) => p.suspect),
    );
    const requested = options.character;
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
    this.broadcast("log", { text: `${player.name} 입장.` });
    this.syncMeta();
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;

    // 게임 중 비자발적 이탈만 재접속을 기다린다(대기실에선 즉시 제거).
    if (!consented && this.state.phase === "playing") {
      this.broadcast("log", {
        text: `${player?.name ?? "누군가"} 연결 끊김 — 재접속 대기…`,
      });
      try {
        await this.allowReconnection(client, 60);
        const back = this.state.players.get(client.sessionId);
        if (back) back.connected = true;
        this.broadcast("log", { text: `${back?.name ?? "플레이어"} 재접속!` });
        return;
      } catch {
        // 시간 초과 → 아래에서 제거
      }
    }
    this.removePlayer(client.sessionId);
  }

  private removePlayer(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (player) this.broadcast("log", { text: `${player.name} 퇴장.` });
    this.state.players.delete(sessionId);
    this.hands.delete(sessionId);
    this.botKnowledge.delete(sessionId);
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
      if (nextRoom) {
        this.broadcast("log", {
          text: `${player.name} 님이 ${label(nextRoom)}에 들어갔습니다.`,
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
      client.send("log", { text: `${label(value)}는 이미 선택되었습니다.` });
      return;
    }
    player.suspect = value;
    player.name = label(value);
  }

  // ── 게임 시작: NPC 충원 + 정답 봉투 + 카드 분배 ──
  private handleStart(client: Client): void {
    if (this.state.phase !== "lobby") return;
    if (this.state.host !== client.sessionId) {
      client.send("log", { text: "방장만 잔치를 시작할 수 있습니다." });
      return;
    }

    // 빈 자리를 NPC로 6인까지 충원
    while (this.state.players.size < MAX_PLAYERS) {
      if (!this.addBot()) break;
    }
    void this.lock();
    this.startGame();
  }

  // ── 다시 하기(리매치): 종료 상태에서 같은 방으로 새 판 ──
  private handleRematch(client: Client): void {
    if (this.state.phase !== "ended") return;
    const p = this.state.players.get(client.sessionId);
    this.broadcast("log", {
      text: `🔄 ${p?.name ?? "누군가"} 님이 다시 하기 — 새 판을 시작합니다.`,
      kind: "info",
    });
    this.startGame();
  }

  // ── 판 시작 코어(최초 시작·리매치 공용): 위치/상태 리셋 + 딜 + 턴 개시 ──
  private startGame(): void {
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
    this.revealed.clear();
    const humanCount = ids.filter(
      (id) => !this.state.players.get(id)?.isBot,
    ).length;
    if (humanCount === 1) {
      const n = Math.min(2, Math.max(0, deck.length - ids.length)); // 딜 유지 위해 여유분만
      for (let j = 0; j < n; j++) {
        const c = deck.shift();
        if (c) {
          this.state.commonCards.push(c.value);
          this.revealed.add(c.value); // 봇도 정답 아님으로 인지
        }
      }
      if (this.state.commonCards.length > 0) {
        this.broadcast("log", {
          text: `📢 공통 단서 공개(정답 아님): ${([...this.state.commonCards] as string[])
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

    // 사람에게만 손패 private 전송, 봇은 추리 노트 초기화
    this.botKnowledge.clear();
    for (const id of ids) {
      const player = this.state.players.get(id);
      if (player?.isBot) {
        this.initBotKnowledge(id);
      } else {
        const target = this.clients.find((c) => c.sessionId === id);
        target?.send("hand", { cards: this.hands.get(id) ?? [] });
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
      text: `게임 시작! 정답 봉투 봉인. NPC ${botCount}명 합류. ${first?.name} 님의 턴.`,
    });
    this.scheduleBotIfNeeded();
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
    for (const c of this.hands.get(id) ?? []) this.eliminate(k, c);
    this.botKnowledge.set(id, k);
  }

  private eliminate(k: BotKnowledge, card: Card): void {
    if (card.kind === "suspect") k.suspects.delete(card.value);
    else if (card.kind === "weapon") k.weapons.delete(card.value);
    else k.rooms.delete(card.value);
  }

  // ── 제안(Suggestion) + 시계방향 반증 (사람/봇 공용) ──
  private doSuggestion(
    suggesterId: string,
    suggestion: Suggestion,
  ): { by: string | null; card: Card | null } {
    const suggester = this.state.players.get(suggesterId);
    const sid = `s${++this.suggestSeq}`;
    // 카테고리별 명확 표기
    this.broadcast("log", {
      text:
        `🔍 [제안] ${suggester?.name} — 도둑: ${label(suggestion.suspect)}` +
        ` · 훔친 것: ${label(suggestion.weapon)} · 장소: ${label(suggestion.room)}`,
      kind: "suggest",
      sid,
    });

    // 지목된 용의자 토큰을 그 방으로 소환 (다음 본인 턴에 그 방에서 시작)
    const target = [...this.state.players.values()].find(
      (p) => p.suspect === suggestion.suspect,
    );
    if (target) {
      const c = this.freeCellIn(suggestion.room, target.id);
      target.x = c.x;
      target.y = c.y;
      target.room = suggestion.room;
      this.broadcast("log", {
        text: `${label(suggestion.suspect)}가 ${label(
          suggestion.room,
        )}(으)로 불려왔습니다.`,
        kind: "move",
      });
    }
    // 지목된 장물(훔친 것) 토큰도 그 방으로 이동 (용의자 소환과 대칭)
    const wt = this.state.weapons.get(suggestion.weapon);
    const wr = regionOf(suggestion.room);
    if (wt && wr) {
      wt.x = wr.x + wr.w - 2;
      wt.y = wr.y + wr.h - 2;
      wt.room = suggestion.room;
    }

    const order = [...this.state.turnOrder] as string[];
    const start = order.indexOf(suggesterId);
    for (let i = 1; i < order.length; i++) {
      const otherId = order[(start + i) % order.length];
      const match = (this.hands.get(otherId) ?? []).find((c) =>
        cardMatches(c, suggestion),
      );
      if (match) {
        const other = this.state.players.get(otherId);
        // 드러난 카드는 정답 아님 → NPC 공유 지식에 반영(추리 가속)
        this.revealed.add(match.value);
        this.broadcast("log", {
          text: `🛡 ${other?.name} 님이 반증했습니다.`,
          kind: "disprove",
          sid,
          disproved: true,
        });
        return { by: other?.name ?? otherId, card: match };
      }
    }
    this.broadcast("log", {
      text: "❗ 아무도 반증하지 못함 — 정답 후보!",
      kind: "disprove",
      sid,
      disproved: false,
    });
    return { by: null, card: null };
  }

  private handleSuggest(client: Client, msg: Suggestion): void {
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.currentTurn !== player.id) {
      client.send("log", { text: "당신의 턴이 아닙니다." });
      return;
    }
    if (!player.room) {
      client.send("log", { text: "방 안에서만 제안할 수 있습니다." });
      return;
    }
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
    // 정통 클루: 제안하면 그 턴은 종료된다.
    this.advanceTurn();
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
      this.broadcast("log", {
        text: `🎉 ${player.name} 사건 해결! 정답: ${label(
          this.solution.suspect,
        )} · ${label(this.solution.weapon)} · ${label(this.solution.room)}`,
        kind: "win",
      });
    } else {
      player.eliminated = true;
      this.broadcast("log", {
        text: `❌ [고발 실패] ${player.name} 탈락(반증만 가능).`,
        kind: "accuse",
      });
      this.advanceTurn();
    }
  }

  private handleAccuse(client: Client, msg: Suggestion): void {
    if (this.state.phase !== "playing" || !this.solution) return;
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.currentTurn !== player.id) {
      client.send("log", { text: "당신의 턴이 아닙니다." });
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
    const targetRoom =
      bot.room && k.rooms.has(bot.room)
        ? bot.room
        : (pickFromSet(k.rooms) ?? pick(ROOMS));
    const region = regionOf(targetRoom) ?? pick(ROOM_REGIONS);
    const cell = this.freeCellIn(region.name, id);
    bot.x = cell.x;
    bot.y = cell.y;
    if (bot.room !== region.name) {
      bot.room = region.name;
      this.broadcast("log", {
        text: `${bot.name} 님이 ${label(region.name)}에 들어갔습니다.`,
        kind: "move",
      });
    }

    // 2) 한 박자 쉬고 제안 (사용자 인지 시간)
    this.clock.setTimeout(
      () => this.botSuggestPhase(id, region.name),
      BOT_ACT_GAP,
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

    // 공유 지식(revealed) 반영한 유효 후보 — 이미 드러난 카드는 제외하고 제안
    const eff = (set: Set<string>): string[] => {
      const c = [...set].filter((v) => !this.revealed.has(v));
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
    void this.speak(id, {
      name: bot.name,
      persona: persona(bot.suspect),
      action: "suggest",
      suspect: label(suggestion.suspect),
      weapon: label(suggestion.weapon),
      room: label(suggestion.room),
      disproved: !!result.card,
    });

    // 제안 대사가 타이핑되는 동안엔 턴을 넘기지 않는다(카메라 튐 방지).
    // 결정/고발/턴넘김은 대사 표시 시간 뒤에 수행.
    this.clock.setTimeout(() => {
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

      this.advanceTurn();
    }, SPEAK_HOLD);
  }

  // NPC 대사: 결정된 정보만 넘겨 LLM 대사 생성, 실패 시 규칙 폴백 → 브로드캐스트.
  private async speak(id: string, input: NarrationInput): Promise<void> {
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

    let text: string | null = null;
    try {
      text = await narrate(enriched);
    } catch {
      text = null;
    }
    if (!text) text = fallbackLine(enriched);
    if (!this.state.players.has(id)) return;
    this.broadcast("say", { id, from: input.name, text });
  }

  /** NPC 행동 딜레이 = 사용자 평균 턴 시간의 절반 (클램프). */
  private npcDelay(): number {
    const base =
      this.avgHumanTurnMs > 0 ? this.avgHumanTurnMs / 2 : NPC_DELAY_DEFAULT;
    return Math.max(NPC_DELAY_MIN, Math.min(NPC_DELAY_MAX, base));
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

  private scheduleBotIfNeeded(): void {
    if (this.state.phase !== "playing") return;
    const cur = this.state.players.get(this.state.currentTurn);
    if (cur?.isBot) {
      this.clock.setTimeout(() => this.runBotTurn(cur.id), this.npcDelay());
    }
  }

  private advanceTurn(): void {
    this.recordTurnDuration();
    const order = ([...this.state.turnOrder] as string[]).filter((id) => {
      const p = this.state.players.get(id);
      return p && !p.eliminated;
    });
    if (order.length === 0) return;
    if (order.length === 1) {
      this.state.phase = "ended";
      this.state.winner = order[0];
      const w = this.state.players.get(order[0]);
      this.broadcast("log", {
        text: `🎉 ${w?.name} 최후 생존 — 승리!`,
        kind: "win",
      });
      return;
    }
    const cur = order.indexOf(this.state.currentTurn);
    const next = order[(cur + 1) % order.length];
    this.state.currentTurn = next;
    this.state.stepsLeft = this.rollSteps();
    this.turnStartedAt = this.clock.currentTime;
    const np = this.state.players.get(next);
    this.broadcast("log", { text: `${np?.name} 님의 턴입니다.` });
    this.scheduleBotIfNeeded();
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
