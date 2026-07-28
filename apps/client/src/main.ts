import Phaser from "phaser";
import {
  PASSAGES,
  ROOMS,
  SUSPECTS,
  WEAPONS,
  ZODIAC,
  emoji,
  job,
  label,
  passageOf,
  persona,
  timingOf,
  zodiacColorHex,
  zodiacCue,
  type Card,
  type MotionProfile,
  type ViewTiming,
  type ZodiacFamily,
} from "@zodiac-clue/shared";
import type { Room } from "colyseus.js";
import {
  client,
  createRoom,
  joinRoomById,
  listPublicRooms,
  type PublicRoom,
} from "./network";
import { GameScene } from "./scenes/game-scene";
import { PixelScene } from "./scenes/pixel-scene";
import { IsoView } from "./scenes/iso-view";
import { cvdMode, resolveMotion } from "./scenes/view-motion";
import type {
  FocusMode,
  PassageLink,
  ViewCell,
  ViewContract,
  ViewOutcome,
  WarpReason,
} from "./scenes/view-contract";

/** 재접속 토큰 저장 키. sessionStorage = 탭 단위(새로고침엔 유지, 새 탭엔 없음). */
const RECONNECT_KEY = "zc_reconnect";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const errMsg = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof Event !== "undefined" && e instanceof Event) {
    return "서버(ws://localhost:2567)에 연결하지 못했습니다. 서버가 켜져 있나요? → `pnpm dev`";
  }
  return String(e);
};

// ── 화면 전환 ─────────────────────────────
const SCREENS = ["landing", "lobby", "gameScreen"] as const;
type ScreenId = (typeof SCREENS)[number];
const show = (which: ScreenId): void => {
  for (const id of SCREENS) $(id).classList.toggle("hidden", id !== which);
};

// ── 로그 ─────────────────────────────
type LogKind = "info" | "move" | "suggest" | "disprove" | "accuse" | "win";
type LogOpts = { kind?: LogKind; sid?: string; disproved?: boolean };
const sidDivs = new Map<string, HTMLElement>();

const addLog = (text: string, opts: LogOpts = {}): void => {
  const kind = opts.kind ?? "info";
  const div = document.createElement("div");
  div.className = "log-" + kind;
  div.textContent = text;
  if (opts.sid && kind === "suggest") sidDivs.set(opts.sid, div);
  // 반증 결과 → 원 제안 로그에 배지 부착
  if (opts.sid && kind === "disprove") {
    const orig = sidDivs.get(opts.sid);
    if (orig) {
      const badge = document.createElement("span");
      badge.className = "log-badge" + (opts.disproved ? "" : " none");
      badge.textContent = opts.disproved ? "반증됨" : "정답후보";
      orig.appendChild(badge);
    }
  }
  $("log").prepend(div);
};

// ── HUD 12색 (view-contract-spec §4.2 · 로드맵 §7.11) ─────────────────
// 보드(캔버스)에는 `ZODIAC_COLOR`가 들어갔는데 HUD는 무채색이라 **같은 인물이
// 화면과 패널에서 다르게 보였다**. 색은 `zodiacColorHex()`에서만 온다 — 여기서
// 새 색을 고르지 않는다.
//
// ⚠ 색 단독 식별 금지(§4.1: 회색조로는 12색이 분리되지 않는다).
//    HUD의 모든 색 적용 지점에는 2차 단서가 함께 붙는다:
//      · 턴 배너 칩  = 이모지 + 이름 첫 글자
//      · 대기실 카드 = 이모지 + 이름 전체
//      · 증거노트 칩 = 이모지 + 이름 전체
//      · 턴 원형     = 이모지 + 이름 전체 + 순번/현재/다음 배지
// HUD는 DOM이라 뷰1~4 어느 렌더러가 떠 있어도 같은 마크업이 뜬다(뷰 독립).

/** 색 밑줄(§7.11 `inset 0 -3px 0 <색>`) — 턴 배너 칩·턴 원형 바에 쓴다. */
const colorUnderline = (suspect: string): string =>
  `inset 0 -3px 0 ${zodiacColorHex(suspect)}`;
/** 좌측 3px 스트라이프(§4.2 "색과 이름을 같은 픽셀에") — 대기실·증거노트 칩. */
const colorStripe = (suspect: string): string =>
  `inset 3px 0 0 ${zodiacColorHex(suspect)}`;

/**
 * `?cvd=1` 색각 대체 표기(§4.3)를 HUD 문자 버전으로 옮긴 것.
 * 인코딩은 팔레트 구조 그대로 — **계열(4) × 명도단(3)**, 최대 3개만 세면 된다.
 * 글리프도 §4.3 규정 그대로: 적 ▌· 벽 ▀· 자 ▐· 청 ▄ / 핍 ● ●● ●●●.
 * 색은 흰색 고정(CSS `.cvd-cue`) — 색 대체 표기가 색에 의존하면 의미가 없다.
 */
const CVD_BAR: Record<ZodiacFamily, string> = {
  red: "▌",
  jade: "▀",
  violet: "▐",
  blue: "▄",
};
const cvdOn = cvdMode();
const cvdTag = (suspect: string): string => {
  if (!cvdOn) return "";
  const cue = zodiacCue(suspect);
  if (!cue) return "";
  return `<span class="cvd-cue">${CVD_BAR[cue.family]}${"●".repeat(cue.tier + 1)}</span>`;
};

// ── 카드 선택 모달 ─────────────────────────────
type Pick = { suspect: string; weapon: string; room?: string };

/**
 * 카드 접두 아이콘. 장소 9종은 EMOJI 맵에 없어 `emoji()`가 빈 문자열을 준다
 * → 장소는 고정 문자 `📍`로 통일한다(ui-copy §2 표기 접두 기호).
 */
const ROOM_SET: ReadonlySet<string> = new Set<string>(ROOMS);
const cardIcon = (v: string): string => (ROOM_SET.has(v) ? "📍" : emoji(v));

/**
 * 카드 셀렉트. `mine`(내 손패)은 **표시**만 다를 수도, 선택 불가일 수도 있다.
 *
 * - 고발(`lockMine=true`): 내 패를 고르는 것은 자멸이므로 `disabled` 유지(ui-copy §6.2).
 * - 제안(`lockMine=false`): **선택 가능**(ui-copy §6.1 · 로드맵 §7.5.2).
 *   "내 카드를 지목해 반증자를 통제"는 클루의 정석 전술인데 서버는 이미 허용하고
 *   클라만 막고 있었다. 접미 문안은 §6.1의 `— 내 패`.
 */
const selectFrom = (
  values: readonly string[],
  mine?: Set<string>,
  /** 내 패 옵션 접미 — 제안/고발이 다르다(ui-copy §6.1·§6.2) */
  mySuffix = " — 내 패",
  /** 내 패를 선택 불가로 잠글지(고발만 true) */
  lockMine = true,
): HTMLSelectElement => {
  const sel = document.createElement("select");
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    // 셀렉트 옵션 라벨: 이모지 + 라벨 (ui-copy §6 공통 규칙)
    opt.textContent =
      `${cardIcon(v)} ${label(v)}` + (mine?.has(v) ? mySuffix : "");
    if (lockMine && mine?.has(v)) opt.disabled = true;
    sel.appendChild(opt);
  }
  // 내 패가 아닌 첫 옵션을 기본 선택 — 제안에서 선택은 열어 두되 기본값으로 밀지 않는다.
  const first =
    [...sel.options].find((o) => !o.disabled && !mine?.has(o.value)) ??
    [...sel.options].find((o) => !o.disabled);
  if (first) sel.value = first.value;
  return sel;
};

/** 이번 판 용의자 후보 = 참여자 6명의 캐릭터(십이지 순서 유지). */
const participantSuspects = (): string[] => {
  if (!room) return [...SUSPECTS];
  const set = new Set<string>();
  (room.state.players as Map<string, { suspect: string }>).forEach((p) =>
    set.add(p.suspect),
  );
  return ZODIAC.filter((z) => set.has(z));
};

type PickerOpts = {
  title: string;
  /** 장소를 사용자가 고른다(고발). 제안은 현재 방으로 고정이라 false. */
  needRoom: boolean;
  /** 제안 — 현재 방 읽기전용 고정행. 값은 서버로 보내지 않는다(서버가 player.room 사용). */
  fixedRoom?: string;
  /** 상단 위험 경고(고발) */
  warn?: string;
  /** 하단 안내 줄 */
  note?: string;
  okLabel: string;
  okDanger?: boolean;
  mySuffix: string;
  /** 내 손패를 선택 불가로 잠글지 — 고발만 true(ui-copy §6.2). */
  lockMine: boolean;
};

const openPicker = (opts: PickerOpts): Promise<Pick | null> =>
  new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const modal = document.createElement("div");
    modal.className = "modal";

    const h = document.createElement("h2");
    h.textContent = opts.title;
    modal.appendChild(h);

    if (opts.warn) {
      const w = document.createElement("div");
      w.className = "modal-warn";
      w.textContent = opts.warn;
      modal.appendChild(w);
    }

    const suspectSel = selectFrom(
      participantSuspects(),
      myCards,
      opts.mySuffix,
      opts.lockMine,
    );
    const weaponSel = selectFrom(
      WEAPONS,
      myCards,
      opts.mySuffix,
      opts.lockMine,
    );
    const roomSel = opts.needRoom
      ? selectFrom(ROOMS, myCards, opts.mySuffix, opts.lockMine)
      : null;

    const row = (labelText: string, sel: HTMLSelectElement): HTMLDivElement => {
      const r = document.createElement("div");
      r.className = "modal-row";
      const l = document.createElement("label");
      l.textContent = labelText;
      r.append(l, sel);
      return r;
    };

    // 장소 고정행 — 제안은 "어느 방에서 하는지"가 3요소 중 하나인데 화면에 없었다.
    // 고르는 값이 아니라 현재 방이므로 읽기 전용 표시로 둔다.
    if (opts.fixedRoom) {
      const r = document.createElement("div");
      r.className = "modal-fixed";
      r.title = "제안 장소는 지금 서 있는 방으로 정해져요.";
      const l = document.createElement("label");
      l.textContent = "장소";
      const v = document.createElement("span");
      v.className = "mf-val";
      v.textContent = `📍 ${label(opts.fixedRoom)}`;
      const b = document.createElement("span");
      b.className = "mf-badge";
      b.textContent = "현재 방 · 고정";
      r.append(l, v, b);
      modal.appendChild(r);
    }

    modal.appendChild(row("용의자", suspectSel));
    modal.appendChild(row("훔친 것", weaponSel));
    if (roomSel) modal.appendChild(row("장소", roomSel));

    if (opts.note) {
      const n = document.createElement("div");
      n.className = "modal-note";
      n.textContent = opts.note;
      modal.appendChild(n);
    }

    const actions = document.createElement("div");
    actions.className = "actions";
    const cancel = document.createElement("button");
    cancel.className = "ghost";
    cancel.textContent = "취소";
    const ok = document.createElement("button");
    ok.textContent = opts.okLabel;
    if (opts.okDanger) ok.className = "danger";
    actions.append(cancel, ok);
    modal.appendChild(actions);

    const close = (result: Pick | null): void => {
      overlay.remove();
      resolve(result);
    };
    cancel.onclick = () => close(null);
    ok.onclick = () =>
      close({
        suspect: suspectSel.value,
        weapon: weaponSel.value,
        room: roomSel?.value,
      });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  });

/**
 * 손패 HUD — 1행이 라벨이자 규칙 설명이다(ui-copy §4.1).
 * "이 3장은 정답이 아님"은 서버가 개별 전송한 손패를 **표시**할 뿐이고,
 * 클라가 정답 여부를 계산하지 않는다(규칙: 손패는 정답 봉투에서 제외된 카드).
 */
const renderHand = (cards: Card[]): void => {
  const host = $("hand");
  host.innerHTML = "";
  const line1 = document.createElement("div");
  line1.className = "hand-label";
  line1.textContent = "🃏 내 손패 · 이 3장은 정답이 아님";
  const line2 = document.createElement("div");
  line2.className = "hand-cards";
  for (const c of cards) {
    const chip = document.createElement("span");
    chip.textContent = `${cardIcon(c.value)} ${label(c.value)}`;
    line2.appendChild(chip);
  }
  host.append(line1, line2);
};

// ── 상태 ─────────────────────────────
let room: Room | null = null;
let game: Phaser.Game | null = null;
let iso: IsoView | null = null;
let phaserStarted = false;

// ── 뷰 진화 단계(순서형·확장형) ─────────────────────────────
// 버튼을 누를 때마다 다음 단계로 순환. 새 단계는 배열에 push만 하면 UI에 자동 편입.
// (이름이 아마존 S3와 헷갈려서 "뷰1/뷰2/뷰3"로 통일.)
type Stage = {
  id: string;
  label: string;
  kind: "phaser" | "three" | "pixel";
  assets: boolean;
};
const STAGES: Stage[] = [
  { id: "2d-emoji", label: "뷰1 · 2D", kind: "phaser", assets: false },
  { id: "three-emoji", label: "뷰2 · 2.5D", kind: "three", assets: false },
  { id: "three-asset", label: "뷰3 · 에셋", kind: "three", assets: true },
  { id: "pixel", label: "뷰4 · 도트", kind: "pixel", assets: false },
  // 미래: { id: "three-3d", label: "뷰5 · 3D", kind: "three", assets: true } 등 append
];
let stageIndex = 0;
/** 내 손패 카드값 집합 — 정답일 수 없으므로 제안·증거노트에서 자동 비활성화. */
let myCards = new Set<string>();
/** 직전 게임 페이즈 — 리매치(ended→playing) 감지용. */
let lastPhase = "";

// ── 활성 뷰 접근자 (spec §3 "`say` 라우팅 3분기 → `activeView()` 하나로 축약") ──
// `main.ts`는 **뷰를 모른다.** 어떤 렌더러가 떠 있든 `ViewContract` 한 타입으로만 말한다.
// 그래서 뷰5를 추가해도 여기 분기가 늘지 않는다(계약 원칙 4).
//
// ⚠ Phaser 씬은 **`create()`가 끝나기 전에도 인스턴스가 조회된다.** 그 시점에 계약을
//   호출하면 보드 사각형·명패가 아직 없어 조용히 아무 일도 안 일어난다 →
//   `isActive(key)`(= status RUNNING, create 완료)로 게이트한다.
const phaserView = (key: "game" | "pixel"): GameScene | PixelScene | null => {
  if (!game || !game.scene.isActive(key)) return null;
  return (game.scene.getScene(key) as GameScene | PixelScene | null) ?? null;
};

/** 지금 화면을 그리고 있는 뷰. 아직 준비되지 않았으면 `null`. */
const activeView = (): ViewContract | null => {
  const st = STAGES[stageIndex];
  if (st.kind === "three") return iso;
  return phaserView(st.kind === "pixel" ? "pixel" : "game");
};

/** 살아 있는 렌더러 전부(뷰2·3은 IsoView 한 인스턴스가 겸한다 → 4뷰 = 3인스턴스). */
const allViews = (): ViewContract[] => {
  const out: ViewContract[] = [];
  const g = phaserView("game");
  if (g) out.push(g);
  const p = phaserView("pixel");
  if (p) out.push(p);
  if (iso) out.push(iso);
  return out;
};

// ── 감속 프로파일: 한 곳에서 판정해 4뷰에 브로드캐스트 (spec §3 `main.ts`) ──
// 렌더러 3종이 각자 `currentTiming()`을 부르던 것을 여기서 덮어쓴다. OS 설정이
// 판 도중 바뀌어도 4뷰가 **동시에** 같은 프로파일로 넘어간다.
let motion: MotionProfile = resolveMotion();
let timing: ViewTiming = timingOf(motion);

const broadcastMotion = (): void => {
  motion = resolveMotion();
  timing = timingOf(motion);
  for (const v of allViews()) v.setMotion(motion);
};

try {
  window
    .matchMedia?.("(prefers-reduced-motion: reduce)")
    ?.addEventListener?.("change", broadcastMotion);
} catch {
  /* matchMedia 미지원 — 초기 판정값을 그대로 쓴다 */
}

// ── 비밀 통로 링크(정적) — 양방향 3쌍을 한 번만 넘긴다(계약 `setPassages` 주석) ──
const PASSAGE_LINKS: readonly PassageLink[] = (() => {
  const seen = new Set<string>();
  const out: PassageLink[] = [];
  for (const [from, to] of Object.entries(PASSAGES)) {
    const key = [from, to].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to });
  }
  return out;
})();

// ── 뷰 전환 정합용 파생 상태 ──────────────────────────────
// 전부 **표현용 사본**이다. 진실값은 서버 상태이고 여기엔 그것을 읽어 만든 것만 둔다.
/** "이미 살펴본 방" — 서버 상태에 없는 클라 로컬 집합(계약 `setSurveyed` 주석). */
const surveyedRooms = new Set<string>();
let surveyDirty = true;
/** 판의 종료(승자). 진행 중이면 `null`. `state.winner`에서만 파생된다. */
let outcome: ViewOutcome | null = null;
/** 마지막으로 현재 상태를 통째로 먹인 뷰. 뷰가 바뀌면 다시 먹인다. */
let syncedView: ViewContract | null = null;

/**
 * 뷰에 현재 상태를 통째로 주입. **뷰를 바꾼 직후** 새 뷰가 조사한 방·통로·현재 턴·
 * 탈락을 그대로 이어받게 하는 지점이다(배정 (3)).
 * `force`가 아니어도 뷰 인스턴스가 바뀌면 자동으로 전량 재주입한다.
 */
const syncActiveView = (force = false): void => {
  const v = activeView();
  if (!v) return;
  const fresh = force || v !== syncedView;
  if (!fresh) {
    if (surveyDirty) {
      v.setSurveyed([...surveyedRooms]);
      surveyDirty = false;
    }
    return;
  }
  syncedView = v;
  surveyDirty = false;
  v.setMotion(motion);
  v.setPassages(PASSAGE_LINKS);
  v.setSurveyed([...surveyedRooms]);
  v.setOutcome(outcome);
  if (!room) return;
  const state = room.state;
  // 12종 구분 가능성 확보 — 뷰3만 실제 프리로드가 일어나고 나머지는 표기 되맞춤.
  for (const z of participantSuspects()) v.identity(z);
  const players = state.players as Map<string, MePlayer>;
  players.forEach((p, id) => v.setElim(id, !!p.eliminated));
  v.setCurrent(state.currentTurn === "" ? null : state.currentTurn);
};

// ── 사건 → 연출 라우팅 (spec §5 ❌ 9행) ───────────────────
// 서버는 소환·통로 전용 메시지를 보내지 않는다 — **동기화 상태의 델타**가 사실이다
// (로드맵 §2.2 "상태 델타로 판정"). 여기서 하는 일은 그 델타를 읽어 **어떤 연출을
// 부를지 고르는 것**뿐이고, 위치·방·승자 같은 값은 전부 서버가 준 것을 그대로 넘긴다.
type CellSnap = { x: number; y: number; room: string };
const lastCells = new Map<string, CellSnap>();
const lastLoot = new Map<string, CellSnap>();
/** 델타 판정에 쓰는 직전 페이즈. 전환 틱(배치·리매치)에는 연출을 내지 않는다. */
let fxPhase = "";

const cheb = (a: CellSnap, b: CellSnap): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** 연출 사본 초기화 — 리매치처럼 판이 다시 깔릴 때 직전 판의 잔상을 지운다. */
const resetFxState = (): void => {
  lastCells.clear();
  lastLoot.clear();
  surveyedRooms.clear();
  surveyDirty = true;
  outcome = null;
  activeView()?.setOutcome(null);
  activeView()?.setSurveyed([]);
};

// 캐릭터 선택은 대기실(renderLobbyChars)에서만 수행 — 랜딩엔 방 만들기/참여만.

// ── 방 연결 후 공통 배선 ─────────────────────────────
const storeToken = (r: Room): void => {
  try {
    sessionStorage.setItem(RECONNECT_KEY, r.reconnectionToken);
  } catch {
    /* sessionStorage 불가 시 무시 */
  }
};

const wireRoom = (r: Room): void => {
  room = r;
  storeToken(r);

  const link = `${location.origin}/room/${r.roomId}`;
  ($("inviteLink") as HTMLInputElement).value = link;
  try {
    history.replaceState({}, "", `/room/${r.roomId}`);
  } catch {
    /* history 사용 불가 시 무시 */
  }

  r.onMessage(
    "log",
    (m: { text: string; kind?: LogKind; sid?: string; disproved?: boolean }) =>
      addLog(m.text, { kind: m.kind, sid: m.sid, disproved: m.disproved }),
  );
  r.onMessage("hand", (m: { cards: Card[] }) => {
    myCards = new Set(m.cards.map((c) => c.value));
    renderHand(m.cards);
    // 내 패를 증거노트에 '제외' 잠금으로 반영
    if (room) buildEvidence(room.roomId);
  });
  r.onMessage("disprove", (m: { by: string | null; card: Card | null }) => {
    if (m.card) {
      addLog(`🔎 ${m.by} 님이 "${label(m.card.value)}" 단서로 반증 (나만 봄)`, {
        kind: "disprove",
      });
    } else {
      addLog("🔎 아무도 반증하지 못함 — 정답 후보!", { kind: "disprove" });
    }
    // 반증은 **나만 보는 정보**라 로그가 우측 끝에 뜬다 → 보드에도 "어느 칸을 봐야
    // 하는지"를 남긴다(계약 `pulseCell`). 이 메시지는 제안자에게만 온다.
    const v = activeView();
    if (!v) return;
    const players = r.state.players as Map<string, MePlayer>;
    if (m.card && m.by) {
      const hits: ViewCell[] = [];
      players.forEach((p) => {
        if (p.name === m.by) hits.push({ x: p.x, y: p.y });
      });
      // 동명이인이면 판정 불가 → 표기하지 않는다(엉뚱한 칸을 가리키는 것보다 낫다).
      if (hits.length === 1) v.pulseCell(hits[0], "neutral");
    } else {
      const me = players.get(r.sessionId);
      // 미반증 = 정답 후보. 제안이 일어난 방(= 내가 서 있는 방)을 경고 톤으로.
      if (me) v.pulseCell({ x: me.x, y: me.y }, "alert");
    }
  });
  r.onMessage("accuseResult", (m: { player: string; correct: boolean }) => {
    addLog(m.correct ? `🎉 ${m.player} 정답!` : `❌ ${m.player} 오답`, {
      kind: m.correct ? "win" : "accuse",
    });
  });
  // 즉시고발 창(§7.5.1) — 서버가 연 창을 표시만 한다. 만료 판정은 서버 몫.
  r.onMessage("canAccuse", (m: { ms: number }) => openAccuseWindow(m.ms));
  r.onMessage("say", (m: { id: string; from: string; text: string }) => {
    addLog(`💬 ${m.from}: ${m.text}`, { kind: "info" });
    // 귓속말 판정은 **서버 상태를 읽는 것**이다 — 계략 NPC(고정 헬퍼)는 `helpers` 맵의
    // 키가 십이지 id이고, `helperWhisper()`가 그 id로 `say`를 보낸다. 좌석(sessionId)이
    // 말한 것은 공개 대사, 헬퍼가 말한 것은 귓속말(§5 행 10).
    const whisper = (r.state.helpers as Map<string, unknown>).has(m.id);
    activeView()?.bubble(m.id, m.text, whisper ? { whisper: true } : undefined);
  });
  r.onMessage("peek", (m: { from: string; cards: Card[] }) => {
    addLog(
      `🃏 ${m.from}의 계략 — 엿본 카드: ${m.cards
        .map((c) => label(c.value))
        .join(", ")} (정답 아님·나만 봄)`,
      { kind: "info" },
    );
    // 엿본 카드는 정답 아님 → 증거노트에 자동 '제외' 표시
    if (room) {
      const data = loadEvi(room.roomId);
      m.cards.forEach((c) => {
        data[c.value] = "cleared";
      });
      saveEvi(room.roomId, data);
      buildEvidence(room.roomId);
    }
  });

  r.onStateChange((state) => {
    // 리매치(종료→진행 전환) 시 증거노트 초기화
    if (lastPhase === "ended" && state.phase === "playing") {
      try {
        localStorage.removeItem(eviKey(r.roomId));
      } catch {
        /* noop */
      }
      buildEvidence(r.roomId);
      resetFxState(); // 승리 연출·살펴본 방·위치 스냅샷을 새 판 기준으로 되돌린다
    }
    lastPhase = state.phase;

    renderLobby(state);
    updateTurnInfo(state);
    updateEndState(state);
    if (state.phase === "playing" && !phaserStarted) enterGame();
    // 연출 라우팅은 **뷰가 생긴 뒤에** — `enterGame()` 뒤에 오는 것이 조건이다.
    applyFx(state);
  });

  r.onError((code, message) => addLog(`에러(${code}): ${message ?? ""}`));

  show("lobby");
};

// ── 오버레이 버스 (최소안 · 로드맵 §7.10) ─────────────────────────────
// 전면(풀스크린) 오버레이의 표시·해제·타이머를 **이 큐 하나만** 소유한다.
// 이전에는 주사위(#diceOverlay)와 결과(#endOverlay)가 서로의 존재를 모른 채
// 각자 setInterval/setTimeout을 들고 같은 자리를 덮었다.
// 최소안 범위 = 주사위 충돌 가드 + 하단 배너 슬롯. 연출 큐·인터스티셜은 08-05.
/** 전면 오버레이 우선순위 — 값이 클수록 우선. §7.10이 지정한 값은 그대로 사용. */
const OVERLAY_PRIORITY = {
  end: 100, // 결과 화면 — 판이 끝나면 그 위에 아무것도 두지 않는다(§7.10)
  goal: 90, // 온보딩 목표 카드(§1.5) — §7.10에 값이 없어 여기서 확정. 주사위보다 앞선다
  dice: 80, // 주사위(§7.10)
  interstitial: 60, // 뷰 전환 인터스티셜(§7.10) — 완전판 08-05 예약, 현재 미사용
  banner: 40, // 하단 배너 슬롯(§7.10 `fxBanner`) — 전면을 막지 않아 큐 밖에서 처리
} as const;
type OverlayId = keyof typeof OVERLAY_PRIORITY;

/** 표시 중인 오버레이가 버스에서 빌려 쓰는 타이머 핸들. 타이머는 버스가 회수한다. */
type OverlayHandle = {
  after: (ms: number, fn: () => void) => void;
  close: () => void;
};
type OverlayReq = {
  id: OverlayId;
  el: HTMLElement;
  /** 표시 직후 실행. 타이머는 반드시 핸들을 통해서만 건다. */
  run?: (h: OverlayHandle) => void;
  /** 대기열에서 꺼낼 때 재검증 — false면 조용히 버린다(뒤늦은 주사위 방지). */
  valid?: () => boolean;
  /** 더 높은 우선순위에 밀렸을 때 대기열로 돌아갈지 */
  requeue?: boolean;
};

let activeOverlay: OverlayReq | null = null;
let overlayTimers: number[] = [];
const pendingOverlays: OverlayReq[] = [];

const hideOverlay = (): void => {
  if (!activeOverlay) return;
  overlayTimers.forEach((t) => window.clearTimeout(t));
  overlayTimers = [];
  activeOverlay.el.classList.add("hidden");
  activeOverlay = null;
};

const runOverlay = (req: OverlayReq): void => {
  activeOverlay = req;
  req.el.classList.remove("hidden");
  req.run?.({
    after: (ms, fn) => {
      overlayTimers.push(window.setTimeout(fn, ms));
    },
    close: () => closeOverlay(req.id),
  });
};

/** 대기열에서 가장 우선순위 높은 것을 꺼내 표시. 유효하지 않으면 버린다. */
const flushOverlay = (): void => {
  while (!activeOverlay && pendingOverlays.length > 0) {
    pendingOverlays.sort(
      (a, b) => OVERLAY_PRIORITY[b.id] - OVERLAY_PRIORITY[a.id],
    );
    const next = pendingOverlays.shift();
    if (!next) return;
    if (next.valid && !next.valid()) continue;
    runOverlay(next);
  }
};

const closeOverlay = (id: OverlayId): void => {
  const i = pendingOverlays.findIndex((p) => p.id === id);
  if (i >= 0) pendingOverlays.splice(i, 1);
  if (activeOverlay?.id === id) {
    hideOverlay();
    flushOverlay();
  }
};

const isOverlayShown = (id: OverlayId): boolean => activeOverlay?.id === id;

/**
 * 전면 오버레이 요청. 동시 표시는 없다.
 * - 표시 중인 것보다 우선순위가 낮거나 같으면 **대기열**로 (주사위 충돌 가드).
 * - 높으면 표시 중인 것을 내리고(타이머 회수) 그 자리를 차지한다.
 */
const showOverlay = (req: OverlayReq): void => {
  const i = pendingOverlays.findIndex((p) => p.id === req.id);
  if (i >= 0) pendingOverlays.splice(i, 1);
  if (activeOverlay) {
    if (activeOverlay.id !== req.id) {
      if (OVERLAY_PRIORITY[req.id] <= OVERLAY_PRIORITY[activeOverlay.id]) {
        pendingOverlays.push(req);
        return;
      }
      const preempted = activeOverlay;
      hideOverlay();
      if (preempted.requeue) pendingOverlays.push(preempted);
    } else {
      hideOverlay(); // 같은 오버레이 재요청 → 타이머 회수 후 처음부터
    }
  }
  runOverlay(req);
};

/** 하단 중앙 배너 — 전면을 막지 않는 알림. 타이머는 버스가 소유(단일 슬롯). */
let bannerTimer: number | undefined;
const showBanner = (text: string, ms = 2800): void => {
  const el = $("fxBanner");
  el.textContent = text;
  el.classList.remove("hidden");
  if (bannerTimer) window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => {
    el.classList.add("hidden");
    bannerTimer = undefined;
  }, ms);
};

/**
 * 상태 델타 → 계약 메서드 라우팅. `onStateChange`마다 1회.
 *
 * 판정 근거는 전부 **서버가 준 값**이다:
 *  · 장물은 제안으로만 움직인다 → 장물의 `room`이 바뀌면 그 방이 **제안이 일어난 방**.
 *  · 내 턴이 아닌 좌석이 방을 옮겼다면 그것은 이동이 아니라 **소환**이다
 *    (서버에서 남의 턴에 좌석을 옮기는 경로는 `doSuggestion`의 소환뿐).
 *  · 내 턴인 좌석이 `PASSAGES`로 연결된 방으로 건너뛰었다면 **비밀 통로**.
 *  · 그 밖의 이동은 일반 이동 — 렌더러의 보간이 담당한다(워프로 만들지 않는다).
 *
 * ⚠ 여기서 진실값을 만들지 않는다. 위 세 줄은 "이미 일어난 사실을 어떤 연출로
 *   보여줄지" 고르는 것이고, 좌표·방 이름·승자는 서버 상태를 그대로 넘긴다.
 */
const applyFx = (state: Room["state"]): void => {
  const v = activeView();
  const myId = room?.sessionId ?? "";
  const players = state.players as Map<string, MePlayer>;
  const weapons = state.weapons as Map<
    string,
    { value: string; x: number; y: number; room: string }
  >;
  const phaseChanged = state.phase !== fxPhase;
  fxPhase = state.phase;
  // 배치 틱(로비→진행, 리매치)은 좌표가 통째로 다시 깔린다 → 스냅샷만 갱신한다.
  const emit = state.phase === "playing" && !phaseChanged && v !== null;

  // ── ① 장물 델타 → `lootWarp` + "제안이 일어난 방" 판정 ──
  type LootMove = { value: string; from: CellSnap; to: CellSnap };
  const lootMoves: LootMove[] = [];
  const liveLoot = new Set<string>();
  weapons.forEach((w, key) => {
    liveLoot.add(key);
    const prev = lastLoot.get(key);
    const cur: CellSnap = { x: w.x, y: w.y, room: w.room ?? "" };
    lastLoot.set(key, cur);
    if (!prev || !emit) return;
    if (prev.x === cur.x && prev.y === cur.y) return;
    lootMoves.push({ value: w.value, from: prev, to: cur });
  });
  for (const key of [...lastLoot.keys()]) {
    if (!liveLoot.has(key)) lastLoot.delete(key);
  }

  let sugRoom = "";
  for (const m of lootMoves) {
    if (m.to.room && m.to.room !== m.from.room) sugRoom = m.to.room;
    v?.lootWarp(m.value, m.from, m.to);
  }

  // ── ② 좌석 델타 → `warp` ──
  type Move = { id: string; suspect: string; name: string; from: CellSnap; to: CellSnap };
  const moves: Move[] = [];
  const live = new Set<string>();
  players.forEach((p, id) => {
    live.add(id);
    const prev = lastCells.get(id);
    const cur: CellSnap = { x: p.x, y: p.y, room: p.room ?? "" };
    lastCells.set(id, cur);
    if (!prev || !emit) return;
    if (prev.x === cur.x && prev.y === cur.y) return;
    moves.push({ id, suspect: p.suspect, name: p.name, from: prev, to: cur });
  });
  for (const id of [...lastCells.keys()]) {
    if (!live.has(id)) lastCells.delete(id);
  }

  let stage = "";
  let stageCamera = false;
  for (const m of moves) {
    const isCur = m.id === state.currentTurn;
    const roomChanged = m.from.room !== m.to.room;
    let reason: WarpReason | null = null;
    if (isCur && m.from.room && passageOf(m.from.room) === m.to.room) {
      reason = "passage";
    } else if (
      (sugRoom !== "" && m.to.room === sugRoom && (roomChanged || cheb(m.from, m.to) >= 2)) ||
      (!isCur && roomChanged)
    ) {
      reason = "summon";
    }
    if (!reason || !v) continue;
    v.warp(m.id, m.from, m.to, reason);
    v.pulseCell(m.to, reason === "summon" ? "suggest" : "neutral");
    if (m.to.room) {
      stage = m.to.room;
      // `"camera"`는 내 턴이거나 내가 지목당했을 때만(계약 `FocusMode` 주석) —
      // NPC 6인이 매 턴 제안하므로 무조건 포커스하면 화면이 계속 흔들린다.
      stageCamera = stageCamera || state.currentTurn === myId || m.id === myId;
    }
    // 하단 배너(전면을 막지 않는 단일 슬롯). 문안은 ui-copy §10 확정본 그대로.
    showBanner(
      reason === "summon"
        ? `🔔 소환 — ${label(m.suspect)} → ${label(m.to.room)}`
        : `🚪 비밀 통로 — ${m.name} → ${label(m.to.room)} · 제안 또는 턴 종료`,
      timing.WARP_BANNER_MS,
    );
  }

  // ── ③ 사건의 무대 → `focusRoom` ──
  // 지목된 인물이 이미 그 방에 있어 좌석이 안 움직였어도 무대는 강조한다(장물만 이동).
  if (stage === "" && sugRoom !== "") {
    stage = sugRoom;
    stageCamera = state.currentTurn === myId;
  }
  if (stage !== "" && v) {
    const mode: FocusMode = stageCamera ? "camera" : "highlight";
    v.focusRoom(stage, mode);
  }

  // ── ④ "이미 살펴본 방"(클라 로컬 파생 · 진실값 아님) → `setSurveyed` ──
  const me = myId ? players.get(myId) : undefined;
  if (me?.room && !surveyedRooms.has(me.room)) {
    surveyedRooms.add(me.room);
    surveyDirty = true;
  }

  // ── ⑤ 판 종료 → `setOutcome` (무승부는 승자가 없으므로 연출도 없다) ──
  const winnerId =
    state.phase === "ended" && state.winner ? (state.winner as string) : "";
  const nextOutcome: ViewOutcome | null = winnerId
    ? { winnerId, winnerName: players.get(winnerId)?.name ?? "" }
    : null;
  if ((outcome?.winnerId ?? "") !== (nextOutcome?.winnerId ?? "")) {
    outcome = nextOutcome;
    v?.setOutcome(outcome);
  }

  // 새 뷰로 막 넘어왔거나 살펴본 방이 늘었으면 여기서 따라잡는다.
  syncActiveView();
};

// 게임 중 현재 턴 배너 (내 턴이면 주사위 굴림 + 남은 이동 표시)
const DICE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
let lastTurn = "";

const myTurnText = (steps: number): string =>
  `🎲 <b>내 턴</b> · 남은 이동 ${steps}칸 · 방에서 [제안]`;

/** 합계 steps(2~12)를 2개 주사위 눈으로 분해. */
const splitDice = (steps: number): [number, number] => {
  const d1 = Math.max(1, Math.min(6, steps - Math.min(6, steps - 1)));
  return [d1, steps - d1];
};

// 내 차례 시작 시 화면 중앙에 주사위를 차분히 굴린다.
// 타이머 소유권은 전부 오버레이 버스에 있다(h.after) — 여기서 직접 걸지 않는다.
const showDiceRoll = (): void => {
  const ov = $("diceOverlay");
  const turnAtRequest = lastTurn;
  const render = (faces: string, text: string): void => {
    ov.innerHTML =
      `<div class="dice-card"><div class="dice-faces">${faces}</div>` +
      `<div class="dice-label">${text}</div></div>`;
  };
  showOverlay({
    id: "dice",
    el: ov,
    requeue: true, // 목표 카드·결과에 밀리면 그 뒤에 다시 굴린다
    // 대기 중 턴이 넘어갔거나 판이 끝났으면 굴리지 않는다(뒤늦은 주사위 방지)
    valid: () =>
      room?.state.phase === "playing" && room?.state.currentTurn === turnAtRequest,
    run: (h) => {
      ov.classList.remove("done");
      let t = 0;
      // 굴리는 단계: 느린 간격으로 6프레임(~0.9s)
      const tick = (): void => {
        t += 1;
        const a = DICE_FACES[Math.floor(Math.random() * 6)];
        const b = DICE_FACES[Math.floor(Math.random() * 6)];
        render(`${a} ${b}`, "주사위");
        if (t < 6) {
          h.after(150, tick);
          return;
        }
        const steps = (room?.state as { stepsLeft?: number })?.stepsLeft ?? 0;
        const [d1, d2] = splitDice(steps);
        render(`${DICE_FACES[d1 - 1]} ${DICE_FACES[d2 - 1]}`, `이동 ${steps}칸`);
        ov.classList.add("done"); // 강조(살짝 커짐)
        h.after(1900, h.close); // 결과를 충분히 보여주고 해제
      };
      h.after(150, tick);
    },
  });
};

// ── 온보딩 목표 카드 (로드맵 §1.5 · 문안 ui-copy §3) ─────────────────
// 저장 위치는 localStorage — sessionStorage면 새 탭·재방문마다 다시 뜨고,
// 방(roomId)별 키면 판마다 다시 뜬다. "한 번 본 사람에게 다시 띄우지 않는다"는
// 브라우저 단위 사실이므로 도메인 전역 키 1개로 둔다(ui-copy §3 선행조건 표기와 동일).
const GOAL_SEEN_KEY = "zc_seen_goal";
const goalSeen = (): boolean => {
  try {
    return localStorage.getItem(GOAL_SEEN_KEY) === "1";
  } catch {
    return false; // localStorage 불가 → 매번 표시(닫기는 항상 가능)
  }
};
const markGoalSeen = (): void => {
  try {
    localStorage.setItem(GOAL_SEEN_KEY, "1");
  } catch {
    /* localStorage 불가 시 무시 */
  }
};
/** 목표 카드 열기 — 전면이므로 반드시 버스를 통한다(주사위와 동시 표시 금지). */
const openGoalCard = (): void => showOverlay({ id: "goal", el: $("goalCard") });
const closeGoalCard = (): void => {
  markGoalSeen();
  closeOverlay("goal"); // 대기 중이던 주사위가 여기서 이어서 굴러간다
};

// 세션 정리 후 메인으로 (탈락/종료 시 나가기)
const exitToMain = (): void => {
  try {
    sessionStorage.removeItem(RECONNECT_KEY);
  } catch {
    /* noop */
  }
  location.href = "/";
};

// 탈락(관전) 배너 + 종료 결과 오버레이
const updateEndState = (state: Room["state"]): void => {
  const players = state.players as Map<
    string,
    { name: string; eliminated: boolean }
  >;
  const meElim = room ? players.get(room.sessionId)?.eliminated : false;
  $("spectateBar").classList.toggle(
    "hidden",
    !(state.phase === "playing" && !!meElim),
  );

  const overlay = $("endOverlay");
  if (state.phase === "ended") {
    const w = players.get(state.winner);
    $("endTitle").textContent = w ? `🎉 ${w.name} 승리!` : "게임 종료";
    $("endSub").textContent =
      "사건이 종결되었습니다. 정답은 기록(우측)을 확인하세요.";
    // 결과도 전면 오버레이 → 버스가 소유. 주사위·목표 카드를 밀어내고 그 자리를 차지한다.
    if (!isOverlayShown("end")) showOverlay({ id: "end", el: overlay });
  } else {
    closeOverlay("end");
  }
};

type TurnPlayer = { suspect: string; name: string; eliminated?: boolean };

/** 턴 순서 스트립 — 현재부터 다음·다음… 순으로 칩 나열(→ 방향, 끝에 순환 ↺). */
const renderTurnStrip = (state: Room["state"]): string => {
  const players = state.players as Map<string, TurnPlayer>;
  const order = [...(state.turnOrder as unknown as string[])];
  if (order.length === 0) return "";
  const curId = state.currentTurn;
  const start = Math.max(0, order.indexOf(curId));
  const seq = order.map((_, i) => order[(start + i) % order.length]);
  const chips = seq
    .map((id, i) => {
      const p = players.get(id);
      if (!p) return "";
      const cls =
        "ti-chip" + (id === curId ? " cur" : "") + (p.eliminated ? " elim" : "");
      const tag = id === curId ? " (현재)" : i === 1 ? " (다음)" : "";
      // §4.2 HUD — 색 밑줄 3px + 18px + 이름 첫 글자. 색은 2차 단서(이모지·첫 글자)와
      // 항상 함께 나온다(색 단독 식별 금지).
      const nm = label(p.suspect);
      const chip =
        `<span class="${cls}" style="box-shadow:${colorUnderline(p.suspect)}"` +
        ` title="${nm}${tag}">${emoji(p.suspect)}` +
        `<i class="ti-ini">${nm.charAt(0)}</i>${cvdTag(p.suspect)}</span>`;
      const arrow =
        i < seq.length - 1
          ? `<span class="ti-arrow">→</span>`
          : `<span class="ti-arrow ti-wrap" title="처음으로 순환">↺</span>`;
      return chip + arrow;
    })
    .join("");
  return `<div class="ti-order">${chips}</div>`;
};

/** 턴 순서를 원형(라운드 테이블)으로 표시하는 오버레이. 현재/다음 강조, 시계방향. */
const openTurnCircle = (): void => {
  if (!room) return;
  const state = room.state;
  const players = state.players as Map<string, TurnPlayer>;
  const order = [...(state.turnOrder as unknown as string[])];
  const curId = state.currentTurn;
  const curIdx = order.indexOf(curId);
  const ring = $("tcRing");
  ring.innerHTML = `<div class="tc-center">↻<span>시계방향</span></div>`;
  const n = order.length;
  const R = 118;
  order.forEach((id, i) => {
    const p = players.get(id);
    if (!p) return;
    const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const x = 150 + R * Math.cos(ang);
    const y = 150 + R * Math.sin(ang);
    const isCur = id === curId;
    const isNext = i === (curIdx + 1) % n;
    const node = document.createElement("div");
    node.className =
      "tc-node" + (isCur ? " cur" : "") + (p.eliminated ? " elim" : "");
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    const badge = isCur
      ? `<div class="tc-badge cur">현재</div>`
      : isNext
        ? `<div class="tc-badge next">다음</div>`
        : `<div class="tc-badge">${i + 1}</div>`;
    // §4.2 HUD — 턴 원형 배지에도 고유색. 이모지·이름·순번 배지가 2차 단서.
    node.innerHTML =
      `<div class="tc-em">${emoji(p.suspect)}</div>` +
      `<div class="tc-bar" style="background:${zodiacColorHex(p.suspect)}"></div>` +
      `<div class="tc-name">${p.name}${cvdTag(p.suspect)}</div>${badge}`;
    ring.appendChild(node);
  });
  $("turnCircle").classList.remove("hidden");
};

// ── 즉시고발 창 (로드맵 §7.5.1 · 문안 ui-copy §9.5·§5.2) ─────────────
// 서버는 사람의 제안이 성립하면 `canAccuse {ms, suggestion}`을 **제안자에게만** 보내
// 같은 턴에 [고발]/[턴 종료]를 고를 창을 열어 둔다. 클라에 핸들러가 없어 이 안내가
// 화면에 아예 없었다.
//
// ⚠ 진실값 경계 — **클라는 창의 만료를 판정하지 않는다.**
//   · 창을 여는 것도, 만료시켜 턴을 넘기는 것도 서버(`armTimer(TURN_TIMER, …)`)다.
//   · 여기서 도는 타이머는 **표시 갱신 전용**이다. 남은 시간이 0이 되어도 스스로
//     창을 닫거나 `endTurn`을 보내지 않고 0초에 고정한 채 서버 상태를 기다린다.
//   · 표시를 지우는 조건은 전부 서버발 사실이다 — `phase !== "playing"`,
//     `currentTurn`이 바뀜. 사용자가 [고발]/[턴 종료]를 실제로 보낸 순간도 정리한다.
//
// 타이머 소유권 — 이 창은 **전면 오버레이가 아니다**(턴 배너 부제 1줄). 오버레이 버스는
// 전면 점유 조정이 소관이므로 큐에 넣지 않는다. 대신 버스와 같은 규칙을 지킨다:
// 타이머 핸들은 이 모듈 밖으로 새지 않고 `clearAccuseWindow()` 하나가 회수한다.
/** 서버가 알려준 창 마감 시각(ms, 로컬 시계). null이면 창이 닫힌 것으로 **표시**한다. */
let accuseDeadline: number | null = null;
let accuseTicker: number | undefined;

/** 남은 시간 문안 — ui-copy §9.5 "제안 후 고발 대기" 확정 문안에 초만 대입. */
const accuseSubText = (): string => {
  if (accuseDeadline === null) return "";
  const left = Math.max(0, Math.ceil((accuseDeadline - Date.now()) / 1000));
  return `⏳ 지금 고발할 수 있어요 (${left}초). 넘기려면 [턴 종료]`;
};

/** 턴 배너 부제(`.ti-sub`)에 들어갈 조각. 배너 전체 재렌더와 같은 경로를 탄다. */
const accuseSubHtml = (): string =>
  accuseDeadline === null
    ? ""
    : `<div class="ti-sub" id="tiSub">${accuseSubText()}</div>`;

/** 초 표시만 갱신(배너 전체를 다시 그리지 않는다 — 클릭 핸들러·칩이 살아 있어야 한다). */
const paintAccuseSub = (): void => {
  const el = document.getElementById("tiSub");
  if (el) el.textContent = accuseSubText();
};

/** 창 표시 정리 — 타이머 회수 지점은 여기 하나뿐. */
const clearAccuseWindow = (): void => {
  if (accuseTicker !== undefined) {
    window.clearInterval(accuseTicker);
    accuseTicker = undefined;
  }
  if (accuseDeadline === null) return;
  accuseDeadline = null;
  document.getElementById("tiSub")?.remove();
};

/** 서버 `canAccuse` 수신 — 남은 시간을 카운트다운으로 **표시만** 한다. */
const openAccuseWindow = (ms: number): void => {
  clearAccuseWindow();
  accuseDeadline = Date.now() + ms;
  // 0.25s 간격 — 초 단위 표시가 최대 0.25s 늦게 바뀐다(1s면 첫 감소가 1s 늦게 보인다).
  accuseTicker = window.setInterval(paintAccuseSub, 250);
  // 이 메시지만으로는 상태 변경이 없어 배너가 다시 그려지지 않는다 → 즉시 1회 렌더.
  if (room) updateTurnInfo(room.state);
};

// ── 액션 버튼 상태·문안 (ui-copy §5) ─────────────────────────────
// `disabled` 속성은 title 툴팁도 click 이벤트도 죽인다 → 비활성 사유 안내(addLog)가
// 영원히 실행되지 않는 죽은 코드였다. 그래서 aria-disabled + .is-off로 표현하고
// 클릭 핸들러는 살려 둔 채 첫 줄에서 같은 문장을 안내한다(툴팁 = 클릭 피드백).
type ActionId = "suggest" | "accuse" | "passage" | "bonus" | "endTurn";
/** 현재 비활성 사유 — null이면 활성. 툴팁과 클릭 피드백이 이 문자열 하나를 공용. */
const offReasons: Record<ActionId, string | null> = {
  suggest: null,
  accuse: null,
  passage: null,
  bonus: null,
  endTurn: null,
};
const NOT_MY_TURN = "지금은 내 차례가 아니에요. 차례가 오면 켜집니다.";
const NOT_STARTED = "잔치가 시작되면 고발할 수 있어요."; // §5.3·§5.4가 §5.2를 재사용
const ELIMINATED = "이미 고발에 실패했어요. 남은 역할은 반증입니다.";

const setAction = (
  id: ActionId,
  reason: string | null,
  activeTitle: string,
): void => {
  const el = $(id) as HTMLButtonElement;
  offReasons[id] = reason;
  el.disabled = false; // disabled면 사유를 안내할 기회 자체가 없다
  el.classList.toggle("is-off", reason !== null);
  el.setAttribute("aria-disabled", reason !== null ? "true" : "false");
  el.title = reason ?? activeTitle;
};

/** 클릭 첫 줄 가드 — 비활성이면 같은 문장을 하단 배너로 안내하고 true를 반환. */
const blockedBy = (id: ActionId): boolean => {
  const reason = offReasons[id];
  if (!reason) return false;
  showBanner(reason);
  return true;
};

type MePlayer = {
  suspect: string;
  name: string;
  room?: string;
  x: number;
  y: number;
  eliminated?: boolean;
};

/**
 * 액션 4종 + 턴 종료의 활성/비활성과 문안을 갱신.
 * 여기서 계산하는 것은 **조작 가능성**뿐이다 — 판정(진실값)은 전부 서버가 다시 검사한다.
 */
const updateActionButtons = (state: Room["state"]): void => {
  const players = state.players as Map<string, MePlayer>;
  const me = room ? players.get(room.sessionId) : undefined;
  const mine = room !== null && state.currentTurn === room.sessionId;
  const idle = state.phase !== "playing";
  const elim = !!me?.eliminated;

  // 제안 (§5.1) — 판정 순서를 지킬 것(탈락 + 내 턴 아님이 겹칠 때 탈락이 먼저)
  setAction(
    "suggest",
    idle
      ? "잔치가 시작되면 제안할 수 있어요."
      : elim
        ? "탈락한 뒤에는 제안할 수 없어요. 반증만 이어집니다."
        : !mine
          ? NOT_MY_TURN
          : !me?.room
            ? "방 안에서만 제안할 수 있어요. 입구(🚪)로 들어가세요."
            : null,
    "이 방에서 용의자와 훔친 것을 지목해요. 장소는 현재 방으로 고정.",
  );

  // 고발 (§5.2) — 즉시고발 창이 열려 있으면 활성 툴팁을 §5.2 "제안 직후" 문안으로.
  setAction(
    "accuse",
    idle ? NOT_STARTED : elim ? ELIMINATED : !mine ? NOT_MY_TURN : null,
    accuseDeadline !== null
      ? "지금 고발할 수 있어요. 넘기려면 [턴 종료]."
      : "정답 3장을 지목해요. 틀리면 즉시 탈락합니다.",
  );

  // 비밀 통로 (§5.3) — 1순위 문안은 §5.2 재사용
  const dest = me?.room ? passageOf(me.room) : undefined;
  setAction(
    "passage",
    idle
      ? NOT_STARTED
      : elim
        ? ELIMINATED
        : !mine
          ? NOT_MY_TURN
          : !me?.room
            ? "비밀 통로는 방 안에서만 쓸 수 있어요."
            : !dest
              ? "이 방에는 비밀 통로가 없어요. (통로는 3쌍)"
              : null,
    me?.room && dest
      ? `비밀 통로 — ${label(me.room)} → ${label(dest)}. 주사위 없이 즉시.`
      : "",
  );

  // 계략 (§5.4) — 인접 여부와 사용 여부를 **분리**해야 3·4번 문안이 구분된다
  // (합쳐서 검사하면 이미 쓴 NPC 옆에서 "근처에 없어요"가 뜬다)
  let nearAny = false;
  let nearUnused = false;
  if (me) {
    (
      state.helpers as Map<string, { x: number; y: number; used: boolean }>
    ).forEach((h) => {
      if (Math.max(Math.abs(h.x - me.x), Math.abs(h.y - me.y)) <= 1) {
        nearAny = true;
        if (!h.used) nearUnused = true;
      }
    });
  }
  setAction(
    "bonus",
    idle
      ? NOT_STARTED
      : elim
        ? ELIMINATED
        : !mine
          ? NOT_MY_TURN
          : nearAny && !nearUnused
            ? "이 NPC의 계략은 이미 썼어요. 다른 NPC를 찾아보세요."
            : !nearUnused
              ? "계략을 줄 이가 근처에 없어요. 보드 가장자리의 NPC 곁으로."
              : null,
    "계략 — 상대 카드 엿보기 + 이동 보너스. NPC마다 1회.",
  );

  // 턴 종료 (§5.5) — 비활성 문안은 위와 같은 문장을 재사용(사유를 두 벌 만들지 않는다)
  setAction(
    "endTurn",
    idle ? NOT_STARTED : elim ? ELIMINATED : !mine ? NOT_MY_TURN : null,
    "이번 차례를 마치고 다음 사람에게 넘겨요.",
  );
};

/** 탭 제목 원본 — 내 턴 표시(§1.5 동적 title)에서 되돌릴 기준. */
const BASE_TITLE = document.title;

const updateTurnInfo = (state: Room["state"]): void => {
  const el = $("turnInfo");
  // 즉시고발 창 정리 ① — 판이 끝났다는 **서버발 사실**. 클라가 시간을 보고 닫는 게 아니다.
  if (state.phase !== "playing") clearAccuseWindow();
  updateActionButtons(state); // phase와 무관하게 항상 최신 사유를 유지
  if (state.phase !== "playing") {
    el.classList.add("hidden");
    document.title = BASE_TITLE;
    lastTurn = "";
    return;
  }
  el.classList.remove("hidden");
  const players = state.players as Map<string, MePlayer>;
  const cur = players.get(state.currentTurn);
  const mine = room !== null && state.currentTurn === room.sessionId;
  // 탭이 뒤에 있어도 내 차례가 온 것을 알 수 있게 제목에 드러낸다.
  document.title = mine ? `🎲 내 턴 — ${BASE_TITLE}` : BASE_TITLE;
  const turnChanged = state.currentTurn !== lastTurn;
  lastTurn = state.currentTurn;
  // 즉시고발 창 정리 ② — 턴이 넘어갔다는 **서버발 사실**(만료 자동 종료도 여기로 온다).
  if (turnChanged) {
    clearAccuseWindow();
    updateActionButtons(state); // 툴팁을 평시 문안으로 되돌린다
  }
  el.classList.toggle("mine", mine);
  el.classList.add("clickable");

  // 상태 줄 + 턴 순서 스트립(현재→다음… 방향). 클릭 시 원형 순서 오버레이.
  const status = mine
    ? `<div class="ti-status">${myTurnText(state.stepsLeft ?? 0)}</div>`
    : `<div class="ti-status">${cur ? `⏳ ${emoji(cur.suspect)} ${cur.name} 님의 턴` : ""}</div>`;
  // 부제(.ti-sub) = 즉시고발 창 카운트다운(§9.5). 창이 닫혀 있으면 빈 문자열이다.
  el.innerHTML = status + renderTurnStrip(state) + accuseSubHtml();
  el.title = "클릭: 전체 턴 순서(원형) 보기";
  el.onclick = openTurnCircle;
  if (mine && turnChanged) showDiceRoll(); // 내 턴 시작 → 중앙 주사위
};

const renderLobby = (state: Room["state"]): void => {
  const players = state.players as Map<
    string,
    { name: string; id: string; suspect: string }
  >;
  const list = $("playerList");
  list.innerHTML = "";
  let count = 0;
  players.forEach((p) => {
    count += 1;
    const li = document.createElement("li");
    li.textContent =
      `${emoji(p.suspect)} ${p.name}` + (p.id === state.host ? "  👑 방장" : "");
    list.appendChild(li);
  });
  $("playerCount").textContent = String(count);

  const isHost = room !== null && state.host === room.sessionId;
  const startBtn = $("startBtn") as HTMLButtonElement;
  startBtn.disabled = !isHost;
  $("hostHint").textContent = isHost
    ? "빈 자리는 NPC로 채워집니다 (최대 6인). 바로 시작할 수 있어요."
    : "방장이 시작하기를 기다리는 중…";

  renderLobbyChars(state);
};

// 캐릭터 직업 풀이 + 성격을 대기실 하단 패널에 표시(생소한 사극 용어 설명).
const showCharInfo = (z: string): void => {
  const j = job(z);
  const jobHtml = j
    ? ` <span class="ci-job">· ${j.term}: ${j.gloss}</span>`
    : "";
  $("lobbyPersona").innerHTML =
    `${emoji(z)} <b>${label(z)}</b>${jobHtml}<br>${persona(z)}`;
};

// 대기실 캐릭터 그리드 — 선택됨/사용중(다른 사람) 실시간 반영, 클릭 시 변경.
const renderLobbyChars = (state: Room["state"]): void => {
  const players = state.players as Map<
    string,
    { id: string; suspect: string }
  >;
  const owner = new Map<string, string>(); // suspect -> sessionId
  players.forEach((p) => owner.set(p.suspect, p.id));
  const mySuspect =
    room !== null ? players.get(room.sessionId)?.suspect : undefined;

  const grid = $("lobbyChars");
  grid.innerHTML = "";
  for (const z of ZODIAC) {
    const cell = document.createElement("div");
    const ownerId = owner.get(z);
    const takenByOther = ownerId !== undefined && ownerId !== room?.sessionId;
    const mine = z === mySuspect;
    cell.className =
      "char" + (takenByOther ? " locked" : "") + (mine ? " selected" : "");
    // §4.2 HUD — 좌측 3px 스트라이프. 게임 진입 **전에** 색을 학습시키는 자리다.
    // 2차 단서는 이미 있는 이모지 + 이름 전체.
    cell.style.boxShadow = colorStripe(z);
    cell.innerHTML =
      `<span class="em">${emoji(z)}</span>` +
      `<span>${label(z)}${cvdTag(z)}</span>`;
    // 직업 뜻풀이를 툴팁으로도 노출(생소한 단어 설명).
    const j = job(z);
    cell.title = j
      ? `${label(z)} — ${j.term}: ${j.gloss}\n${persona(z)}`
      : label(z);
    cell.onmouseenter = () => showCharInfo(z);
    if (!takenByOther && !mine) {
      cell.onclick = () => room?.send("character", { value: z });
    }
    grid.appendChild(cell);
  }
  // 기본 표시 = 내 캐릭터(있으면).
  if (mySuspect) showCharInfo(mySuspect);
};

// ── 증거 노트 (개인 추리 메모 · 서버 전송 X · 로컬 저장) ─────────────
type EviState = "" | "cleared" | "suspect";
const EVI_NEXT: Record<EviState, EviState> = {
  "": "cleared",
  cleared: "suspect",
  suspect: "",
};

const eviKey = (roomId: string): string => `zc_evi_${roomId}`;
const loadEvi = (roomId: string): Record<string, EviState> => {
  try {
    return JSON.parse(localStorage.getItem(eviKey(roomId)) ?? "{}");
  } catch {
    return {};
  }
};
const saveEvi = (roomId: string, data: Record<string, EviState>): void => {
  try {
    localStorage.setItem(eviKey(roomId), JSON.stringify(data));
  } catch {
    /* localStorage 불가 시 무시 */
  }
};

const buildEvidence = (roomId: string): void => {
  const host = $("evidence");
  host.innerHTML = "";
  const data = loadEvi(roomId);
  // 공통 단서(모두 공개·정답 아님) — 증거노트에 자동 제외 표시
  const commonSet = new Set<string>(
    room ? ([...((room.state.commonCards as string[]) ?? [])] as string[]) : [],
  );
  // 3번째 원소 = 십이지 고유색 적용 대상인지(§4.2 "증거노트 용의자 칩").
  // 훔친 것·장소는 십이지가 아니므로 색이 없다(`zodiacColorHex`가 중립색을 주는 것과 별개로
  // 의미 없는 색을 칠하지 않는다).
  const groups: [string, readonly string[], boolean][] = [
    ["용의자", participantSuspects(), true],
    ["훔친 것", WEAPONS, false],
    ["장소", ROOMS, false],
  ];
  for (const [cat, values, colored] of groups) {
    const g = document.createElement("div");
    g.className = "evi-group";
    const c = document.createElement("div");
    c.className = "cat";
    c.textContent = cat;
    g.appendChild(c);
    const chips = document.createElement("div");
    chips.className = "evi-chips";
    for (const v of values) {
      const chip = document.createElement("div");
      // §4.2 HUD — 용의자 칩 좌측 3px 스트라이프. 이모지 + 이름이 2차 단서로 남는다.
      // `base`는 아래 apply()가 className을 다시 조립할 때도 스트라이프 여백을 지키기 위함.
      const base = "evi-chip" + (colored ? " zc" : "");
      if (colored) chip.style.boxShadow = colorStripe(v);
      // 장소는 EMOJI 맵에 없어 아이콘 칸이 비었다 → cardIcon()이 📍로 채운다(§2)
      chip.innerHTML =
        `<span>${cardIcon(v)}</span>` +
        `<span class="evi-name">${label(v)}${colored ? cvdTag(v) : ""}</span>`;
      // 내 패 또는 공통 단서 → 정답 아님, 자동 제외·잠금
      const own = myCards.has(v) || commonSet.has(v);
      if (own) {
        chip.className = base + " cleared own";
        chip.title = commonSet.has(v) ? "공통 단서 (정답 아님)" : "내 패 (정답 아님)";
      } else {
        chip.title = "클릭: 없음(제외) → 의심 → 초기화";
        const apply = (): void => {
          const st = data[v] ?? "";
          chip.className = base + (st ? " " + st : "");
        };
        chip.onclick = () => {
          const next = EVI_NEXT[data[v] ?? ""];
          if (next) data[v] = next;
          else delete data[v];
          apply();
          saveEvi(roomId, data);
        };
        apply();
      }
      chips.appendChild(chip);
    }
    g.appendChild(chips);
    host.appendChild(g);
  }
};

const enterGame = (): void => {
  phaserStarted = true;
  show("gameScreen");

  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#1c1712",
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    scene: [GameScene, PixelScene],
  });
  game.registry.set("room", room);
  if (room) buildEvidence(room.roomId);
  // Phaser 씬은 첫 `step`이 끝나야 `create()`가 돌아 있다(그 전엔 보드 사각형이 없어
  // `setPassages`가 조용히 실패한다). 부팅 직후 1회 전량 주입 지점.
  game.events.once(Phaser.Core.Events.POST_STEP, () => syncActiveView(true));

  // 뷰 진화 단계 전환(순서형). 서버·HUD·입력 규칙은 단계와 무관하게 동일.
  // 핵심: #game(Phaser)은 절대 display:none 하지 않는다. three는 위에 얹어
  // 가리기만 하고(z-index), 뷰1로 오면 three 캔버스만 숨겨 아래 Phaser를 보인다.
  const viewBtn = $("viewToggle") as HTMLButtonElement;
  const viewList = $("viewList");
  const closeViewMenu = (): void => viewList.classList.add("hidden");
  const setStage = (i: number): void => {
    stageIndex = ((i % STAGES.length) + STAGES.length) % STAGES.length;
    const st = STAGES[stageIndex];
    const three = st.kind === "three";
    const pixel = st.kind === "pixel";
    if (three && !iso && room) iso = new IsoView(room, $("gameScreen"));
    // PixelScene은 config 배열의 2번째라 자동 시작되지 않는다 — 첫 진입에서만 run.
    // (렌더러 `pixel-scene.ts` `setActive` 주석의 `TODO(main.ts)`가 이 한 줄이다.
    //  시작되지 않은 씬에는 계약 메서드가 존재하지 않으므로 씬 밖에서 해야 한다.)
    if (pixel && game && !game.scene.isActive("pixel")) game.scene.run("pixel");
    // 표시/은닉은 **계약 `setActive` 하나로만** 한다. 숨을 때 타이머·리스너·루프를
    // 정리하는 책임이 뷰에 있어 `sys.setVisible` 직접 호출로는 그 계약이 실행되지 않는다.
    // (뷰1은 뷰4에서도 계속 active — 입력·카메라 담당이고 표시만 꺼진다.)
    iso?.setActive(three);
    if (three) iso?.setAssets(st.assets); // 뷰2=이모지 / 뷰3=에셋 아트
    phaserView("game")?.setActive(st.kind === "phaser");
    phaserView("pixel")?.setActive(pixel);
    // three에선 iso가 입력 담당 → Phaser 키보드 off. phaser/pixel은 GameScene이 담당.
    if (game?.input.keyboard) game.input.keyboard.enabled = !three;
    viewBtn.textContent = st.label + " ▲";
    [...viewList.children].forEach((li, idx) =>
      (li as HTMLElement).classList.toggle("active", idx === stageIndex),
    );
    // 새 뷰가 현재 상태(조사한 방·통로·현재 턴·탈락·승리)를 그대로 이어받는다.
    syncActiveView(true);
    // 방금 `run`한 씬은 다음 step에야 `create()`가 끝난다 → 그 프레임에 한 번 더.
    game?.events.once(Phaser.Core.Events.POST_STEP, () => syncActiveView(true));
  };
  // 위로 열리는 드롭다운으로 단계 직접 선택.
  viewList.innerHTML = "";
  STAGES.forEach((s, i) => {
    const li = document.createElement("li");
    li.textContent = s.label;
    li.onclick = (e) => {
      e.stopPropagation();
      setStage(i);
      closeViewMenu();
    };
    viewList.appendChild(li);
  });
  viewBtn.onclick = (e) => {
    e.stopPropagation();
    viewList.classList.toggle("hidden");
  };
  document.addEventListener("click", closeViewMenu);
  // 진화 서사는 항상 뷰1(2D)에서 시작 — 매 게임 진입 시 처음부터.
  setStage(0);

  ($("suggest") as HTMLButtonElement).onclick = async () => {
    // 비활성 사유는 툴팁과 같은 문장으로 안내(§5.0). disabled를 쓰지 않으므로 도달한다.
    if (blockedBy("suggest")) return;
    const me = room
      ? (room.state.players as Map<string, { room: string }>).get(room.sessionId)
      : undefined;
    if (!me?.room) return; // 사유 안내는 위 가드가 담당
    const pick = await openPicker({
      title: "제안 — 이 방에서 누가, 무엇을?",
      needRoom: false,
      fixedRoom: me.room,
      note: "지목한 인물과 물건이 이 방으로 소환돼요.",
      okLabel: "이 조합으로 제안",
      mySuffix: " — 내 패",
      lockMine: false, // §6.1 — 제안에서는 내 패도 고를 수 있다(반증자 통제 전술)
    });
    if (pick) {
      // 장소는 서버가 player.room에서 가져간다 — 고정행은 표시일 뿐 값을 바꾸지 않는다.
      room?.send("suggest", {
        suspect: pick.suspect,
        weapon: pick.weapon,
        room: "",
      });
    }
  };
  ($("accuse") as HTMLButtonElement).onclick = async () => {
    if (blockedBy("accuse")) return;
    const pick = await openPicker({
      title: "고발 — 진범을 지목하라",
      needRoom: true,
      warn: "⚠ 틀리면 즉시 탈락합니다. 그 뒤로는 반증만 할 수 있어요.",
      note: "이 3장이 정답 봉투와 모두 같아야 승리해요.",
      okLabel: "고발한다",
      okDanger: true,
      mySuffix: " — 내 패 (정답 아님)",
      lockMine: true, // §6.2 — 고발에서 내 패 지목은 자멸이므로 잠금 유지
    });
    if (pick && pick.room) {
      room?.send("accuse", {
        suspect: pick.suspect,
        weapon: pick.weapon,
        room: pick.room,
      });
      // 즉시고발 창 정리 ③ — 선택을 실제로 보냈다. (취소로 닫았으면 창은 그대로 둔다)
      clearAccuseWindow();
      if (room) updateTurnInfo(room.state);
    }
  };
  ($("endTurn") as HTMLButtonElement).onclick = () => {
    if (blockedBy("endTurn")) return;
    room?.send("endTurn", {});
    clearAccuseWindow(); // 즉시고발 창 정리 ③
    if (room) updateTurnInfo(room.state);
  };
  ($("passage") as HTMLButtonElement).onclick = () => {
    if (blockedBy("passage")) return;
    room?.send("passage", {});
  };
  ($("bonus") as HTMLButtonElement).onclick = () => {
    if (blockedBy("bonus")) return;
    room?.send("useBonus", {});
  };
  ($("endHome") as HTMLButtonElement).onclick = exitToMain;
  ($("specHome") as HTMLButtonElement).onclick = exitToMain;
  ($("endRematch") as HTMLButtonElement).onclick = () =>
    room?.send("rematch", {});

  // 온보딩 목표 카드 — 첫 진입 1회 + [?]로 재열람 (§1.5 · ui-copy §3)
  ($("goalOk") as HTMLButtonElement).onclick = closeGoalCard;
  ($("helpBtn") as HTMLButtonElement).onclick = openGoalCard;
  $("goalCard").onclick = (e) => {
    if (e.target === $("goalCard")) closeGoalCard(); // 바깥 클릭도 "봤다"로 간주
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOverlayShown("goal")) closeGoalCard();
  });
  // `?demo=1`은 촬영·시연용 스킵. 그 외 첫 진입에서 1회만.
  const demo = new URLSearchParams(location.search).get("demo") === "1";
  if (!demo && !goalSeen()) openGoalCard();

  // 턴 순서(원형) 오버레이 닫기 — 버튼 또는 바깥 클릭.
  const closeTurnCircle = (): void => $("turnCircle").classList.add("hidden");
  ($("tcClose") as HTMLButtonElement).onclick = closeTurnCircle;
  $("turnCircle").onclick = (e) => {
    if (e.target === $("turnCircle")) closeTurnCircle();
  };

  // 우측 컬럼: 좌측 모서리 드래그=너비, 노트↔기록 사이 드래그=높이
  const rightCol = $("rightPanel");
  const eviPanel = $("eviPanel");

  const makeDrag = (
    handle: HTMLElement,
    onMove: (e: PointerEvent) => void,
  ): void => {
    let dragging = false;
    handle.addEventListener("pointerdown", (e) => {
      dragging = true;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener("pointermove", (e) => {
      if (dragging) onMove(e);
    });
    const stop = (e: PointerEvent): void => {
      dragging = false;
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    };
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  // 높이 조절: 증거노트 높이 = 포인터 y − 컬럼 top
  makeDrag($("colResizer"), (e) => {
    const rect = rightCol.getBoundingClientRect();
    const h = Math.max(80, Math.min(rect.height - 160, e.clientY - rect.top));
    eviPanel.style.height = `${h}px`;
  });
  // 너비 조절: 컬럼 너비 = 우측 고정 모서리 − 포인터 x
  makeDrag($("colWResizer"), (e) => {
    const right = rightCol.getBoundingClientRect().right;
    const w = Math.max(220, Math.min(680, right - e.clientX));
    rightCol.style.width = `${w}px`;
  });

  addLog("잔치 시작! 이동: 방향키, 방에 들어가 [제안]");
};

// ── 랜딩 액션 ─────────────────────────────
const setLandingMsg = (text: string): void => {
  $("landingMsg").textContent = text;
};

/** 주소를 메인(/)으로 되돌린다 — 없는 방/실패 시. */
const goMain = (): void => {
  try {
    history.replaceState({}, "", "/");
  } catch {
    /* history 사용 불가 시 무시 */
  }
};

// ── 공개/비공개 선택 + 공개방 목록 ─────────────────────────────
let createPublic = true;

const wireVisibilityToggle = (): void => {
  const seg = $("visSeg");
  [...seg.children].forEach((btn) => {
    (btn as HTMLElement).onclick = () => {
      createPublic = (btn as HTMLElement).dataset.pub === "1";
      [...seg.children].forEach((b) =>
        b.classList.toggle("active", b === btn),
      );
    };
  });
};

const loadPublicRooms = async (): Promise<void> => {
  const list = $("roomList");
  let rooms: PublicRoom[] = [];
  try {
    rooms = await listPublicRooms();
  } catch {
    list.innerHTML = `<li class="room-empty">목록을 불러오지 못했어요.</li>`;
    return;
  }
  if (rooms.length === 0) {
    list.innerHTML = `<li class="room-empty">열린 공개방이 없어요. 방을 만들어보세요.</li>`;
    return;
  }
  list.innerHTML = "";
  for (const r of rooms) {
    const full = r.clients >= r.maxClients;
    const host = r.metadata?.hostName || "대기 중";
    const li = document.createElement("li");
    li.className = "room-item";
    li.innerHTML =
      `<span class="ri-body"><b>${host}</b>님의 방` +
      `<span class="ri-sub"> · ${r.clients}/${r.maxClients}인</span></span>`;
    const btn = document.createElement("button");
    btn.textContent = full ? "만석" : "참여";
    btn.disabled = full;
    btn.onclick = async () => {
      setLandingMsg("참여하는 중…");
      try {
        wireRoom(await joinRoomById(r.roomId));
      } catch (e) {
        setLandingMsg("참여 실패: " + errMsg(e));
        void loadPublicRooms();
      }
    };
    li.appendChild(btn);
    list.appendChild(li);
  }
};

/**
 * `?solo=1` — 원클릭 솔로 진입.
 * 랜딩에서 고민 없이 한 판이 시작되도록 **기존 경로를 클라가 자동 호출**할 뿐이다.
 * 서버 변경 0: `create`(비공개) → `start` 메시지 2개. NPC 충원·정답 봉투·카드 분배는
 * 전부 서버 `handleStart`(규칙 엔진)가 수행한다 — 클라는 판정에 관여하지 않는다.
 * 문구는 확정 문안이 없어 기존 랜딩 문구("비공개방 만드는 중…")를 재사용.
 */
const startSolo = async (): Promise<void> => {
  setLandingMsg("비공개방 만드는 중…");
  try {
    const r = await createRoom(false);
    wireRoom(r); // 대기실 배선 + 재접속 토큰 저장 + /room/ID로 주소 정리
    r.send("start", {}); // 방장 = 나 → 빈자리 NPC 충원 후 즉시 시작
  } catch (e) {
    goMain();
    setLandingMsg("방 생성 실패: " + errMsg(e));
  }
};

const init = async (): Promise<void> => {
  const query = new URLSearchParams(location.search);
  // 초대 링크(/room/CODE, 구형 ?room=CODE)로 들어온 경우 코드 자동 채움
  const pathMatch = location.pathname.match(/\/room\/([^/]+)/);
  const invited = pathMatch?.[1] ?? query.get("room");
  if (invited) {
    ($("codeInput") as HTMLInputElement).value = invited;
    setLandingMsg("초대 링크로 들어왔어요. [참가] 후 대기실에서 캐릭터를 고르세요.");
  }

  wireVisibilityToggle();
  ($("refreshRooms") as HTMLButtonElement).onclick = () =>
    void loadPublicRooms();
  void loadPublicRooms();
  // 랜딩이 보이는 동안 주기적으로 공개방 목록 갱신.
  window.setInterval(() => {
    if (!$("landing").classList.contains("hidden")) void loadPublicRooms();
  }, 5000);

  ($("createBtn") as HTMLButtonElement).onclick = async () => {
    setLandingMsg(createPublic ? "공개방 만드는 중…" : "비공개방 만드는 중…");
    try {
      wireRoom(await createRoom(createPublic));
    } catch (e) {
      setLandingMsg("방 생성 실패: " + errMsg(e));
    }
  };

  ($("joinBtn") as HTMLButtonElement).onclick = async () => {
    const code = ($("codeInput") as HTMLInputElement).value.trim();
    if (!code) {
      setLandingMsg("초대 코드를 입력하세요.");
      return;
    }
    setLandingMsg("참가하는 중…");
    try {
      wireRoom(await joinRoomById(code));
    } catch (e) {
      goMain();
      setLandingMsg(
        "없는 방이거나 참가할 수 없어요. 코드를 확인하거나 새 방을 만드세요. (" +
          errMsg(e) +
          ")",
      );
    }
  };

  ($("startBtn") as HTMLButtonElement).onclick = () => room?.send("start", {});

  ($("copyBtn") as HTMLButtonElement).onclick = async () => {
    const link = ($("inviteLink") as HTMLInputElement).value;
    try {
      await navigator.clipboard.writeText(link);
      ($("copyBtn") as HTMLButtonElement).textContent = "복사됨!";
      window.setTimeout(() => {
        ($("copyBtn") as HTMLButtonElement).textContent = "복사";
      }, 1500);
    } catch {
      ($("inviteLink") as HTMLInputElement).select();
    }
  };

  // ?solo=1 → 랜딩·재접속 복원을 건너뛰고 바로 한 판. (파라미터 없는 진입은 기존 그대로)
  if (query.get("solo") === "1") {
    await startSolo();
    return;
  }

  // 새로고침 세션 복원 (탭 기준). 유효 토큰이면 방으로 바로 재입장.
  const token = sessionStorage.getItem(RECONNECT_KEY);
  if (token) {
    setLandingMsg("이전 세션에 재접속 중…");
    try {
      wireRoom(await client.reconnect(token));
    } catch {
      sessionStorage.removeItem(RECONNECT_KEY);
      setLandingMsg(
        invited ? "초대 링크로 들어왔어요. [참가] 후 대기실에서 캐릭터를 고르세요." : "",
      );
    }
  }
};

void init();
