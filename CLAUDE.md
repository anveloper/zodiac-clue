# zodiac-clue

웹 멀티플레이 추리 게임. **게임 주제는 가변**이며, 재사용 가능한 **"게임 엔진"**과 교체 가능한 **"게임 콘텐츠(주제)"**를 분리해 개발한다.
배경·목표: `docs/design/20260720-engine-and-workflow-plan.md` · 우선순위: `docs/design/20260825-roadmap-1y.md` (사람용 `.html` 동봉).

> **문맥 (2026-08-25)** — NHN NAN 2026 사전과제로 시작했으나 과제는 종료됐다. 이 저장소는 이제 **1년 목표의 실제 게임 개발**이다.
> 과제 시기 문서는 `docs/archive/`에 동결 — **현재 상태의 출처가 아니다.** 그 문서들의 «현황·마감·수치»를 근거로 삼지 마라.

## 스택
- pnpm 모노레포: `apps/server`(Colyseus/TS) · `apps/client`(Phaser 2D + Vite/TS) · `packages/shared`(공용 타입·데이터)
- **렌더러는 Phaser 하나다.** Three.js 2.5D·픽셀 뷰는 2026-08-25 제거했고 **3D는 하지 않는다** — 되살리지 마라(근거: `docs/plans/active/20-phaser-only-pivot.md`).
- 실행: `pnpm dev` (서버 `:2567` + 클라 `:5173`) · 검증: `pnpm -r typecheck`, `pnpm --filter @zodiac-clue/client build`

## 개발 워크플로우 (모든 AI 도구 공통)
- 작업은 **`docs/plans/` 규칙**을 따른다 → 시작 시 `docs/plans/active/<task>.md` 생성, 완료 시 `docs/plans/done/`으로 이동(`git mv`). 상세: `docs/plans/README.md`.
- **문서 이원화**:
  - **`.md`(AI 전용)**: 다른 에이전트가 참조할 때 **읽기 토큰을 아끼도록 압축**해 작성 — 핵심만 밀도 높게, 수식·중복 제거.
  - **`.html`(사람용)**: **Claude가 매번 별도로 "한눈에 보기 좋게" 디자인**해 작성. `md→html` 자동 변환/빌드는 쓰지 않는다(기계 변환은 가독성 미달).
  - `docs/plans/*`는 `.md`만(AI 전용). 그 외 문서는 `.md`(압축) + `.html`(디자인) 2중.
  - **사람용 진입점**: `docs/index.html` — 설계/플랜/로그를 한눈에 링크하는 대시보드. 문서 추가·상태 변경 시 갱신한다.
- 이 규칙은 **`CLAUDE.md`와 `AGENTS.md`가 동일하게 참조**한다(single-source). 한쪽을 고치면 다른 쪽도 동기화한다.

## 코딩 컨벤션
- TypeScript strict, `any` 금지, `interface`보다 `type` 선호. 파일명 kebab-case.
- **진실값(정답·판정·결정)은 결정론적 규칙 엔진에서만.** LLM은 **표현(대사·연출) 전용** — 진실값을 생성/변경하지 않는다(환각 차단·무료티어 안전).
- 비밀 정보(정답 봉투·손패)는 동기화 상태에 넣지 않고 대상에게만 개별 전송.
- NPC 딜레이 = 사용자 평균 플레이시간의 **절반, 단 상한 1600ms**(엔진 규약). 상한은 판 길이를 위한 것 — 사람 턴이 3.2초를 넘으면 상한이 지배한다.

## 커밋
- Conventional Commits. 파일은 기능별로 묶어서 커밋. **AI 협력 문구는 제외.**

## 아카이브 (docs/archive)
- 과제 시기 문서 동결분: 제출물 3종, 상류 리서치(NHN 공고 분석·아이디어·엔진 비교·회의록), 마감 로드맵·실행계획, 폐기된 4뷰 계약.
- 용도는 **"왜 이 선택을 했고 무엇을 기각했는지"** 조회 하나뿐 — 이미 기각한 선택지를 근거 없이 되살리지 않기 위함이다.
- 상세 구성·읽는 규칙: `docs/archive/README.md`.
