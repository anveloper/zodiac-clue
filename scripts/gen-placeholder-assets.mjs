// placeholder 에셋 생성기 (SVG) — S3(three-asset) 로더 배선을 위한 스탠드인.
// 조선 사극 팔레트 + 이모지 + 한글 라벨로 테마형 placeholder를 컨벤션 경로에 찍는다.
// 나중에 GPT 이미지 2.0로 만든 상세 아트(PNG)로 같은 경로에 교체.
// 데이터는 packages/shared/src/cards.ts 를 미러링(변경 시 함께 갱신).
//
// 실행: node scripts/gen-placeholder-assets.mjs
// 출력: apps/client/public/assets/{char,loot,room,ui,bg}/*.svg

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps/client/public/assets");

// ── 팔레트(사극) ────────────────────────────────────────────────
const PAL = { bg: "#16130f", card: "#211c16", edge: "#7c6238", ink: "#f0e9dc", gold: "#f0d9a8", tan: "#cbb489", feast: "#3a2b1a" };
// 캐릭터별 강조색(12) — 오방+한지 톤 변주
const ACCENT = {
  rat: "#6c7a89", ox: "#8a6d3b", tiger: "#c0692b", rabbit: "#c65b7c",
  gecko: "#4f8f6b", snake: "#7a4b7e", horse: "#a9702f", sheep: "#b9a98a",
  monkey: "#c99a3f", rooster: "#b5483a", dog: "#5e6b57", pig: "#c98a7a",
};

const CHAR = {
  rat: "🐭", ox: "🐮", tiger: "🐯", rabbit: "🐰", gecko: "🦎", snake: "🐍",
  horse: "🐴", sheep: "🐑", monkey: "🐵", rooster: "🐔", dog: "🐶", pig: "🐷",
};
const LOOT = { japchae: "🍜", gift: "🎁", safe: "💰", chopstick: "🥢", liquor: "🍶", tteok: "🍡" };
const ROOMS = ["jeongji","daecheong","huwon","sarangbang","sarangchae","seojae","anbang","haengnang","byeoldang"];

const LABEL = {
  rat:"생쥐 서생", ox:"황소 역사", tiger:"호랑이 대감", rabbit:"토끼 낭자", gecko:"게코 도령",
  snake:"뱀 무녀", horse:"말 장수", sheep:"양 목동", monkey:"잔나비 광대", rooster:"닭 훈장",
  dog:"삽살 포교", pig:"돼지 객주",
  japchae:"잡채", gift:"잔치 선물", safe:"금고", chopstick:"젓가락", liquor:"술동이", tteok:"떡시루",
  jeongji:"정지(부엌)", daecheong:"대청마루", huwon:"후원", sarangbang:"사랑방", sarangchae:"사랑채",
  seojae:"서재", anbang:"안방", haengnang:"행랑채", byeoldang:"별당",
};

const FONT = `'Apple SD Gothic Neo','Noto Sans KR',system-ui,sans-serif`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tag = (w) =>
  `<g opacity="0.9"><rect x="${w - 118}" y="14" width="104" height="26" rx="6" fill="#000" opacity="0.45"/>` +
  `<text x="${w - 66}" y="32" font-family="${FONT}" font-size="14" fill="${PAL.gold}" text-anchor="middle" letter-spacing="1">PLACEHOLDER</text></g>`;

// 얼굴 아이콘(512²): 원형 토큰. 정면·빌보드/탑다운 공통.
const faceSVG = (id) => {
  const a = ACCENT[id], W = 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
<rect width="${W}" height="${W}" fill="none"/>
<circle cx="256" cy="238" r="210" fill="${a}"/>
<circle cx="256" cy="238" r="210" fill="none" stroke="${PAL.gold}" stroke-width="10"/>
<text x="256" y="300" font-size="240" text-anchor="middle">${CHAR[id]}</text>
<rect x="106" y="440" width="300" height="52" rx="12" fill="#000" opacity="0.5"/>
<text x="256" y="476" font-family="${FONT}" font-size="30" fill="${PAL.ink}" text-anchor="middle">${esc(LABEL[id])}</text>
${tag(W)}</svg>`;
};

// SD(768²): 치비 느낌 — 큰 이모지 + 부드러운 그림자, 배경 옅음.
const sdSVG = (id) => {
  const a = ACCENT[id], W = 768;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
<defs><radialGradient id="g" cx="50%" cy="42%" r="55%">
<stop offset="0%" stop-color="${a}" stop-opacity="0.55"/><stop offset="100%" stop-color="${a}" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${W}" fill="none"/>
<ellipse cx="384" cy="640" rx="190" ry="42" fill="#000" opacity="0.28"/>
<rect x="120" y="120" width="528" height="528" rx="60" fill="url(#g)"/>
<text x="384" y="470" font-size="380" text-anchor="middle">${CHAR[id]}</text>
<rect x="214" y="668" width="340" height="60" rx="14" fill="#000" opacity="0.5"/>
<text x="384" y="710" font-family="${FONT}" font-size="34" fill="${PAL.ink}" text-anchor="middle">${esc(LABEL[id])} · SD</text>
${tag(W)}</svg>`;
};

// 장물 아이콘(512²): 원형, 금테.
const lootSVG = (id) => {
  const W = 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
<rect width="${W}" height="${W}" fill="none"/>
<circle cx="256" cy="238" r="200" fill="${PAL.card}"/>
<circle cx="256" cy="238" r="200" fill="none" stroke="${PAL.gold}" stroke-width="8" stroke-dasharray="6 10"/>
<text x="256" y="300" font-size="220" text-anchor="middle">${LOOT[id]}</text>
<rect x="116" y="440" width="280" height="52" rx="12" fill="#000" opacity="0.5"/>
<text x="256" y="476" font-family="${FONT}" font-size="30" fill="${PAL.ink}" text-anchor="middle">${esc(LABEL[id])}</text>
${tag(W)}</svg>`;
};

// 방 바닥 타일(512² · 룸 종횡비=정사각): 한지 톤 + 격자 + 방 이름 현판.
const roomSVG = (id) => {
  const W = 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
<rect width="${W}" height="${W}" fill="${PAL.tan}"/>
<g stroke="${PAL.edge}" stroke-width="2" opacity="0.35">
${Array.from({ length: 7 }, (_, i) => { const p = ((i + 1) * W) / 8; return `<line x1="${p}" y1="0" x2="${p}" y2="${W}"/><line x1="0" y1="${p}" x2="${W}" y2="${p}"/>`; }).join("")}
</g>
<rect x="8" y="8" width="${W - 16}" height="${W - 16}" fill="none" stroke="${PAL.edge}" stroke-width="6"/>
<rect x="106" y="222" width="300" height="68" rx="10" fill="${PAL.feast}" opacity="0.92"/>
<text x="256" y="266" font-family="${FONT}" font-size="34" fill="${PAL.gold}" text-anchor="middle">${esc(LABEL[id])}</text>
${tag(W)}</svg>`;
};

const feastSVG = () => {
  const W = 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
<rect width="${W}" height="${W}" fill="${PAL.feast}"/>
<rect x="10" y="10" width="${W - 20}" height="${W - 20}" fill="none" stroke="${PAL.gold}" stroke-width="6"/>
<text x="256" y="300" font-size="200" text-anchor="middle">🎁</text>
<text x="256" y="430" font-family="${FONT}" font-size="40" fill="${PAL.gold}" text-anchor="middle">잔치상</text>
${tag(W)}</svg>`;
};

// 배경(1536×1024 근사)·UI 프레임.
const bgSVG = (title, emo, base) => {
  const W = 1536, H = 1024;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${base}"/><stop offset="100%" stop-color="${PAL.bg}"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#v)"/>
<text x="768" y="470" font-size="220" text-anchor="middle">${emo}</text>
<text x="768" y="640" font-family="${FONT}" font-size="60" fill="${PAL.gold}" text-anchor="middle">${esc(title)}</text>
${tag(W)}</svg>`;
};

const uiFrameSVG = () => {
  const W = 1024, H = 1024;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="none"/>
<rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="28" fill="${PAL.card}" opacity="0.85" stroke="${PAL.gold}" stroke-width="8"/>
<rect x="70" y="70" width="${W - 140}" height="${H - 140}" rx="18" fill="none" stroke="${PAL.edge}" stroke-width="3" stroke-dasharray="4 8"/>
<text x="512" y="540" font-family="${FONT}" font-size="52" fill="${PAL.gold}" text-anchor="middle">UI 프레임</text>
${tag(W)}</svg>`;
};

// ── 생성 ────────────────────────────────────────────────────────
async function emit(rel, svg) {
  const p = join(OUT, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, svg, "utf8");
  return rel;
}

const out = [];
for (const id of Object.keys(CHAR)) {
  out.push(await emit(`char/${id}-face.svg`, faceSVG(id)));
  out.push(await emit(`char/${id}-sd.svg`, sdSVG(id)));
}
for (const id of Object.keys(LOOT)) out.push(await emit(`loot/${id}-icon.svg`, lootSVG(id)));
for (const id of ROOMS) out.push(await emit(`room/${id}-floor.svg`, roomSVG(id)));
out.push(await emit(`room/feast.svg`, feastSVG()));
out.push(await emit(`bg/lobby.svg`, bgSVG("대감집 · 대기실", "🏮", "#2a2016")));
out.push(await emit(`bg/win.svg`, bgSVG("잔치는 계속된다", "🎉", "#3a2b12")));
out.push(await emit(`bg/lose.svg`, bgSVG("도둑은 사라졌다", "🌫", "#181410")));
out.push(await emit(`ui/frame.svg`, uiFrameSVG()));

console.log(`placeholder 에셋 ${out.length}개 생성 → apps/client/public/assets/`);
console.log(out.map((r) => "  " + r).join("\n"));
