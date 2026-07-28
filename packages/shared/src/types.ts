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

// ── AI 계측(관측 가능성) — ④ §4 ──────────────────────
/**
 * 한 문장이 **어느 경로로 왔는가**. 진실값이 아니라 운영 메타데이터다
 * (④ §4 "추가 필드는 전부 운영 메타데이터이며 게임 상태가 아니다").
 * - `llm`: Gemini 실호출 성공
 * - `cache`: 같은 진실값 조합의 LRU 캐시 히트 (API 호출 0)
 * - `fallback`: 규칙 폴백 대사 — **왜 폴백인지는 `AiFallbackReason`**
 */
export type AiSource = "llm" | "cache" | "fallback";

/**
 * 폴백 사유. 2026-07-27 장애(전 대사가 조용히 규칙 폴백)를 **즉시** 잡았을 값이다 —
 * 그때 로그에는 `HTTP 400`밖에 없었고 화면에는 아무 신호도 없었다(④ §4.1).
 * - `timeout`  : 4000ms `AbortController` 만료
 * - `http`     : 200이 아닌 응답(429 쿼터 초과 포함)
 * - `empty`    : 200이지만 후보 텍스트가 비어 있음
 * - `toolong`  : 길이 규약 초과 + 문장 경계 없음 → 폐기
 * - `nokey`    : `GEMINI_API_KEY` 미설정
 * - `disabled` : 키는 있으나 운영상 LLM 경로를 끈 상태
 */
export type AiFallbackReason =
  | "timeout"
  | "http"
  | "empty"
  | "toolong"
  | "nokey"
  | "disabled";

/** `say` 메시지에 동봉되는 경로·지연·모델 메타. */
export type SayAi = {
  source: AiSource;
  /** `narrate()` 왕복 소요(ms). 폴백이면 0 또는 실제 소요. */
  ms: number;
  /** 실호출 모델명. 폴백이면 `""` — **키 값은 어떤 필드에도 담기지 않는다.** */
  model: string;
  /** `source === "fallback"`일 때만. */
  reason?: AiFallbackReason;
};

/** 이번 판 누적 경로 집계 — AI 카운터 칩(`✨LLM n · ♻캐시 n · ⚙폴백 n`)용. */
export type AiStats = {
  llm: number;
  cache: number;
  fallback: number;
  /** 전 경로 평균 왕복(ms, 반올림). */
  avgMs: number;
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
