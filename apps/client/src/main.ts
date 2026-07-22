import Phaser from "phaser";
import {
  ROOMS,
  SUSPECTS,
  WEAPONS,
  ZODIAC,
  emoji,
  job,
  label,
  passageOf,
  persona,
  type Card,
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

// ── 카드 선택 모달 ─────────────────────────────
type Pick = { suspect: string; weapon: string; room?: string };

const selectFrom = (
  values: readonly string[],
  disabled?: Set<string>,
): HTMLSelectElement => {
  const sel = document.createElement("select");
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = label(v) + (disabled?.has(v) ? " (내 패)" : "");
    if (disabled?.has(v)) opt.disabled = true;
    sel.appendChild(opt);
  }
  // 비활성(내 패)이 아닌 첫 옵션을 기본 선택
  const firstEnabled = [...sel.options].find((o) => !o.disabled);
  if (firstEnabled) sel.value = firstEnabled.value;
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

const openPicker = (title: string, needRoom: boolean): Promise<Pick | null> =>
  new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const modal = document.createElement("div");
    modal.className = "modal";

    const h = document.createElement("h2");
    h.textContent = title;
    modal.appendChild(h);

    const suspectSel = selectFrom(participantSuspects(), myCards);
    const weaponSel = selectFrom(WEAPONS, myCards);
    const roomSel = needRoom ? selectFrom(ROOMS, myCards) : null;

    const row = (labelText: string, sel: HTMLSelectElement): HTMLDivElement => {
      const r = document.createElement("div");
      r.className = "modal-row";
      const l = document.createElement("label");
      l.textContent = labelText;
      r.append(l, sel);
      return r;
    };

    modal.appendChild(row("용의자", suspectSel));
    modal.appendChild(row("훔친 것", weaponSel));
    if (roomSel) modal.appendChild(row("장소", roomSel));

    const actions = document.createElement("div");
    actions.className = "actions";
    const cancel = document.createElement("button");
    cancel.className = "ghost";
    cancel.textContent = "취소";
    const ok = document.createElement("button");
    ok.textContent = "확인";
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
    $("hand").innerHTML =
      "<b>내 단서 패</b>: " + m.cards.map((c) => label(c.value)).join(", ");
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
  });
  r.onMessage("accuseResult", (m: { player: string; correct: boolean }) => {
    addLog(m.correct ? `🎉 ${m.player} 정답!` : `❌ ${m.player} 오답`, {
      kind: m.correct ? "win" : "accuse",
    });
  });
  r.onMessage("say", (m: { id: string; from: string; text: string }) => {
    addLog(`💬 ${m.from}: ${m.text}`, { kind: "info" });
    const kind = STAGES[stageIndex].kind;
    if (kind === "three") {
      iso?.showBubble(m.id, m.text);
    } else {
      const key = kind === "pixel" ? "pixel" : "game";
      const scene = game?.scene.getScene(key) as
        | GameScene
        | PixelScene
        | undefined;
      scene?.showBubble(m.id, m.text);
    }
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
    }
    lastPhase = state.phase;

    renderLobby(state);
    updateTurnInfo(state);
    updateEndState(state);
    if (state.phase === "playing" && !phaserStarted) enterGame();
  });

  r.onError((code, message) => addLog(`에러(${code}): ${message ?? ""}`));

  show("lobby");
};

// 게임 중 현재 턴 배너 (내 턴이면 주사위 굴림 + 남은 이동 표시)
const DICE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
let lastTurn = "";
let diceTimer: number | undefined;

const myTurnText = (steps: number): string =>
  `🎲 <b>내 턴</b> · 남은 이동 ${steps}칸 · 방에서 [제안]`;

/** 합계 steps(2~12)를 2개 주사위 눈으로 분해. */
const splitDice = (steps: number): [number, number] => {
  const d1 = Math.max(1, Math.min(6, steps - Math.min(6, steps - 1)));
  return [d1, steps - d1];
};

// 내 차례 시작 시 화면 중앙에 주사위를 차분히 굴린다.
const showDiceRoll = (): void => {
  const ov = $("diceOverlay");
  ov.classList.remove("hidden");
  ov.classList.remove("done");
  if (diceTimer) window.clearInterval(diceTimer);
  let t = 0;
  const render = (faces: string, label: string): void => {
    ov.innerHTML =
      `<div class="dice-card"><div class="dice-faces">${faces}</div>` +
      `<div class="dice-label">${label}</div></div>`;
  };
  // 굴리는 단계: 느린 간격으로 6프레임(~0.9s)
  diceTimer = window.setInterval(() => {
    t += 1;
    const a = DICE_FACES[Math.floor(Math.random() * 6)];
    const b = DICE_FACES[Math.floor(Math.random() * 6)];
    render(`${a} ${b}`, "주사위");
    if (t >= 6) {
      window.clearInterval(diceTimer);
      diceTimer = undefined;
      const steps = (room?.state as { stepsLeft?: number })?.stepsLeft ?? 0;
      const [d1, d2] = splitDice(steps);
      render(
        `${DICE_FACES[d1 - 1]} ${DICE_FACES[d2 - 1]}`,
        `이동 ${steps}칸`,
      );
      ov.classList.add("done"); // 강조(살짝 커짐)
      // 결과를 충분히 보여주고 서서히 사라짐
      window.setTimeout(() => ov.classList.add("hidden"), 1900);
    }
  }, 150);
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
    overlay.classList.remove("hidden");
  } else {
    overlay.classList.add("hidden");
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
      const chip = `<span class="${cls}" title="${label(p.suspect)}${tag}">${emoji(p.suspect)}</span>`;
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
    node.innerHTML =
      `<div class="tc-em">${emoji(p.suspect)}</div>` +
      `<div class="tc-name">${p.name}</div>${badge}`;
    ring.appendChild(node);
  });
  $("turnCircle").classList.remove("hidden");
};

const updateTurnInfo = (state: Room["state"]): void => {
  const el = $("turnInfo");
  if (state.phase !== "playing") {
    el.classList.add("hidden");
    lastTurn = "";
    return;
  }
  el.classList.remove("hidden");
  const players = state.players as Map<
    string,
    {
      suspect: string;
      name: string;
      room?: string;
      x: number;
      y: number;
      eliminated?: boolean;
    }
  >;
  const cur = players.get(state.currentTurn);
  const mine = room !== null && state.currentTurn === room.sessionId;
  const me = room ? players.get(room.sessionId) : undefined;
  // 내 턴 + 탈락(관전) 아닐 때만 행동 가능. 아니면 모든 액션 버튼 비활성화.
  const canAct = mine && !me?.eliminated;
  // 제안: 행동 가능 + 방 안일 때만
  ($("suggest") as HTMLButtonElement).disabled = !(canAct && !!me?.room);
  // 고발·턴 종료: 행동 가능할 때만
  ($("accuse") as HTMLButtonElement).disabled = !canAct;
  ($("endTurn") as HTMLButtonElement).disabled = !canAct;
  // 비밀 통로 버튼: 행동 가능 + 현재 방에 통로가 있을 때만 활성
  ($("passage") as HTMLButtonElement).disabled = !(
    canAct && !!me?.room && !!passageOf(me.room)
  );
  // 계략 버튼: 행동 가능 + 인접(체비셰프≤1)에 미사용 고정 NPC가 있을 때만 활성
  let nearHelper = false;
  if (canAct && me) {
    (
      state.helpers as Map<string, { x: number; y: number; used: boolean }>
    ).forEach((h) => {
      if (
        !h.used &&
        Math.max(Math.abs(h.x - me.x), Math.abs(h.y - me.y)) <= 1
      ) {
        nearHelper = true;
      }
    });
  }
  ($("bonus") as HTMLButtonElement).disabled = !nearHelper;
  const turnChanged = state.currentTurn !== lastTurn;
  lastTurn = state.currentTurn;
  el.classList.toggle("mine", mine);
  el.classList.add("clickable");

  // 상태 줄 + 턴 순서 스트립(현재→다음… 방향). 클릭 시 원형 순서 오버레이.
  const status = mine
    ? `<div class="ti-status">${myTurnText(state.stepsLeft ?? 0)}</div>`
    : `<div class="ti-status">${cur ? `⏳ ${emoji(cur.suspect)} ${cur.name} 님의 턴` : ""}</div>`;
  el.innerHTML = status + renderTurnStrip(state);
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
    cell.innerHTML =
      `<span class="em">${emoji(z)}</span>` + `<span>${label(z)}</span>`;
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
  const groups: [string, readonly string[]][] = [
    ["용의자", participantSuspects()],
    ["훔친 것", WEAPONS],
    ["장소", ROOMS],
  ];
  for (const [cat, values] of groups) {
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
      chip.innerHTML =
        `<span>${emoji(v)}</span>` + `<span>${label(v)}</span>`;
      // 내 패 또는 공통 단서 → 정답 아님, 자동 제외·잠금
      const own = myCards.has(v) || commonSet.has(v);
      if (own) {
        chip.className = "evi-chip cleared own";
        chip.title = commonSet.has(v) ? "공통 단서 (정답 아님)" : "내 패 (정답 아님)";
      } else {
        chip.title = "클릭: 없음(제외) → 의심 → 초기화";
        const apply = (): void => {
          const st = data[v] ?? "";
          chip.className = "evi-chip" + (st ? " " + st : "");
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
    if (three) {
      if (!iso && room) iso = new IsoView(room, $("gameScreen"));
      iso?.setActive(true); // three 캔버스가 Phaser 위를 덮음(HUD는 그 위)
      iso?.setAssets(st.assets); // 뷰2=이모지 / 뷰3=에셋 아트
    } else {
      iso?.setActive(false); // 캔버스 숨김 → 아래 Phaser가 그대로 보임
    }
    // Phaser 씬 표시 전환: 뷰1=GameScene / 뷰4=PixelScene. GameScene은 뷰4에서도
    // 계속 active(입력·카메라 담당)이되 invisible — PixelScene이 카메라를 미러링.
    // PixelScene은 config 배열의 2번째라 자동 시작되지 않음 → 처음 필요할 때 run.
    if (pixel && game && !game.scene.isActive("pixel")) game.scene.run("pixel");
    game?.scene.getScene("game")?.sys.setVisible(st.kind === "phaser");
    game?.scene.getScene("pixel")?.sys.setVisible(pixel);
    // three에선 iso가 입력 담당 → Phaser 키보드 off. phaser/pixel은 GameScene이 담당.
    if (game?.input.keyboard) game.input.keyboard.enabled = !three;
    viewBtn.textContent = st.label + " ▲";
    [...viewList.children].forEach((li, idx) =>
      (li as HTMLElement).classList.toggle("active", idx === stageIndex),
    );
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
    // 방 안에서만 제안 가능 — 밖이면 안내(제안이 거부돼 턴이 안 넘어가는 혼동 방지)
    const me = room
      ? (room.state.players as Map<string, { room: string; id: string }>).get(
          room.sessionId,
        )
      : undefined;
    if (room && room.state.currentTurn !== room.sessionId) {
      addLog("지금은 내 턴이 아니에요.", { kind: "info" });
      return;
    }
    if (!me?.room) {
      addLog("방 안에서만 제안할 수 있어요. 방으로 이동하세요.", {
        kind: "info",
      });
      return;
    }
    const pick = await openPicker("제안 — 누가, 무엇으로?", false);
    if (pick) {
      room?.send("suggest", {
        suspect: pick.suspect,
        weapon: pick.weapon,
        room: "",
      });
    }
  };
  ($("accuse") as HTMLButtonElement).onclick = async () => {
    const pick = await openPicker("고발 — 진범을 지목하라", true);
    if (pick && pick.room) {
      room?.send("accuse", {
        suspect: pick.suspect,
        weapon: pick.weapon,
        room: pick.room,
      });
    }
  };
  ($("endTurn") as HTMLButtonElement).onclick = () => room?.send("endTurn", {});
  ($("passage") as HTMLButtonElement).onclick = () =>
    room?.send("passage", {});
  ($("bonus") as HTMLButtonElement).onclick = () => room?.send("useBonus", {});
  ($("endHome") as HTMLButtonElement).onclick = exitToMain;
  ($("specHome") as HTMLButtonElement).onclick = exitToMain;
  ($("endRematch") as HTMLButtonElement).onclick = () =>
    room?.send("rematch", {});

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

const init = async (): Promise<void> => {
  // 초대 링크(/room/CODE, 구형 ?room=CODE)로 들어온 경우 코드 자동 채움
  const pathMatch = location.pathname.match(/\/room\/([^/]+)/);
  const invited =
    pathMatch?.[1] ?? new URLSearchParams(location.search).get("room");
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
