# 20260719 — 모노레포 & 기본 클루(6인) 초기 세팅

> NAN 2026 사전과제. 웹 멀티플레이 클루형 추리 게임 `zodiac-clue` 첫 스캐폴딩.
> 목표: **기본 클루 룰(6인)을 웹에서 동작**시키는 최소 세팅 (이동·실시간·장소 상호작용). 음성은 이후.

---

## chore — 기반 설정

- **pnpm 모노레포** 구성: `apps/*` + `packages/*` 워크스페이스.
- 루트 `tsconfig.base.json`(strict, `moduleResolution: bundler`), `.gitignore`, `README.md`.
- Node 20 / pnpm 10 기준.

## feat — 공용 패키지 (`packages/shared`)

- 클루 카드 데이터: ~~**용의자 6 · 흉기 6 · 장소 9 (총 21장)**~~ + 한글 라벨 매핑(`LABELS`) — 테마 리스킨 대비 라벨만 교체 가능.
  - (갱신 2026-07-21) 현재: **용의자=십이지 12(참여자 캐릭터만 정답 후보) · 장물 6 · 장소 9**. 한 판 덱은 참여자 수에 맞춰 구성.
- 공용 타입: `Card` / `Solution` / `Suggestion` / 클라·서버 메시지 타입.
- 맵: `GRID 24×24`, `ROOM_REGIONS`(방 9곳 영역) + `roomAt(x,y)` 헬퍼.

## feat — 서버 (`apps/server`, Colyseus)

- **Colyseus 권위 서버**. `ClueRoom`(maxClients 6).
- **동기화 상태**(`GameState`/`Player`): phase·턴·플레이어 위치·방. **비밀정보(정답 봉투·손패)는 동기화 상태에 넣지 않음** → 서버 전용 `Map`으로 보관, 손패는 각 클라에 **private 전송**.
- 기능: 그리드 이동(서버 검증) / 게임 시작 시 정답 봉투 추출 + 카드 분배 / **제안(Suggestion) → 시계방향 반증(Disprove) → 고발(Accusation)** / 턴 진행·탈락 처리.
- 장소(방) 진입 감지 = 상호작용 지점(로그 브로드캐스트).

## feat — 클라이언트 (`apps/client`, Phaser + Vite)

- **Phaser 3 + Vite(TS)**. 그리드 맵·방 영역 렌더, 방향키/WASD 이동 → 서버 전송, `onStateChange`로 전체 상태 재조정 렌더.
- HUD: 게임 시작·제안·고발·턴 종료 버튼 + 내 손패 표시 + 로그 패널.
- 네트워크: `colyseus.js`로 `joinOrCreate("clue")`.

---

## 기술 결정 로그

- **엔진/네트워크**: Phaser(클라) + Colyseus(서버). 방/로비/상태동기화 내장이라 최소 코드로 실시간 확보.
- **버전 고정**: Colyseus가 0.17로 올라갔으나 클라(`colyseus.js`)와 wire 호환되는 **0.15 라인**으로 고정(서버/클라 `@colyseus/schema` 2.x 일치). 서버는 CommonJS로 실행(colyseus 0.15가 CJS).
- **이동 방식**: **그리드(칸 단위, 저빈도)** 채택 — 연속 이동 대비 예측·보간 불필요, netcode 최소.
- **레포 가시성**: 공고 "public 권장(비공개 시 심사계정 초대)" → **public** 확정.

## 검증 (실측)

- ✅ 3패키지 타입체크 통과(`pnpm -r typecheck`)
- ✅ 서버 부팅 + `:2567` LISTEN, 매치메이킹 `joinOrCreate/clue` 좌석예약 정상(maxClients 6), 미정의 방 에러 반환
- ✅ 클라 Vite 프로덕션 빌드 성공
- ⏳ 전체 UI 플레이(제안/반증/고발)는 `pnpm dev` 후 브라우저 탭 2개로 수동 확인 필요

## 다음 할 일

- [ ] 주사위/턴 이동 규칙 정식화 (현재는 자유 그리드 이동)
- [ ] 조디악(띠) 테마 리스킨 — 라벨·아트("호랑이 생신" 컨셉)
- [ ] 음성(STT/TTS) — Web Speech API 우선
- [ ] 팀원 collaborator 초대 / 배포 파이프라인
