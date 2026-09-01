/**
 * 참가 시도 문지기 — **추측에 대가를 붙인다.**
 *
 * 왜 필요한가(54회차 검수 실측): 방 코드를 «부를 수 있게» 만들며 엔트로피가
 * **2⁵⁴ → 2⁴⁰**으로 떨어졌다. 그런데 참가 실패에 아무 대가가 없어 localhost 병렬
 * 20연결로 **초당 9,615회** 추측이 통했다 — 동시 방 100개면 아무 비공개 방이나
 * 평균 18.6분에 열렸다. 비공개 방은 코드가 **유일한 자물쇠**다.
 *
 * 🔴 **세는 것은 «없는 방을 부른 횟수»다.** 두 번 좁혔다.
 *   ① 초안은 **시도**를 셌다 → 이 게임은 **한 Wi-Fi에 모여 하는 파티 게임**이라
 *      가정·교실·사무실이 IP 하나를 공유한다. 시도를 세면 정상 참가가 예산을 먹는다.
 *   ② 그래서 **실패**를 셌다 → 실증에서 또 뒤집혔다. 방은 6석이라 7번째 사람의 실패,
 *      판이 시작된 방(`locked`)에 링크로 들어온 사람의 실패가 **전부 정상**인데
 *      그것들이 예산을 먹고, 다 쓰면 **정상 참가까지 429로 갇혔다**(실측).
 *   ③ 위협은 «없는 코드를 찍어 보는 것» 하나다. Colyseus는 «없음»과 «잠김»에
 *      **같은 코드(4212)**를 쓰므로 응답으로는 못 가른다 — 그래서 **직접 조회**한다.
 *      만석·잠김·시작됨은 방이 **있으므로** 예산을 안 먹는다.
 *
 * 시계를 주입받는 순수 함수다 — 그래야 게이트가 잴 수 있다(저장소 규칙).
 */

/** 창 길이. 짧으면 정상 사용이 걸리고 길면 기억이 무거워진다. */
export const JOIN_WINDOW_MS = 60_000;

/**
 * **있는 방**으로 가는 길에 거는 느슨한 예산.
 * 🔴 초안은 있는 방을 **무제한**으로 통과시켰다. 그런데 `joinById`는 호출마다 **좌석 예약**을
 * 하나 잡으므로, 코드를 아는 사람이 6번씩 던지면 그 방은 **영구히 못 들어오게 된다**
 * (검수 실증: 6석 방에 30회 → 예약 5·만석 25, 목록에서도 사라짐).
 * 정상 사용(한 판에 사람 6명 + 재접속 몇 번)은 분당 60에 한참 못 미친다.
 */
export const JOIN_MAX_EXISTING_PER_WINDOW = 60;

/**
 * 한 창에서 허용하는 **«없는 방» 호출** 횟수.
 *
 * 근거: 사람이 **존재하지도 않는** 코드를 치는 횟수는 한 자릿수다(오타·만료된 링크).
 * 있는 방에 대한 실패(만석·시작됨)는 안 세므로 한 IP에 여러 명이 몰려도 예산을 안 먹는다.
 * 공격자에게는 **초당 9,615 → 분당 20**이라 2⁴⁰을 훑는 데 «수만 년»이 든다.
 */
export const JOIN_MAX_PER_WINDOW = 20;

type Bucket = { hits: number[] };

/**
 * 기억할 수 있는 키의 상한.
 * 🔴 초안은 상한도 축출도 없었다 — `sweep`은 **그 키를 다시 만졌을 때만** 도는데,
 * 공격자가 IP를 바꿔 가며 두드리면 그 키들은 **영영 다시 안 만져진다.**
 * 검수 실측: 서로 다른 키 100만 개 → heap **+301.4 MB**, 창이 지나도 `size()`가 100만 그대로.
 * 「메모리 전용이다」라는 각주는 **누수를 설명하지 않는다.**
 */
export const JOIN_MAX_KEYS = 20_000;

export type JoinGuard = {
  /** 창 밖으로 나간 통을 실제로 **버린다.** 안 부르면 키가 무한히 쌓인다. */
  evict: (now: number) => number;
  /** 통과시킬지 **판단만** 한다 — 기록은 실패했을 때만(`recordFailure`). */
  allow: (key: string, now: number) => boolean;
  /** «없는 방»을 부른 것 하나를 예산에서 깎는다. */
  recordMiss: (key: string, now: number) => void;
  /** 다음 시도까지 남은 밀리초(거절 응답에 싣는다). */
  retryAfterMs: (key: string, now: number) => number;
  /** 지금 **실제로 들고 있는** 키 수(빈 통 포함) — 누수를 보려고 있다. */
  size: () => number;
};

/**
 * ⚠️ **메모리 안에만 있다.** 프로세스가 여럿이면 프로세스마다 따로 센다 —
 * 지금 배포는 단일 인스턴스이므로 성립하고, 늘어나는 순간 공유 저장소가 필요하다.
 * 그 사실을 여기 적어 두는 이유는, **모르고 늘리면 자물쇠가 조용히 약해지기** 때문이다.
 */
export const createJoinGuard = (
  maxPerWindow: number = JOIN_MAX_PER_WINDOW,
  windowMs: number = JOIN_WINDOW_MS,
  maxKeys: number = JOIN_MAX_KEYS,
): JoinGuard => {
  const buckets = new Map<string, Bucket>();
  /** 축출을 매번 돌면 비싸다 — 기록이 쌓일 때마다 가끔 돈다. */
  let sinceEvict = 0;

  /** 창 밖으로 나간 기록을 버린다. 안 버리면 IP 수만큼 메모리가 영원히 자란다. */
  const sweep = (b: Bucket, now: number): void => {
    const cut = now - windowMs;
    let i = 0;
    while (i < b.hits.length && (b.hits[i] as number) <= cut) i++;
    if (i > 0) b.hits.splice(0, i);
  };

  return {
    allow: (key, now) => {
      const b = buckets.get(key);
      if (!b) return true;
      sweep(b, now);
      /* 거절 자체는 «기억»에 안 남긴다 — 남기면 거절당한 시도가 다음 창의 예산을
         미리 먹어 공격자가 창을 **영원히 연장**할 수 있다. */
      return b.hits.length < maxPerWindow;
    },
    recordMiss: (key, now) => {
      const b = buckets.get(key) ?? { hits: [] };
      sweep(b, now);
      b.hits.push(now);
      buckets.set(key, b);
      /* 상한을 넘기 전에 청소한다. 청소해도 안 줄면 **가장 오래된 것부터 버린다** —
         `Map`은 삽입 순서를 지키므로 앞에서부터가 곧 오래된 순이다.
         ⚠️ 버려진 키는 예산이 초기화된다. 그래도 «기억이 무한히 자라는 것»보다 낫고,
            상한이 2만이라 정상 트래픽으로는 닿지 않는다. */
      if (++sinceEvict >= 512 || buckets.size > maxKeys) {
        sinceEvict = 0;
        for (const [k, v] of buckets) {
          sweep(v, now);
          if (v.hits.length === 0) buckets.delete(k);
        }
        while (buckets.size > maxKeys) {
          const oldest = buckets.keys().next();
          if (oldest.done) break;
          buckets.delete(oldest.value);
        }
      }
    },
    evict: (now) => {
      let dropped = 0;
      for (const [k, v] of buckets) {
        sweep(v, now);
        if (v.hits.length === 0) {
          buckets.delete(k);
          dropped++;
        }
      }
      return dropped;
    },
    retryAfterMs: (key, now) => {
      const b = buckets.get(key);
      if (!b || b.hits.length === 0) return 0;
      sweep(b, now);
      if (b.hits.length < maxPerWindow) return 0;
      return Math.max(0, (b.hits[0] as number) + windowMs - now);
    },
    /* ⚠️ **실제로 들고 있는 키 수를 그대로 돌려준다.** 초안은 «빈 통은 안 센다»로
       걸러서, 정작 누수를 재야 할 때 **실제 크기를 숨겼다**(검수 지적). */
    size: () => buckets.size,
  };
};

/**
 * 요청에서 «누구인가»를 뽑는다.
 *
 * 🔴 **`X-Forwarded-For`를 그냥 믿으면 위조된다** — 헤더 한 줄로 IP를 바꿔 가며
 * 상한을 무한히 우회할 수 있다. 프록시가 **몇 홉인지**를 배포가 알려 줄 때만 읽는다.
 */
export const clientKey = (
  headers: Record<string, string | string[] | undefined>,
  remoteAddress: string | undefined,
  trustProxyHops: number,
): string => {
  /* 🔴 **맨 «왼쪽»을 믿으면 아무 의미가 없다.** 표준 프록시는 `X-Forwarded-For`에
     **덧붙이므로** 왼쪽 값은 **클라이언트가 써 넣은 것**이다. 초안이 그걸 썼고, 검수가
     헤더 한 줄로 200회를 전부 통과시켰다(차단 0) — 바로 위 주석이 경고한 그 우회를
     **켜는 코드**를 쓴 셈이다.
     프록시 홉 수를 아는 것은 **배포뿐**이다. `TRUST_PROXY=<n>`으로 받아
     **오른쪽에서 n번째**를 쓴다(n번째 홉이 써 준 값 = 그 앞의 진짜 상대). */
  if (trustProxyHops > 0) {
    const xff = headers["x-forwarded-for"];
    const raw = Array.isArray(xff) ? xff.join(",") : xff;
    const list = (raw ?? "").split(",").map((v) => v.trim()).filter(Boolean);
    const picked = list[list.length - trustProxyHops];
    if (picked) return picked;
  }
  return remoteAddress ?? "unknown";
};

/**
 * 매치메이크 경로 중 **추측할 것이 있는 것**에서 대상 방 id를 뽑는다.
 * 아니면 `null` — 방 만들기·공개방 목록은 추측할 것이 없다.
 *
 * 🔴 **라우터와 «같은 눈»으로 봐야 한다.** 초안은 `/\/matchmake\/joinById\/([^/?#]+)/`라는
 * 자기만의 엄격한 경로 정규식을 썼는데, Colyseus는 `req.url`을 **토큰으로 쪼개** 라우팅한다
 * (`Server.js`: `url.match(controller.allowedRoomNameChars)` → `indexOf("matchmake")+1/+2`).
 * 두 파서가 다른 URL을 보면 **한쪽만 통과하는 틈**이 생긴다 — 검수 실측:
 *   `/matchmake/joinById//AAAA0002` · `/matchmake//joinById/AAAA0004`
 *   → 문지기는 «내 길이 아니다»로 흘려보내고 Colyseus는 정상 참가로 처리했다.
 *   그 틈으로 **초당 35,088회**가 지나갔다 — 자물쇠 효과 0.
 * 그래서 토크나이저를 **주입받는다.** 호출부가 `matchMaker.controller`의 것을 그대로 넘기므로
 * 둘이 갈라질 수 없다.
 *
 * 🔴 **디코딩하지 않는다.** 초안의 `decodeURIComponent`는 `%ZZ` 하나에 `URIError`를 던졌고,
 * 그것이 `async` 리스너 안이라 **요청 한 개로 프로세스가 죽었다**(검수 실증 — 변경 전 서버는
 * 같은 요청에 정상 응답했다). Colyseus 자신도 디코딩하지 않는다.
 */
export const joinByIdTarget = (
  url: string | undefined,
  allowedRoomNameChars: RegExp,
  matchmakeRoute: string,
): string | null => {
  if (typeof url !== "string") return null;
  /* `g` 플래그가 붙은 정규식은 `lastIndex`를 들고 다닌다 — 그대로 쓰면 호출마다 결과가 갈린다.
     `String.match`는 `g`일 때 `lastIndex`를 안 쓰지만, 넘겨받은 것이 무엇이든 안전하도록 새로 만든다. */
  const re = new RegExp(allowedRoomNameChars.source, allowedRoomNameChars.flags.includes("g") ? allowedRoomNameChars.flags : `${allowedRoomNameChars.flags}g`);
  const tokens = url.match(re);
  if (!tokens) return null;
  const i = tokens.indexOf(matchmakeRoute);
  if (i < 0 || tokens[i + 1] !== "joinById") return null;
  return tokens[i + 2] ?? null;
};
