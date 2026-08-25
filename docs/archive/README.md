# docs/archive — 해커톤(NHN NAN 2026) 시기 문서

2026-08-25 이관. **삭제가 아니라 동결이다.** 여기 문서는 사실이었던 적이 있고, 지금 코드와 어긋난다.

## 왜 남겨 두는가
"왜 이 게임인지"·"왜 이 구조인지"의 근거가 전부 여기 있다. 1년짜리 개발에서 가장 비싼 실수는
**이미 기각한 선택지를 근거 없이 되살리는 것**이다. 아카이브는 그 재발을 막는 장치다.

## 읽을 때 규칙
- 여기 서술된 **현황·상태·마감·수치는 2026-08-10 과제 마감 기준**이다. 현재 상태의 출처가 아니다.
- 현재 상태의 출처는 `README.md`와 `docs/design/20260825-roadmap-1y.md`.
- 특히 **뷰2·3·4(Three.js·픽셀) 서술은 전부 폐기됐다** — 렌더러는 뷰1(Phaser) 하나다.

## 구성
| 경로 | 내용 |
|---|---|
| `submission/` | 심사 제출 5종 중 문서 3종(게임 소개·AI 기술·팀 롤) |
| `planning/` | 상류 리서치 — NHN 공고 분석·장르/매출 분석·엔진 비교·회의록·원페이저 |
| `design/game-intro.*` | 제출 ③ 장문 원본 |
| `design/20260727-improvement-roadmap.*` | 마감 기준 개선 로드맵(자기 결함 목록). 대체 → `design/20260825-roadmap-1y.md` |
| `design/20260727-execution-plan.*` | 마감까지의 일정·컷라인 |
| `design/20260727-view-contract-spec.*` | 렌더러 4종 공유 `ViewContract` 명세. **폐기** — 단일 렌더러로 전환 |
| `design/20260730-view-selector-hide.md` | 뷰 선택기 숨김 결정. 이번 제거의 직접 근거 |
| `design/20260728-video-storyboard.*`, `submission-checklist.md`, `20260728-team-roles.md` | 촬영·제출 실무 |
| `plans/12-view-evolution-stages.md` | 뷰 진화 선택기 — **취소** |
| `plans/18-cameo-helper-npcs.md`, `plans/19-gecko-ui-backlog.md` | 촬영용 카메오 · 팀 브랜치 백로그 |
