import type { MotionProfile } from "@zodiac-clue/shared";

/**
 * 4뷰 표기 계약 — `docs/design/20260727-view-contract-spec.md` §2.
 *
 * **설계 원칙 — "정보는 강제, 표현은 자유"**
 *  1. 모든 메서드는 **서버 진실값에서 파생된 순수 데이터**만 받는다.
 *     Phaser/Three/DOM 타입이 이 파일에 하나도 등장하지 않는다.
 *  2. 모든 메서드의 반환형은 `void`. 반환형을 두는 순간 호출부가 표현을 알게 되고
 *     4뷰는 "스킨 4개"가 된다 — 진화 서사의 정면 위배.
 *  3. 강제하는 것은 "이 사실을 반드시 화면에 남겨라"뿐. 어떤 오브젝트로 남길지는 뷰의 몫.
 *  4. 뷰5 추가 시 `implements ViewContract` 한 줄이 미구현을 컴파일 타임에 잡는다.
 *
 * ⚠ 이 파일에는 **판정이 없다**. 계약은 서버가 이미 정한 사실을 화면에 남기라고
 *    요구할 뿐이고, 어떤 사실인지는 인자로 들어온다(진실값은 서버 규칙 엔진만).
 *
 * 📍 위치에 대하여: spec은 `packages/shared/src/view-contract.ts`를 지목한다.
 *    이번 작업의 파일 범위가 `apps/client/src/scenes/**`로 한정돼 있어 여기 둔다.
 *    타입이 **엔진 타입을 하나도 참조하지 않으므로**(원칙 1) shared로 옮길 때
 *    import 경로 외에 바뀔 것이 없다.
 *
 * 📍 `ViewLifecycle`(roadmap §9.5)에 대하여: 생명주기 축은 이 계약과 **같은 파일**에
 *    얹히도록 설계돼 있다(execution-plan §7.2 ④). 3개 렌더러를 두 번 고치지 않도록
 *    `dispose()`·`contextCost`를 지금 선점해 둔다. 남은 `mount()`/`tick(dt)`와
 *    `STAGES`의 `load` 슬롯은 `main.ts` 소유라 이 작업 범위 밖이다.
 */

/** 뷰 식별자. 한 인스턴스가 두 뷰를 겸할 수 있다(IsoView = 뷰2·뷰3).
 * `tiles`는 임시 타일셋 실험 뷰(뷰2 슬롯) — 조립형 한옥 타일 비주얼 확인용. */
export type ViewId =
  | "2d-emoji"
  | "three-emoji"
  | "three-asset"
  | "pixel"
  | "tiles";

/** 그리드 칸 — 서버가 주는 위치 진실값의 유일한 단위(x,y ∈ 0..23). */
export type ViewCell = { x: number; y: number };

/** 순간이동의 이유. 일반 이동과 반드시 구분돼 보여야 한다(§5 행 5·8). */
export type WarpReason = "summon" | "passage";

/**
 * 방 주목 방식.
 * - `"camera"`: **내 턴이거나 내가 지목당했을 때만** 허용(§2). NPC 6인이 매 턴
 *   제안하므로 무조건 포커스하면 화면이 계속 흔들린다.
 * - `"highlight"`: 그 외 전부.
 */
export type FocusMode = "camera" | "highlight";

/** 칸 주목의 의미. 색이 아니라 **의미**를 넘긴다(뷰가 자기 팔레트로 번역한다). */
export type PulseTone = "neutral" | "suggest" | "alert";

export type BubbleOpts = {
  /** 귓속말 — 4뷰 모두 테두리 파선 + "(귓속말)" 접두로 공개 대사와 구분(§2). */
  whisper?: boolean;
};

/** 액터 1명의 현재 상태. 전부 서버 상태에서 그대로 파생된 값이다. */
export type ActorSnapshot = {
  id: string;
  /** 십이지 키. 색·이모지·실루엣이 **전부 이 키에서** 파생된다(§4). */
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

/**
 * 표기 계약. 렌더러 3종(`GameScene`·`IsoView`·`PixelScene`)이 `implements` 한다.
 * 미구현 메서드는 `pnpm -r typecheck`에서 컴파일 에러로 노출된다.
 */
export type ViewContract = {
  /** 이 뷰의 식별자. IsoView는 `useAssets`에 따라 두 값 사이를 오간다. */
  readonly viewId: ViewId;

  /**
   * WebGL 컨텍스트 비용(§9.5). 뷰2·3처럼 한 인스턴스가 두 stage를 겸하면
   * 두 stage가 **같은 비용 1을 공유**한다(인스턴스를 쪼개면 컨텍스트가 늘어난다).
   */
  readonly contextCost: number;

  /** 이 뷰의 표시/은닉. 숨길 때 타이머·리스너·루프까지 뷰가 정리할 책임을 진다. */
  setActive(on: boolean): void;

  /** 감속 프로파일. 이후 보간 길이를 `timingOf(p)`에서 재조회한다. */
  setMotion(p: MotionProfile): void;

  /** 액터 1명의 현재 상태를 화면에 반영(없으면 생성). */
  syncActor(a: ActorSnapshot): void;

  /** 퇴장. 말풍선·타이머·보간·GPU 자원까지 정리할 책임은 뷰에 있다. */
  removeActor(id: string): void;

  /** 지금 턴이 누구인지. `null`이면 아무도 아님. */
  setCurrent(id: string | null): void;

  /**
   * 탈락 표기. **알파 단독 금지**(`ELIM_NEEDS_SECOND_CUE`) —
   * 알파 + (파선 테두리 또는 ✕ 오버레이) 2중 표기가 계약이다.
   */
  setElim(id: string, on: boolean): void;

  /** 순간이동(소환·비밀 통로). 일반 이동과 구분돼 보여야 한다. */
  warp(id: string, from: ViewCell, to: ViewCell, reason: WarpReason): void;

  /** 장물 순간이동. `value`는 장물 카드값(장물 6종 구분의 키). */
  lootWarp(value: string, from: ViewCell, to: ViewCell): void;

  /** 사건의 무대. `mode`의 허용 조건은 `FocusMode` 주석 참조. */
  focusRoom(room: string, mode: FocusMode): void;

  /** 특정 칸 주목. */
  pulseCell(cell: ViewCell, tone: PulseTone): void;

  /** 대사. 총 수명은 `bubbleLifeMs()`가 계산한다(서버 `SPEAK_HOLD`와의 정합 지점). */
  bubble(id: string, text: string, opts?: BubbleOpts): void;

  /**
   * 12종·6종 구분 가능성 확보. 뷰가 그 용의자를 **다른 용의자와 구분되게** 그릴
   * 준비를 한다(에셋 프리로드 등). 절차적 표기 뷰에서는 준비할 것이 없을 수 있다.
   */
  identity(suspect: string): void;

  /**
   * "이미 살펴본 방". **서버 상태에 없는 파생 정보**(정답과 무관)이므로 클라 로컬에서
   * 계산한다 — 진실값이 아니다. 뷰는 계산하지 않고 받은 목록을 표기만 한다.
   */
  setSurveyed(rooms: readonly string[]): void;

  /** 비밀 통로(정적 표기). 지금은 버튼 활성 여부로만 존재를 알 수 있다(§5 행 7). */
  setPassages(links: readonly PassageLink[]): void;

  /** 승리·종료. `null`이면 연출 해제(리매치). */
  setOutcome(o: ViewOutcome | null): void;

  /**
   * GPU 자원 해제(roadmap §9.3·§9.5). 뷰를 영구히 버릴 때만 호출한다 —
   * `setActive(false)`는 dispose가 아니다(되돌아올 수 있어야 한다).
   */
  dispose(): void;
};
