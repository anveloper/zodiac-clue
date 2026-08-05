// 공개 문서 사이트(zodiac-clue.vercel.app/docs/)에서 제외할 내부 문서.
// 단일 소스: gen-docs-manifest.mjs(트리 목록)와 copy-public-docs.mjs(파일 복사)가 함께 참조한다.
//
// 제외 기준 — "아직 안 한 일 목록"과 "자기 결함 목록"은 산출물이 아니다.
// 반대로 개발일지(logs)와 완료 플랜(plans/done)은 남긴다: 결함이 아니라
// "AI 에이전트 워크플로로 개발했다"의 증거물이다.

/** 디렉토리 단위 제외 (docs/ 기준 상대 경로 접두) */
export const PRIVATE_DIRS = [
  "planning", // 상류 리서치·회의록 (NHN 매출 분석·상금 계산 등)
  "plans/active", // 진행 중 작업 = 미완 목록
  "plans/hold", // 보류 목록
];

/** 파일 단위 제외 (docs/ 기준 상대 경로, 확장자 제외한 basename 매칭) */
export const PRIVATE_FILES = [
  "submission/05-team-roles", // ⑤ 최종본 — 실명 포함이라 공개 docs 사이트엔 배포하지 않는다(로컬·PDF 제출만)
  "design/submission-checklist", // 미제작 항목·심사 프로세스 메모
  "design/20260728-team-roles", // ⑤ 초안(미확정·[확인 필요] 포함)
  "design/20260728-video-storyboard", // 미구현 기능 표시가 드러남
  "design/20260727-improvement-roadmap", // 자기 결함 목록
  "design/20260729-mafia-content-design", // 오염 지점 11건 = 자기 결함 목록. 표제도 «분리는 성립하지 않는다»다
  "design/20260727-execution-plan", // 남은 일정·컷라인
  "plans/done/13-execution-plan-merge", // 위 두 문서를 경로로 지목하는 작업 기록
  "design/20260728-agent-loop-workflow", // 내부 작업 절차(런북) — 산출물이 아니다
];

/**
 * 로컬 전용 마니페스트 — 내부 문서까지 포함한 **전체** 트리.
 * `docs/index.html`이 «로컬일 때만» 이 파일을 읽어 내부 문서를 보여준다.
 *
 * 배포 산출물에 이 파일이 **없다**는 것이 비공개의 1차 방어선이다(요청 차단은 2차).
 * 그래서 아래 `isPrivateDocPath`가 이 이름을 항상 비공개로 판정한다 —
 * `copy-public-docs.mjs`가 같은 함수로 거르므로 복사에서 자동 제외된다.
 */
export const LOCAL_MANIFEST = "manifest.local.json";

/** docs/ 기준 상대 경로가 비공개 대상인지 */
export const isPrivateDocPath = (rel) => {
  const p = rel.replace(/\\/g, "/");
  if (p === LOCAL_MANIFEST) return true;
  if (PRIVATE_DIRS.some((d) => p === d || p.startsWith(`${d}/`))) return true;
  const noExt = p.replace(/\.(md|html)$/i, "");
  return PRIVATE_FILES.includes(noExt);
};
