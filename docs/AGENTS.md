# docs/ — 문서 관리 컨벤션

## 핵심 문서
| 파일 | 역할 | 동기화 의무 |
|---|---|---|
| `Dev_Rule.md` | 사람용 개발 규칙 원문 | 룰 변경 시 갱신 |
| `structure/code_flow.md` | **코드 지도**. 클래스/함수/컴포넌트 색인 | **신규/변경 시 즉시** |
| `plans/*.md` | 단계별 계획 / 연구 노트 | 단계 종료 시 마무리 메모 |

## `code_flow.md` 운영 규칙 (가장 중요)
1. **신규 코드 작성 전**: 같은 책임의 함수/컴포넌트가 이미 있는지 본 문서로 검색.
2. **신규 추가/수정 시**: 즉시 본 문서 반영.
3. **이동/삭제/이름 변경 시**: 본 문서도 같이 수정.
4. export 되는 것 위주. private 헬퍼는 생략.

> 이 규칙은 기존 `.cursor/rules/dev-rule.mdc` §1 의 핵심입니다. 어기면 같은 함수가 중복 구현되어 유지보수 비용 폭증.

## 문서 작성 톤
- 모든 본문 **한국어**.
- 코드 식별자/명령어/외부 라이브러리명은 영어 원문.
- 표(table) 적극 사용. 긴 산문 지양.
- 마크다운 헤더 깊이는 `###` 까지 권장 (최대 `####`).

## `plans/` 디렉토리
- 시점별 계획/리서치 노트. 날짜 prefix 사용: `2026-04-08_integration_research.md` 같은 형식 또는 기존 `integration_research_2026-04-08.md` 형식 유지.
- 단계 종료 시 결론/배운 점/다음 단계 섹션을 마지막에 추가.
- 오래된 계획도 삭제 금지 (히스토리). 참조 안 되면 `plans/archive/` 로만 이동.

## 사용자 가이드 HTML (`public/help/`)
docs/ 와 별개로 앱 안에서 열리는 사용자 가이드. 변경 시:
- `google-sheets-setup.html` — Google Cloud Console 셋업 단계별
- `ai-setup.html` — AI provider 키 발급
- `scheduler-app-guide.html` — 앱 사용법
- `public/help/gifs/*.gif` — 캡처 자료
- HTML 안의 텍스트/이미지 참조 깨지지 않게 주의. `<img src="gifs/...">` 상대 경로 유지.

## 새 문서 추가 시
1. 파일 위치 결정 (`docs/structure/`, `docs/plans/`, 또는 루트).
2. 마크다운 헤더 + 한 줄 요약 + 본문.
3. 다른 문서에서 링크 추가 (orphan 파일 만들지 않기).
4. `code_flow.md` 와 연관되면 cross-link.

## 절대 하지 말 것
- `code_flow.md` 를 갱신하지 않고 새 함수 추가.
- 외부 reference 코드의 본문을 그대로 docs 에 옮겨 적기 (저작권 + dev-rule.mdc §4 위반).
- 키/토큰/링크 같은 자격증명을 문서에 평문 기록.
