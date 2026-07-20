# zodiac-clue

웹 멀티플레이 추리 게임. **게임 주제는 가변**이며, 재사용 가능한 **"게임 엔진"**과 교체 가능한 **"게임 콘텐츠(주제)"**를 분리해 개발한다.
배경·목표·로드맵: `docs/design/20260720-engine-and-workflow-plan.md` (사람용 `.html` 동봉).

## 스택
- pnpm 모노레포: `apps/server`(Colyseus/TS) · `apps/client`(Phaser + Vite/TS) · `packages/shared`(공용 타입·데이터)
- 실행: `pnpm dev` (서버 `:2567` + 클라 `:5173`) · 검증: `pnpm -r typecheck`, `pnpm --filter @zodiac-clue/client build`

## 개발 워크플로우 (모든 AI 도구 공통)
- 작업은 **`docs/plans/` 규칙**을 따른다 → 시작 시 `docs/plans/active/<task>.md` 생성, 완료 시 `docs/plans/done/`으로 이동(`git mv`). 상세: `docs/plans/README.md`.
- **문서 이원화**: `docs/plans/*` = AI 전용 **압축 `.md`**. 그 외 문서는 **`.md` + `.html` 2중 작성**(AI는 `.md`, 사람은 `.html`).
- 이 규칙은 **`CLAUDE.md`와 `AGENTS.md`가 동일하게 참조**한다(single-source). 한쪽을 고치면 다른 쪽도 동기화한다.

## 코딩 컨벤션
- TypeScript strict, `any` 금지, `interface`보다 `type` 선호. 파일명 kebab-case.
- **진실값(정답·판정·결정)은 결정론적 규칙 엔진에서만.** LLM은 **표현(대사·연출) 전용** — 진실값을 생성/변경하지 않는다(환각 차단·무료티어 안전).
- 비밀 정보(정답 봉투·손패)는 동기화 상태에 넣지 않고 대상에게만 개별 전송.
- NPC 딜레이 = 사용자 평균 플레이시간의 절반(엔진 규약).

## 커밋
- Conventional Commits. 파일은 기능별로 묶어서 커밋. **AI 협력 문구는 제외.**
