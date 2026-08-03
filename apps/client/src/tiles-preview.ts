// 타일셋 조립 프리뷰 — TileScene(뷰2 실험)을 서버 없이 단독으로 띄운다.
// 목적: 타일 배치/배율을 게임 흐름 없이 바로 눈으로 확인·스크린샷.
import Phaser from "phaser";
import { TileScene } from "./scenes/tile-scene";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "board",
  transparent: false,
  backgroundColor: "#4a5330",
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
  scene: [TileScene],
});
