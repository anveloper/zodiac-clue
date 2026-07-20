# docs/plans — AI 작업 플랜 (AI 전용 · 압축 .md)

이 폴더는 **AI 개발 도구(CLAUDE / CODEX) 전용**이다. 사람용 설명은 별도 `.html`로 둔다.

## 구조
- `active/` : 진행 중 작업. **1 작업 = 1 `.md` 체크리스트**.
- `done/`   : 완료 작업. 완료 시 `git mv active/<x>.md done/`.

## 규칙
- 작업 시작 → `active/`에 플랜 생성. 완료 → `done/`으로 이동.
- 포맷(압축): `goal` / `tasks`(체크박스) / `done-criteria`. 군더더기 없이.
- 여기 문서는 **압축 `.md`만**(AI 전용). **다른 에이전트 참조 시 읽기 토큰을 아끼도록** 밀도 높게.
- 그 외 폴더의 사람용 문서는 `.md`(압축) + `.html` 2중. **`.html`은 Claude가 별도로 "한눈에 보기 좋게" 디자인**(md→html 자동변환 미사용).
- CLAUDE.md / AGENTS.md 는 이 워크플로우를 공통 참조(single-source).
