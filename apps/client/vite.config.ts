import { defineConfig } from "vite";

export default defineConfig({
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
