# AGENTS.md — zodiac-clue (CODEX / AI 에이전트용)

> 이 저장소의 규칙은 **`CLAUDE.md`와 동일**하다 (single-source). 한쪽을 고치면 다른 쪽도 동기화한다.
> 아래는 그 요약이며, 상세는 `CLAUDE.md`, `docs/plans/README.md`, `docs/design/20260720-engine-and-workflow-plan.md`를 따른다.

> **문맥 (2026-08-25)** — NHN NAN 2026 사전과제 종료. 이제 **1년 목표의 실제 게임 개발**이다.
> 과제 시기 문서는 `docs/archive/`에 동결됐고 **현재 상태의 출처가 아니다**(`docs/archive/README.md`).

## 프로젝트
- 웹 멀티플레이 추리 게임. **주제는 가변** → "게임 엔진"과 "게임 콘텐츠(주제)"를 분리해 개발.
- pnpm 모노레포: `apps/server`(Colyseus) · `apps/client`(Phaser+Vite) · `packages/shared`.
- **렌더러는 Phaser 하나.** Three.js 2.5D·픽셀 뷰는 2026-08-25 제거, **3D는 하지 않는다** — 되살리지 마라.
- 실행 `pnpm dev` · 검증 `pnpm -r typecheck` · 게이트 `pnpm verify`.
- 우선순위: `docs/design/20260825-roadmap-1y.md`.

## 개발 워크플로우
- 작업 시작 → `docs/plans/active/<task>.md` 생성, 완료 → `docs/plans/done/`으로 `git mv`. 상세 `docs/plans/README.md`.
- 문서 이원화:
  - `.md`(AI 전용): 참조 시 **읽기 토큰 절약**을 위해 압축(핵심만 밀도 높게).
  - `.html`(사람용): **Claude가 별도로 보기 좋게 디자인**(md→html 자동변환/빌드 미사용).
  - `docs/plans/*`는 `.md`만. 그 외 = `.md`(압축) + `.html`(디자인) 2중.
  - 사람용 진입점: `docs/index.html`(설계/플랜/로그 대시보드). 문서 추가·상태 변경 시 갱신.

## 코딩 컨벤션
- TypeScript strict, `any` 금지, `type` 선호, 파일명 kebab-case.
- 진실값(정답·판정·결정)은 결정론 규칙 엔진에서만. **LLM은 표현(대사·연출) 전용.**
- 비밀 정보(정답·손패)는 동기화 상태에 넣지 않고 개별 전송. NPC 딜레이 = 사용자 평균×0.5, **상한 1600ms**.

## 커밋
- Conventional Commits, 기능별 커밋, **AI 협력 문구 제외.**

## 아카이브 (docs/archive)
- 과제 시기 동결 문서: 제출물 3종 · 상류 리서치(NHN 공고 분석·아이디어·엔진 비교·회의록) · 마감 로드맵 · 폐기된 4뷰 계약.
- 조회 전용(«무엇을 기각했는지»). 현황·마감·수치를 근거로 삼지 마라. 구성: `docs/archive/README.md`.
