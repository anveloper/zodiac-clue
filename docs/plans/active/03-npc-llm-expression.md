# plan: NPC LLM 표현 + 절반 딜레이

status: active · created: 2026-07-20 · ref: docs/design/20260720-engine-and-workflow-plan §1.3

## goal
NPC 결정은 규칙엔진, 대사/연출은 LLM(Gemini) 경유, 딜레이 = 사용자 평균 플레이시간 × 0.5.

## tasks
- [x] 사용자 턴 소요시간 측정(EMA) → npcDelay = avg / 2 (800~6000 클램프)
- [x] 파이프라인: decideTurn(규칙, 진실값) → narrate(LLM, 대사만)
- [x] LLM 입력은 '결정된 정보'만. 진실값 생성/변경 금지(systemInstruction 계약)
- [x] 폴백: 한도(429)/타임아웃/오류 시 규칙기반 정적 대사
- [x] 캐릭터 성격(PERSONA)을 프롬프트에 반영 + 랜딩 성격 도감
- [~] 무료티어 가드: 프레임 호출 0·키 env·thinking off 완료 / **캐시·디바운스 미구현**
- [ ] 대사 로그/검증(제출물 ④ AI 기술문서 소재)

## done-criteria
- NPC가 사람 템포(절반 딜레이)로 움직이며 자연어 대사 출력, 429에도 게임 안 끊김
- 대사가 규칙엔진 결정과 모순되지 않음(표현-진실 분리 검증)
