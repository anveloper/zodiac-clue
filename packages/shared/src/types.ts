import type { RoomName, Suspect, Weapon } from "./cards";

export type CardKind = "suspect" | "weapon" | "room";

export type Card = {
  kind: CardKind;
  value: string;
};

/** 정답 봉투 — 서버에만 존재. 클라로 절대 동기화하지 않는다. */
export type Solution = {
  suspect: Suspect;
  weapon: Weapon;
  room: RoomName;
};

/** 한 판의 제안(추리) 내용. */
export type Suggestion = {
  suspect: Suspect;
  weapon: Weapon;
  room: RoomName;
};

// ── 클라 → 서버 메시지 ───────────────────────────────
export type ClientMessages = {
  join: { name: string };
  start: Record<string, never>;
  /** 그리드 한 칸 이동 의도. dx,dy ∈ {-1,0,1} */
  move: { dx: number; dy: number };
  suggest: Suggestion;
  accuse: Suggestion;
  endTurn: Record<string, never>;
};

// ── 서버 → 클라 메시지 (개별/브로드캐스트) ───────────
export type ServerMessages = {
  /** 접속자 본인의 손패 (private) */
  hand: { cards: Card[] };
  /** 제안에 대한 반증 결과 (제안자에게만 private) */
  disprove: { by: string | null; card: Card | null; suggestion: Suggestion };
  /** 공개 로그 (브로드캐스트) */
  log: { text: string };
  /** 고발 결과 */
  accuseResult: { player: string; correct: boolean };
};

export type MessageType = keyof ClientMessages | keyof ServerMessages;
