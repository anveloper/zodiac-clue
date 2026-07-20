# 20260720 — NPC 대사 LLM(Gemini) + 캐릭터 성격(페르소나)

> load-bearing AI 1단계. **결정(무엇을)은 규칙엔진(진실), 대사·연출(어떻게)은 LLM 경유.**
> 캐릭터 성격을 도감으로 보여주고, 그 성격을 대사 프롬프트에 반영.

---

## feat — NPC 대사 LLM 표현 레이어 (`apps/server`)

- `ai/narrator.ts`: `narrate()`(Gemini) + `fallbackLine()`(규칙). LLM은 **결정된 정보만** 입력받아 사극 대사 한 줄 생성, 진실값 생성 금지(systemInstruction 계약).
- **모델**: `gemini-flash-lite-latest` (저지연 ~1s, 무료 RPM 넉넉). flash 계열은 thinking 모델이라 `thinkingConfig.thinkingBudget:0`으로 끔(안 끄면 생각 토큰이 예산 먹고 빈 응답). 타임아웃 4s + AbortController.
- **폴백**: 키 없음/타임아웃/오류 시 규칙 대사로 대체 → 429·장애에도 게임 안 끊김.
- **키 관리**: `apps/server/.env`(gitignore) + `process.loadEnvFile()`. 커밋 금지. `.env.example` 제공.
- clue-room: NPC 턴에 결정(이동·제안·추리) 후 `speak()`로 대사 브로드캐스트(`say`).

## feat — 절반 딜레이 (`apps/server`)

- 사용자 턴 소요시간을 EMA로 측정 → **NPC 행동 딜레이 = 평균 × 0.5** (클램프 800~6000ms). 데이터 없으면 1600ms.

## feat — 캐릭터 성격(페르소나)

- `shared`: `PERSONA`(12캐릭터 성격) 공용 소스 — 도감 + 프롬프트에 함께 사용.
- **랜딩(방 만들기 루트)에 성격 도감**: 캐릭터에 마우스 올리면/선택하면 성격 표시(`#personaPanel`).
- **프롬프트 반영**: `narrate()`가 성격을 받아 systemInstruction에 "성격이 말투에 드러나야" 명시 → 같은 행동도 캐릭터별로 말투가 달라짐.

## feat — 대사 말풍선 (`apps/client`)

- `say` 수신 시 로그(💬) + 해당 말 위에 **말풍선**(Phaser, 4.2s 후 사라짐).

## 검증

- ✅ 3패키지 타입체크 · 클라 빌드
- ✅ 게임 로그에 실제 Gemini 대사 연속 출력, narrate 오류 0 (모델/thinking 이슈 해결 후)
- ✅ 성격 반영: 같은 행동(뱀 무녀/오랏줄/후원)이 잔나비 광대="재미난 구경거리!" vs 닭 훈장="엄히 다스림이 마땅하도다"로 대비
- 참고: agent-browser screenshot이 세션 중 고장(파일 미생성) → 검증은 로그/eval/직접 curl로 수행

## 추가 — 말투(voice) 강화 (같은 날 후속)

- `shared`: `VOICE`(캐릭터별 `tone`/`intro`/`outro`) + `voice()` 추가. PERSONA(성격 bio)와 별개로 **말투 전용 데이터**.
  - `tone`: LLM 프롬프트에 "이렇게 말하라" 지시(예: "훈계조로 꾸짖듯").
  - `intro`/`outro`: LLM 실패 시 폴백 대사에 붙는 캐릭터 추임새(예: "쯧쯧, "…" 마땅히 그러하렷다.").
- `narrator`: `NarrationInput`에 tone/intro/outro 추가. userText에 말투 명시, 폴백은 `deco()`로 앞뒤 추임새 래핑.
- `clue-room.speak()`: 화자의 `suspect`로 `voice()`를 조회해 자동 주입(콜사이트 3곳 무변경).
- 검증(같은 행동 "뱀 무녀/오랏줄/후원"):
  - 잔나비 광대 폴백 "낄낄, … 이거 아주 볼만하구먼!" / LLM "…찰지게 감길 일을 찾으시는구먼요!"
  - 닭 훈장 폴백 "쯧쯧, … 마땅히 그러하렷다." / LLM "…학문은 어디로 가고 잡기에 눈이 먼 것인가."
  - 양 목동 폴백 "저, 저기… … 아니면 말고요." / LLM "…어찌할까요."
  → **폴백까지 캐릭터색**이 입혀져 무료티어/장애 시에도 페르소나 유지.

## 다음 할 일

- [ ] LLM 호출 캐시/디바운스(동일 상황 반복 대사 절약)
- [ ] 대사 로그를 제출물 ④(AI 기술문서) 소재로 정리
- [ ] 승패 화면/리매치, 음성(STT/TTS)
