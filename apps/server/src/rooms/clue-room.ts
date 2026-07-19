import { Room, type Client } from "colyseus";
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  MAX_PLAYERS,
  ROOMS,
  SUSPECTS,
  WEAPONS,
  label,
  roomAt,
  type Card,
  type Solution,
  type Suggestion,
} from "@zodiac-clue/shared";
import { GameState, Player } from "../schema/game-state";

type JoinOptions = { character?: string };

const pick = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];

const shuffle = <T>(arr: T[]): void => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
};

export class ClueRoom extends Room<GameState> {
  maxClients = MAX_PLAYERS;

  // ── 서버 전용 비밀 상태 (동기화하지 않음) ──
  private solution: Solution | null = null;
  private hands = new Map<string, Card[]>();

  onCreate(): void {
    this.setState(new GameState());

    this.onMessage("move", (client, msg: { dx: number; dy: number }) =>
      this.handleMove(client, msg),
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
    // 요청한 캐릭터가 유효(손님)하고 비어있으면 배정, 아니면 남는 것 중 첫 번째
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
    this.broadcast("log", {
      text: `${player.name} 입장 (${label(suspect)}).`,
    });
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;

    // 새로고침·순단 등 비자발적 이탈이면 잠시 재접속을 기다린다.
    if (!consented) {
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
    // 방장이 나가면 다음 사람에게 위임
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

  // ── 이동 (그리드 한 칸, 서버 검증) ──
  private handleMove(client: Client, msg: { dx: number; dy: number }): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.eliminated) return;

    const nx = Math.max(
      0,
      Math.min(GRID_WIDTH - 1, player.x + Math.sign(msg.dx ?? 0)),
    );
    const ny = Math.max(
      0,
      Math.min(GRID_HEIGHT - 1, player.y + Math.sign(msg.dy ?? 0)),
    );
    player.x = nx;
    player.y = ny;

    const nextRoom = roomAt(nx, ny) ?? "";
    if (nextRoom !== player.room) {
      player.room = nextRoom;
      if (nextRoom) {
        this.broadcast("log", {
          text: `${player.name} 님이 ${label(nextRoom)}에 들어갔습니다.`,
        });
      }
    }
  }

  // ── 게임 시작: 정답 봉투 + 카드 분배 ──
  private handleStart(client: Client): void {
    if (this.state.phase !== "lobby") return;
    if (this.state.host !== client.sessionId) {
      client.send("log", { text: "방장만 잔치를 시작할 수 있습니다." });
      return;
    }
    const ids = [...this.state.players.keys()];
    if (ids.length < 2) {
      client.send("log", { text: "2명 이상이어야 시작할 수 있습니다." });
      return;
    }
    // 시작하면 방을 잠가 난입 방지
    void this.lock();

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

    // 각자 손패는 본인에게만 private 전송
    for (const id of ids) {
      const target = this.clients.find((c) => c.sessionId === id);
      target?.send("hand", { cards: this.hands.get(id) ?? [] });
    }

    this.state.turnOrder.clear();
    ids.forEach((id) => this.state.turnOrder.push(id));
    this.state.currentTurn = ids[0];
    this.state.phase = "playing";

    const first = this.state.players.get(ids[0]);
    this.broadcast("log", {
      text: `게임 시작! 정답 봉투 봉인 완료. ${first?.name} 님의 턴.`,
    });
  }

  // ── 제안(Suggestion) + 시계방향 반증 ──
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

    // 정식 룰: 제안의 장소는 현재 있는 방으로 강제
    const suggestion: Suggestion = {
      suspect: msg.suspect,
      weapon: msg.weapon,
      room: player.room as Suggestion["room"],
    };
    this.broadcast("log", {
      text: `${player.name}의 제안: "${label(suggestion.suspect)} · ${label(
        suggestion.weapon,
      )} · ${label(suggestion.room)}"`,
    });

    const order = [...this.state.turnOrder] as string[];
    const start = order.indexOf(player.id);
    for (let i = 1; i < order.length; i++) {
      const otherId = order[(start + i) % order.length];
      const hand = this.hands.get(otherId) ?? [];
      const match = hand.find(
        (c) =>
          (c.kind === "suspect" && c.value === suggestion.suspect) ||
          (c.kind === "weapon" && c.value === suggestion.weapon) ||
          (c.kind === "room" && c.value === suggestion.room),
      );
      if (match) {
        const other = this.state.players.get(otherId);
        client.send("disprove", {
          by: other?.name ?? otherId,
          card: match,
          suggestion,
        });
        this.broadcast("log", {
          text: `${other?.name} 님이 반증했습니다. (카드는 ${player.name}에게만 공개)`,
        });
        return;
      }
    }
    client.send("disprove", { by: null, card: null, suggestion });
    this.broadcast("log", { text: "아무도 반증하지 못했습니다 — 정답 후보!" });
  }

  // ── 고발(Accusation): 봉투와 대조 ──
  private handleAccuse(client: Client, msg: Suggestion): void {
    if (this.state.phase !== "playing" || !this.solution) return;
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.currentTurn !== player.id) {
      client.send("log", { text: "당신의 턴이 아닙니다." });
      return;
    }

    const correct =
      msg.suspect === this.solution.suspect &&
      msg.weapon === this.solution.weapon &&
      msg.room === this.solution.room;

    this.broadcast("accuseResult", { player: player.name, correct });

    if (correct) {
      this.state.phase = "ended";
      this.state.winner = player.id;
      this.broadcast("log", {
        text: `🎉 ${player.name} 사건 해결! 정답: ${label(
          this.solution.suspect,
        )} · ${label(this.solution.weapon)} · ${label(this.solution.room)}`,
      });
    } else {
      player.eliminated = true;
      this.broadcast("log", {
        text: `❌ ${player.name} 고발 실패 — 탈락(반증만 가능).`,
      });
      this.advanceTurn();
    }
  }

  private handleEndTurn(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.currentTurn !== player.id) return;
    this.advanceTurn();
  }

  private advanceTurn(): void {
    const order = ([...this.state.turnOrder] as string[]).filter((id) => {
      const p = this.state.players.get(id);
      return p && !p.eliminated;
    });
    if (order.length === 0) return;
    if (order.length === 1) {
      // 마지막 생존자 자동 승리
      this.state.phase = "ended";
      this.state.winner = order[0];
      const w = this.state.players.get(order[0]);
      this.broadcast("log", { text: `🎉 ${w?.name} 최후 생존 — 승리!` });
      return;
    }
    const cur = order.indexOf(this.state.currentTurn);
    const next = order[(cur + 1) % order.length];
    this.state.currentTurn = next;
    const np = this.state.players.get(next);
    this.broadcast("log", { text: `${np?.name} 님의 턴입니다.` });
  }

  private spawnPoint(index: number): { x: number; y: number } {
    const pts = [
      { x: 0, y: 0 },
      { x: GRID_WIDTH - 1, y: 0 },
      { x: 0, y: GRID_HEIGHT - 1 },
      { x: GRID_WIDTH - 1, y: GRID_HEIGHT - 1 },
      { x: Math.floor(GRID_WIDTH / 2), y: 0 },
      { x: Math.floor(GRID_WIDTH / 2), y: GRID_HEIGHT - 1 },
    ];
    return pts[index % pts.length];
  }
}
