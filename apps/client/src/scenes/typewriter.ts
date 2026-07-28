import Phaser from "phaser";

/**
 * Phaser 말풍선 타자기 — **텍스트를 1회만 그리고 마스크로 가린다**(roadmap §9.3 뷰1 부수).
 *
 * 기존 구현은 55ms마다 `setText()`를 호출했다. Phaser `Text`의 `setText`는 캔버스를
 * 다시 그리고 **GPU 텍스처를 재업로드**한다 — 30자 대사 = 30회, 6인 동시 발화면
 * 초당 ~109회. 뷰4에 타자기를 넣으면서 같은 결함이 복제됐다.
 *
 * 여기서는 전문을 한 번 그린 뒤 `Graphics` 지오메트리 마스크로 가린다.
 * 마스크는 벡터라 텍스처 업로드가 없다. 한 글자씩 드러나는 **정보**는 그대로다.
 *
 * ⚠ 마스크 Graphics는 표시 목록에 있지만 `visible=false`다 —
 *    `GeometryMask`가 렌더러에게 직접 그리게 하므로 마스크 기능은 유지된다.
 */
export type TypeReveal = {
  text: Phaser.GameObjects.Text;
  mask: Phaser.GameObjects.Graphics;
  /** 지금까지 드러낸 글자 수. */
  shown: number;
  /** 전체 글자 수. */
  total: number;
};

/** 전문을 즉시 그리고(1회) 마스크를 씌운다. 이후 `paintReveal`로 진행률만 갱신. */
export const beginReveal = (
  scene: Phaser.Scene,
  text: Phaser.GameObjects.Text,
  full: string,
): TypeReveal => {
  text.setText(full); // ← 유일한 텍스처 업로드
  const mask = scene.add.graphics();
  mask.setVisible(false);
  text.setMask(mask.createGeometryMask());
  const r: TypeReveal = { text, mask, shown: 0, total: full.length };
  paintReveal(r);
  return r;
};

/**
 * 현재 진행률만큼만 보이도록 마스크 사각형을 다시 칠한다.
 * 말풍선이 매 프레임 움직이므로 위치가 바뀔 때마다 호출돼야 한다.
 */
export const paintReveal = (r: TypeReveal): void => {
  const { text, mask } = r;
  mask.clear();
  if (r.shown <= 0) return;
  mask.fillStyle(0xffffff, 1);
  if (r.shown >= r.total) {
    // 완료 — 텍스트 전체 사각형 하나로 끝낸다(줄 계산 불필요).
    const tl = text.getTopLeft();
    mask.fillRect(tl.x, tl.y, text.displayWidth, text.displayHeight);
    return;
  }
  const lines = text.getWrappedText(text.text);
  const padLeft = text.padding.left ?? 0;
  const padTop = text.padding.top ?? 0;
  const padBottom = text.padding.bottom ?? 0;
  const tl = text.getTopLeft();
  const inner = Math.max(1, text.height - padTop - padBottom);
  const lh = inner / Math.max(1, lines.length);
  // ⚠ `getTopLeft()`·`displayWidth`는 **스케일이 적용된** 월드 값이고
  //    `text.height`·`measureText`는 스케일 이전 값이다. 말풍선은 줌과 무관하게
  //    같은 화면 크기로 읽히도록 `1/zoom`으로 역스케일되므로(뷰1·뷰4),
  //    두 계열을 섞으면 마스크가 글자와 어긋난다 — 스케일 이전 값에만 `s`를 곱한다.
  //    (스케일 1이면 아래 식은 예전과 완전히 같다.)
  const sx = text.scaleX;
  const sy = text.scaleY;
  // 폰트를 컨텍스트에 동기화해야 measureText가 실제 렌더와 같은 폭을 준다.
  text.style.syncFont(text.canvas, text.context);
  let rest = r.shown;
  for (let i = 0; i < lines.length && rest > 0; i++) {
    const line = lines[i];
    const take = Math.min(rest, line.length);
    const w =
      take >= line.length
        ? text.displayWidth
        : (padLeft + text.context.measureText(line.slice(0, take)).width) * sx;
    mask.fillRect(
      tl.x,
      tl.y + (padTop + i * lh) * sy,
      w,
      (lh + (i === 0 ? padTop : 0)) * sy,
    );
    // 줄바꿈에서 소비된 공백 1자를 함께 센다(래핑으로 사라진 구분자).
    rest -= take + 1;
  }
};

/** 마스크를 걷어 전문을 노출(연출 종료). */
export const finishReveal = (r: TypeReveal): void => {
  r.shown = r.total;
  paintReveal(r);
};

/** 마스크 자원 해제. `clearMask(true)`는 Mask만 파괴하므로 Graphics는 직접 destroy. */
export const destroyReveal = (r: TypeReveal): void => {
  r.text.clearMask(true);
  r.mask.destroy();
};
