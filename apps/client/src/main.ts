import Phaser from "phaser";
import {
  ROOMS,
  SUSPECTS,
  WEAPONS,
  ZODIAC,
  emoji,
  label,
  type Card,
} from "@zodiac-clue/shared";
import type { Room } from "colyseus.js";
import { client, createRoom, joinRoomById } from "./network";
import { BOARD_H, BOARD_W, GameScene } from "./scenes/game-scene";

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
const addLog = (text: string): void => {
  const div = document.createElement("div");
  div.textContent = text;
  $("log").prepend(div);
};

// ── 카드 선택 모달 ─────────────────────────────
type Pick = { suspect: string; weapon: string; room?: string };

const selectFrom = (values: readonly string[]): HTMLSelectElement => {
  const sel = document.createElement("select");
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = label(v);
    sel.appendChild(opt);
  }
  return sel;
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

    const suspectSel = selectFrom(SUSPECTS);
    const weaponSel = selectFrom(WEAPONS);
    const roomSel = needRoom ? selectFrom(ROOMS) : null;

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
let phaserStarted = false;
let selectedCharacter: string | null = null;

// ── 십이지신 캐릭터 선택 그리드 ─────────────────────────────
const selectCharacter = (z: string, grid: HTMLElement): void => {
  selectedCharacter = z;
  [...grid.children].forEach((c, i) =>
    c.classList.toggle("selected", ZODIAC[i] === z),
  );
  ($("createBtn") as HTMLButtonElement).disabled = false;
  ($("joinBtn") as HTMLButtonElement).disabled = false;
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

  r.onMessage("log", (m: { text: string }) => addLog(m.text));
  r.onMessage("hand", (m: { cards: Card[] }) => {
    $("hand").innerHTML =
      "<b>내 단서 패</b>: " + m.cards.map((c) => label(c.value)).join(", ");
  });
  r.onMessage("disprove", (m: { by: string | null; card: Card | null }) => {
    if (m.card) {
      addLog(`🔎 ${m.by} 님이 "${label(m.card.value)}" 단서로 반증 (나만 봄)`);
    } else {
      addLog("🔎 아무도 반증하지 못함 — 정답 후보!");
    }
  });
  r.onMessage("accuseResult", (m: { player: string; correct: boolean }) => {
    addLog(m.correct ? `🎉 ${m.player} 정답!` : `❌ ${m.player} 오답`);
  });

  r.onStateChange((state) => {
    renderLobby(state);
    if (state.phase === "playing" && !phaserStarted) enterGame();
  });

  r.onError((code, message) => addLog(`에러(${code}): ${message ?? ""}`));

  show("lobby");
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
  startBtn.disabled = !isHost || count < 2;
  $("hostHint").textContent = isHost
    ? count < 2
      ? "2명 이상 모이면 시작할 수 있어요."
      : ""
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

const enterGame = (): void => {
  phaserStarted = true;
  show("gameScreen");

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#1c1712",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: BOARD_W,
      height: BOARD_H,
    },
    scene: [GameScene],
  });
  game.registry.set("room", room);

  ($("suggest") as HTMLButtonElement).onclick = async () => {
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

  addLog("잔치 시작! 이동: 방향키/WASD, 방에 들어가 [제안]");
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
    setLandingMsg("초대 링크로 들어왔어요. 캐릭터를 고르고 [참가]를 누르세요.");
  }

  ($("createBtn") as HTMLButtonElement).onclick = async () => {
    if (!selectedCharacter) {
      setLandingMsg("캐릭터를 선택하세요.");
      return;
    }
    setLandingMsg("방 만드는 중…");
    try {
      wireRoom(await createRoom(selectedCharacter));
    } catch (e) {
      setLandingMsg("방 생성 실패: " + errMsg(e));
    }
  };

  ($("joinBtn") as HTMLButtonElement).onclick = async () => {
    if (!selectedCharacter) {
      setLandingMsg("캐릭터를 선택하세요.");
      return;
    }
    const code = ($("codeInput") as HTMLInputElement).value.trim();
    if (!code) {
      setLandingMsg("초대 코드를 입력하세요.");
      return;
    }
    setLandingMsg("참가하는 중…");
    try {
      wireRoom(await joinRoomById(code, selectedCharacter));
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
        invited ? "초대 링크로 들어왔어요. 캐릭터를 고르고 [참가]를 누르세요." : "",
      );
    }
  }
};

void init();
