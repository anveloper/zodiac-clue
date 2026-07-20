# plan: 게임형 카메라(탑뷰 추적·줌·자유시점) + 플로팅 HUD

status: active · created: 2026-07-20 · ref: docs/design/20260720-camera-and-hud

## goal
사이드패널 레이아웃 → **전체화면 보드**. 카메라가 내 캐릭터를 따라가는 탑뷰, 휠 줌, 특수키 자유시점. 단서 패/증거 체크는 화면 모서리 플로팅 UI.

## tasks
- [ ] Scale 모드 FIT→RESIZE, 캔버스 풀스크린(#game 100vw/100vh), 사이드패널 제거
- [ ] 카메라 setBounds(보드) + startFollow(내 토큰), lerp 부드럽게. 내 sessionId로 내 토큰 식별
- [ ] 휠 줌: wheel→setZoom(clamp min~max), 커서 기준 확대감(대략 중앙 유지)
- [ ] 자유시점: 특수키(hold) → stopFollow + 드래그/방향키 팬, 릴리즈 시 내 토큰으로 복귀(snap/lerp)
- [ ] 플로팅 HUD(DOM overlay, position:fixed): ①내 단서 패(하단 좌) ②증거 체크리스트(우측, 용의자·흉기·장소 토글) ③로그/알림(하단 우, 접이식)
- [ ] 조작 안내 오버레이(이동/줌/자유시점/제안·고발 키) 최소 표기
- [ ] 반응형: 모바일 축소 시 HUD 접힘/토글, 캔버스 리사이즈 대응

## done-criteria
- 보드가 뷰포트보다 크고, 내 캐릭터 중심 탑뷰로 이동·추적됨
- 휠로 확대/축소, 특수키로 다른 영역 자유 확인 후 놓으면 복귀
- 단서 패·증거 체크·로그가 보드 위 모서리 플로팅으로만 노출(사이드패널 없음)
