import Phaser from "phaser";
import {
  ROOMS,
  SUSPECTS,
  WEAPONS,
  ZODIAC,
  emoji,
  label,
  persona,
  type Card,
} from "@zodiac-clue/shared";
import type { Room } from "colyseus.js";
import { client, createRoom, joinRoomById } from "./network";
import { GameScene } from "./scenes/game-scene";

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
  // 접힘 상태용 최신 한 줄 요약
  $("logLatest").textContent = text.length > 40 ? text.slice(0, 40) + "…" : text;
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
    modal.appendChild(row("수법", weaponSel));
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
let phaserStarted = false;
let selectedCharacter: string | null = null;
/** 내 손패 카드값 집합 — 정답일 수 없으므로 제안·증거노트에서 자동 비활성화. */
let myCards = new Set<string>();

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
    const scene = game?.scene.getScene("game") as GameScene | undefined;
    scene?.showBubble(m.id, m.text);
  });

  r.onStateChange((state) => {
    renderLobby(state);
    updateTurnInfo(state);
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
    { suspect: string; name: string }
  >;
  const cur = players.get(state.currentTurn);
  const mine = room !== null && state.currentTurn === room.sessionId;
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
  const groups: [string, readonly string[]][] = [
    ["용의자", participantSuspects()],
    ["수법", WEAPONS],
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
      const own = myCards.has(v); // 내 패 → 정답 아님, 자동 제외·잠금
      if (own) {
        // 내 손패는 항상 '제외'로 고정, 토글 불가
        chip.className = "evi-chip cleared own";
        chip.title = "내 패 (정답 아님)";
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

  // 좁은 화면에선 HUD 접이식 패널을 접어 겹침 방지
  if (window.innerWidth <= 680) {
    document
      .querySelectorAll("#gameScreen details[open]")
      .forEach((d) => d.removeAttribute("open"));
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

  // 우측 컬럼(증거노트+기록) 넓게 보기 토글 — 둘은 같은 컬럼에 세로로 공존
  ($("logExpand") as HTMLButtonElement).onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    $("rightPanel").classList.toggle("wide");
  };

  // 노트↔기록 사이 드래그로 높이 조절
  const resizer = $("colResizer");
  const eviPanel = $("eviPanel");
  const rightCol = $("rightPanel");
  let dragging = false;
  resizer.addEventListener("pointerdown", (e) => {
    dragging = true;
    (e.target as Element).setPointerCapture((e as PointerEvent).pointerId);
    e.preventDefault();
  });
  resizer.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = rightCol.getBoundingClientRect();
    const h = Math.max(
      60,
      Math.min(rect.height - 150, (e as PointerEvent).clientY - rect.top),
    );
    eviPanel.style.flex = "none";
    eviPanel.style.height = `${h}px`;
  });
  const stopDrag = (e: Event): void => {
    dragging = false;
    try {
      (e.target as Element).releasePointerCapture(
        (e as PointerEvent).pointerId,
      );
    } catch {
      /* noop */
    }
  };
  resizer.addEventListener("pointerup", stopDrag);
  resizer.addEventListener("pointercancel", stopDrag);

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
