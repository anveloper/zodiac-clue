# plan: 게임 엔진 / 콘텐츠 분리

status: hold(보류) · created: 2026-07-20 · held: 2026-07-21 · ref: docs/design/20260720-engine-and-workflow-plan §1.4

> 보류 사유: 현재 주제(클루/십이지)로 제출·완성도에 집중. 주제 교체가 확정되면 재개.

## goal
주제(클루)가 바뀌어도 재사용되도록 엔진 코어와 GameDefinition을 분리.

## tasks
- [ ] GameDefinition 인터페이스 정의: 구성물(카드/역할/맵)·승리조건·NPC정책(decideTurn)·초기배치·라벨/이모지
- [ ] 엔진 코어 추출: 방/턴/상태동기화/NPC스케줄/재접속/딜레이 (게임 상수 0)
- [ ] 클루를 GameDefinition 구현체로 이관 (shared cards + clue-room 리팩터)
- [ ] 더미 GameDefinition으로 엔진만 구동되는 스모크 테스트
- [ ] 클라 렌더도 정의 주입식으로(보드/토큰/라벨을 GameDefinition에서)

## done-criteria
- 엔진 코어 어디에도 "클루/십이지" 상수 없음, 게임 교체가 GameDefinition 하나로 가능
