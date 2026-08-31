# eval-narrator 리포트 (자동 생성)

> 이 파일은 `node scripts/eval-narrator.mjs`가 매 실행마다 덮어쓴다. **직접 편집하지 마라.**
> 생성 2026-08-31T22:14:11.185Z · 모드 **offline** · seed 20260728 · 명세 ④ §3

## 결과: PASS

오프라인 모드 — **Gemini 호출 0건**. 실호출이 필요한 규칙(C2raw·C7)은 미판정으로 남는다.

## 스위트

| 스위트 | 표본 | 통과 | 실패 |
|---|---|---|---|
| §3.1 36케이스 (오프라인 · 폴백 경로 전 문안) | 130 | 130 | 0 |
| 폴백 전수 스윕 | 112752 | 112752 | 0 |
| 실호출 (미실행(기본 오프라인 모드 — 실호출은 --live로만)) | 0 | 0 | 0 |

## 판정 불가로 남긴 것

- **L1 [C2(원문) · 프롬프트 준수율]** LLM **원문**의 길이(12~40, 기준 ≥33/36)와 정규화 발동률(=프롬프트 준수율) — 사유: 계측은 부착돼 있다(narrate → SayAi.rawLen·norm). 그러나 원문은 실호출에서만 생긴다 — 오프라인 실행에는 판정할 표본 자체가 없다.
- **L2 [C7]** 경로·지연 분포(LLM 성공률 ≥90% · p50 ≤1200ms · p95 ≤2500ms · 타임아웃 0) — 사유: 실제 왕복 없이는 성립하지 않는다. 오프라인 모드에서는 미판정.
- **L3 [C2(하한)]** 12자 하한 — 사유: 코드에 강제 수단이 없다(④ §2.3 '최소 길이 미강제' — 알려진 간극). 비차단 계측만 한다.
- **L4 [C5 ①]** `후원`(장소 라벨 ∧ 일반 명사)의 자동 판정 — 사유: ④ §3.2가 자동 FAIL이 아니라 수동 확인 큐로 격리하라고 규정했다.
- **L5 [C6]** 실서버 판의 `hands` 스냅샷과의 대조 — 사유: 룸 인스턴스를 띄워야 하므로 이 스크립트 범위 밖이다. 대신 검증기 로컬 결정론 딜 + **27라벨 전체를 손패로 가정한 상위집합 검사(C5 ①)**로 판정했다 — 결론은 실제 hands 대조보다 강하다(어떤 딜이 나와도 성립).
- **L6 [C2(상한 수치)]** 문서 §3.2의 '정규화본 ≤80' — 사유: 07-28 문장경계 절단 도입 전 값이라 낡았다. 코드 상수 LINE_MAX=40로 판정했다(문서 쪽 정정 필요).

## 기계 판독용

```json
{
  "tool": "eval-narrator",
  "spec": "docs/design/20260720-ai-tech-doc.md §3",
  "mode": "offline",
  "seed": 20260728,
  "generatedAt": "2026-08-31T22:14:11.185Z",
  "source": {
    "narrator": "apps/server/src/ai/narrator.ts",
    "cards": "packages/shared/src/content/clue/cards.ts",
    "LINE_MAX": 40,
    "LINE_BUDGET_SUGGEST": 25
  },
  "preconditions": [
    {
      "id": "P1",
      "name": "라벨 27종 상호 비포함 (부분문자열 스캔의 전제)",
      "pass": true,
      "detail": "라벨 27종 · 포함쌍 0"
    },
    {
      "id": "P2",
      "name": "폴백 문안 강제 열거가 전수다 (자연 샘플 2,000회 이탈 0)",
      "pass": true,
      "detail": "이탈 0 — 분기별 문안 수 가정 정확"
    },
    {
      "id": "P3",
      "name": "오프라인 모드에서 네트워크 호출 0건 (fetch 트랩)",
      "pass": true,
      "detail": "globalThis.fetch 트랩 발동 0 — Gemini 무료 쿼터 소모 없음"
    },
    {
      "id": "P4",
      "name": "판정기 자기검사 — 알려진 위반을 실제로 FAIL로 잡는다",
      "pass": true,
      "detail": "음성 17건 · 양성 9건 전부 기대대로"
    },
    {
      "id": "P5",
      "name": "정규화 실측 — 중간 마크업 제거 ∧ 정상 문장(낫표·말줄임표) 보존 (④ §2.3)",
      "pass": true,
      "detail": "위반 문장 9종 교정 · 정상 문장 5종 바이트 동일 · 교정 결과 전건 C3 통과"
    },
    {
      "id": "P6",
      "name": "상한 초과 구제 — 어절 중간 절단 없이 살리고, 공백 없는 덩어리는 폐기",
      "pass": true,
      "detail": "합성 코퍼스 16종(41~50자, 종결부호 끝에만) 전건 구제 · 이전 규칙 생존 0/16 → 현재 16/16 · 공백 없는 덩어리 2종은 그대로 폐기"
    }
  ],
  "statics": [
    {
      "id": "S1",
      "name": "NarrationInput에 정답 봉투·손패 필드가 존재하지 않는다 (§2.2)",
      "pass": true,
      "detail": "필드 11종 [name, action, suspect, weapon, room, hint, persona, tone, intro, outro, disproved] · 금지 필드 0"
    },
    {
      "id": "S2",
      "name": "narrator.ts가 규칙엔진/상태 스키마를 import하지 않는다",
      "pass": true,
      "detail": "import [@zodiac-clue/shared, ../util/josa, ./telemetry]"
    },
    {
      "id": "S3",
      "name": "narrate()가 참조하는 입력 필드가 §2.1 입력 계약 안에 있다",
      "pass": true,
      "detail": "참조 [action, suspect, weapon, room, hint, disproved, name, persona, tone] · intro/outro LLM 경로 사용 없음(§2.1 부합)"
    },
    {
      "id": "S4",
      "name": "요청에 이전 대사 히스토리가 없다 (§2.2 인젝션 표면 0)",
      "pass": true,
      "detail": "contents = 단일 user 턴"
    },
    {
      "id": "S5",
      "name": "요청 payload의 텍스트 출처가 SYSTEM·userText 둘뿐이다",
      "pass": true,
      "detail": "text 슬롯 [SYSTEM, userText]"
    }
  ],
  "suites": {
    "A": {
      "name": "§3.1 36케이스 (오프라인 · 폴백 경로 전 문안)",
      "total": 130,
      "rules": {
        "C1": {
          "pass": 130,
          "total": 130
        },
        "C2": {
          "pass": 130,
          "total": 130
        },
        "C3": {
          "pass": 130,
          "total": 130
        },
        "C4": {
          "pass": 130,
          "total": 130
        },
        "C5": {
          "pass": 130,
          "total": 130
        },
        "C6": {
          "pass": 48,
          "total": 48
        }
      },
      "lengthStats": {
        "n": 130,
        "min": 16,
        "max": 40,
        "mean": 30.43,
        "p95": 40
      },
      "byAction": {
        "suggest": {
          "budget": 25,
          "n": 40,
          "over": 0,
          "mean": 20.73,
          "min": 16,
          "max": 25,
          "decoRate": 85
        },
        "accuse": {
          "budget": 40,
          "n": 36,
          "over": 0,
          "mean": 37.06,
          "min": 29,
          "max": 40,
          "decoRate": 100
        },
        "scheme": {
          "budget": 40,
          "n": 48,
          "over": 0,
          "mean": 34.83,
          "min": 24,
          "max": 40,
          "decoRate": 100
        },
        "suggest(반증)": {
          "budget": 25,
          "n": 6,
          "over": 0,
          "mean": 20.17,
          "min": 18,
          "max": 24,
          "decoRate": 100
        }
      },
      "under12": 0,
      "manualQueue": [],
      "failures": []
    },
    "B": {
      "name": "폴백 전수 스윕",
      "total": 112752,
      "rules": {
        "C1": {
          "pass": 112752,
          "total": 112752
        },
        "C2": {
          "pass": 112752,
          "total": 112752
        },
        "C3": {
          "pass": 112752,
          "total": 112752
        },
        "C4": {
          "pass": 112752,
          "total": 112752
        },
        "C5": {
          "pass": 112752,
          "total": 112752
        },
        "C6": {
          "pass": 34992,
          "total": 34992
        }
      },
      "lengthStats": {
        "n": 112752,
        "min": 16,
        "max": 40,
        "mean": 29.29,
        "p95": 40
      },
      "byAction": {
        "suggest": {
          "budget": 25,
          "n": 31104,
          "over": 0,
          "mean": 21.55,
          "min": 16,
          "max": 25,
          "decoRate": 84.5
        },
        "suggest(반증)": {
          "budget": 25,
          "n": 23328,
          "over": 0,
          "mean": 21.03,
          "min": 16,
          "max": 25,
          "decoRate": 94.1
        },
        "accuse": {
          "budget": 40,
          "n": 23328,
          "over": 0,
          "mean": 37.12,
          "min": 28,
          "max": 40,
          "decoRate": 100
        },
        "scheme": {
          "budget": 40,
          "n": 34992,
          "over": 0,
          "mean": 36.46,
          "min": 21,
          "max": 40,
          "decoRate": 99.6
        }
      },
      "under12": 0,
      "manualQueue": [],
      "failures": []
    },
    "C": {
      "name": "실호출 (미실행(기본 오프라인 모드 — 실호출은 --live로만))",
      "total": 0,
      "rules": {},
      "lengthStats": null,
      "byAction": {},
      "under12": 0,
      "manualQueue": [],
      "failures": []
    }
  },
  "C7": {
    "judged": false,
    "reason": "C7(경로·지연 분포)은 실제 왕복 없이는 판정할 수 없다 — 오프라인 모드에서는 미판정으로 남긴다(추정 금지)."
  },
  "C2raw": {
    "judged": false,
    "reason": "C2(원문 기준)·프롬프트 준수율은 LLM 원문이 있어야 성립한다 — 오프라인에는 원문 자체가 없다. 미판정으로 남긴다(계측은 부착 완료: SayAi.rawLen/norm)."
  },
  "salvage": {
    "note": "합성 코퍼스 — 실측 표본이 아니다. 라이브가 관측한 형태(41~50자·종결부호 끝에만)의 재현.",
    "n": 16,
    "legacyKept": 0,
    "keptNow": 16,
    "tiers": {
      "sentence": 1,
      "clause": 0,
      "word": 16,
      "drop": 4
    },
    "rows": [
      {
        "rawLen": 41,
        "old": null,
        "now": "쯧쯧, 후원에서 술동이를 훔쳤다니 그 죄가 실로 무겁고 부끄러운…",
        "len": 36
      },
      {
        "rawLen": 41,
        "old": null,
        "now": "낄낄, 서재에서 떡시루를 집어간 자가 뱀 무녀라니 이거 참으로…",
        "len": 35
      },
      {
        "rawLen": 41,
        "old": null,
        "now": "어험— 안방에서 금고를 열어젖힌 자가 누구인지 내 반드시 밝혀내고…",
        "len": 37
      },
      {
        "rawLen": 46,
        "old": null,
        "now": "쯧쯧, 후원에서 술동이를 훔쳐 갔다니 그 죄가 실로 무겁고 부끄러운…",
        "len": 38
      },
      {
        "rawLen": 46,
        "old": null,
        "now": "저, 저기… 정지에서 잡채가 없어졌다는데 혹시 토끼 낭자가 그때…",
        "len": 36
      },
      {
        "rawLen": 46,
        "old": null,
        "now": "그거 아나, 대청에서 젓가락이 사라졌다는 소문이 벌써 온 동네에…",
        "len": 36
      },
      {
        "rawLen": 47,
        "old": null,
        "now": "어험— 안방의 금고를 열어젖힌 자가 대체 누구인지 내 오늘 반드시…",
        "len": 37
      },
      {
        "rawLen": 43,
        "old": null,
        "now": "저, 저기… 정지에서 잡채가 없어졌다는데 혹시 토끼 낭자가 다녀가지…",
        "len": 38
      },
      {
        "rawLen": 43,
        "old": null,
        "now": "그거 아나, 대청에서 젓가락이 사라졌다는 소문이 온 동네에 파다하게…",
        "len": 38
      },
      {
        "rawLen": 43,
        "old": null,
        "now": "사랑방에 감돌던 그 기운이 예사롭지 않으니 두고 보면 절로 알게 되는…",
        "len": 39
      },
      {
        "rawLen": 42,
        "old": null,
        "now": "고하오— 별당에서 선물이 사라진 건에 대하여 지체 없이 낱낱이…",
        "len": 35
      },
      {
        "rawLen": 44,
        "old": null,
        "now": "어이구, 행랑에서 떡시루를 가져간 이가 돼지 객주라면 밑질 거래는…",
        "len": 37
      },
      {
        "rawLen": 44,
        "old": null,
        "now": "어머, 서재의 금고를 만진 사람이 게코 도령이라니 눈치 못 챌 줄 알고…",
        "len": 40
      },
      {
        "rawLen": 43,
        "old": null,
        "now": "핫핫, 사랑채에서 술동이를 비운 자가 말 장수라는 것쯤은 내 눈은…",
        "len": 37
      },
      {
        "rawLen": 44,
        "old": null,
        "now": "허, 정지에서 잡채가 사라진 셈속을 따져 보면 답이 훤히 드러나는 법이…",
        "len": 40
      },
      {
        "rawLen": 43,
        "old": null,
        "now": "안방의 젓가락을 가져간 이가 황소 역사는 아니니 에두를 것 없이 말해…",
        "len": 39
      }
    ]
  },
  "unjudgeable": [
    {
      "id": "L1",
      "rule": "C2(원문) · 프롬프트 준수율",
      "what": "LLM **원문**의 길이(12~40, 기준 ≥33/36)와 정규화 발동률(=프롬프트 준수율)",
      "why": "계측은 부착돼 있다(narrate → SayAi.rawLen·norm). 그러나 원문은 실호출에서만 생긴다 — 오프라인 실행에는 판정할 표본 자체가 없다.",
      "unblock": "`--live`로 사람이 쿼터를 승인하고 실행하면 같은 실행에서 판정된다(원문 텍스트는 여전히 저장하지 않는다 — 길이·발동 종류만)."
    },
    {
      "id": "L2",
      "rule": "C7",
      "what": "경로·지연 분포(LLM 성공률 ≥90% · p50 ≤1200ms · p95 ≤2500ms · 타임아웃 0)",
      "why": "실제 왕복 없이는 성립하지 않는다. 오프라인 모드에서는 미판정.",
      "unblock": "`--live`로 사람이 쿼터를 승인하고 실행."
    },
    {
      "id": "L3",
      "rule": "C2(하한)",
      "what": "12자 하한",
      "why": "코드에 강제 수단이 없다(④ §2.3 '최소 길이 미강제' — 알려진 간극). 비차단 계측만 한다.",
      "unblock": "정규화에 하한 가드를 넣으면 차단 규칙으로 승격 가능."
    },
    {
      "id": "L4",
      "rule": "C5 ①",
      "what": "`후원`(장소 라벨 ∧ 일반 명사)의 자동 판정",
      "why": "④ §3.2가 자동 FAIL이 아니라 수동 확인 큐로 격리하라고 규정했다.",
      "unblock": "형태소 분석 없이는 자동화 불가 — 리포트 인쇄로 갈음(설계대로)."
    },
    {
      "id": "L5",
      "rule": "C6",
      "what": "실서버 판의 `hands` 스냅샷과의 대조",
      "why": "룸 인스턴스를 띄워야 하므로 이 스크립트 범위 밖이다. 대신 검증기 로컬 결정론 딜 + **27라벨 전체를 손패로 가정한 상위집합 검사(C5 ①)**로 판정했다 — 결론은 실제 hands 대조보다 강하다(어떤 딜이 나와도 성립).",
      "unblock": "해소 불필요 — 상위집합 검사가 더 강한 명제다."
    },
    {
      "id": "L6",
      "rule": "C2(상한 수치)",
      "what": "문서 §3.2의 '정규화본 ≤80'",
      "why": "07-28 문장경계 절단 도입 전 값이라 낡았다. 코드 상수 LINE_MAX=40로 판정했다(문서 쪽 정정 필요).",
      "unblock": "④ §3.2 표의 C2 기준을 LINE_MAX로 갱신."
    }
  ],
  "exitCode": 0
}
```
