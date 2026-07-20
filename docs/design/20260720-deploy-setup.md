# 설계: 배포 세팅 (프리티어 지향)

> human view: 20260720-deploy-setup.html · ref: 서버 최소 스펙 논의(2026-07-20)

## 구조
- **클라(정적)**: Vite 빌드 → Vercel / Cloudflare Pages / Netlify (프리티어, TLS 자동).
- **서버(WS)**: Colyseus(Node, 인메모리, DB 불필요) → **상시 켜진 호스트** 필요.
- AI: Gemini 외부 무료 API(서버 부하 미미).
- 핵심 제약: **상시 WebSocket + wss(TLS)**. CPU/RAM은 소량이면 충분.

## 최소 스펙 (MVP)
- 1 vCPU(shared 무방) · RAM 512MB(최소 256MB) · 디스크 1~10GB · Node 20 LTS · Ubuntu 22.04
- 공개 포트 1개(2567) + TLS 종단(wss). 단일 인스턴스(수평확장=Redis presence 필요 → MVP 생략).

## 호스팅 후보 (우선순위)
1. **Oracle Cloud Always Free** — ARM Ampere(최대 4vCPU/24GB) 영구 무료. 가성비 최고, VM 직접 운영.
2. **AWS Lightsail($3.5~5) / EC2 t3.micro(12개월 무료)** — 익숙·빠른 세팅.
3. **Fly.io** — WS 친화, 소형 상시 인스턴스 저렴.
- ✗ 회피: Render/Railway **무료 scale-to-zero**(15분 유휴 슬립 → WS 콜드스타트 치명적). 데모만이면 감수.

## VM 레시피 (Oracle/EC2 공통)
1. Node 20 설치(nvm 또는 nodesource), pnpm 활성(`corepack enable`).
2. 레포 클론 → `pnpm i` → 서버만 실행(`pnpm --filter @zodiac-clue/server dev` 또는 build 후 tsx/node).
3. `apps/server/.env`에 `GEMINI_API_KEY`·`GEMINI_MODEL`·`PORT=2567`. **커밋 금지 유지**.
4. **Caddy** 리버스 프록시(자동 Let's Encrypt): `game.example.com { reverse_proxy localhost:2567 }` → `:443` wss 종단.
5. **pm2** 또는 **systemd**로 Node 상시 유지(재부팅 자동 기동).
6. 방화벽/보안그룹: 443, 22(SSH)만 개방. 2567은 외부 비공개(프록시 경유).

## 클라 연결 설정
- 클라의 서버 주소를 env로 분리: 개발 `ws://localhost:2567`, 운영 `wss://game.example.com`.
- 클라를 https로 배포하면 **반드시 wss**(브라우저가 ws:// 혼합콘텐츠 차단).
- 서버 CORS/allowed origins에 클라 도메인 등록.

## 체크리스트
- [ ] 서버 호스트 선택(Oracle/EC2/Fly)
- [ ] 도메인/서브도메인 + DNS A레코드
- [ ] Caddy 자동 TLS 동작(wss 접속 확인)
- [ ] pm2/systemd 상시 기동 + 재부팅 복원
- [ ] .env 시크릿 주입(키 커밋 금지)
- [ ] 클라 운영 빌드에 wss 주소 주입 + 배포(Vercel/CF Pages)
- [ ] 방화벽 443/22만 개방

## 주의
- 무료 scale-to-zero 호스팅은 WS 게임에 부적합.
- 단일 인스턴스 = 재시작 시 진행 중 방 소실(MVP 허용). 영속 필요 시 이후 Redis/드라이버.
- 키·시크릿은 호스트 env/secret로만.
