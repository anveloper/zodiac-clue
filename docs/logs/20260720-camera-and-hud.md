# 20260720 — 게임형 카메라(탑뷰 추적·줌·자유시점) + 플로팅 HUD

> "대시보드" 레이아웃 → "게임" 화면. 사이드패널 제거, 보드를 전체화면으로.

---

## feat — 풀스크린 캔버스 (`apps/client`)

- Phaser Scale `FIT→RESIZE`, `#game`을 `position:absolute; inset:0`(100vw×100vh). 고정 보드크기 스케일 제거.
- `index.html` 게임 섹션을 사이드패널(.wrap/.side) → **플로팅 HUD 오버레이**로 교체.

## feat — 추적 카메라 (`game-scene.ts`)

- `cam.setBounds(0,0,BOARD_W,BOARD_H)` + `startFollow(내 disc, lerp 0.12)`. 내 토큰은 `room.sessionId`로 식별, 렌더 시 최초 1회 팔로우 연결.
- 초기 줌 1.8배(탑뷰 확대감), 중앙 정렬.

## feat — 휠 줌

- `input.on("wheel")` → `setZoom(clamp(zoom×0.9/1.1, 0.6, 3))`.

## feat — 자유시점 (Space hold)

- `keydown-SPACE`→`stopFollow`, `keyup-SPACE`→`startFollow`(부드럽게 복귀).
- 자유시점 중: 드래그 팬(pointermove/zoom 보정) + 방향키 팬. **이동(`move`) 전송 잠금**(키 충돌 방지).

## feat — 플로팅 HUD (DOM, position:fixed)

- 좌상: 조작 버튼(제안/고발/턴종료), 좌하: 내 단서 패, 우상: **증거 노트**, 우하: 로그/알림, 하단중앙: 조작 안내(kbd).
- **증거 노트**: 용의자/흉기/장소 전 항목 칩. 클릭 순환 없음(제외)→의심→초기화. **개인 메모라 서버 전송 X**, `localStorage(zc_evi_<roomId>)` 저장.

## 검증

- ✅ 클라 타입체크 · vite build 성공
- 참고: agent-browser screenshot 세션 중 고장 → 시각 확인은 사용자 브라우저에서

## 남은 것

- [ ] 반응형: 소화면 HUD 접힘/토글 (겹침 여지)
- 이후: 04(승패화면·리매치, LLM 캐시), 02(엔진/콘텐츠 분리)
