# plan: NPC LLM 표현 + 절반 딜레이

status: active · created: 2026-07-20 · ref: docs/design/20260720-engine-and-workflow-plan §1.3

## goal
NPC 결정은 규칙엔진, 대사/연출은 LLM(Gemini) 경유, 딜레이 = 사용자 평균 플레이시간 × 0.5.

## tasks
- [ ] 사용자 턴 소요시간 측정(EMA) → npcDelay = avg / 2 (하한/상한 클램프)
- [ ] 파이프라인: decideTurn(규칙, 진실값) → narrate(LLM, 대사/제스처만)
- [ ] LLM 입력은 '결정된 정보'만. 진실값 생성/변경 금지(프롬프트 계약)
- [ ] 폴백: 한도(429)/실패 시 규칙기반 정적 대사
- [ ] 무료티어 가드: 호출 캐시/디바운스, 프레임 호출 0, 키는 서버 env
- [ ] 대사 로그/검증(제출물 ④ AI 기술문서 소재)

## done-criteria
- NPC가 사람 템포(절반 딜레이)로 움직이며 자연어 대사 출력, 429에도 게임 안 끊김
- 대사가 규칙엔진 결정과 모순되지 않음(표현-진실 분리 검증)
