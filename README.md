# zodiac-clue

NHN NAN 2026 사전과제 — 웹 기반 멀티플레이 **클루(Cluedo)형 추리 게임**.
테마: **호랑이 생신 잔치**(십이지 손님 중 잔치 선물을 훔친 자를 추리). NPC 대사는 LLM으로 표현.

- 🎮 **라이브(플레이)**: https://zodiac-clue.vercel.app
- 📚 **문서 대시보드(공개)**: https://zodiac-clue.vercel.app/docs/ — 설계·플랜·개발일지
- 🖥 **서버**: `wss://141-147-157-219.sslip.io` (OCI, Colyseus)

## 구조 (pnpm 모노레포)

```
zodiac-clue/
├── apps/
│   ├── server/     # Colyseus (Node/TS) — 방·상태동기화·클루 룰·NPC 결정(권위 서버)
│   └── client/     # Phaser 3 + Vite (TS) — 보드 렌더·카메라·입력·네트워크
└── packages/
    └── shared/     # 공용 타입·카드/방/성격 데이터(용의자=십이지12·장물6·장소9)
```

## 기술 스택

- **서버**: [Colyseus](https://colyseus.io) 0.15 — 방/로비/상태동기화. 비밀정보(손패·정답 봉투)는 동기화하지 않고 개별 private 전송.
- **클라**: [Phaser 3](https://phaser.io)(2D) + [Three.js](https://threejs.org)(2.5D · 뷰2/뷰3) + [Vite](https://vitejs.dev) + `colyseus.js` — 탑뷰 추적 카메라·줌·트윈 이동·플로팅 HUD.
- **AI(NPC 대사)**: Google **Gemini**(`gemini-flash-lite-latest`). 원칙 — **결정·진실값은 규칙엔진, 표현(대사)만 LLM**. 실패 시 규칙 폴백. → [AI 기술문서](docs/design/20260720-ai-tech-doc.html)
- **배포**: 서버 GitHub Actions(SSH→OCI), 클라 Vercel(Git 연동). main push 자동배포. → [배포 세팅](docs/design/20260720-deploy-setup.html)

## 개발

```sh
pnpm install
pnpm dev          # 서버(:2567) + 클라(:5173) 동시 실행
pnpm dev:server   # / pnpm dev:client
pnpm -r typecheck # 타입체크
```

브라우저 http://localhost:5173 → 방 만들기/초대(`/room/<코드>`)로 멀티 접속. 6인 미만이면 NPC 자동 충원.

## 구현 현황

- [x] 모노레포 · Colyseus 방(최대 6인, 부족분 NPC 충원) · 재접속(탭 기준)
- [x] **방 공개/비공개** 선택 · **메인 공개방 목록**(방장·인원, 시작 전만 노출, 5초 갱신)·참여 · 초대 코드 참가
- [x] 십이지 테마 리스킨(호랑이 생신 잔치) · 캐릭터 선택/중복검증 · 성격 도감 · **직업 용어 풀이**(생소한 사극 단어 설명)
- [x] 보드: 탑뷰 추적 카메라·줌·자유시점, 방/입구(🚪)·중앙 잔치상, 플로팅 HUD·증거노트 · **턴 순서 표시**(현재→다음 스트립, 클릭 시 원형 순서)
- [x] **뷰 진화 단계 선택기**(개발 진화를 기능으로, 위로 열리는 드롭다운): 뷰1 `2d-emoji`(Phaser) · 뷰2 `three-emoji`(Three.js 빌보드) · 뷰3 `three-asset`(에셋 아트) · **뷰4 `pixel`(도트풍)** · 항상 뷰1 시작. 마우스 우클릭 드래그 팬(전 단계 공통)
- [x] 정통 클루 턴: **주사위 2d6**·턴 게이팅·방 안 무료이동·문 봉쇄·**방 진입 턴엔 이탈 불가**·제안 시 용의자/장물 소환(방마다 **지정 소환 자리** — 문·벽 안 막음)·**비밀 통로**
- [x] 추리 3요소 = **도둑(용의자) · 훔친 것(장물: 잡채·선물·금고 등) · 장소**. 제안·시계방향 반증·고발·탈락 관전·종료 결과·**리매치**
- [x] **NPC**: 규칙기반 추리(공유 공개카드로 수렴) + **LLM 대사·페르소나(말투)**, 절반 딜레이
- [x] **고정 NPC(계략)**: 미선택 6명 모서리2·방↔방 벽면4 배치 → 엿보기 + 이동 보너스 + **귓속말 대사(당사자만 전문)** · 공통 단서(솔로) · 배포 자동화
- [ ] 계략 다양화·고정NPC 다른 역할 · 엔진/콘텐츠 분리 · 도메인/음성

자세한 로드맵·남은 작업은 [문서 대시보드](docs/index.html) 및 `docs/plans/` 참고.

## 라이선스

과제용 프로젝트. 외부 에셋 사용 시 출처·라이선스 명시 필수.
