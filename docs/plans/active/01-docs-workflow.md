# plan: 문서 체계 도입 (docs/plans + .md/.html 이중화)

status: active · created: 2026-07-20 · ref: docs/design/20260720-engine-and-workflow-plan

## goal
AI(CLAUDE/CODEX) 공용 개발 규칙 확립 + 문서 이원화(.md AI / .html 사람).

## tasks
- [x] docs/plans/{active,done} 구조 + README(규칙)
- [x] CLAUDE.md에 plans 워크플로우 규칙 추가 (active→done, 압축 .md, 이중화)
- [x] AGENTS.md 생성 (CODEX용, CLAUDE.md와 동일 규칙 참조 · single-source)
- [x] 이중화 규칙 명시: docs/plans=.md only, 그 외=.md+.html
- [x] .html 생성 방식 확정: **Claude 수기 디자인**(md→html 빌드 미사용). .md는 토큰 절약형 압축.
- [ ] (추후) 도메인/docs 정적 공개 경로 설계

## done-criteria
- 새 작업이 active/*.md로 시작되고 완료 시 done/으로 이동되는 흐름이 문서로 강제됨
- CLAUDE.md/AGENTS.md가 같은 규칙을 참조
- 규칙 명시: .md=토큰절약 압축(AI), .html=Claude 수기 디자인(사람)
