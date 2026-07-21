# plan: 엔드게임 · 폴리시 · 제출물 소재

status: done · created: 2026-07-20 · closed: 2026-07-21 · ref: 01/03 이관 항목 + 제출물 요구

## goal
게임 한 판이 승패로 명확히 끝나고(리매치), 무료티어 비용을 더 줄이며, 제출물 ④(AI 기술문서) 소재를 확보.

## tasks
- [x] 승패 화면: 결과 오버레이(승자) + [다시 하기]/[메인으로]. **리매치**=서버 `startGame()` 추출·`rematch` 메시지(위치/상태 리셋, 로비 왕복 없이 재시작), 클라 증거노트 초기화
- [x] 오답 고발 시 탈락 처리 UX — 관전 배너(❌ 탈락·관전) + [메인으로]
- [x] LLM 캐시: (action·suspect·weapon·room·persona·tone) 키 LRU(200) — `narrator.ts`
- [x] 제출물 ④ AI 기술문서 초안 — `docs/design/20260720-ai-tech-doc.{md,html}`
- [x] docs 정적 공개 — 도메인 없이 `vercel.app/docs/` 경로(빌드 시 dist에 복사, SPA rewrite에서 docs 제외). 정식 도메인은 이후 `docs.<도메인>` 선택

## done-criteria
- 한 판이 승패 오버레이로 끝나고 [다시 하기]로 재시작 ✅
- 동일 상황 반복 시 LLM 재호출 없이 캐시 응답 ✅
- 제출물 ④ "규칙엔진 결정 vs LLM 표현" 문서 존재 ✅
