// 한글 조사(助詞) 이형태 선택 — 앞말의 종성(받침) 유무로 고르는 순수 함수.
// 근거: docs/design/20260727-improvement-roadmap.md §7.14 · 20260727-ui-copy.md R6.
//   R6 — UI·로그 문장은 조사를 **회피**한다(라벨/화살표/낫표 어순). 이 헬퍼는 조사를
//   피할 수 없는 **NPC 대사 전용**이다. 새 로그 문안에 쓰지 말 것.
// 진실값(정답·판정)과 무관한 표현 계층 유틸이며 부작용·상태가 없다.

const HANGUL_BASE = 0xac00; // '가'
const HANGUL_LAST = 0xd7a3; // '힣'
const JONG_RIEUL = 8; // 종성 'ㄹ'의 인덱스

/**
 * 마지막 글자의 종성 인덱스(0=받침 없음, 1~27=받침 있음).
 * 마지막 글자가 한글 음절이 아니면(숫자·영문·기호·빈 문자열) `null`.
 */
const jongseong = (word: string): number | null => {
  const ch = word.trim().slice(-1);
  if (!ch) return null;
  const code = ch.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_LAST) return null;
  return (code - HANGUL_BASE) % 28;
};

/**
 * 받침 유무로 조사를 고른다. 예: `josa(w, "이", "가")`, `josa(w, "을", "를")`.
 * 폴백 — 한글 음절이 아닌 글자(숫자·영문·이모지)로 끝나면 **받침 없음**으로 보고
 * `withoutBatchim`을 쓴다(로마자·아라비아숫자 병기에서 오독이 가장 적은 선택).
 */
export const josa = (
  word: string,
  withBatchim: string,
  withoutBatchim: string,
): string => {
  const j = jongseong(word);
  return j === null || j === 0 ? withoutBatchim : withBatchim;
};

/** `로/으로` 예외 — 받침이 없거나 종성이 `ㄹ`이면 `로`, 그 외에는 `으로`. */
export const ro = (word: string): string => {
  const j = jongseong(word);
  return j === null || j === 0 || j === JONG_RIEUL ? "로" : "으로";
};
