import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  CELL_PX,
  GRID_WIDTH,
  GRID_HEIGHT,
  ROOM_REGIONS,
  FEAST,
  doorSideOf,
  type MotionProfile,
  type RoomRegion,
} from "@zodiac-clue/shared";
import type {
  ActorSnapshot,
  BubbleOpts,
  FocusMode,
  PassageLink,
  PulseTone,
  ViewCell,
  ViewContract,
  ViewOutcome,
  WarpReason,
} from "./view-contract";

// ── 임시 타일셋 실험 뷰(뷰2 슬롯) ──────────────────────────────────────────
// A안: 뷰1(webp)을 건드리지 않고, 조립형 한옥 타일(atlas 슬라이스 → 51개 투명 PNG)을
// 그리드에 «규칙대로» 배치한 결과를 눈으로 확인하는 «비주얼 테스트베드».
// 게임 진실값(토큰·턴·말풍선)은 아직 그리지 않는다 — ViewContract 메서드는 대부분 no-op.
// 목적은 타일 조립 방식(벽·바닥·문·가구·마당)의 일관성 검증뿐이다.

const CELL = CELL_PX;

/** atlas 슬라이스 id 51종(= slice_atlas.py ID_ORDER). `/assets/tiles/<id>.png`. */
const TILE_IDS = [
  "maru", "umulmaru", "heuk", "jangpan",
  "madang", "path_straight", "path_corner", "path_tjunc", "grass_edge",
  "wall_top", "wall_bottom", "wall_left", "wall_right",
  "corner_tl", "corner_tr", "corner_bl", "corner_br",
  "door_top", "door_bottom", "door_left", "door_right",
  "banaji", "dwiju", "ibuljang", "sabangtakja", "chaekjang", "mungab", "gyeongdae", "byeongpung",
  "soban", "seoan", "bangseok", "hwaro", "deungjan", "onggi", "jeolgu", "muldongi", "baguni",
  "banjitgori", "bojagi", "bunjae", "cheongja_hwabyeong",
  "agungi", "jangdokdae", "seokdeung", "jige", "meongseok", "daenamu", "gotgam", "bitjaru", "jipsin",
] as const;

type Floor = "maru" | "umulmaru" | "heuk" | "jangpan";
type Placement = { id: string; gx: number; gy: number; cw?: number; ch?: number };
type RoomLayout = { floor: Floor; furniture: Placement[] };

// 방별 조립 사양(부록 표 기준). gx,gy는 방 로컬 그리드(0-based). cw/ch = footprint 칸수(기본 1).
const LAYOUTS: Record<string, RoomLayout> = {
  jeongji: { floor: "heuk", furniture: [
    { id: "agungi", gx: 1, gy: 1, cw: 2 }, { id: "onggi", gx: 3, gy: 1 }, { id: "jeolgu", gx: 1, gy: 3 },
  ] },
  daecheong: { floor: "umulmaru", furniture: [
    { id: "dwiju", gx: 1, gy: 1 }, { id: "sabangtakja", gx: 3, gy: 1, cw: 2 }, { id: "byeongpung", gx: 2, gy: 3, cw: 2 },
  ] },
  huwon: { floor: "heuk", furniture: [
    { id: "jangdokdae", gx: 1, gy: 1, cw: 2 }, { id: "seokdeung", gx: 3, gy: 3 }, { id: "daenamu", gx: 1, gy: 3 },
  ] },
  sarangbang: { floor: "maru", furniture: [
    { id: "chaekjang", gx: 1, gy: 1, cw: 2 }, { id: "seoan", gx: 2, gy: 3 }, { id: "byeongpung", gx: 1, gy: 4, cw: 2 },
  ] },
  sarangchae: { floor: "maru", furniture: [
    { id: "mungab", gx: 1, gy: 1, cw: 2 }, { id: "soban", gx: 2, gy: 2 },
  ] },
  seojae: { floor: "maru", furniture: [
    { id: "chaekjang", gx: 1, gy: 1 }, { id: "banaji", gx: 3, gy: 1 }, { id: "seoan", gx: 2, gy: 2 },
  ] },
  anbang: { floor: "jangpan", furniture: [
    { id: "ibuljang", gx: 1, gy: 1 }, { id: "gyeongdae", gx: 3, gy: 1 }, { id: "banaji", gx: 1, gy: 3 },
  ] },
  haengnang: { floor: "heuk", furniture: [
    { id: "sabangtakja", gx: 1, gy: 1 }, { id: "banaji", gx: 4, gy: 1 }, { id: "jige", gx: 1, gy: 3 }, { id: "meongseok", gx: 2, gy: 2, cw: 2 },
  ] },
  byeoldang: { floor: "maru", furniture: [
    { id: "byeongpung", gx: 1, gy: 1, cw: 2 }, { id: "deungjan", gx: 3, gy: 1 }, { id: "bunjae", gx: 1, gy: 2 },
  ] },
};

export class TileScene extends Phaser.Scene implements ViewContract {
  readonly viewId = "tiles" as const;
  readonly contextCost = 1;

  private layer!: Phaser.GameObjects.Container;
  private built = false;

  constructor() {
    super("tiles");
  }

  preload(): void {
    for (const id of TILE_IDS) {
      if (!this.textures.exists(`tile-${id}`)) {
        this.load.image(`tile-${id}`, `/assets/tiles/${id}.png`);
      }
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#6f7d4a");
    this.layer = this.add.container(0, 0);
    this.buildBoard();
    this.built = true;
    this.fitCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitCamera, this);
  }

  // ── 조립 ──────────────────────────────────────────────────────────────
  private buildBoard(): void {
    // 1) 바깥 마당 배경(전체 격자).
    for (let gy = 0; gy < GRID_HEIGHT; gy++) {
      for (let gx = 0; gx < GRID_WIDTH; gx++) {
        this.floorCell("madang", gx, gy, 0);
      }
    }
    // 2) 중앙 잔치상 바닥(마루로 표시).
    for (let gy = 0; gy < FEAST.h; gy++) {
      for (let gx = 0; gx < FEAST.w; gx++) {
        this.floorCell("umulmaru", FEAST.x + gx, FEAST.y + gy, 1);
      }
    }
    // 3) 방마다: 바닥 → 벽·모서리·문 → 가구.
    for (const r of ROOM_REGIONS) this.buildRoom(r);
  }

  private buildRoom(r: RoomRegion): void {
    const lay = LAYOUTS[r.name] ?? { floor: "maru", furniture: [] };
    const side = doorSideOf(r);
    // 방 로컬 문 좌표.
    const dgx = r.door.x - r.x;
    const dgy = r.door.y - r.y;

    // 바닥(방 전체).
    for (let gy = 0; gy < r.h; gy++) {
      for (let gx = 0; gx < r.w; gx++) this.floorCell(lay.floor, r.x + gx, r.y + gy, 2);
    }

    // 벽 링(테두리 셀 위에 얹는다 — 바닥 위 depth). 문 셀은 제외 후 문 타일로 대체.
    const isDoor = (gx: number, gy: number): boolean =>
      side === "top" ? gy === 0 && gx === dgx
      : side === "bottom" ? gy === r.h - 1 && gx === dgx
      : side === "left" ? gx === 0 && gy === dgy
      : gx === r.w - 1 && gy === dgy;

    for (let gx = 1; gx < r.w - 1; gx++) {
      if (!isDoor(gx, 0)) this.edgeTile("wall_top", r.x + gx, r.y, "top");
      if (!isDoor(gx, r.h - 1)) this.edgeTile("wall_bottom", r.x + gx, r.y + r.h - 1, "bottom");
    }
    for (let gy = 1; gy < r.h - 1; gy++) {
      if (!isDoor(0, gy)) this.edgeTile("wall_left", r.x, r.y + gy, "left");
      if (!isDoor(r.w - 1, gy)) this.edgeTile("wall_right", r.x + r.w - 1, r.y + gy, "right");
    }
    // 모서리 기둥.
    this.edgeTile("corner_tl", r.x, r.y, "top");
    this.edgeTile("corner_tr", r.x + r.w - 1, r.y, "top");
    this.edgeTile("corner_bl", r.x, r.y + r.h - 1, "bottom");
    this.edgeTile("corner_br", r.x + r.w - 1, r.y + r.h - 1, "bottom");
    // 문.
    this.edgeTile(`door_${side}`, r.door.x, r.door.y, side);

    // 가구(바닥 앵커, 세워서).
    for (const p of lay.furniture) {
      this.standTile(p.id, r.x + p.gx, r.y + p.gy, p.cw ?? 1, p.ch ?? 1);
    }
  }

  /** 바닥 타일 — 정확히 CELL×CELL. */
  private floorCell(id: string, gx: number, gy: number, depth: number): void {
    const key = `tile-${id}`;
    if (!this.textures.exists(key)) return;
    const img = this.add
      .image(gx * CELL + CELL / 2, gy * CELL + CELL / 2, key)
      .setDisplaySize(CELL, CELL)
      .setDepth(depth);
    this.layer.add(img);
  }

  /** 벽·문·모서리 — 셀 하단에 바닥 앵커로 얹어 «서 있게». 폭=CELL, 높이=원본 비율. */
  private edgeTile(id: string, gx: number, gy: number, side: string): void {
    const key = `tile-${id}`;
    if (!this.textures.exists(key)) return;
    const src = this.textures.get(key).getSourceImage();
    const aspect = src.height / Math.max(1, src.width);
    const w = CELL;
    const h = Math.min(CELL * 2, w * aspect);
    const img = this.add.image(gx * CELL + CELL / 2, gy * CELL + CELL, key);
    img.setOrigin(0.5, 1).setDisplaySize(w, h);
    // 뒷벽(top)은 위로 서고, 앞벽(bottom)은 낮게. depth는 y 기준으로 겹침 정리.
    img.setDepth(10 + gy + (side === "top" ? 0 : 2));
    this.layer.add(img);
  }

  /** 가구 — 하단 중앙 앵커로 세운다. 폭=footprint*CELL, 높이=원본 비율. */
  private standTile(id: string, gx: number, gy: number, cw: number, ch: number): void {
    const key = `tile-${id}`;
    if (!this.textures.exists(key)) return;
    const src = this.textures.get(key).getSourceImage();
    const aspect = src.height / Math.max(1, src.width);
    const w = cw * CELL;
    const h = Math.min((ch + 1.2) * CELL, w * aspect);
    const cx = gx * CELL + (cw * CELL) / 2;
    const by = gy * CELL + ch * CELL; // footprint 하단
    const img = this.add.image(cx, by, key).setOrigin(0.5, 1).setDisplaySize(w, h);
    img.setDepth(40 + gy);
    this.layer.add(img);
  }

  private fitCamera(): void {
    if (!this.built) return;
    const boardW = GRID_WIDTH * CELL;
    const boardH = GRID_HEIGHT * CELL;
    const cam = this.cameras.main;
    const zoom = Math.min(cam.width / boardW, cam.height / boardH) * 0.98;
    cam.setZoom(zoom);
    cam.centerOn(boardW / 2, boardH / 2);
  }

  // ── ViewContract(테스트베드: 대부분 no-op) ────────────────────────────
  setActive(on: boolean): void {
    this.scene.setVisible(on);
    if (on) {
      this.scene.setActive(true);
      this.fitCamera();
    }
  }
  setMotion(_p: MotionProfile): void {}
  syncActor(_a: ActorSnapshot): void {}
  removeActor(_id: string): void {}
  setCurrent(_id: string | null): void {}
  setElim(_id: string, _on: boolean): void {}
  warp(_id: string, _from: ViewCell, _to: ViewCell, _reason: WarpReason): void {}
  lootWarp(_value: string, _from: ViewCell, _to: ViewCell): void {}
  focusRoom(_room: string, _mode: FocusMode): void {}
  pulseCell(_cell: ViewCell, _tone: PulseTone): void {}
  bubble(_id: string, _text: string, _opts?: BubbleOpts): void {}
  identity(_suspect: string): void {}
  setSurveyed(_rooms: readonly string[]): void {}
  setPassages(_links: readonly PassageLink[]): void {}
  setOutcome(_o: ViewOutcome | null): void {}
  dispose(): void {
    this.layer?.destroy(true);
    this.built = false;
  }

  /** 방 파라미터 미사용 경고 방지용(현재 room 상태를 읽지 않는다). */
  bindRoom(_room: Room): void {}
}
