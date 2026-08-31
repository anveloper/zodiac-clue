/**
 * 방 코드 — **사람이 부르고 받아 적는** 방 식별자.
 *
 * 왜 엔진 층인가: 주제를 모른다. 어떤 게임이든 「친구에게 불러 주는 방 번호」는 필요하다.
 *
 * 왜 만들었나(53회차 검수 실측): Colyseus 기본 id는 `nanoid(9)`이고 알파벳 64자에
 * **대소문자가 섞이며 `-`와 `_`가 둘 다 있다.** 9자 중 하나라도 그 둘을 포함할 확률이
 * **24.8%**다(실측 `gkzuKFC5_`는 밑줄로 끝난다). 「대문자 케이 / 소문자 지 / 밑줄」은
 * 한국어로 불러 줄 자연스러운 말이 없다 — **등폭 서체로는 못 고치는 축**이다
 * (서체는 `0`/`O` 같은 «모양» 혼동만 줄인다).
 */

/**
 * **Crockford base32** — `I`·`L`·`O`·`U`가 없다.
 * `O`가 없으니 `0`이, `I`/`L`이 없으니 `1`이 **혼동 상대를 잃는다.**
 * `U`는 우연한 욕설을 피하는 관례다.
 */
export const ROOM_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * 32⁸ = **2⁴⁰ ≈ 1.1조**.
 *
 * 🔴 **길이는 «부르기 편함»이 아니라 «자물쇠 세기»가 정한다.** 초안은 6자(2³⁰)였는데,
 * 검수가 실제로 뚫었다: localhost 병렬 20연결로 존재하지 않는 코드에 `joinById`를 던져
 * **초당 9,615회**, 동시 방 100개면 아무 비공개 방이나 **평균 18.6분**에 열렸다.
 * 비공개 방은 이 코드가 **유일한 자물쇠**이고 서버에 참가 실패 레이트리밋이 없다
 * (`grep -rn "rateLimit|throttle|onAuth" apps/server/src` → 0건).
 *
 * ⚠️ **옛 `nanoid(9)`(64⁹ = 2⁵⁴)와 «같은 급»이 아니다** — 초안 주석이 그렇게 적었는데
 * 거짓이었다. 8자로 늘려도 **2⁴⁰**으로, 여전히 **2¹⁴ = 16,384배 약하다.**
 * 그 대가로 얻은 것이 «불러 줄 수 있음»이고, 남은 격차는 **레이트리밋으로 갚아야 한다**
 * (다음 회차 후보). 같은 실측 속도로 동시 방 1000개 기준 6자 1.9분 → 8자 **약 34시간**이다.
 */
export const ROOM_CODE_LEN = 8;

/** 표시할 때 끊어 읽는 단위 — `ABCD-EFGH`. **값 자체에는 하이픈이 없다.** */
export const ROOM_CODE_GROUP = 4;

/** 정규화를 마친 코드가 만족해야 하는 모양. */
export const ROOM_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/**
 * 바이트열 → 코드. **난수는 부르는 쪽이 준다** — 비공개 방은 코드가 유일한 자물쇠라
 * 서버는 암호학적 난수를 넣어야 한다(`Math.random`은 예측 가능하다).
 * 256 % 32 === 0 이므로 `byte % 32`에 **모듈로 편향이 없다.**
 */
export const roomCodeFromBytes = (bytes: Uint8Array): string => {
  /* 🔴 모자란 바이트를 `0`으로 채우면 **자물쇠에 구멍이 뚫린다** — 초안은 `bytes[i] ?? 0`으로
     조용히 넘겼다. 이 함수가 만드는 것은 비공개 방의 유일한 자물쇠다. */
  if (bytes.length < ROOM_CODE_LEN) {
    throw new RangeError(`방 코드에는 ${ROOM_CODE_LEN}바이트가 필요하다(받은 것: ${bytes.length})`);
  }
  let out = "";
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    out += ROOM_CODE_ALPHABET[(bytes[i] as number) % ROOM_CODE_ALPHABET.length];
  }
  return out;
};

/**
 * 사람이 친 것을 코드로 되돌린다. **새 모양이 아니면 `null`** —
 * 옛 형식(`nanoid`) id를 대문자로 올려 망가뜨리지 않기 위해서다.
 *
 * Crockford의 입력 규약을 그대로 쓴다: 사람이 `O`를 치면 `0`, `I`/`L`을 치면 `1`로 읽는다.
 * 그 글자들은 알파벳에 없으므로 **되돌릴 값이 하나뿐이라** 모호하지 않다.
 */
export const normalizeRoomCode = (raw: string): string | null => {
  /* 🔴 **하이픈을 아무 데서나 벗기면 옛 id가 새 코드로 둔갑한다.** 초안이 그랬고
     검수가 실증했다: `"xy-z1-2-3"` → `"XYZ123"`. 옛 링크가 **조용히 남의 방으로 간다.**
     그래서 받아 주는 모양은 둘뿐이다 — **민값**(`ABCDEFGH`)과 **화면에 보이는 그대로**
     (`ABCD-EFGH`). 그 밖의 하이픈 배치는 «새 코드가 아니다»로 본다. */
  const s = raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  const bare = ROOM_CODE_RE.test(s)
    ? s
    : new RegExp(
        `^([0-9A-HJKMNP-TV-Z]{${ROOM_CODE_GROUP}})-([0-9A-HJKMNP-TV-Z]{${ROOM_CODE_LEN - ROOM_CODE_GROUP}})$`,
      ).exec(s);
  if (typeof bare === "string") return bare;
  return bare ? `${bare[1]}${bare[2]}` : null;
};

/** `ABC123` → `ABC-123`. 끊어 주면 한 번에 세 글자씩 부르고 받아 적는다. */
export const formatRoomCode = (code: string): string =>
  ROOM_CODE_RE.test(code)
    ? `${code.slice(0, ROOM_CODE_GROUP)}-${code.slice(ROOM_CODE_GROUP)}`
    : code;
