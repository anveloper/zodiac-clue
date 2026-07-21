import Phaser from "phaser";
import {
  ROOMS,
  SUSPECTS,
  WEAPONS,
  ZODIAC,
  emoji,
  label,
  passageOf,
  persona,
  type Card,
} from "@zodiac-clue/shared";
import type { Room } from "colyseus.js";
import { client, createRoom, joinRoomById } from "./network";
import { GameScene } from "./scenes/game-scene";
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
let viewMode: "2d" | "iso" = "2d";
let phaserStarted = false;
let selectedCharacter: string | null = null;
/** 내 손패 카드값 집합 — 정답일 수 없으므로 제안·증거노트에서 자동 비활성화. */
let myCards = new Set<string>();
/** 직전 게임 페이즈 — 리매치(ended→playing) 감지용. */
let lastPhase = "";

// ── 십이지신 캐릭터 선택 그리드 ─────────────────────────────
const showPersona = (z: string): void => {
  $("personaPanel").innerHTML =
    `${emoji(z)} <b>${label(z)}</b> — ${persona(z)}`;
};

const selectCharacter = (z: string, grid: HTMLElement): void => {
  selectedCharacter = z;
  [...grid.children].forEach((c, i) =>
    c.classList.toggle("selected", ZODIAC[i] === z),
  );
  showPersona(z);
};

const buildCharGrid = (): void => {
  const grid = $("charGrid");
  grid.innerHTML = "";
  for (const z of ZODIAC) {
    const cell = document.createElement("div");
    cell.className = "char";
    cell.innerHTML =
      `<span class="em">${emoji(z)}</span>` + `<span>${label(z)}</span>`;
    cell.onclick = () => selectCharacter(z, grid);
    cell.onmouseenter = () => showPersona(z);
    grid.appendChild(cell);
  }
};

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
    if (viewMode === "iso") {
      iso?.showBubble(m.id, m.text);
    } else {
      const scene = game?.scene.getScene("game") as GameScene | undefined;
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

  if (mine) {
    el.innerHTML = myTurnText(state.stepsLeft ?? 0);
    if (turnChanged) showDiceRoll(); // 턴 시작 → 중앙 주사위
  } else {
    el.textContent = cur ? `⏳ ${emoji(cur.suspect)} ${cur.name} 님의 턴` : "";
  }
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
    if (!takenByOther && !mine) {
      cell.onclick = () => room?.send("character", { value: z });
    }
    grid.appendChild(cell);
  }
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
    scene: [GameScene],
  });
  game.registry.set("room", room);
  if (room) buildEvidence(room.roomId);

  // 2D(Phaser) ↔ 2.5D(Three.js) 시점 토글. 서버·HUD·입력 규칙은 동일.
  const setView = (mode: "2d" | "iso"): void => {
    viewMode = mode;
    const gameDiv = $("game");
    const toggleBtn = $("viewToggle") as HTMLButtonElement;
    if (mode === "iso") {
      if (!iso && room) iso = new IsoView(room, $("gameScreen"));
      iso?.setActive(true);
      gameDiv.style.display = "none";
      if (game?.input.keyboard) game.input.keyboard.enabled = false;
      toggleBtn.textContent = "2D";
    } else {
      iso?.setActive(false);
      gameDiv.style.display = "block";
      if (game?.input.keyboard) game.input.keyboard.enabled = true;
      toggleBtn.textContent = "2.5D";
    }
    try {
      localStorage.setItem("zc_view", mode);
    } catch {
      /* noop */
    }
  };
  ($("viewToggle") as HTMLButtonElement).onclick = () =>
    setView(viewMode === "2d" ? "iso" : "2d");
  // 저장된 선호 시점 복원
  try {
    if (localStorage.getItem("zc_view") === "iso") setView("iso");
  } catch {
    /* noop */
  }

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

const init = async (): Promise<void> => {
  buildCharGrid();

  // 초대 링크(/room/CODE, 구형 ?room=CODE)로 들어온 경우 코드 자동 채움
  const pathMatch = location.pathname.match(/\/room\/([^/]+)/);
  const invited =
    pathMatch?.[1] ?? new URLSearchParams(location.search).get("room");
  if (invited) {
    ($("codeInput") as HTMLInputElement).value = invited;
    setLandingMsg("초대 링크로 들어왔어요. [참가] 후 대기실에서 캐릭터를 고르세요.");
  }

  ($("createBtn") as HTMLButtonElement).onclick = async () => {
    setLandingMsg("방 만드는 중…");
    try {
      wireRoom(await createRoom(selectedCharacter ?? undefined));
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
      wireRoom(await joinRoomById(code, selectedCharacter ?? undefined));
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
