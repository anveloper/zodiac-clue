/**
 * 렌더러가 받는 표기용 데이터 타입.
 *
 * **원칙 — 여기 있는 것은 전부 서버 진실값에서 파생된 순수 데이터다.**
 *  1. Phaser/DOM 타입이 이 파일에 하나도 등장하지 않는다.
 *  2. **판정이 없다.** 어떤 사실인지는 인자로 들어오고, 진실값은 서버 규칙 엔진만 만든다.
 *
 * 📍 유래: 구 `view-contract.ts`의 `ViewContract`(렌더러 4종이 `implements` 하던 15메서드 계약).
 *    2026-08-25에 뷰2·3(Three.js)·뷰4(픽셀)를 제거하면서 **계약은 死코드가 됐다** —
 *    구현체가 하나뿐인 인터페이스는 추상화가 아니라 우회로다. 계약은 걷어내고 **데이터 타입만 남겼다.**
 *    이 타입들은 여전히 값어치가 있다: `main.ts`가 서버 델타를 여기 형태로 정규화한 뒤
 *    `GameScene`에 넘기므로, **상태 해석과 그리기가 분리된 지점**이 그대로 유지된다.
 *    (원 계약 명세: `docs/archive/design/20260727-view-contract-spec.md` · 제거 근거: 같은 폴더 `20260730-view-selector-hide.md`)
 */

/** 그리드 칸 — 서버가 주는 위치 진실값의 유일한 단위(x,y ∈ 0..23). */
export type ViewCell = { x: number; y: number };

/** 순간이동의 이유. 일반 이동과 반드시 구분돼 보여야 한다. */
export type WarpReason = "summon" | "passage";

/**
 * 방 주목 방식.
 * - `"camera"`: **내 턴이거나 내가 지목당했을 때만** 허용. NPC 6인이 매 턴
 *   제안하므로 무조건 포커스하면 화면이 계속 흔들린다.
 * - `"highlight"`: 그 외 전부.
 */
export type FocusMode = "camera" | "highlight";

/** 칸 주목의 의미. 색이 아니라 **의미**를 넘긴다(렌더러가 자기 팔레트로 번역한다). */
export type PulseTone = "neutral" | "suggest" | "alert";

export type BubbleOpts = {
  /** 귓속말 — 테두리 파선 + "(귓속말)" 접두로 공개 대사와 구분. */
  whisper?: boolean;
};

/** 액터 1명의 현재 상태. 전부 서버 상태에서 그대로 파생된 값이다. */
export type ActorSnapshot = {
  id: string;
  /** 십이지 키. 색·이모지·실루엣이 **전부 이 키에서** 파생된다. */
  suspect: string;
  name: string;
  isBot: boolean;
  cell: ViewCell;
  eliminated: boolean;
};

/** 비밀 통로 연결(방 이름 쌍). 양방향은 호출부가 한 번만 넘긴다. */
export type PassageLink = { from: string; to: string };

/** 판의 종료. `null`이면 진행 중(연출 해제). */
export type ViewOutcome = {
  winnerId: string;
  winnerName: string;
};
