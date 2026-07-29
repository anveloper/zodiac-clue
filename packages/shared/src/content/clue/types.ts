// 클루 카드·프로토콜 타입 — **콘텐츠(주제) 층.**
// `ClientMessages`/`ServerMessages`가 곧 클루 규칙이다
// (docs/design/20260729-mafia-content-design.md §1.2-④).
// AI 계측 타입(`AiSource`/`SayAi`/`AiStats`)은 주제 무관이라 `engine/ai.ts`로 갈라 두고
// 여기서는 **타입으로만** 참조한다 — 의존 방향은 content → engine 한 방향뿐이다.

import type { AiStats, SayAi } from "../../engine/ai";
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

/**
 * 제안 기록 1건 — **공개 정보만** 담는다(로드맵 §1.2 + §8.3 b).
 * 실시간 브로드캐스트(`suggestLog`)와 재접속 리플레이(`suggestLogAll`)가
 * **같은 자료구조**를 쓴다. 반증 **카드 값**은 여기 없다 — 제안자에게만 가는
 * `disprove` 메시지가 유일한 전달 경로다(비밀 정보 규약).
 */
export type SuggestEntry = {
  /** 이번 판에서 1부터 증가. */
  seq: number;
  byId: string;
  byName: string;
  /** 한글 라벨. */
  suspect: string;
  weapon: string;
  room: string;
  /** 반증자 sessionId. `null`이면 아무도 반증하지 못함(정답 후보). */
  disprovedById: string | null;
  disprovedByName: string | null;
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
  /** 현재 방의 비밀 통로로 이동(턴 종료) */
  passage: Record<string, never>;
  /** 종료 후 같은 방으로 새 판 시작 */
  rematch: Record<string, never>;
  /** 인접한 고정 NPC(계략)의 보너스 사용 */
  useBonus: Record<string, never>;
};

// ── 서버 → 클라 메시지 (개별/브로드캐스트) ───────────
export type ServerMessages = {
  /** 접속자 본인의 손패 (private) */
  hand: { cards: Card[] };
  /** 제안에 대한 반증 결과 (제안자에게만 private) */
  disprove: { by: string | null; card: Card | null; suggestion: Suggestion };
  /** 공개 로그 (브로드캐스트) */
  log: {
    text: string;
    /** 로그 종류 — 색상/구분용 */
    kind?: "info" | "move" | "suggest" | "disprove" | "accuse" | "win";
    /** 제안-반증 연결 id (제안 로그에 결과 배지를 붙이기 위함) */
    sid?: string;
    /** 반증 결과일 때: 반증됨 여부 */
    disproved?: boolean;
  };
  /** 고발 결과 */
  accuseResult: { player: string; correct: boolean };
  /**
   * NPC 대사 (브로드캐스트) — 말풍선/로그용.
   * `ai`는 그 문장이 **어디서 왔는지**를 알려주는 계측 필드다(④ §4). 없으면
   * LLM이 죽어도 화면에 아무 신호가 없다 — 그것이 07-27 장애가 늦게 발견된 이유다.
   */
  say: { id: string; from: string; text: string; ai: SayAi };
  /** 이번 판 누적 AI 경로 집계 — 값이 바뀔 때만 브로드캐스트. */
  aiStats: AiStats;
  /** 제안 기록 1건(실시간 브로드캐스트). */
  suggestLog: SuggestEntry;
  /** 제안 기록 전체(재접속·관전 입장 시 개별 전송) — 리플레이용. */
  suggestLogAll: SuggestEntry[];
  /** 계략 엿보기 결과 (사용자 본인에게만) — 상대가 가진(정답 아닌) 카드 */
  peek: { from: string; cards: Card[] };
  /**
   * 즉시고발권(로드맵 §7.5.1) — 제안자에게만.
   * 자기 제안 직후 **같은 턴에** 고발할 수 있는 창이 열렸음을 알린다.
   * `ms` 안에 `accuse` 또는 `endTurn`을 보내지 않으면 서버가 자동으로 턴을 넘긴다.
   */
  canAccuse: { ms: number; suggestion: Suggestion };
};

export type MessageType = keyof ClientMessages | keyof ServerMessages;
