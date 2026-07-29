// 4뷰 공용 **표기 강도** 상수 — 단일 소스 (docs/design/20260727-view-contract-spec.md §1.2·§1.6).
//
// ⚠️ **미분류 층이다.** 이 패키지는 `engine/`(주제 무관)과 `content/clue/`(클루 고유)로 갈라져
// 있는데, 아래 값들은 **어느 쪽인지 판정되지 않았다**:
//   - `ELIM_ALPHA`·`ELIM_NEEDS_SECOND_CUE` — 마피아 설계는 «제거 표기»로 그대로 쓴다고 적었지만
//     (mafia-content-design §4.6) §1.1의 3층 분류표는 이 줄들을 판정하지 않았다.
//   - `RING_CURRENT`(현재 턴 링) — 「현재 턴」이 순차 턴제 전제인지, 발언자 강조로 일반화되는지 미정.
//   - `SPENT_ALPHA`·`SCHEME_DESAT_KEEP` — 대상이 클루의 «계략 NPC»라 콘텐츠에 가깝지만,
//     §1.1은 이 두 줄을 «뷰 타이밍·색 유틸(🟢 엔진)» 범위(166-207) 안에 포함시켜 놓았다.
//     문서의 범위 표기와 값의 의미가 어긋나므로 **판정을 미룬다.**
//   - `TOKEN_OUTLINE_*`·`BUBBLE_*` — 토큰/말풍선 일반 표기로 보이나 근거 문서가 없다.
//
// 잘못 옮긴 파일 하나가 경계를 더 흐리므로, **애매한 것은 옮기지 않고 원래 자리에 남긴다.**
// 판정이 서면 그때 `engine/` 또는 `content/clue/`로 한 번에 옮긴다.
//
// ⚠ 이 파일은 DOM·Phaser·Three 타입을 하나도 참조하지 않는다.

// ── §1.2 표기 강도 (모든 뷰 동일 · 모션 프로파일 무관) ────────
// "정보가 얼마나 죽어 보이는가"는 표현이 아니라 정보다.

/** 탈락(고발 실패) 토큰의 불투명도. 토큰 **전체**(링·원·얼굴·이름표)에 적용한다. */
export const ELIM_ALPHA = 0.35;
/** 이미 사용된 계략 NPC의 불투명도. */
export const SPENT_ALPHA = 0.3;
/** 현재 턴 링 색(금색). */
export const RING_CURRENT = 0xffd479;
/**
 * 탈락 표기는 알파 단독 금지 — 회색조·저대비에서 사라진다.
 * 알파 + (파선 테두리 또는 ✕ 오버레이) 2중 표기가 계약이다.
 */
export const ELIM_NEEDS_SECOND_CUE = true;
/**
 * §4.1 — 모든 토큰 색면은 최소 2px 아웃라인.
 * 팔레트가 밝은 방바닥과 대비 1.0~1.3까지 떨어지는 것을 **설계상 허용**하는 대신,
 * 배경 분리를 아웃라인이 전담한다.
 */
export const TOKEN_OUTLINE_PX = 2;
export const TOKEN_OUTLINE_COLOR = 0xffffff;

/** 계략(미사용 NPC)에 쓰는 채도 유지율 — §4.2 "채도 20%". */
export const SCHEME_DESAT_KEEP = 0.2;

// ── §1.6 말풍선 가독 ────────────────────────────────────────
// 말풍선은 LLM 산출물이 **인월드에서 읽히는 유일한 지점**이다(로드맵 §1.4).
// 잘리거나 배경에 녹으면 «AI를 어떻게 썼는가»의 증거가 화면에서 사라진다.

/** 말풍선 테두리 두께(화면 px). `BOARD.bubbleEdge`와 짝. */
export const BUBBLE_BORDER_PX = 2;
/** 말풍선이 화면 가장자리·HUD에서 떨어져 있어야 하는 최소 여백(화면 px). */
export const BUBBLE_SAFE_PAD_PX = 6;
