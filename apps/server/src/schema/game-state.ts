import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";

/** 동기화되는 플레이어 상태 (모든 클라가 봄). 비밀 카드는 여기 넣지 않는다. */
export class Player extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("string") suspect = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("boolean") connected = true;
  @type("boolean") eliminated = false;
  /** NPC(봇) 여부. */
  @type("boolean") isBot = false;
  /**
   * 사람이 이탈해 **대리 중인** 좌석(로드맵 §8.1). `isBot`도 true다.
   * 순수 NPC(🤖)와 자리를 비운 사람(💤)을 표기로 구분하기 위한 공개 정보 — 비밀값 아님.
   */
  @type("boolean") awayBot = false;
  /** 현재 위치한 방(장소). 없으면 "" (복도). */
  @type("string") room = "";
}

/** 장물(훔친 것) 토큰 — 보드 위 위치(동기화). 제안 시 지목된 장물이 해당 방으로 이동. */
export class WeaponToken extends Schema {
  @type("string") value = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") room = "";
}

/** 고정 NPC(선택 안 된 십이지 6명) — 모서리에 배치, 다가가면 보너스(계략) 제공. */
export class HelperToken extends Schema {
  @type("string") value = ""; // 십이지 id
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") bonus = "peek"; // 보너스 종류(추후 확장)
  @type("boolean") used = false; // 이번 판 사용 여부
}

/** 방 전체 동기화 상태. 정답 봉투·손패는 서버 전용이라 여기 없음. */
export class GameState extends Schema {
  /** lobby | playing | ended */
  @type("string") phase = "lobby";
  /** 방장(host) sessionId — 첫 입장자. 게임 시작 권한. */
  @type("string") host = "";
  /** 현재 턴 플레이어의 sessionId */
  @type("string") currentTurn = "";
  @type(["string"]) turnOrder = new ArraySchema<string>();
  @type({ map: Player }) players = new MapSchema<Player>();
  /** 승자 sessionId (없으면 "") */
  @type("string") winner = "";
  /** 현재 턴 플레이어의 남은 이동 칸 수(주사위). 0이면 이동 불가. */
  @type("number") stepsLeft = 0;
  /**
   * 현재 턴이 자동으로 넘어가는 시각(서버 `clock.currentTime` 기준 ms). 0이면 제한 없음
   * (솔로 = 사람 1명이면 클럭을 끈다 — 로드맵 §8.2).
   * **공개 정보다** — 누구의 턴이 언제 끝나는지는 전원이 동등하게 알아야 하는 값이고,
   * 정답·손패와 무관하다(비밀 정보 동기화 금지 규약에 저촉되지 않는다).
   */
  @type("number") turnEndsAt = 0;
  /** 공통 단서(모두 공개·정답 아님). 솔로(사람1)일 때 추리 보조로 일부 공개. */
  @type(["string"]) commonCards = new ArraySchema<string>();
  /** 장물(훔친 것) 토큰들(보드 위 위치). */
  @type({ map: WeaponToken }) weapons = new MapSchema<WeaponToken>();
  /** 고정 NPC(계략 제공) — 선택 안 된 십이지 6명, 모서리 배치. */
  @type({ map: HelperToken }) helpers = new MapSchema<HelperToken>();
}
