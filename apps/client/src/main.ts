import Phaser from "phaser";
import {
  ROOMS,
  SUSPECTS,
  WEAPONS,
  label,
  type Card,
} from "@zodiac-clue/shared";
import { joinClue } from "./network";
import { GameScene } from "./scenes/game-scene";

const logEl = document.getElementById("log") as HTMLDivElement;
const handEl = document.getElementById("hand") as HTMLDivElement;

const addLog = (text: string): void => {
  const div = document.createElement("div");
  div.textContent = text;
  logEl.prepend(div);
};

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

/** 용의자/수법(/장소) 드롭다운 모달을 띄우고 선택값을 반환. 취소 시 null. */
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

const main = async (): Promise<void> => {
  const name = window.prompt("잔치에 참석할 이름을 입력하세요", "탐정") ?? "탐정";
  const room = await joinClue(name);

  room.onMessage("log", (m: { text: string }) => addLog(m.text));
  room.onMessage("hand", (m: { cards: Card[] }) => {
    handEl.innerHTML =
      "<b>내 단서 패</b>: " + m.cards.map((c) => label(c.value)).join(", ");
  });
  room.onMessage(
    "disprove",
    (m: { by: string | null; card: Card | null }) => {
      if (m.card) {
        addLog(`🔎 ${m.by} 님이 "${label(m.card.value)}" 단서로 반증 (나만 봄)`);
      } else {
        addLog("🔎 아무도 반증하지 못함 — 정답 후보!");
      }
    },
  );
  room.onMessage("accuseResult", (m: { player: string; correct: boolean }) => {
    addLog(m.correct ? `🎉 ${m.player} 정답!` : `❌ ${m.player} 오답`);
  });

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: 480,
    height: 480,
    parent: "game",
    backgroundColor: "#1c1712",
    scene: [GameScene],
  });
  game.registry.set("room", room);

  const btn = (id: string): HTMLButtonElement =>
    document.getElementById(id) as HTMLButtonElement;

  btn("start").onclick = () => room.send("start", {});
  btn("endTurn").onclick = () => room.send("endTurn", {});
  btn("suggest").onclick = async () => {
    // 장소는 서버가 현재 방으로 강제하므로 용의자·수법만 선택
    const pick = await openPicker("제안 — 누가, 무엇으로?", false);
    if (pick) room.send("suggest", { suspect: pick.suspect, weapon: pick.weapon, room: "" });
  };
  btn("accuse").onclick = async () => {
    const pick = await openPicker("고발 — 진범을 지목하라", true);
    if (pick && pick.room) {
      room.send("accuse", { suspect: pick.suspect, weapon: pick.weapon, room: pick.room });
    }
  };

  addLog("입장 완료. 2명 이상 모이면 [잔치 시작]. 이동: 방향키/WASD");
};

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  addLog("접속 실패: " + msg);
});
