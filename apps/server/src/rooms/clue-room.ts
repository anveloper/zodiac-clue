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
  label,
  persona,
  roomAt,
  roomCenter,
  voice,
  type Card,
  type Solution,
  type Suggestion,
} from "@zodiac-clue/shared";
import { GameState, Player } from "../schema/game-state";
import { fallbackLine, narrate, type NarrationInput } from "../ai/narrator";

type JoinOptions = { character?: string };

/** 봇의 추리 노트 — 각 카테고리에서 아직 남은(정답 후보) 값들. */
type BotKnowledge = {
  suspects: Set<string>;
  weapons: Set<string>;
  rooms: Set<string>;
};

// NPC 행동 딜레이 = 사용자 평균 턴 시간의 절반 (클램프). 데이터 없으면 기본값.
const NPC_DELAY_DEFAULT = 1600;
const NPC_DELAY_MIN = 800;
const NPC_DELAY_MAX = 6000;

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
  // 사용자 턴 시간 이동평균(ms) + 현재 턴 시작 시각(clock)
  private avgHumanTurnMs = 0;
  private turnStartedAt = 0;

  onCreate(): void {
    this.setState(new GameState());

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
  }

  // ── 이동 (그리드 한 칸, 서버 검증) — 정통 클루: 자기 턴 + 이동 한도 내에서만 ──
  private handleMove(client: Client, msg: { dx: number; dy: number }): void {
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.eliminated) return;
    // 자기 턴이 아니면 이동 불가
    if (this.state.currentTurn !== client.sessionId) return;
    // 이번 턴 이동 한도 소진 시 불가
    if (this.state.stepsLeft <= 0) return;

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

    // 이동 수는 복도에서 출발할 때만 소모(방 안 이동은 무료)
    const fromCorridor = roomAt(player.x, player.y) === null;
    player.x = nx;
    player.y = ny;
    if (fromCorridor) this.state.stepsLeft -= 1;

    const nextRoom = roomAt(nx, ny) ?? "";
    if (nextRoom !== player.room) {
      player.room = nextRoom;
      if (nextRoom) {
        this.broadcast("log", {
          text: `${player.name} 님이 ${label(nextRoom)}에 들어갔습니다.`,
          kind: "move",
        });
      }
    }
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

    const ids = [...this.state.players.keys()];
    const solution: Solution = {
      suspect: pick(SUSPECTS),
      weapon: pick(WEAPONS),
      room: pick(ROOMS),
    };
    this.solution = solution;

    const deck: Card[] = [
      ...SUSPECTS.filter((s) => s !== solution.suspect).map(
        (v): Card => ({ kind: "suspect", value: v }),
      ),
      ...WEAPONS.filter((w) => w !== solution.weapon).map(
        (v): Card => ({ kind: "weapon", value: v }),
      ),
      ...ROOMS.filter((r) => r !== solution.room).map(
        (v): Card => ({ kind: "room", value: v }),
      ),
    ];
    shuffle(deck);

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
    // 봇은 서로 다른 방 중심에서 시작 (복도가 아니라 방)
    const region = ROOM_REGIONS[(this.botSeq - 1) % ROOM_REGIONS.length];
    bot.x = region.x + Math.floor(region.w / 2);
    bot.y = region.y + Math.floor(region.h / 2);
    bot.room = region.name;
    this.state.players.set(id, bot);
    return true;
  }

  /** 이번 턴 이동 한도(주사위 2d6) — 2~12칸. 방 안 이동은 무료라 실효 이동은 더 큼. */
  private rollSteps(): number {
    const d = (): number => 1 + Math.floor(Math.random() * 6);
    return d() + d();
  }

  private initBotKnowledge(id: string): void {
    const k: BotKnowledge = {
      suspects: new Set<string>(SUSPECTS),
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
        `🔍 [제안] ${suggester?.name} — 용의자: ${label(suggestion.suspect)}` +
        ` · 수법: ${label(suggestion.weapon)} · 장소: ${label(suggestion.room)}`,
      kind: "suggest",
      sid,
    });

    // 지목된 용의자 토큰을 그 방으로 소환 (다음 본인 턴에 그 방에서 시작)
    const target = [...this.state.players.values()].find(
      (p) => p.suspect === suggestion.suspect,
    );
    if (target) {
      const c = roomCenter(suggestion.room);
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

    const order = [...this.state.turnOrder] as string[];
    const start = order.indexOf(suggesterId);
    for (let i = 1; i < order.length; i++) {
      const otherId = order[(start + i) % order.length];
      const match = (this.hands.get(otherId) ?? []).find((c) =>
        cardMatches(c, suggestion),
      );
      if (match) {
        const other = this.state.players.get(otherId);
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

  // ── NPC 턴: 방 이동 → 제안/추리 → 확신 시 고발 ──
  private runBotTurn(id: string): void {
    if (this.state.phase !== "playing" || this.state.currentTurn !== id) return;
    const bot = this.state.players.get(id);
    if (!bot || !bot.isBot) return;
    const k = this.botKnowledge.get(id);
    if (!k) {
      this.advanceTurn();
      return;
    }

    // 1) 임의의 방으로 이동
    const region = pick(ROOM_REGIONS);
    bot.x = region.x + Math.floor(region.w / 2);
    bot.y = region.y + Math.floor(region.h / 2);
    if (bot.room !== region.name) {
      bot.room = region.name;
      this.broadcast("log", {
        text: `${bot.name} 님이 ${label(region.name)}에 들어갔습니다.`,
      });
    }

    // 2) 아직 남은 후보로 제안
    const suggestion: Suggestion = {
      suspect: (pickFromSet(k.suspects) ??
        pick(SUSPECTS)) as Suggestion["suspect"],
      weapon: (pickFromSet(k.weapons) ?? pick(WEAPONS)) as Suggestion["weapon"],
      room: region.name as Suggestion["room"],
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

    // 3) 각 카테고리 후보가 1개로 좁혀졌으면 고발
    if (k.suspects.size === 1 && k.weapons.size === 1 && k.rooms.size === 1) {
      const acc: Suggestion = {
        suspect: [...k.suspects][0] as Suggestion["suspect"],
        weapon: [...k.weapons][0] as Suggestion["weapon"],
        room: [...k.rooms][0] as Suggestion["room"],
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
