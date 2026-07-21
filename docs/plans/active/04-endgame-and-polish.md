# plan: 엔드게임 · 폴리시 · 제출물 소재

status: active · created: 2026-07-20 · ref: 01/03 이관 항목 + 제출물 요구

## goal
게임 한 판이 승패로 명확히 끝나고(리매치), 무료티어 비용을 더 줄이며, 제출물 ④(AI 기술문서) 소재를 확보.

## tasks
- [x] 승패 화면: 결과 오버레이(승자) + [다시 하기]/[메인으로]. **리매치**=서버 `startGame()` 추출·`rematch` 메시지(위치/상태 리셋, 로비 왕복 없이 재시작), 클라 증거노트 초기화
- [x] 오답 고발 시 탈락 처리 UX — 관전 배너(❌ 탈락·관전) + [메인으로]
- [x] LLM 캐시: (action·suspect·weapon·room·persona·tone) 키 LRU(200) — `narrator.ts`
- [x] 제출물 ④ AI 기술문서 초안 — `docs/design/20260720-ai-tech-doc.{md,html}`
- [ ] 도메인/docs 정적 공개 경로 설계(도메인 구매 후)

## 남은 것
- 리매치(Phaser 재구성) · 도메인 구매 후 정적 공개.

## done-criteria
- 한 판이 승패 오버레이로 끝남 ✅ / 리매치 재시작은 남음
- 동일 상황 반복 시 LLM 재호출 없이 캐시 응답 ✅
- 제출물 ④ "규칙엔진 결정 vs LLM 표현" 문서 존재 ✅
