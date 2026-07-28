// 기준선 파일 입출력 — `scripts/gate.baseline.json`
//
// 왜 파일인가: 이번 라운드에 **코드 스플리팅(§9.1)과 규칙 변경이 동시에 들어온다.**
// 기준선을 스크립트에 하드코딩하면 다음 커밋에서 즉시 깨지고, 깨진 게이트는 아무도 안 돌린다.
// → 기준선은 데이터로 분리하고, 갱신할 때 **사람이 사유를 적도록** 강제한다(`--reason=`).
//
// 갱신 명령:
//   node scripts/gate-bundle-budget.mjs   --update-baseline --reason="Three 동적 import 분리(§9.1)"
//   node scripts/sim-balance.mjs --gate   --update-baseline --reason="봇 확률적 오답 고발 도입(§5)"

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE_PATH = join(ROOT, "scripts", "gate.baseline.json");

const EMPTY = {
  $note:
    "회귀 게이트 기준선. 손으로 고치지 말고 각 게이트의 --update-baseline --reason=\"...\" 로 갱신한다. " +
    "reason 은 '왜 이 값이 바뀌는 것이 의도된 변경인가'를 적는 칸이다.",
};

export const readBaseline = () => {
  if (!existsSync(BASELINE_PATH)) return { ...EMPTY };
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch (e) {
    throw new Error(`gate.baseline.json 파싱 실패: ${e.message}`);
  }
};

/**
 * 기준선 한 섹션을 갱신한다.
 * @param {string} section  "bundle" | "sim"
 * @param {object} data     기록할 측정값
 * @param {string} reason   사람이 적는 변경 사유(필수)
 */
export const writeBaseline = (section, data, reason) => {
  if (!reason || !reason.trim()) {
    throw new Error(
      "--reason=\"...\" 가 없다. 기준선 갱신은 **의도된 변경임을 사람이 적는 행위**다 — " +
        "사유 없는 갱신은 회귀를 기준선으로 승격시킨다.",
    );
  }
  const b = readBaseline();
  const prev = b[section];
  b.$note = EMPTY.$note;
  b[section] = {
    recordedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    reason: reason.trim(),
    ...data,
  };
  if (prev) b[section].previous = { recordedAt: prev.recordedAt, reason: prev.reason };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(b, null, 2)}\n`, "utf8");
  return b[section];
};

export const parseReason = (argv) => {
  const a = argv.find((x) => x.startsWith("--reason="));
  return a ? a.slice("--reason=".length) : "";
};
