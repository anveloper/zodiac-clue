import Phaser from "phaser";
import type { Room } from "colyseus.js";
import { ROOM_REGIONS, label } from "@zodiac-clue/shared";
import { CELL, BOARD_W, BOARD_H } from "./game-scene";

// 뷰4 "도트풍" — 탑다운 픽셀 스타일 오버레이 씬.
// GameScene(뷰1)이 입력·카메라·로직을 담당하고, 이 씬은 카메라를 미러링하며
// 도트 비주얼만 그린다(외부 에셋 0, 전부 절차적 생성). 좌표계는 GameScene과 동일.

const PAL = {
  grass1: 0x5b8c4a,
  grass2: 0x4d7a3e,
  grass3: 0x6fa457,
  room: 0xd8b884,
  roomHi: 0xe8cfa0,
  roomEdge: 0x5e4526,
  wood: 0x8a5a2a,
  woodDark: 0x5e3d1c,
  gold: 0xf0c848,
  ink: 0x2a2118,
  cream: 0xf3e6c8,
  loot: 0xc98a3a,
};
const PLAYER_COLORS = [
  0xef4444, 0xf59e0b, 0x84cc16, 0x22c55e, 0x38bdf8, 0xa855f7,
];

type PlayerView = {
  name: string;
  suspect: string;
  isBot: boolean;
  x: number;
  y: number;
  eliminated: boolean;
};

type Critter = {
  c: Phaser.GameObjects.Container;
  ring: Phaser.GameObjects.Rectangle;
  body: Phaser.GameObjects.Container;
  placed: boolean;
};

export class PixelScene extends Phaser.Scene {
  private room!: Room;
  private tokens = new Map<string, Critter>();
  private loot = new Map<string, Phaser.GameObjects.Container>();
  private helpers = new Map<string, Phaser.GameObjects.Container>();
  private bubbles = new Map<string, Phaser.GameObjects.Text>();

  constructor() {
    super("pixel");
  }

  create(): void {
    this.room = this.registry.get("room") as Room;
    this.cameras.main.setRoundPixels(true);
    this.makeGrassTexture();
    this.drawBoard();
    // 표시 여부는 setStage가 sys.setVisible로 제어(뷰4에서만 보임).
  }

  /** 16px 잔디 타일 텍스처를 절차적으로 생성. */
  private makeGrassTexture(): void {
    if (this.textures.exists("px-grass")) return;
    const g = this.add.graphics();
    g.fillStyle(PAL.grass1, 1);
    g.fillRect(0, 0, 16, 16);
    // 고정 패턴(결정적) — 어두운/밝은 풀 픽셀 흩뿌림
    const dark: [number, number][] = [
      [2, 3], [3, 3], [9, 1], [12, 6], [5, 10], [13, 12], [1, 13], [7, 7],
    ];
    const light: [number, number][] = [
      [4, 2], [10, 4], [6, 9], [14, 8], [2, 11], [11, 13], [8, 14],
    ];
    g.fillStyle(PAL.grass2, 1);
    for (const [x, y] of dark) g.fillRect(x, y, 2, 1);
    g.fillStyle(PAL.grass3, 1);
    for (const [x, y] of light) g.fillRect(x, y, 1, 1);
    g.generateTexture("px-grass", 16, 16);
    g.destroy();
  }

  /** 픽셀 보드: 잔디 바닥 + 방(판자 패널) + 문 + 중앙 잔치상. */
  private drawBoard(): void {
    this.add
      .tileSprite(0, 0, BOARD_W, BOARD_H, "px-grass")
      .setOrigin(0)
      .setDepth(0);

    // 중앙 잔치상 (나무 궤짝 느낌)
    const fx = 9 * CELL;
    const fy = 9 * CELL;
    const fw = 6 * CELL;
    const fh = 6 * CELL;
    this.pixelPanel(fx, fy, fw, fh, PAL.woodDark, PAL.wood, PAL.gold);
    this.add
      .rectangle(fx + fw / 2, fy + fh / 2 - 6, 46, 40, PAL.gold)
      .setStrokeStyle(3, PAL.ink)
      .setDepth(1);
    this.add
      .rectangle(fx + fw / 2, fy + fh / 2 - 6, 10, 40, PAL.loot)
      .setDepth(1); // 리본
    this.add
      .text(fx + fw / 2, fy + fh / 2 + 34, "잔치상", {
        fontFamily: "monospace",
        fontSize: "20px",
        color: "#f3e6c8",
      })
      .setOrigin(0.5)
      .setDepth(1);

    // 방(판자 패널 + 명패 + 문)
    for (const r of ROOM_REGIONS) {
      const x = r.x * CELL;
      const y = r.y * CELL;
      const w = r.w * CELL;
      const h = r.h * CELL;
      this.pixelPanel(x, y, w, h, PAL.roomEdge, PAL.room, PAL.roomHi);

      const name = label(r.name);
      this.add
        .rectangle(x + 8, y + 8, name.length * 18 + 16, 26, PAL.ink, 0.88)
        .setOrigin(0)
        .setStrokeStyle(2, PAL.gold)
        .setDepth(2);
      this.add
        .text(x + 16, y + 12, name, {
          fontFamily: "monospace",
          fontSize: "16px",
          color: "#f0d9a8",
        })
        .setOrigin(0)
        .setDepth(3);

      // 문(입구)
      const dcx = r.door.x * CELL + CELL / 2;
      const dcy = r.door.y * CELL + CELL / 2;
      this.add
        .rectangle(dcx, dcy, CELL * 0.9, CELL * 0.9, PAL.wood)
        .setStrokeStyle(3, PAL.gold)
        .setDepth(1);
      this.add
        .rectangle(dcx, dcy, CELL * 0.34, CELL * 0.62, PAL.woodDark)
        .setDepth(2); // 문짝
      this.add
        .text(dcx, dcy + CELL * 0.5, "입구", {
          fontFamily: "monospace",
          fontSize: "11px",
          color: "#2a2118",
          backgroundColor: "#f0c848",
          padding: { x: 3, y: 1 },
        })
        .setOrigin(0.5, 0)
        .setDepth(3);
    }
  }

  /** 사각 픽셀 패널: 바깥 테두리 + 안쪽 채움 + 상단 하이라이트 라인(도트 입체감). */
  private pixelPanel(
    x: number,
    y: number,
    w: number,
    h: number,
    edge: number,
    fill: number,
    hi: number,
  ): void {
    this.add.rectangle(x, y, w, h, edge).setOrigin(0).setDepth(0);
    this.add
      .rectangle(x + 3, y + 3, w - 6, h - 6, fill)
      .setOrigin(0)
      .setDepth(0);
    this.add.rectangle(x + 3, y + 3, w - 6, 3, hi).setOrigin(0).setDepth(0); // 상단 하이라이트
    this.add.rectangle(x + 3, y + 3, 3, h - 6, hi).setOrigin(0).setDepth(0); // 좌측 하이라이트
  }

  /** 도트 캐릭터(크리터) — 몸통 블록 + 귀 + 눈. 플레이어 색으로 구분. */
  private makeCritter(color: number): Phaser.GameObjects.Container {
    const s = CELL; // 셀 기준
    const body = this.add.rectangle(0, 2, s * 0.6, s * 0.56, color);
    body.setStrokeStyle(3, PAL.ink);
    const earL = this.add
      .rectangle(-s * 0.2, -s * 0.28, s * 0.16, s * 0.22, color)
      .setStrokeStyle(3, PAL.ink);
    const earR = this.add
      .rectangle(s * 0.2, -s * 0.28, s * 0.16, s * 0.22, color)
      .setStrokeStyle(3, PAL.ink);
    const eyeL = this.add.rectangle(-s * 0.12, -s * 0.02, 5, 6, 0xffffff);
    const eyeR = this.add.rectangle(s * 0.12, -s * 0.02, 5, 6, 0xffffff);
    const pupL = this.add.rectangle(-s * 0.12, 0, 3, 3, PAL.ink);
    const pupR = this.add.rectangle(s * 0.12, 0, 3, 3, PAL.ink);
    return this.add.container(0, 0, [
      earL,
      earR,
      body,
      eyeL,
      eyeR,
      pupL,
      pupR,
    ]);
  }

  update(): void {
    if (!this.scene.isVisible()) return;
    this.mirrorCamera();
    this.syncTokens();
    this.bubbles.forEach((b, id) => {
      const anchor = this.tokens.get(id)?.c ?? this.helpers.get(id);
      if (anchor) b.setPosition(anchor.x, anchor.y - CELL * 0.9);
    });
  }

  /** NPC/계략 대사 말풍선(도트 톤). GameScene과 동일하게 say 라우팅에서 호출. */
  showBubble(id: string, text: string): void {
    const anchor = this.tokens.get(id)?.c ?? this.helpers.get(id);
    if (!anchor) return;
    this.bubbles.get(id)?.destroy();
    const b = this.add
      .text(anchor.x, anchor.y - CELL * 0.9, text, {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#2a2118",
        backgroundColor: "#f3e6c8",
        padding: { x: 6, y: 3 },
        align: "center",
        wordWrap: { width: 240 },
      })
      .setOrigin(0.5, 1)
      .setDepth(100);
    this.bubbles.set(id, b);
    this.time.delayedCall(3200, () => {
      if (this.bubbles.get(id) === b) {
        b.destroy();
        this.bubbles.delete(id);
      }
    });
  }

  /** GameScene(뷰1)의 카메라를 그대로 미러 — 줌·팬·추적을 재사용. */
  private mirrorCamera(): void {
    const gs = this.scene.get("game");
    const gcam = gs?.cameras?.main;
    if (!gcam) return;
    const cam = this.cameras.main;
    cam.setZoom(gcam.zoom);
    cam.scrollX = gcam.scrollX;
    cam.scrollY = gcam.scrollY;
  }

  /** 서버 상태 → 도트 토큰/장물/NPC 위치 동기화. */
  private syncTokens(): void {
    const state = this.room.state as unknown as {
      players: Map<string, PlayerView>;
      weapons: Map<string, { value: string; x: number; y: number }>;
      helpers: Map<string, { value: string; x: number; y: number; used: boolean }>;
      currentTurn: string;
    };
    const players = state.players;
    const ids = [...players.keys()];
    const current = state.currentTurn ?? "";
    const seen = new Set<string>();

    players.forEach((p, id) => {
      seen.add(id);
      const cx = p.x * CELL + CELL / 2;
      const cy = p.y * CELL + CELL / 2;
      let t = this.tokens.get(id);
      if (!t) {
        const color = PLAYER_COLORS[ids.indexOf(id) % PLAYER_COLORS.length];
        const ring = this.add
          .rectangle(0, 2, CELL * 0.86, CELL * 0.82, 0x000000, 0)
          .setStrokeStyle(3, PAL.gold)
          .setVisible(false);
        const body = this.makeCritter(color);
        const nameTxt = this.add
          .text(0, CELL * 0.5, `${p.isBot ? "🤖" : ""}${p.name}`, {
            fontFamily: "monospace",
            fontSize: "12px",
            color: "#f3e6c8",
            backgroundColor: "#000000aa",
            padding: { x: 3, y: 1 },
          })
          .setOrigin(0.5, 0);
        const c = this.add.container(cx, cy, [ring, body, nameTxt]).setDepth(5);
        t = { c, ring, body, placed: true };
        this.tokens.set(id, t);
      } else if (t.c.x !== cx || t.c.y !== cy) {
        this.tweens.killTweensOf(t.c);
        this.tweens.add({ targets: t.c, x: cx, y: cy, duration: 120, ease: "Quad.Out" });
      }
      t.ring.setVisible(id === current);
      t.c.setAlpha(p.eliminated ? 0.35 : 1);
    });

    // 장물(도트 상자)
    state.weapons.forEach((w, key) => {
      const cx = w.x * CELL + CELL / 2;
      const cy = w.y * CELL + CELL / 2;
      let s = this.loot.get(key);
      if (!s) {
        const box = this.add
          .rectangle(0, 0, CELL * 0.5, CELL * 0.4, PAL.loot)
          .setStrokeStyle(3, PAL.ink);
        const lid = this.add.rectangle(0, -CELL * 0.16, CELL * 0.56, CELL * 0.12, PAL.gold).setStrokeStyle(2, PAL.ink);
        s = this.add.container(cx, cy, [box, lid]).setDepth(4);
        this.loot.set(key, s);
      } else if (s.x !== cx || s.y !== cy) {
        this.tweens.killTweensOf(s);
        this.tweens.add({ targets: s, x: cx, y: cy, duration: 220, ease: "Quad.Out" });
      }
    });

    // 고정 NPC(계략) — 회색 크리터 + 태그
    state.helpers.forEach((h, key) => {
      const cx = h.x * CELL + CELL / 2;
      const cy = h.y * CELL + CELL / 2;
      let c = this.helpers.get(key);
      if (!c) {
        const body = this.makeCritter(0x8a8172);
        const tag = this.add
          .text(0, CELL * 0.44, "계략", {
            fontFamily: "monospace",
            fontSize: "10px",
            color: "#f0c848",
            backgroundColor: "#000000aa",
            padding: { x: 3, y: 1 },
          })
          .setOrigin(0.5, 0);
        c = this.add.container(cx, cy, [body, tag]).setDepth(4);
        this.helpers.set(key, c);
      }
      c.setAlpha(h.used ? 0.3 : 1);
    });

    for (const id of [...this.tokens.keys()]) {
      if (!seen.has(id)) {
        this.tokens.get(id)?.c.destroy();
        this.tokens.delete(id);
      }
    }
  }
}
