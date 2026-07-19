# zodiac-clue

NHN NAN 2026 사전과제 — 웹 기반 멀티플레이 **클루(Cluedo)형 추리 게임**.
초기 목표: **기본 클루 룰(6인)** 을 웹에서 동작시키는 것. 실시간 이동·장소 상호작용까지. (음성은 이후 단계)

## 구조 (pnpm 모노레포)

```
zodiac-clue/
├── apps/
│   ├── server/     # Colyseus (Node/TS) — 방·상태동기화·클루 룰 (권위 서버)
│   └── client/     # Phaser 3 + Vite (TS) — 그리드 렌더·입력·네트워크
└── packages/
    └── shared/     # 공용 타입 + 클루 카드 데이터(용의자6·흉기6·장소9)
```

## 기술 스택

- **서버**: [Colyseus](https://colyseus.io) 0.15 — 방/로비/상태동기화 내장, 권위 서버. 비밀 정보(각자 손패·정답 봉투)는 동기화 상태에 넣지 않고 개별 클라에 private 전송.
- **클라**: [Phaser 3](https://phaser.io) + [Vite](https://vitejs.dev) + `colyseus.js`
- **이동**: 그리드(칸 단위) — netcode 최소화 (연속 이동 대비 예측·보간 불필요)
- **AI(예정)**: Gemini 심문 NPC를 서버 라우트로 (이후 단계)

## 개발

```sh
pnpm install
pnpm dev          # 서버(:2567) + 클라(:5173) 동시 실행
# 개별 실행
pnpm dev:server
pnpm dev:client
```

브라우저에서 http://localhost:5173 접속 → 여러 탭을 열어 멀티 접속 테스트.

## 현재 구현 범위 (초기 세팅)

- [x] 모노레포 스캐폴딩(서버/클라/공용)
- [x] Colyseus 방 접속(최대 6인) + 캐릭터 배정
- [x] 그리드 맵 렌더 + 실시간 이동 동기화
- [x] 장소(방) 진입 감지 = 상호작용 지점
- [x] 게임 시작 시 카드 분배 + 정답 봉투(서버 비밀) + 손패 private 전송
- [x] 기본 제안(Suggestion)·반증(Disprove)·고발(Accusation) 흐름
- [ ] 주사위/턴 이동 규칙 정식화 (현재는 자유 그리드 이동)
- [ ] 조디악(띠) 테마 리스킨 + AI 증인(호랑이) 심문
- [ ] 음성(STT/TTS) — 이후 단계

## 라이선스

과제용 프로젝트. 외부 에셋 사용 시 출처·라이선스 명시 필수.
