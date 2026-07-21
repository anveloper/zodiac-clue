import * as THREE from "three";
import type { Room } from "colyseus.js";
import {
  FEAST,
  GRID_HEIGHT,
  GRID_WIDTH,
  ROOM_REGIONS,
  emoji,
  inFeast,
  label,
  roomAt,
} from "@zodiac-clue/shared";

// 2.5D 뷰: 평면 보드를 카메라로 살짝 내려다보는(피치) 원근 뷰.
// 서버 상태(그리드 x,y)를 그대로 읽어 3D 월드로 매핑한다. 룰/입력은 2D와 동일.

const PLAYER_COLORS = [
  0xef4444, 0xf59e0b, 0x84cc16, 0x22c55e, 0x38bdf8, 0xa855f7,
];
const MOVE_COOLDOWN_MS = 110;

const CAM_PITCH = (42 * Math.PI) / 180; // 내려다보는 각(수평 기준)
const MIN_DIST = 9; // 근접
const MAX_DIST = 34; // 전체 조망
const INIT_DIST = 17;
const LERP_ME = 0.14; // 내 턴 추적(빠름)
const LERP_OTHER = 0.06; // 남 턴 추적(천천히)
const CAM_SWITCH_DELAY = 900; // 턴 전환 지연(반증 먼저 인지)
const PAN_STEP = 0.6; // 자유시점 방향키 팬
const TYPE_MS = 55;
const BUBBLE_HOLD_MS = 2600;

// 그리드(gx,gy) → 월드(x,0,z). 보드 중심을 원점에.
const worldX = (gx: number): number => gx - GRID_WIDTH / 2 + 0.5;
const worldZ = (gy: number): number => gy - GRID_HEIGHT / 2 + 0.5;

type PlayerView = {
  name: string;
  suspect: string;
  isBot: boolean;
  x: number;
  y: number;
  eliminated: boolean;
};

type Token = {
  group: THREE.Group;
  ring: THREE.Mesh;
  face: THREE.Sprite;
  cur: THREE.Vector2; // 현재 보간 위치(그리드 단위)
  target: THREE.Vector2; // 목표 위치
  placed: boolean;
};

type Bubble = {
  el: HTMLDivElement;
  id: string;
  full: string;
  shown: number;
  typeTimer: number;
  holdTimer: number;
};

/** 이모지/텍스트를 캔버스 텍스처로 만들어 빌보드 스프라이트로 반환. */
const makeSprite = (
  text: string,
  opts: {
    fontPx: number;
    color?: string;
    bg?: string;
    padX?: number;
    padY?: number;
    worldH: number;
  },
): THREE.Sprite => {
  const { fontPx, color = "#ffffff", bg, padX = 0, padY = 0, worldH } = opts;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Sprite();
  const font = `${fontPx}px system-ui, "Apple SD Gothic Neo", sans-serif`;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const tw = Math.ceil(metrics.width) + padX * 2;
  const th = Math.ceil(fontPx * 1.3) + padY * 2;
  canvas.width = tw;
  canvas.height = th;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (bg) {
    ctx.fillStyle = bg;
    const r = 8;
    ctx.beginPath();
    ctx.roundRect(0, 0, tw, th, r);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.fillText(text, tw / 2, th / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set((worldH * tw) / th, worldH, 1);
  sprite.renderOrder = 10;
  return sprite;
};

export class IsoView {
  private room: Room;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private bubbleLayer: HTMLDivElement;

  private myId: string;
  private tokens = new Map<string, Token>();
  private weapons = new Map<string, THREE.Sprite>();
  private helpers = new Map<string, THREE.Group>();
  private bubbles = new Map<string, Bubble>();

  private look = new THREE.Vector3(0, 0, 0); // 현재 카메라가 보는 지점(보간)
  private panOffset = new THREE.Vector3(0, 0, 0); // 자유시점 이동
  private camDist = INIT_DIST;
  private freeLook = false;
  private dragging = false;
  private lastPointer = new THREE.Vector2();

  private followId = "";
  private switchTimer = 0;
  private lastMove = 0;
  private active = false;
  private raf = 0;

  constructor(room: Room, host: HTMLElement) {
    this.room = room;
    this.myId = room.sessionId;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText =
      "position:fixed; inset:0; width:100%; height:100%; display:none;";
    this.bubbleLayer = document.createElement("div");
    this.bubbleLayer.style.cssText =
      "position:fixed; inset:0; pointer-events:none; display:none;";

    // #game(2D 캔버스) 바로 뒤·HUD 앞에 삽입 → HUD가 항상 위에 쌓이도록.
    const gameDiv = document.getElementById("game");
    if (gameDiv?.parentElement) {
      gameDiv.parentElement.insertBefore(this.canvas, gameDiv.nextSibling);
      gameDiv.parentElement.insertBefore(
        this.bubbleLayer,
        this.canvas.nextSibling,
      );
    } else {
      host.appendChild(this.canvas);
      host.appendChild(this.bubbleLayer);
    }

    this.scene.background = new THREE.Color(0x1c1712);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);

    this.buildLights();
    this.buildBoard();

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);
    this.onResize = this.onResize.bind(this);
    this.loop = this.loop.bind(this);
  }

  // ── 활성/비활성(토글) ──
  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    this.canvas.style.display = on ? "block" : "none";
    this.bubbleLayer.style.display = on ? "block" : "none";
    if (on) {
      this.resize();
      window.addEventListener("keydown", this.onKeyDown);
      window.addEventListener("keyup", this.onKeyUp);
      this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
      this.canvas.addEventListener("pointerdown", this.onPointerDown);
      this.canvas.addEventListener("contextmenu", this.onContextMenu);
      window.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
      window.addEventListener("resize", this.onResize);
      this.raf = requestAnimationFrame(this.loop);
    } else {
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);
      this.canvas.removeEventListener("wheel", this.onWheel);
      this.canvas.removeEventListener("pointerdown", this.onPointerDown);
      this.canvas.removeEventListener("contextmenu", this.onContextMenu);
      window.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("pointerup", this.onPointerUp);
      window.removeEventListener("resize", this.onResize);
      cancelAnimationFrame(this.raf);
    }
  }

  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xfff2d8, 0.6);
    dir.position.set(-8, 16, 6);
    this.scene.add(dir);
  }

  // ── 보드(복도 바닥 + 그리드 + 방 + 잔치상 + 문) ──
  private buildBoard(): void {
    const W = GRID_WIDTH;
    const H = GRID_HEIGHT;
    // 복도 바닥
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshStandardMaterial({ color: 0x2a2118 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // 그리드 선
    const grid = new THREE.GridHelper(W, W, 0x5a4a34, 0x453a2a);
    (grid.material as THREE.Material).opacity = 0.5;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = 0.01;
    this.scene.add(grid);

    // 방(살짝 높은 박스 → 2.5D 깊이감) + 명패 + 문
    for (const r of ROOM_REGIONS) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(r.w, 0.2, r.h),
        new THREE.MeshStandardMaterial({ color: 0xcbb489 }),
      );
      box.position.set(
        worldX(r.x) + (r.w - 1) / 2,
        0.1,
        worldZ(r.y) + (r.h - 1) / 2,
      );
      this.scene.add(box);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(box.geometry),
        new THREE.LineBasicMaterial({ color: 0x7c6238 }),
      );
      edge.position.copy(box.position);
      this.scene.add(edge);

      // 명패(방 이름) — 방 위쪽에 빌보드
      const plaque = makeSprite(label(r.name), {
        fontPx: 44,
        color: "#f0d9a8",
        bg: "#2b2013e8",
        padX: 18,
        padY: 10,
        worldH: 0.7,
      });
      plaque.position.set(box.position.x, 0.9, worldZ(r.y) - 0.1);
      this.scene.add(plaque);

      // 문(입구) — 이 칸으로만 출입. 밝은 바닥 타일 + 문기둥 + "입구" 라벨로 명확히.
      const dx = worldX(r.door.x);
      const dz = worldZ(r.door.y);
      const mark = new THREE.Mesh(
        new THREE.PlaneGeometry(0.94, 0.94),
        new THREE.MeshBasicMaterial({
          color: 0xffd479,
          transparent: true,
          opacity: 0.85,
        }),
      );
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(dx, 0.24, dz);
      this.scene.add(mark);
      const post = new THREE.MeshStandardMaterial({ color: 0x8a5a2a });
      for (const sx of [-0.42, 0.42]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.7, 0.14), post);
        pillar.position.set(dx + sx, 0.35, dz);
        this.scene.add(pillar);
      }
      const door = makeSprite("🚪", { fontPx: 90, worldH: 0.8 });
      door.position.set(dx, 0.66, dz);
      this.scene.add(door);
      const doorLabel = makeSprite("입구", {
        fontPx: 30,
        color: "#2a2118",
        bg: "#ffd479",
        padX: 8,
        padY: 4,
        worldH: 0.3,
      });
      doorLabel.position.set(dx, 1.15, dz);
      this.scene.add(doorLabel);
    }

    // 중앙 잔치상
    const feast = new THREE.Mesh(
      new THREE.BoxGeometry(FEAST.w, 0.34, FEAST.h),
      new THREE.MeshStandardMaterial({ color: 0x3a2b1a }),
    );
    feast.position.set(
      worldX(FEAST.x) + (FEAST.w - 1) / 2,
      0.17,
      worldZ(FEAST.y) + (FEAST.h - 1) / 2,
    );
    this.scene.add(feast);
    const feastEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(feast.geometry),
      new THREE.LineBasicMaterial({ color: 0xb8933f }),
    );
    feastEdge.position.copy(feast.position);
    this.scene.add(feastEdge);
    const gift = makeSprite("🎁", { fontPx: 130, worldH: 1.5 });
    gift.position.set(feast.position.x, 1.1, feast.position.z);
    this.scene.add(gift);
    const feastLabel = makeSprite("잔치상", {
      fontPx: 46,
      color: "#d8c188",
      worldH: 0.6,
    });
    feastLabel.position.set(feast.position.x, 0.5, feast.position.z + 1.4);
    this.scene.add(feastLabel);
  }

  // ── 토큰 생성 ──
  private createToken(id: string, index: number, p: PlayerView): Token {
    const group = new THREE.Group();
    const color = PLAYER_COLORS[index % PLAYER_COLORS.length];
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 32),
      new THREE.MeshStandardMaterial({ color }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.22;
    group.add(disc);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.6, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffd479,
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.23;
    ring.visible = false;
    ring.renderOrder = 9;
    group.add(ring);

    const face = makeSprite(emoji(p.suspect), { fontPx: 110, worldH: 0.95 });
    face.position.set(0, 0.85, 0);
    group.add(face);

    const nameSprite = makeSprite(`${p.isBot ? "🤖" : ""}${p.name}`, {
      fontPx: 34,
      color: "#f0e9dc",
      bg: "#000000aa",
      padX: 10,
      padY: 6,
      worldH: 0.36,
    });
    nameSprite.position.set(0, 0.35, 0.15);
    group.add(nameSprite);

    this.scene.add(group);
    const token: Token = {
      group,
      ring,
      face,
      cur: new THREE.Vector2(p.x, p.y),
      target: new THREE.Vector2(p.x, p.y),
      placed: false,
    };
    this.tokens.set(id, token);
    return token;
  }

  // ── 상태 → 씬 반영(매 프레임 호출) ──
  private syncState(): void {
    const state = this.room.state as unknown as {
      players: Map<string, PlayerView>;
      weapons: Map<string, { value: string; x: number; y: number }>;
      helpers: Map<
        string,
        { value: string; x: number; y: number; used: boolean }
      >;
      currentTurn: string;
    };
    const players = state.players;
    const ids = [...players.keys()];
    const current = state.currentTurn ?? "";
    const seen = new Set<string>();

    players.forEach((p, id) => {
      seen.add(id);
      const token = this.tokens.get(id) ?? this.createToken(id, ids.indexOf(id), p);
      token.target.set(p.x, p.y);
      const isCurrent = id === current;
      token.ring.visible = isCurrent;
      const alpha = p.eliminated ? 0.35 : 1;
      (token.face.material as THREE.SpriteMaterial).opacity = alpha;
    });

    // 장물 토큰
    state.weapons.forEach((w, key) => {
      let s = this.weapons.get(key);
      if (!s) {
        s = makeSprite(emoji(w.value), { fontPx: 96, worldH: 0.8 });
        this.scene.add(s);
        this.weapons.set(key, s);
      }
      s.position.set(worldX(w.x), 0.55, worldZ(w.y));
    });

    // 고정 NPC(계략)
    state.helpers.forEach((h, key) => {
      let g = this.helpers.get(key);
      if (!g) {
        g = new THREE.Group();
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(0.42, 32),
          new THREE.MeshStandardMaterial({ color: 0x2b2013 }),
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = 0.22;
        g.add(disc);
        const face = makeSprite(emoji(h.value), { fontPx: 100, worldH: 0.85 });
        face.position.set(0, 0.8, 0);
        g.add(face);
        const mark = makeSprite("🃏", { fontPx: 48, worldH: 0.4 });
        mark.position.set(0.3, 1.15, 0);
        g.add(mark);
        const tag = makeSprite("계략", {
          fontPx: 30,
          color: "#e0a35a",
          bg: "#000000aa",
          padX: 8,
          padY: 4,
          worldH: 0.28,
        });
        tag.position.set(0, 0.32, 0.15);
        g.add(tag);
        g.position.set(worldX(h.x), 0, worldZ(h.y));
        this.scene.add(g);
        this.helpers.set(key, g);
      }
      const op = h.used ? 0.3 : 1;
      g.children.forEach((c) => {
        if (c instanceof THREE.Sprite)
          (c.material as THREE.SpriteMaterial).opacity = op;
      });
    });

    // 카메라 추적 대상 = 현재 턴(지연 전환)
    const followCand = current && this.tokens.has(current) ? current : this.myId;
    if (followCand !== this.followId && this.switchTimer === 0) {
      const isMe = followCand === this.myId;
      this.switchTimer = window.setTimeout(
        () => {
          this.followId = followCand;
          this.switchTimer = 0;
          this.panOffset.set(0, 0, 0); // 새 턴 대상으로 리센터
        },
        isMe ? 150 : CAM_SWITCH_DELAY,
      );
    }
    if (this.followId === "") this.followId = followCand;

    // 사라진 토큰 정리
    for (const id of [...this.tokens.keys()]) {
      if (!seen.has(id)) {
        const t = this.tokens.get(id);
        if (t) this.scene.remove(t.group);
        this.tokens.delete(id);
      }
    }
  }

  // ── 매 프레임 루프 ──
  private loop(): void {
    if (!this.active) return;
    this.syncState();

    // 토큰 위치 보간(그리드→월드)
    this.tokens.forEach((t) => {
      const k = t.placed ? 0.25 : 1;
      t.cur.lerp(t.target, k);
      t.placed = true;
      t.group.position.set(worldX(t.cur.x), 0, worldZ(t.cur.y));
    });

    // 카메라: 추적 대상으로 부드럽게
    const ft = this.tokens.get(this.followId);
    if (ft) {
      const inset = this.insetWorld();
      const desired = new THREE.Vector3(
        worldX(ft.cur.x) + inset + this.panOffset.x,
        0,
        worldZ(ft.cur.y) + this.panOffset.z,
      );
      const l = this.followId === this.myId ? LERP_ME : LERP_OTHER;
      this.look.lerp(desired, this.freeLook || this.dragging ? 1 : l);
    }
    const off = new THREE.Vector3(
      0,
      Math.sin(CAM_PITCH),
      Math.cos(CAM_PITCH),
    ).multiplyScalar(this.camDist);
    this.camera.position.copy(this.look).add(off);
    this.camera.lookAt(this.look);

    this.updateBubbles();
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** 우측 패널이 가리는 만큼 시선 중심을 오른쪽으로 보정(토큰이 보이는 영역 중앙에 오도록). */
  private insetWorld(): number {
    const el = document.getElementById("rightPanel");
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const insetPx = Math.max(0, window.innerWidth - rect.left);
    const frac = insetPx / window.innerWidth;
    const aspect = window.innerWidth / window.innerHeight;
    const viewW = 2 * this.camDist * Math.tan((45 * Math.PI) / 360) * aspect;
    return (frac * viewW) / 2;
  }

  // ── 말풍선(DOM 오버레이 + 타자기) ──
  showBubble(id: string, text: string): void {
    const prev = this.bubbles.get(id);
    if (prev) {
      window.clearInterval(prev.typeTimer);
      window.clearTimeout(prev.holdTimer);
      prev.el.remove();
      this.bubbles.delete(id);
    }
    const el = document.createElement("div");
    el.style.cssText =
      "position:absolute; transform:translate(-50%,-100%); max-width:260px;" +
      "background:#f0e0c0; color:#2a2118; padding:4px 8px; border-radius:8px;" +
      "font-size:15px; line-height:1.35; text-align:center; white-space:pre-wrap;" +
      "box-shadow:0 2px 8px #0008;";
    this.bubbleLayer.appendChild(el);
    const b: Bubble = {
      el,
      id,
      full: text,
      shown: 0,
      typeTimer: 0,
      holdTimer: 0,
    };
    b.typeTimer = window.setInterval(() => {
      b.shown += 1;
      el.textContent = text.slice(0, b.shown);
      if (b.shown >= text.length) {
        window.clearInterval(b.typeTimer);
        b.holdTimer = window.setTimeout(() => {
          el.remove();
          this.bubbles.delete(id);
        }, BUBBLE_HOLD_MS);
      }
    }, TYPE_MS);
    this.bubbles.set(id, b);
  }

  private updateBubbles(): void {
    if (this.bubbles.size === 0) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.bubbles.forEach((b) => {
      const token = this.tokens.get(b.id);
      const helper = this.helpers.get(b.id);
      const base = token ? token.group.position : helper?.position;
      if (!base) return;
      const pos = new THREE.Vector3(base.x, 1.6, base.z).project(this.camera);
      const sx = (pos.x * 0.5 + 0.5) * w;
      const sy = (-pos.y * 0.5 + 0.5) * h;
      b.el.style.left = `${sx}px`;
      b.el.style.top = `${sy}px`;
      b.el.style.display = pos.z > 1 ? "none" : "block";
    });
  }

  // ── 입력 ──
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.camDist = THREE.MathUtils.clamp(
      this.camDist * (e.deltaY > 0 ? 1.1 : 0.9),
      MIN_DIST,
      MAX_DIST,
    );
  }

  private onPointerDown(e: PointerEvent): void {
    // 우클릭/휠클릭 드래그 = 화면 팬(자유시점 아니어도). 좌클릭은 자유시점(Space) 중에만.
    const rightOrMid = e.button === 1 || e.button === 2;
    if (!this.freeLook && !rightOrMid) return;
    this.dragging = true;
    this.lastPointer.set(e.clientX, e.clientY);
    if (rightOrMid) e.preventDefault();
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    this.lastPointer.set(e.clientX, e.clientY);
    const k = this.camDist / 600;
    this.panOffset.x -= dx * k;
    this.panOffset.z -= dy * k;
  }

  private onPointerUp(): void {
    this.dragging = false;
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code === "Space") {
      this.freeLook = true;
      return;
    }
    let dx = 0;
    let dy = 0;
    switch (e.code) {
      case "ArrowUp":
      case "KeyW":
        dy = -1;
        break;
      case "ArrowDown":
      case "KeyS":
        dy = 1;
        break;
      case "ArrowLeft":
      case "KeyA":
        dx = -1;
        break;
      case "ArrowRight":
      case "KeyD":
        dx = 1;
        break;
      default:
        return;
    }
    if (this.freeLook) {
      this.panOffset.x += dx * PAN_STEP;
      this.panOffset.z += dy * PAN_STEP;
      return;
    }
    // 이동 게이팅(2D와 동일)
    const s = this.room.state as unknown as {
      currentTurn: string;
      stepsLeft: number;
      players: Map<string, { x: number; y: number }>;
    };
    if (s.currentTurn !== this.myId) return;
    const me = s.players.get(this.myId);
    const inRoom = !!me && roomAt(me.x, me.y) !== null;
    const free = !!me && (inRoom || inFeast(me.x, me.y));
    const steps = s.stepsLeft ?? 0;
    if (!free && steps <= 0) return;
    if (me && inRoom && steps <= 0) {
      const tx = me.x + dx;
      const ty = me.y + dy;
      if (roomAt(tx, ty) === null && !inFeast(tx, ty)) return;
    }
    const now = performance.now();
    if (now - this.lastMove < MOVE_COOLDOWN_MS) return;
    this.lastMove = now;
    this.room.send("move", { dx, dy });
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.code === "Space") {
      this.freeLook = false;
      this.dragging = false;
      this.panOffset.set(0, 0, 0);
    }
  }

  private onResize(): void {
    this.resize();
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
