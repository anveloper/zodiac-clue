import { defineConfig, transformWithEsbuild, type Plugin } from "vite";

/**
 * `index.html`을 **내보낼 때만** 줄인다 — 소스는 주석째로 남긴다.
 *
 * 왜: Vite는 JS·CSS 자산은 최소화하지만 **`index.html`은 손대지 않는다.**
 *     실측(07-29) — `dist/index.html`이 소스와 바이트가 같았다(67,997 B).
 *     그 안에는 인라인 `<style>` 53,060 B가 들어 있고, 그중 18,397 B가 CSS 주석,
 *     마크업 쪽에도 HTML 주석이 4,478 B 더 있다. 합쳐서 **22.9 kB의 주석이 매 첫
 *     방문마다 전송**되고 있었다. index.html은 렌더 블로킹 경로의 첫 왕복이라
 *     이 무게는 그대로 첫 페인트 앞에 선다.
 *
 * 무엇을 하지 않는가: 인라인 CSS를 외부 파일로 빼지 않는다. 첫 방문 총 전송량은
 *     그대로인데 렌더 블로킹 요청만 하나 늘기 때문이다(파일을 옮기는 것 ≠ 빨라지는 것).
 *     선택자를 지우지도 않는다 — `log-*`·`ai-*`는 `main.ts`가 런타임에 문자열로
 *     조립해 붙인다(`main.ts:172`, `:210`). 정적 검색만으로 「미사용」이라 단정하면
 *     화면이 깨진다. 여기서 줄이는 것은 **런타임에 아무 의미가 없는 바이트뿐**이다.
 *
 * dev에도 적용하는 이유: 수용 게이트(`scripts/gate-screen.mjs`)는 **개발 서버**를
 *     띄워 화면을 잰다. 빌드에만 걸면 게이트가 재는 화면과 실제로 나가는 화면이
 *     달라져, 겹침·명암비 판정이 배포물을 검증하지 못한다. 재는 것과 나가는 것은
 *     같아야 한다. 사람이 읽는 원본은 `index.html` 소스 파일 그대로다.
 */
const minifyIndexHtml = (): Plugin => ({
  name: "zodiac-minify-index-html",
  enforce: "post",
  transformIndexHtml: {
    order: "post",
    async handler(html) {
      // `<style>`/`<script>` 안쪽은 마크업 규칙(공백 접기·주석 제거)이 통하지 않는다.
      // 그래서 블록을 먼저 잘라내고, **사이의 마크업만** 접는다.
      const BLOCK = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;

      // 마크업: ① 주석 제거(조건부 주석 없음 — 실측 확인)
      //         ② 줄바꿈을 포함한 공백 덩어리 → 줄바꿈 하나.
      //            HTML은 공백 덩어리를 어차피 **한 칸**으로 렌더한다. 줄바꿈 하나도
      //            한 칸이다 → 렌더 결과가 동일하다. `>` `<` 사이 공백을 아예 없애면
      //            인라인 요소 간 한 칸이 사라져 레이아웃이 바뀌므로 **거기까지는 가지 않는다.**
      //            (`<pre>`·`<textarea>`·`white-space: pre`는 이 문서에 없다 — 실측 확인)
      const squeezeMarkup = (s: string): string =>
        s.replace(/<!--[\s\S]*?-->/g, "").replace(/[ \t]*\r?\n[ \t\r\n]*/g, "\n");

      const parts: string[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = BLOCK.exec(html)) !== null) {
        parts.push(squeezeMarkup(html.slice(last, m.index)));
        const [block, tag] = m;
        if (tag.toLowerCase() === "style") {
          const open = block.indexOf(">") + 1;
          const css = block.slice(open, block.lastIndexOf("</"));
          // esbuild의 CSS 최소화. Vite가 이미 의존하는 것을 그대로 쓴다(새 의존성 0).
          const { code } = await transformWithEsbuild(css, "index-inline.css", {
            loader: "css",
            minify: true,
          });
          parts.push(`${block.slice(0, open)}${code.trim()}</style>`);
        } else {
          parts.push(block); // 스크립트는 손대지 않는다 — Vite가 자산으로 따로 처리한다.
        }
        last = m.index + block.length;
      }
      parts.push(squeezeMarkup(html.slice(last)));
      return parts.join("").trim();
    },
  },
});

export default defineConfig({
  plugins: [minifyIndexHtml()],
  server: {
    port: 5173,
  },
  build: {
    // 렌더러(phaser ≈1.48MB · three ≈550kB)는 §9.1에 따라 **의도적으로** 크리티컬
    // 경로 밖의 동적 청크다. 기본 500kB 경고는 "동적 import로 쪼개라"고 안내하는데
    // 이미 쪼갠 상태라 더 이상 실행 가능한 신호가 아니다.
    // 지켜야 할 예산은 **진입 청크(`index-*.js`)**이고 현재 ≈113kB다.
    chunkSizeWarningLimit: 1600,
  },
});
