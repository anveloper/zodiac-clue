import Phaser from "phaser";
import { label, type Card } from "@zodiac-clue/shared";
import { joinClue } from "./network";
import { GameScene } from "./scenes/game-scene";

const logEl = document.getElementById("log") as HTMLDivElement;
const handEl = document.getElementById("hand") as HTMLDivElement;

const addLog = (text: string): void => {
  const div = document.createElement("div");
  div.textContent = text;
  logEl.prepend(div);
};

const ask = (msg: string): string | null => {
  const v = window.prompt(msg);
  return v ? v.trim() : null;
};

const main = async (): Promise<void> => {
  const name = window.prompt("닉네임을 입력하세요", "탐정") ?? "탐정";
  const room = await joinClue(name);

  room.onMessage("log", (m: { text: string }) => addLog(m.text));
  room.onMessage("hand", (m: { cards: Card[] }) => {
    handEl.innerHTML =
      "<b>내 손패</b>: " + m.cards.map((c) => label(c.value)).join(", ");
  });
  room.onMessage(
    "disprove",
    (m: { by: string | null; card: Card | null }) => {
      if (m.card) {
        addLog(`🔎 ${m.by} 님이 "${label(m.card.value)}" 카드로 반증 (나만 봄)`);
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
    backgroundColor: "#1c1c22",
    scene: [GameScene],
  });
  game.registry.set("room", room);

  const btn = (id: string): HTMLButtonElement =>
    document.getElementById(id) as HTMLButtonElement;

  btn("start").onclick = () => room.send("start", {});
  btn("endTurn").onclick = () => room.send("endTurn", {});
  btn("suggest").onclick = () => {
    const suspect = ask(
      "제안 — 용의자 (scarlett/mustard/white/green/peacock/plum)",
    );
    const weapon = ask(
      "제안 — 흉기 (candlestick/dagger/lead-pipe/revolver/rope/wrench)",
    );
    if (suspect && weapon) {
      // 장소는 서버가 현재 방으로 강제
      room.send("suggest", { suspect, weapon, room: "" });
    }
  };
  btn("accuse").onclick = () => {
    const suspect = ask("[고발] 용의자");
    const weapon = ask("[고발] 흉기");
    const roomName = ask(
      "[고발] 장소 (kitchen/ballroom/conservatory/dining/billiard/library/lounge/hall/study)",
    );
    if (suspect && weapon && roomName) {
      room.send("accuse", { suspect, weapon, room: roomName });
    }
  };

  addLog("접속 완료. 2명 이상 모이면 [게임 시작]을 누르세요. 이동: 방향키/WASD");
};

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  addLog("접속 실패: " + msg);
});
