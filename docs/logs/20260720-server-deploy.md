# 20260720 — 서버/클라 실배포 (OCI + Vercel)

> 프리티어로 전 구간 라이브. 게임 https://zodiac-clue.vercel.app · 서버 wss://141-147-157-219.sslip.io

---

## chore — 서버(WS) 배포: Oracle Cloud Always Free
- VM: Osaka·Ubuntu 22.04. A1(ARM) `out of host capacity` → **VM.Standard.E2.1.Micro**(1 OCPU/1GB) + **swap 2GB**.
- 런타임: **Node 22 + pnpm(corepack)**. 서버는 tsx로 실행.
- **systemd** `zodiac-server.service`: `pnpm exec tsx src/index.ts`, Restart=always, enable → 상시 실행·재부팅 자동기동. 로그에 `NPC 대사: Gemini ON`.
- `.env`(gitignore): `GEMINI_API_KEY`/`GEMINI_MODEL`/`PORT=2567`, `process.loadEnvFile()` 로드.

## chore — TLS/wss: Caddy + Let's Encrypt
- Caddyfile `<host> { reverse_proxy localhost:2567 }`. 도메인 미보유 → **sslip.io**(`141-147-157-219.sslip.io`)로 IP에 인증서 취득.
- 검증: 실제 colyseus.js 클라로 `wss://...` 연결+방생성 OK, CORS(Origin 반사) OK.

## chore — 네트워킹/방화벽
- **VCN 마법사**(Create VCN with Internet Connectivity)로 VCN+public subnet+IGW 생성(인스턴스 인라인 서브넷은 공인 IP 토글 버그).
- **2겹 개방**: OCI Security List(Ingress 80·443) + OS iptables(80·443, netfilter-persistent 저장).

## feat — 클라 배포: Vercel
- 루트 `vercel.json`: `framework:null`, `outputDirectory=apps/client/dist`, buildCommand로 `VITE_SERVER_URL=wss://...` 주입, SPA rewrite(`/(.*)`→`/index.html`).
- 클라 접속주소는 `VITE_SERVER_URL`(빌드타임 인라인, 미설정 시 `ws://localhost:2567`). `apps/client/.env.example` 추가.
- 배포: `vercel --prod` → https://zodiac-clue.vercel.app (200, 번들에 wss 주소 인라인 확인).

## 검증
- ✅ 사이트 200, 번들에 wss 엔드포인트 주입
- ✅ wss 연결+방생성(실 클라), CORS 반사
- ✅ systemd 상시/재부팅 복원, Gemini ON

## 남은 것
- 도메인 구매 시 sslip.io → 정식 도메인 교체(Caddyfile 한 줄)
- 04(승패·리매치, LLM 캐시), 02(엔진/콘텐츠 분리)
- GitHub↔Vercel 연동(자동 배포)
