# 마피아 콘텐츠 설계 + 엔진/콘텐츠 경계 실측

> 작성 2026-07-29 · AI 전용 압축본 · 사람용 `.html` 미작성(통합 담당자 몫 · `docs/index.html`·`docs/manifest.json` 등록도 함께)
> 상위: `20260720-engine-and-workflow-plan.md` §1.4 · `docs/plans/hold/02-engine-content-separation.md`(보류 중) · `20260727-view-contract-spec.md` · `20260720-ai-tech-doc.md` §8
> 목적: 두 번째 주제(마피아)를 얹어 「엔진과 콘텐츠가 분리돼 있다」는 저장소의 주장을 **실증 또는 반증**한다.

## 0. 결론 먼저

**분리는 성립하지 않는다.** `hold/02`가 «GameDefinition 도입, 클루를 구현체로 이관»을 과제로 남긴 채 보류돼 있고, 그 이후 7일간의 개발(4뷰 계약·시드 RNG·재접속·관전·AI 계측)은 **엔진 품질을 올렸지만 경계는 긋지 않았다.** 실측 결과:

| 층 | 실태 |
|---|---|
| **진짜 엔진** (주제 무관·즉시 재사용) | 타이머 프리미티브 · 재접속/대리 NPC/관전 · 시드 해시 RNG · AI 계측·폴백 골격 · 좌표 없는 뷰 크롬 · 오버레이 버스 · 랜딩/로비/초대/재접속 셸 |
| **콘텐츠** (교체 대상 · 정상) | `cards.ts` 12지 팩 · 보드 데이터 · 제안–반증–고발 규칙 · 정답 봉투 |
| 🔴 **오염** (엔진 자리에 클루가 박힘) | **11건** — 아래 §1.2 |

가장 심각한 3건: ① **동기화 스키마 전체가 클루 전용**이고 주제별 스키마라는 개념이 없다 ② **LLM 표현 계층과 환각 검증기가 3카테고리에 결속**돼 있어 새 주제는 이 저장소의 «검증 없는 기능은 넣지 않는다» 규칙에 걸린다 ③ **`ViewContract`가 좌표 없는 액터를 표현할 수 없고**, 그마저 렌더러 3곳이 우회한다.

마피아를 얹었을 때 가장 크게 부러지는 것은 **승패 판정이 `advanceTurn()` 한복판에 인라인돼 있다는 것**(`clue-room.ts:2022-2050`)이다. 「보드가 없다」는 표면적 문제일 뿐 렌더러를 새로 짜면 되지만, 이건 엔진 코어 함수가 콘텐츠 판정을 겸하고 있는 것이라 훅으로 뺄 자리 자체가 없다.

---

## 1. 경계 실측

### 1.1 3층 분류

| 계층 | 위치 | 판정 |
|---|---|---|
| 타이머 `armTimer/cancelTimer/cancelAllTimers` | `clue-room.ts:309-337` | 🟢 엔진. 키·지속·만료콜백만 받는다. 클루 지식 0 |
| 재접속·대리 NPC·좌석 반환 | `clue-room.ts:622-747` | 🟡 골격은 엔진, `restoreSeat`이 `sendHand`/`sendSuggestLog`/`sendSolutionTo`를 직접 호출(734-741)해 콘텐츠에 결속 |
| 관전자 모델 | `clue-room.ts:196,526-545,582-607` | 🟢 엔진. 「좌석을 만들지 않는다」는 구조적 결정이라 주제 무관 |
| 공개방 목록 메타 `syncMeta` | `clue-room.ts:381-399` | 🟢 엔진(담기는 값이 인원·phase뿐) |
| 시드 해시 RNG | `rules/rng.ts` 전체 | 🟢 엔진. 「결정 좌표」 모델은 주제 무관. **최고 재사용 자산** |
| 좌석별 시야 `seenNotSolution` | `clue-room.ts:175,341-366` | 🟢 개념은 엔진(정보 대칭성), 값이 카드값이라 타입만 콘텐츠 |
| AI 계측·폴백·정규화 | `ai/telemetry.ts` · `narrator.ts:269-331,435-544` | 🟢 엔진 |
| LLM 프롬프트·입력 계약·폴백 문안 | `narrator.ts:13-33,84-103,129-171,358-368` | 🔴 클루 전용(§1.2-8) |
| 동기화 스키마 | `schema/game-state.ts` 전체 | 🔴 클루 전용(§1.2-2) |
| 프로토콜 타입 | `shared/src/types.ts:115-171` | 🔴 클루 전용(§1.2-4) |
| 보드 데이터·이동 규칙 | `shared/src/index.ts:6-133` | 🟠 콘텐츠인데 **패키지 배럴 루트**에 있다(§1.2-3) |
| 12지 팩 | `shared/src/cards.ts` | 🟠 정상 콘텐츠. 단 `zodiacColor()` 등 함수명이 주제에 묶여 렌더러 3곳이 직접 호출 |
| 뷰 타이밍·색 유틸 | `view-consts.ts:50-160,166-207` | 🟢 엔진 |
| 뷰 좌표계·보드 팔레트·통로/앵커 상수 | `view-consts.ts:11-23,215-242,244-280,291-329` | 🔴 같은 파일에 섞임(§1.2-5) |
| 4뷰 계약 | `scenes/view-contract.ts` | 🔴 16메서드 중 7개 + 필수 필드 2개가 클루 어휘(§1.2-6) |
| 뷰 크롬(HUD 인셋·모션·타자기·three 자원) | `hud-inset.ts`(shared import 0) · `view-motion.ts` · `typewriter.ts` · `three-res.ts` | 🟢 엔진. 좌표 없이 그대로 산다 |
| 클라 셸 | `main.ts` 2727줄 | 🔴 §1.2-7 |
| 밸런스 시뮬 · 환각 eval | `scripts/sim-balance.mjs` · `scripts/eval-narrator.mjs` | 🔴 §1.2-9 |

### 1.2 🔴 오염 지점 11건 (파일:줄 · 「무엇을 가정하는가」)

**① 룸 클래스가 엔진+콘텐츠 융합** — `apps/server/src/rooms/clue-room.ts` 전체(2076줄, 단일 클래스)
`solution`(159) `hands`(160) `botKnowledge`(161) `suspectPool`(168) `suggestedIn`(185) `suggestLog`(213) `failedAccusations`(227) 같은 **클루 상태**와 `timers`(257) `spectators`(196) `ai`(204) `avgHumanTurnMs`(259) 같은 **엔진 상태**가 같은 private 스코프에 있다. 추출 경계선이 코드에 존재하지 않는다. `index.ts:51` `gameServer.define("clue", ClueRoom)` — 룸 타입 1개 하드코딩.

**② 동기화 스키마 전체가 클루 전용** — `apps/server/src/schema/game-state.ts`
`Player.x/y`(8,9) `Player.room`(20) `Player.suspect`(7) / `GameState.stepsLeft`(52) `commonCards`(62) `weapons`(64) `helpers`(66). 가정: **모든 플레이어는 격자 좌표를 갖고, 판에는 주사위와 장물 토큰이 있다.** Colyseus는 스키마 클래스 정의가 곧 와이어 포맷이므로 «주제별 스키마»가 필요한데 `GameState` 한 벌뿐이고 상속 계층도 없다. `phase`(43)는 `lobby|playing|ended` **판 생명주기**인데, 마피아의 밤/낮은 **라운드 페이즈**라 축이 다르다 — 같은 필드에 얹으면 두 축이 충돌한다.

**③ shared 배럴이 클루 보드다** — `packages/shared/src/index.ts`
`MAX_PLAYERS=6`(6) `GRID_WIDTH/HEIGHT=24`(9,10) `ROOM_REGIONS`(26-36) `doorSideOf`(47) `FEAST`(67) `roomAt`(77) `PASSAGES`(85) `canCross`(115). 패키지 루트가 `export * from "./cards"`(1)로 시작하므로 **`@zodiac-clue/shared`를 import하는 순간 클루 보드가 딸려온다** — 클라·서버·스크립트 전부. 마피아 콘텐츠가 들어갈 자리가 이 패키지에 없다.

**④ 프로토콜 = 클루 규칙** — `packages/shared/src/types.ts:115-171`
`ClientMessages`에 `move{dx,dy}`(119) `suggest/accuse: Suggestion`(120,121) `passage`(124) `useBonus`(128). `ServerMessages`에 `hand`(134) `disprove`(136) `peek`(162) `canAccuse`(168). `MessageType`(171)이 두 union의 합집합이므로, 마피아 메시지를 추가하면 **모든 주제의 메시지가 하나의 타입에 합쳐진다.** 같은 파일 24-92행의 `AiSource`/`SayAi`/`AiStats`는 진짜 엔진 타입인데 같은 파일에 섞여 있다.

**⑤ 뷰 상수 파일이 두 계층을 겸함** — `packages/shared/src/view-consts.ts`
파일 헤더(8-9)가 「DOM·Phaser·Three 타입을 하나도 참조하지 않는다」며 중립성을 선언하지만, 주석 12행이 **`x,y ∈ 0..23`을 좌표계 전제**로 못박고 `INIT_MIN_CELLS`(307)의 근거는 «방 3열이 x 1‑5·9‑14·18‑22»라는 **보드 레이아웃 실측치**다. `BOARD` 팔레트(244-280)의 키가 `feast/doorTile/plaque/helperDisc/loot`. `PASSAGE_ALPHA_*`(215-221) `SUMMON_ANCHOR_*`(236,242) `fitZoom`(313) `INIT_MIN_CELLS_PERSPECTIVE`(329)도 클루 보드 전용. 반면 `ViewTiming`(52-96) `bubbleLifeMs`(144) `expK`(159) `shade/desaturate`(182,196)는 순수 엔진.

**⑥ 4뷰 계약이 좌표 없는 액터를 표현하지 못한다** — `apps/client/src/scenes/view-contract.ts`
`ActorSnapshot.cell: ViewCell` **필수**(60), `ActorSnapshot.suspect` **필수**(57 — 액터 정체성 키의 이름 자체가 클루 개념). 16개 멤버 중 `warp`(109) `lootWarp`(112) `focusRoom`(115) `pulseCell`(118) `setSurveyed`(133) `setPassages`(136) `ViewCell`(32) `WarpReason`(35) — **8개가 클루 보드 어휘**. 「뷰5를 추가해도 표기가 갈라지지 않게」(spec §0)라는 명시적 추상화가 **주제 축은 전혀 고려하지 않았다.**
게다가 **계약을 우회하는 경로가 3개** 있다: `state.weapons`/`state.helpers`를 렌더러가 각자 구조적 캐스트로 직독한다 — `game-scene.ts:724-727,761-765` · `iso-view.ts:1138-1146` · `pixel-scene.ts:722-727`. 스키마 shape가 세 파일에 손으로 복제돼 있다.

**⑦ 클라 셸이 3카테고리·턴제·보드를 동시에 가정** — `apps/client/src/main.ts`
`Pick`(479) `CardTriple`(794) `SuggestEntry`(344)가 `suspect/weapon/room`을 **명명 필드**로 갖는다(N카테고리도, 0카테고리도 표현 불가). `buildEvidence`의 카테고리 리터럴(2048-2052). `ActionId`(1769)가 5액션 닫힌 union. `LogKind`(152)가 `move|suggest|disprove|accuse`. `updateActionButtons`(1804-1888)가 **서버 규칙을 클라에서 재구현**(`!me?.room` 1818 / `passageOf` 1834 / 헬퍼 체비셰프 인접 1856-1864). `wireRoom`(977-1166)이 11개 메시지를 리터럴로 하드 등록(라우터·레지스트리 없음). 결정타: **`enterGame()`(2168)이 Phaser 부팅 실패 시 하드 리턴**(2183-2196) → 보드 없는 주제는 셸 자체를 못 켠다.
`network.ts:9,36`에 `"clue"` 리터럴(룸 타입 파라미터 없음). `index.html:953-965`에 `#gameSelect data-game="zodiac-clue"` 확장 슬롯이 **마크업으로만** 있고 `main.ts`가 한 번도 읽지 않는다 — 의도만 기록된 죽은 훅.

**⑧ LLM 표현 계층이 클루 세계관을 하드코딩** — `apps/server/src/ai/narrator.ts`
`SYSTEM`(84-103): 「조선 사극풍 추리 보드게임 NPC」 「호랑이 대감의 생신 잔치」 「누가·무엇을·어디서를 추리한다」. `NarrationInput`(13-33)의 필수 필드가 `suspect/weapon/room` 3개 + `action: "suggest"|"accuse"|"scheme"`(16). `fallbackLine`(129-171) 전체가 클루 문안. `cacheKey`(358-368)가 3요소 조합. **표현 계층이 주제와 1:1로 묶여 있다** — 「LLM은 표현 전용」이라는 규약이 「표현 계층은 재사용 가능」을 뜻하지 않는다는 것이 여기서 드러난다.

**⑨ 검증 계층이 3카테고리에 결속 — 가장 조용하고 치명적**
- `scripts/eval-narrator.mjs:129-133`: `CAT = {suspect, weapon, room}` 라벨 사전. C4(진실값 치환 없음)·C5·C6가 전부 이 사전 위에서 정의된다(`ai-tech-doc` §3). **마피아 대사는 현 검사기로 판정할 수 없다** → `ai-tech-doc` §8.1-2 「검증할 수 없는 기능은 넣지 않는다」에 스스로 걸린다.
- `scripts/sim-balance.mjs:34-46,104-117`: **규칙 엔진의 4번째 복제본**. 헤더 주석이 「이식 원본: clue-room.ts의 규칙부」라고 자인한다. `gate-sim-regression`이 이 미러를 CI 기준선으로 쓰므로 **서버 규칙을 옮기면 게이트가 리팩터를 검증하지 못한다**(미러는 반응하지 않는다).

**⑩ 봇 결정 모델이 3집합 소거 고정**
`BotKnowledge`(clue-room.ts:56-60) = `{suspects,weapons,rooms}` Set 3개. `bot-accuse.ts`는 「순수 규칙 함수」로 훌륭히 분리돼 있으나 시그니처가 `suspects/weapons/rooms`(42-44)라 클루 전용. NPC **스케줄링**(`npcDelay` 1924 · `scheduleBotIfNeeded` 2001)은 엔진, **결정**(`runBotTurn` 1594 · `botSuggestPhase` 1663 · `afterBotSpeak` 1725)은 콘텐츠인데 둘이 같은 클래스에서 서로를 직접 호출한다.

**⑪ NPC 딜레이 규약 자체가 클루 턴 페이싱에서 유도됨**
`CLAUDE.md`가 규약으로 못박은 「평균의 절반, 상한 1600ms」는 `npcDelay()`(1924-1946)에서 `NPC_ROUND_BUDGET_MS(12000) / 남은 봇 수`라는 **순차 턴 전제**의 라운드 예산과 곱해진다. `LINE_BUDGET_SUGGEST=25`(narrator.ts:61)의 역산 근거(56-58행 주석)도 「봇 1턴 = npcDelay + BOT_ACT_GAP + bubbleLifeMs ≤ 4000」이라는 **턴제 예산식**이다. 즉 **대사 길이 상한마저 클루의 턴 페이싱에서 나왔다.**

---

## 2. 마피아를 얹으면 무엇이 부러지는가

### 2.1 개인 턴제 → 전원 동시 페이즈 · **부러진다 (부분)**

「지금 행동할 수 있는 사람은 정확히 1명」이 **서버 입력 게이트 6곳에 같은 문장으로 박혀 있다**: `handlePassage:406` · `handleUseBonus:434` · `handleMove:782` · `handleSuggest:1461` · `handleAccuse:1580` · `handleEndTurn:1589` — 전부 `this.state.currentTurn !== client.sessionId`. `state.currentTurn`은 단일 sessionId(`game-state.ts:47`)다. 마피아 낮 투표는 N명이 동시에 보낸다.

- 우회로 A(`currentTurn=""` + 새 핸들러)는 **두 번째 권한 체계**를 만드는 것 = 규약 위반 소지.
- 정공법: 「행동 자격 **집합**」 술어 도입. 클루는 `actorSet = {currentTurn}`인 특수 케이스로 재해석된다 → 게이트 6곳이 술어 하나로 통일된다. §3-⑥의 부산물.
- 클라 쪽도 6곳이 단일 `currentTurn`을 읽는다: `updateTurnInfo:1896` · `renderTurnStrip:1623` · `openTurnCircle:1655` · `updateActionButtons:1807` · `showDiceRoll:1462` · `applyFx:1387`.
- 봇 스케줄: `scheduleBotIfNeeded:2001-2008`이 「현재 턴이 봇이면 타이머 1개」. 마피아 낮엔 봇 5명이 **동시에** 투표해야 한다 → 좌석당 타이머 N개 + `npcDelay`의 라운드 예산(1940)이 의미를 잃는다(§1.2-⑪).

**부러지지 않는 부분**: 타이머 프리미티브(`armTimer` 309)와 마감 시각 공개 모델(`turnEndsAt` `game-state.ts:54-60` — 주석이 이미 「공개 정보다」라고 논증)은 페이즈 타이머에 **그대로 쓰인다.** 클라도 이미 서버가 준 `ms`를 표시만 하고 만료 판정을 하지 않는다(`openAccuseWindow` main.ts:1744) — 페이즈 타이머에 필요한 정확한 계약이다.

### 2.2 「일부에게만 공유되는 비밀」 · **부러지지 않는다** (예상 밖의 좋은 소식)

현 비밀 등급은 두 가지처럼 보인다: **{전원 비공개}** = 정답 봉투(`sendSolutionTo:1374-1375`가 `phase !== "ended"`로 차단, 「누설 방지 불변식」 주석 1362-1364), **{1인 전용}** = 손패(`sendHand:615-620`)·반증 카드(`handleSuggest:1495-1499`).

그런데 **3번째 등급의 실증 구현이 이미 있다**: `helperWhisper()`(494-524) — 당사자에게는 전문(`client.send` 516), 나머지에게는 마스킹본(`broadcast` + `{except: client}` 519-523). 이것이 **마피아 밤 채팅의 정확한 원형**이다. 이 저장소가 Colyseus의 `@filter` 스키마를 쓰지 않고 **전부 개별 `client.send`로 처리**한 것이 여기서 이득으로 돌아온다 — 「팀 전원에게만」은 대상 목록을 돌면 그만이다.

**진짜 부러지는 곳은 복구 경로다.** `restoreSeat()`(712-747)이 재전송하는 목록이 하드코딩돼 있다: `sendHand`(734) `sendSuggestLog`(737) `aiStats`(738) `sendSolutionTo`(741). 마피아는 「내 역할 + 내가 아는 동료 + 지난 밤 결과」를 되돌려야 하는데 넣을 훅이 없다. **좌석 상태 복원이 콘텐츠 지식이라는 사실**이 여기서 드러난다 — `onSeatRestored(client)` 추상 메서드가 필요하다.

### 2.3 제거 · **클루의 탈락과 다르다**

| | 클루 `eliminated` | 마피아 제거 |
|---|---|---|
| 트리거 | 오답 고발(`doAccusation:1561`) | 밤 지목 / 낮 투표 |
| 잃는 것 | 이동·제안·고발 | **전부** |
| 유지하는 것 | **반증** — `doSuggestion`의 반증 순회(1270-1284)가 `turnOrder` 전체를 돌며 **`eliminated`를 필터하지 않는다.** 로그 문안도 「탈락 · 반증만 가능」(1570) | 없음 |
| 겸직 의미 | **보드 위 유령이 아님** — `handleMove:799`의 충돌 검사가 `!p.eliminated`로 제외한다 | 해당 없음 |
| 승패 관여 | 간접(생존자 1명 = 최후 생존 승리) | **직접 입력**(생존 밤손님 수 vs 생존 시민 수) |

즉 클루의 탈락은 **「행동권 박탈 + 정보원 유지」**, 마피아의 제거는 **「완전 퇴장 + 승패 카운터」**다. 같은 boolean에 얹을 수 없다.

**가장 심각한 파손 지점**: `advanceTurn()`(2010-2062) 안에 **승패 판정이 인라인**돼 있다.
```
order.length === 1  →  phase="ended", winner=order[0], endReason="survivor"   (2022-2050)
```
마피아에서 2명 남은 상태는 「밤손님1 + 시민1 = 밤손님 승」이고 1명 남는 상황은 애초에 도달하지 않는다. 이건 **엔진 코어 함수(턴 순환)가 콘텐츠 판정(승리 조건)을 겸하고 있는 것**이라 훅으로 뺄 자리가 없다 — 함수를 쪼개야 한다. 종료 3경로(`doAccusation:1538-1559` · `endInDraw:1435` · `advanceTurn:2022`)가 각자 `phase/winner/endReason/cancelAllTimers/setListed/syncMeta/logAiSummary/revealSolution` 8단계를 **복붙**하고 있는 것도 같은 문제의 증상이다.

### 2.4 보드 없는 게임을 4뷰가 그릴 수 있는가 · **없다. 새로 짜야 한다**

- `ActorSnapshot.cell` 필수(`view-contract.ts:60`) → 좌표 없는 액터는 **타입 수준에서 표현 불가**.
- `drawBoard`/`buildBoard` ≈500줄이 순수 클루: `game-scene.ts:548-701` · `iso-view.ts:589-765` · `pixel-scene.ts:220-367`. 전부 `ROOM_REGIONS`/`GRID_*`/`FEAST` 직결. (`FEAST` 사각형은 뷰1·뷰4에서 상수 대신 리터럴 `9,9,6,6`으로 인라인돼 있다 — `game-scene.ts:560-563` · `pixel-scene.ts:228-231`.)
- **뷰4는 카메라가 없다.** 뷰1의 Phaser 카메라를 매 프레임 미러링한다(`pixel-scene.ts:710-719`) → 뷰1을 띄우지 않으면 뷰4가 돌지 않는다. **「4뷰 진화 서사」 자체가 보드에 의존**한다.

**좌표 없이 그대로 사는 것**(실측):
`hud-inset.ts` 전체(import 0) · `view-motion.ts` · `typewriter.ts` · `three-res.ts` · 계약의 무좌표 8멤버(`setActive/setMotion/setCurrent/setElim/bubble/identity/setOutcome/dispose`)와 그 구현부(`game-scene.ts:878-910` · `iso-view.ts:898-928` · `pixel-scene.ts:946-967`) · 오버레이 버스(`main.ts:1133-1235`) · `showBanner`(1237) · `setAction`/`blockedBy`(1770-1790) · AI 칩 파이프라인(93-337) · 랜딩/로비/초대/재접속(2516-2725) · 뷰 전환 기계(775-781, 2221-2293).

### 2.5 그 외

| 항목 | 실태 | 마피아 |
|---|---|---|
| 인원 | `MAX_PLAYERS=6`(shared/index.ts:6) → `maxClients`(clue-room.ts:156) · `spawnPoint`(2065)가 6점 배열 · 색 12종(cards.ts:40) | 6인 가능하나 표준은 7~12. 상수 1개 + 스폰 배열이 상한을 진다 |
| 봇 딜레이 | 상한 1600ms(§1.2-⑪) | 낮 토론 60초에 봇 6명이 1.6초 간격이면 10초에 소진. **규약이 페이즈형과 충돌** |
| 대사 길이 | 상한 40자·제안 25자(narrator.ts:43,61) — 턴 예산 역산 | 마피아 발언은 주장·근거라 25자로 안 된다. 예산식을 페이즈 길이에서 재유도해야 함 |
| 재현성 | 시드 해시 RNG로 판 전체 재생 가능(rng.ts:107-129) | **그대로 성립**. 밤 지목·투표를 `seededUnit(seed, seat, round, tag)` 좌표로 두면 된다 |

---

## 3. 최소 변경 제안 (비용 순)

> 규모는 **추정치**다. 실측 근거가 있는 것만 표시했다.

### L0 — 거의 공짜, 클루 동작 무영향

| # | 무엇 | 규모 | 클루 무영향 근거 |
|---|---|---|---|
| ① | 룸 타입 파라미터화. `network.ts:9,36`의 `"clue"`를 인자로, `index.ts:51`에 `define` 추가 | ~20줄 | 기본값 `"clue"` 유지 → 호출부 6곳(main.ts 랜딩·로비 경로)의 동작 동일 |
| ② | `#gameSelect`(index.html:953-965) 배선 | ~30줄 | 마크업이 이미 존재. 읽기만 추가 |
| ③ | shared 재배치: `engine/`(ViewTiming·색 유틸·`AiSource`/`SayAi`/`AiStats`) ↔ `content/clue/`(cards·board·Suggestion·메시지). **루트 배럴에서 전부 재수출 유지** | 파일 이동 위주, 추정 0.5~1일 | 재수출을 유지하면 **import 경로 변경 0** → 컴파일 결과 동일. `pnpm -r typecheck` 통과가 곧 증명 |

### L1 — 중간, 클루 런타임 경로 불변

| # | 무엇 | 규모 | 근거 |
|---|---|---|---|
| ④ | `ActorSnapshot.cell`을 `cell?: ViewCell`로 완화 + 계약을 `packages/shared`로 이동 | 3파일 각 1~2곳 가드 | **타입만 완화**. 클루는 항상 cell을 채워 보내므로 런타임 경로 불변. 이동은 spec §2가 이미 지시했고 문서가 「import 경로 외 바뀔 것 없음」이라 자인(view-contract-spec.md:96) |
| ⑤ | `weapons`/`helpers` 직독 3곳을 계약 메서드로 승격 | **코드가 줄어든다**(세 벌 중복 제거) | 같은 값을 다른 경로로 전달. `game-scene.ts:724` · `iso-view.ts:1138` · `pixel-scene.ts:722`의 구조적 캐스트 3벌이 1벌로 |
| ⑥ | 서버 `BaseGameRoom` 추출: 타이머(309-337) · 재접속/대리/관전(196,526-545,582-607,622-747) · `syncMeta`(381) · AI 계측(1866-1906) · 좌석별 시야(341-366). **콘텐츠 훅 3개**(`onSeatRestored` / `onGameEnd` / `canAct(client)`)를 추상 메서드로 | 서버 ~600줄 이동, 클루 룸 ~1400줄 잔존 | ⚠️ **검증 공백**: `pnpm verify`의 sim-regression 게이트는 `sim-balance.mjs` **미러**를 돌리므로 서버 리팩터에 **반응하지 않는다**(§1.2-⑨). 안전망은 typecheck + 수동 플레이뿐. 이 사실을 리팩터 전에 명시할 것 |
| ⑦ | 종료 3경로(1538-1559 / 1435-1456 / 2022-2050)의 8단계 복붙을 `endGame(reason, winnerId)` 하나로 | ~60줄 감소 | 세 경로가 이미 동일 순서로 같은 8단계를 수행한다(실측). 순서를 보존하면 동작 동일 |

### L2 — 큼 · 리스크 있음

| # | 무엇 | 규모 | 판단 |
|---|---|---|---|
| ⑧ | `NarrationInput` 개방: `{suspect,weapon,room}` → `facts: Record<string,string>` + 주제별 라벨 사전 + `SYSTEM` 주입 | narrator ~120줄, eval ~80줄 | **가능하다.** 근거: C4가 「A의 라벨 최소 1개 포함 + A에 없는 **같은 카테고리** 라벨 0개」로 정의돼 있어(ai-tech-doc §3 C4 · eval-narrator.mjs:129-133), **카테고리 사전만 주제별로 갈아끼우면 검사식은 그대로 성립**한다. 이게 이 리팩터의 핵심 정당화 |
| ⑨ | 스키마 분리: `BaseGameState`(phase/host/turnOrder/players 최소집합) + 주제별 서브클래스 | 추정 2~3일 | ⚠️ **실현 가능성 중.** Colyseus 스키마 상속의 와이어 호환성(필드 순서·타입 id)을 **이 저장소에서 검증한 적이 없다**(미확인). 스키마 diff가 재접속 토큰·관전 경로를 지나므로 「클루 무영향」을 정적으로 보장하기 어렵다. **실험 브랜치로 먼저 확인할 것** |
| ⑩ | 마피아 룸·스키마·규칙·봇 정책·뷰 신규 작성 | — | 리팩터가 아니라 신규 |

### 실현 가능성이 낮다고 판단한 것 (그대로 적는다)

- **`main.ts` 2727줄을 주제 중립 셸로 리팩터** — 모듈 경계가 하나도 없고 15개 암묵 모듈이 전역 가변 상태(`room`,`myCards`,`endInfo`,`sugEntries`,`aiCount`,`surveyedRooms`,`accuseDeadline`…)로 얽혀 있다. **「분해」보다 「마피아 전용 엔트리를 새로 짜고 공용 조각만 모듈로 추출」이 싸다**고 본다(추정, 실측 근거 없음).
- **4뷰를 마피아에 재사용** — 재사용분은 크롬뿐. 뷰 진화 서사(뷰1→뷰4)는 마피아에서 **다른 축**(예: 텍스트 로그 → 원탁 2D → 원탁 3D 조명 → 도트)으로 다시 설계해야 한다. 이식 불가.
- **`sim-balance.mjs` 미러를 실코드 공유로 전환** — 미러가 `gate.baseline.json`의 근거이므로 공유로 바꾸면 기준선이 무효화된다. 마피아용은 **두 번째 미러**를 짜는 것이 현실적이다. 같은 결함을 복제하는 것이지만, 비용상 그렇다. **나쁜 소식으로 기록한다.**

---

## 4. 마피아 콘텐츠 설계

### 4.1 세계관 — 십이지 유지

**이어간다.** 근거: `cards.ts`의 12캐릭터·CIEDE2000 검증 12색(view-contract-spec §4.1: 색각 2형/1형에서 충돌 0쌍)·페르소나·보이스·직업 용어가 이미 있다. 이것을 재사용하는 것은 **콘텐츠 재사용이 아니라 캐릭터 팩 재사용**이라 경계 실험을 오염시키지 않는다 — 오히려 「캐릭터 팩은 주제와 독립인가」라는 **별도 명제를 검증**한다. 재사용 불가한 것은 `BOT_NERVE`(cards.ts:277)뿐이다(「고발을 지를 배짱」이라는 클루 전용 의미).

**무대**: 「호랑이 대감댁 **삼경(三更)**」 — 잔치가 끝난 이튿날 밤. 대감집에 도둑이 아니라 **밤손님**이 들었다. 밤마다 손님 하나가 사라진다.

| 역할(내부 id) | 사극 라벨 | 진영 | 능력 |
|---|---|---|---|
| `mafia` | 밤손님(夜客) | 밤손님 | 밤에 한 명 지목 · 서로를 안다 |
| `doctor` | 의원 | 집안 | 밤에 한 명 보호(자기 포함 1회 제한) |
| `cop` | 포교 | 집안 | 밤에 한 명 조사 → 진영만 확인 (`dog`가 이미 「포교」라 배역이 자연스럽다) |
| `citizen` | 집안사람 | 집안 | 없음 |

| 좌석 | 밤손님 | 의원 | 포교 | 집안사람 |
|---|---|---|---|---|
| 6 | 2 | 1 | 1 | 2 |
| 7 | 2 | 1 | 1 | 3 |
| 8 | 2 | 1 | 1 | 4 |

승리: 밤손님 = 생존 밤손님 ≥ 생존 집안. 집안 = 생존 밤손님 0. (밸런스 수치는 **전부 추정** — 시뮬레이션 미실시.)

### 4.2 페이즈 구조

`armTimer`(clue-room.ts:309) + `turnEndsAt`(game-state.ts:60)를 **그대로** 쓴다. `phase`(판 생명주기)와 **별도로** `roundPhase`를 신설한다(§1.2-② 참조).

| roundPhase | 길이 | 행동 자격 | 동시성 | 비밀 등급 |
|---|---|---|---|---|
| `night` | 30s | 밤손님(합의 지목) · 의원(보호) · 포교(조사) | 동시 | 팀 / 개인 |
| `dawn` | 6s | 없음(결과 연출) | — | 공개 |
| `talk` | 60s (사람 수로 가변) | 생존자 전원 | 동시 | 공개 |
| `vote` | 30s | 생존자 전원 | 동시 | 개인 → 집계만 공개 |
| `dusk` | 6s | 없음 | — | 공개 |

- **행동 자격 집합**: 서버 게이트를 `canAct(client, phase)` 술어 하나로. 클루는 `actorSet={currentTurn}`인 특수 케이스(§2.1).
- **AFK 백스톱**: 페이즈 만료 시 미행동 좌석의 선택을 규칙 함수가 시드로 대신 고른다 — 기존 `armTurnClock`(1977)의 논리를 그대로 이식.
- **재현성**: 모든 무작위는 `seededUnit(seed, seat, round, tag)`. 판 재생이 클루와 동일하게 성립한다.

### 4.3 비밀 전송 계약

| 정보 | 등급 | 경로 | 원형 |
|---|---|---|---|
| 내 역할 | 1인 전용 | `client.send("role", …)` | `sendHand`(615) |
| 동료 밤손님 명단 | **팀 전용** | 팀 좌석 목록을 돌며 `client.send` | `helperWhisper`(494-524) |
| 밤 지목 채널 | 팀 전용 + 마스킹 브로드캐스트 | `send` + `broadcast{except}` | `helperWhisper`(516-523) |
| 포교 조사 결과 | 1인 전용 | `client.send` | `peek`(477) |
| 투표 집계 | 공개 | `broadcast` | `suggestLog`(1343) |
| 전체 역할표 | 종료 후 전원 | `phase!=="ended"` 게이트 | `sendSolutionTo`(1374-1375) |

재접속 복구는 `onSeatRestored(client)` 훅으로(§2.2 · §3-⑥).

### 4.4 AI NPC가 밤손님일 때

- **결정은 순수 규칙 함수**: `rules/mafia-night.ts` · `rules/mafia-vote.ts`. `bot-accuse.ts`와 동일한 형태(주입된 `unit()` · 시드 좌표 · `Math.random`/`Date.now` 금지).
- **팀 합의 결정론화**: 각 봇이 후보에 점수를 매기고, 동점은 `seededUnit(seed,"nightPick",round)`로 tie-break. 사람 밤손님이 있으면 사람 선택 우선, 만료 시 규칙이 대신 고른다.
- **정보 대칭성 유지**: 봇 시민은 **공개 정보만** 본다 — `seenNotSolution`(clue-room.ts:175)의 좌석별 시야 모델을 그대로 이식한다. 「봇이 자기 역할 외의 비밀을 본다」는 클루에서 이미 제거한 결함(§1.1 정정)이므로 재발시키지 않는다.
- **대리 NPC가 밤손님 좌석을 받는 경우**: 팀 채널을 물려받는다(`handoverToBot` 673의 「손패 유지」와 동일 논리). ⚠️ **클루에 없던 문제**: `isBot`/`awayBot`가 동기화 상태(game-state.ts:13,18)라 「저 좌석은 봇이다」가 **공개 정보**인데, 마피아에서는 그것이 **추리 정보**가 된다.
  - **정책 결정: 공개를 유지한다.** 숨기면 ① 재접속 진단이 불가능해지고 ② 클라가 상태를 추정하기 시작한다(추정 = 클라가 진실값을 만드는 것 = 금지, `syncMeta` 주석 373-375의 논리 그대로). 대신 봇 발언 빈도를 사람과 동일하게 맞춰 「말 안 하는 쪽이 봇」이라는 표식을 없앤다. **명시적 트레이드오프**로 기록한다.

### 4.5 🔥 LLM 표현-전용 경계 × 「거짓말이 핵심인 게임」

**겉보기 모순**: 마피아의 핵심은 거짓말인데, 이 저장소는 「LLM은 진실값을 생성/변경하지 않는다」(CLAUDE.md)를 불변 규약으로 둔다.

**해소 — 거짓말은 진실값이 아니다. 거짓말의 *내용*이 진실값이다.**

| 무엇 | 누가 정하는가 |
|---|---|
| 이 좌석이 밤손님인가 | 규칙엔진(역할 배정) |
| 이번 발언에서 거짓을 말할 것인가 (`deceptive: boolean`) | 규칙엔진(페르소나 상수 + 시드) |
| **거짓말할 경우 무엇을 주장할 것인가** (`claim`) | **규칙엔진** — 후보 집합에서 시드로 선택 |
| 그 확정된 주장을 어떤 말투로 말할 것인가 | **LLM** |

즉 **LLM은 거짓말을 «창작»하지 않고 «연기»한다.**

이것은 새 설계가 아니라 **이 저장소가 이미 명문화한 결정의 첫 구현**이다 — `ai-tech-doc.md:485-486`:

> 거짓을 말하기로 정해지면 **거짓 답변의 내용까지 규칙엔진이 후보에서 고른다.** LLM이 거짓 내용을 창작하면 그 거짓은 환각과 구분할 수 없고 §3의 C4·C5가 원리적으로 작동하지 않는다

**왜 이 경계가 «취향」이 아니라 «필수」인가 (검증 관점)**: C4의 판정식은 「A의 라벨 최소 1개 포함 + A에 없는 같은 카테고리 라벨 0개」다. 거짓말을 LLM이 창작하면 「A에 없는 라벨」이 **정상 출력**이 되어 C4가 **원리적으로 판정 불능**이 된다. 규칙엔진이 `claim`을 확정하면 C4의 `A`가 「확정된 주장」으로 치환될 뿐 **검사식은 그대로 성립한다** → 거짓말이 있어도 환각 검사가 살아 있다.

**`NarrationInput` 확장안**
```
{ persona, tone, intro, outro,          // 기존 그대로 (cards.ts VOICE)
  action: "claim" | "accuse" | "defend" | "nightWhisper",
  claim: { kind: "role"|"alibi"|"suspicion", subject: <좌석 라벨>, value: <역할/좌석 라벨> },
  deceptive: boolean }                  // true면 "확신에 찬 태도" 연기 지시만 추가
```
LLM은 `claim`을 **바꿀 수 없다**. `deceptive`는 태도 지시일 뿐 내용에 영향을 주지 않는다.

**검증 항목 (마피아판 C-시리즈 · `ai-tech-doc` §8.2의 C8~C11 특화)**

| id | 판정 | blocking |
|---|---|---|
| M1 | 발화에 등장하는 역할·좌석 라벨이 `claim`이 지정한 값 집합의 **부분집합**인가 | ○ |
| M2 | `deceptive=false` 발화가 서버 진실값과 모순되지 않는가 | ○ |
| M3 | 밤 채널 발화의 **전송 대상**이 팀 좌석 집합과 정확히 일치하는가 (문자열 검사가 아니라 전송 대조) | ○ |
| M4 | 출력에 **다른 좌석의 역할값**이 등장하지 않는가 (C6 = `hands` 대조의 마피아판) | ○ |

**남는 진짜 한계 — 소원 성취식으로 덮지 않는다**

1. **NPC 마피아의 전략 깊이 상한 = 규칙 함수의 표현력.** `claim`을 규칙이 정하는 순간 「언제 거짓말을 지를지」의 감각은 상수(nerve류)로 환원된다. 사람이 느끼는 「AI가 능청스럽다」는 품질은 **문장력**에서만 나온다. 경계 준수의 대가다.
2. **사람의 자유 발언은 이번 스코프에 못 들어간다.** 마피아 토론의 본질은 자연어인데, 그것을 서버가 「주장」으로 구조화하려면 `ai-tech-doc` §8.2의 ① 질의 정규화 LLM이 필요하고 그건 본행사 스코프로 명시적으로 미뤄진 것이다(§8.1: 「경계를 먼저 세우고 검증 프로토콜을 갖춘 뒤」). → **1차 마피아는 자유 채팅 대신 «구조화 발언»으로 시작해야 한다**(버튼: 「나는 X다」/「Y가 의심스럽다」/「Z를 보았다」/「반박한다」). **재미의 상당 부분이 깎인다.** 이것이 이 설계의 가장 큰 제약이다.
3. **무료티어 예산.** 클루는 판당 ≈30발화(ai-tech-doc §2.5 실측). 마피아는 봇 5명 × 라운드당 1~2발화 × 8라운드 ≈ **최대 80콜/판**(추정). 캐시는 `claim` 조합이 키라 여전히 안 맞는다(같은 이유로 클루 적중률도 0% — 설계 예측값). → **규칙으로 발화 예산 상한**을 걸어야 한다(라운드당 봇 발화 ≤ 생존 봇 수, 낮 1회).

### 4.6 뷰

보드가 없으므로 **원탁 레이아웃**. 4뷰 진화 서사는 다른 축으로 재설계한다(§3의 「실현 가능성 낮음」).

| | 재사용(좌표 무관) | 신규 |
|---|---|---|
| 계약 | `setActive` `setMotion` `setElim`(→제거 표기) `bubble` `identity` `setOutcome` `dispose` | `setPhase(day\|night)` · `setSpeaking(id\|null)`(← `setCurrent` 일반화) · `setVote(from,to)` · `revealRole(id, role)` |
| 크롬 | `hud-inset` · `view-motion` · `typewriter` · `three-res` · 오버레이 버스 · 배너 · AI 칩 | 투표 패널 · 페이즈 타이머 바 · 역할 카드 오버레이 |

밤 = 조명 소등(뷰2·3의 `PointLight`는 `setOutcome` 구현에 이미 있다) · 제거 = `ELIM_ALPHA` + 2중 표기 계약(view-consts.ts:29,38) 그대로.

---

## 5. 확인 / 미확인 구분

| 주장 | 근거 |
|---|---|
| 오염 지점 11건의 파일:줄 | **직접 읽음**(서버·shared 전량, 클라 계약·상수) |
| 클라 렌더러·`main.ts`·`index.html` 인용 줄 번호 | **탐색 에이전트 2건 병행 조사** — 계약 파일(`view-contract.ts`)은 필자가 재확인, 렌더러 3종 본문은 재확인하지 않음 |
| ⚠️ 클라 줄 번호의 유효기간 | 조사 도중 **다른 세션이 `index.html`·`main.ts`·`network.ts`를 수정**했다(공개방 상태 배지 · ui-copy §8.5 · 10:17~10:18). `network.ts`는 재확인해 갱신했으나 **`main.ts`·`index.html` 줄 번호는 최대 수십 줄 밀렸을 수 있다** — 심볼명으로 재조회할 것 |
| 반증 순회가 `eliminated`를 필터하지 않음 | **직접 확인**(clue-room.ts:1270-1284) |
| 승패 판정이 `advanceTurn` 안에 있음 | **직접 확인**(2022-2050) |
| §3의 규모 수치 | **전부 추정.** 실측은 「세 벌 중복 → 한 벌」(⑤)과 「종료 8단계 복붙」(⑦)뿐 |
| Colyseus 스키마 상속의 와이어 호환성 | **미확인.** 실험 필요(§3-⑨) |
| 마피아 밸런스 수치(역할 배분·페이즈 길이) | **전부 추정.** 시뮬레이션 미실시 |
| 판당 LLM 콜 80건이 무료티어에 들어오는지 | **미확인.** 현 쿼터 여유 실측치 없음 |
| 「main.ts는 분해보다 새로 짜기가 싸다」 | **판단.** 실측 근거 없음 |

## 변경 이력
- 2026-07-29: 최초 작성. 서버·shared 전량 + 클라 계약/상수 직독 + 렌더러·셸 탐색 조사 기반 경계 실측, 마피아 콘텐츠 설계.
