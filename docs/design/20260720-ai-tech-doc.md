# 제출물 ④ — AI 기술 문서 (zodiac-clue)

> human view: 20260720-ai-tech-doc.html · 초안 2026-07-20

## 핵심 원칙: load-bearing AI = 표현 전용
**"무엇을 하는가(결정·진실값)"는 결정론적 규칙엔진이, "어떻게 보이는가(대사·연출)"는 LLM이 담당.**
LLM은 게임의 정답이나 남의 패를 만들지 않는다 → 환각 차단·무료티어 안전·재현성 확보.

## 2계층 구조
### 1) 결정 계층 — 규칙엔진 (서버, `clue-room.ts`)
- 정답 봉투·카드 분배·이동(그리드/입구/주사위)·제안·시계방향 반증·고발 판정: 전부 결정론.
- **NPC 추리(decideTurn)**: 각 봇의 후보집합(용의자/흉기/장소)에서 자기 손패·자기 제안의 반증·**공유 공개카드(revealed)**를 소거 → 남은 후보로 제안, 확신 시에만 고발.
  - 반증 안 됨 + 자기 미보유 → 그 3장이 봉투(정답) → **정확한 고발**. 봇은 틀린 고발을 하지 않음.
  - 후보가 각 1개로 좁혀지면 고발.
- LLM 장애와 무관하게 게임 진행·판정은 항상 정상.

### 2) 표현 계층 — LLM (Gemini, `ai/narrator.ts`)
- 입력: 규칙엔진이 확정한 **결정된 정보만**(행동·용의자·흉기·장소·성격·말투).
- 출력: 사극풍 대사 **한 문장**. systemInstruction으로 형식·길이·진실값 생성 금지 계약.
- **성격(PERSONA)·말투(VOICE tone)** 주입 → 같은 결정도 캐릭터별로 말투가 달라짐.
- **폴백(fallbackLine)**: 키 없음/타임아웃/429/오류 시 규칙기반 사극 대사. intro/outro로 캐릭터색 유지.

## Gemini 운용 (무료티어 안전)
- 모델 `gemini-flash-lite-latest`(저지연 ~1s). flash 계열은 thinking 모델 → `thinkingConfig.thinkingBudget:0`으로 꺼야 빈 응답 방지.
- `maxOutputTokens:64`, `temperature:0.95`, AbortController **4초 타임아웃**.
- **호출 최소화**: 이벤트당 1콜 + **동일상황 캐시(LRU 200)**로 재사용. 프레임 루프 호출 0.
- 키는 서버 `.env`(gitignore)에만. 클라·로그·커밋에 노출 없음.

## 사람다운 템포
- NPC 행동 딜레이 = **사용자 평균 턴시간의 절반**(EMA 측정, 800~7000ms 클램프).
- 턴 내 **2박자**(방 이동 → 잠깐 쉬고 → 제안)로 사용자가 흐름을 인지.

## 검증 예시 (결정 vs 표현 분리)
- 동일 **결정**: 제안 = 뱀 무녀 / 오랏줄 / 후원
  - 잔나비 광대(익살): "낄낄, 후원서 오랏줄이라니 아주 볼만하구먼!"
  - 닭 훈장(훈계조): "쯧쯧, 오랏줄로 엄히 다스림이 마땅하렷다."
  - → **진실값(제안 내용)은 동일**, 표현만 페르소나별로 달라짐.
- 봇 수렴: 공유 공개카드 도입 후 사람 전멸 뒤 봇만 남아도 유한 시간에 종결(측정 ~40s·제안 13회).

## 재현성·안전 요약
- LLM 실패해도 게임 로직·판정 불변(폴백).
- LLM은 정답/손패를 모름 → 치트·환각 불가.
- 무료티어: thinking off + 캐시 + 타임아웃 + 이벤트당 1콜.

## 주요 프롬프트·지시 (실제)
- **systemInstruction**: "너는 조선 사극풍 추리 보드게임 NPC다. 배경: 호랑이 대감의 생신 잔치에서 누군가 잔치 음식·선물을 훔쳤다. 누가(도둑)·무엇을(훔친 것)·어디서(장소)를 추리한다(살인·흉기 아님). … 오직 대사 한 문장만 출력 … 게임의 정답이나 남의 손패를 아는 척 금지, 주어진 정보만 사용."
- **userText**(결정된 정보만): `NPC: {이름} (성격: {persona}; 말투: {tone}). 행동: 고발 — 도둑 {도둑}, 훔친 것 {장물}, 장소 {장소}.`
- **generationConfig**: `temperature 0.95`, `maxOutputTokens 64`, `thinkingConfig.thinkingBudget 0`. 4초 타임아웃.
- 핵심: 프롬프트에 **정답·손패를 넣지 않음** → LLM은 표현만, 치트 불가.

## 외부 에셋·오픈소스 출처
- **Colyseus 0.15**(MIT) 실시간 서버 · **colyseus.js**(MIT) 클라 네트워크
- **Phaser 3**(MIT) 렌더 · **Vite**(MIT) 빌드 · **TypeScript**(Apache-2.0)
- **Google Gemini API**(`gemini-flash-lite-latest`) — NPC 대사 생성
- **그래픽/아이콘**: 별도 이미지 에셋 없음 — 보드·토큰은 전부 코드(Phaser Graphics) 생성, 아이콘은 **시스템 유니코드 이모지**. 폰트는 시스템 폰트.
- **인프라**: Oracle Cloud(Always Free), Vercel, Caddy+Let's Encrypt, sslip.io

## AI 도구 사용내역 (심사 요건)
- 개발 보조로 **Claude Code**(에이전트) 사용 — 코드 작성·리팩터·문서화. 최종 판단·구조 설계는 사람이 검토.
- 게임 내 AI는 **Gemini(NPC 대사)** 뿐. 결정/판정에는 LLM 미사용.

## 파일 맵
- 결정: `apps/server/src/rooms/clue-room.ts`, `schema/game-state.ts`, `packages/shared`
- 표현: `apps/server/src/ai/narrator.ts`, 성격/말투 `packages/shared/src/cards.ts`(PERSONA/VOICE)
