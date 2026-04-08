# inel_scheduler 프로젝트 계획서 (초안)

## 1) 목표
- 스트리머/편집자 협업용 편집 스케줄러와 시청자 공유용 방송 스케줄러를 하나의 프로젝트로 운영한다.
- 데이터 원천은 Google Sheets를 사용하고, 가능한 범위에서 치지직 API 데이터를 누적해 스케줄 정확도를 높인다.

## 2) 사용자 그룹
- 스트리머(본인): 전체 스케줄 작성/수정, 공개 여부 결정
- 편집자: 편집 작업 일정/상태/분량 업데이트
- 시청자: 공개된 방송 일정 확인 (월간/주간)

## 3) 핵심 기능

### A. 편집 파이프라인 스케줄러 (내부용)
- 항목: 작업일, 영상 구간/주제, 예상 분량(분), 포맷(Shorts/Longform), 우선순위, 상태
- 협업: 담당 편집자, 마감일, 코멘트, 변경 이력
- 뷰: 날짜 기반 캘린더 + 상태 기반 보드(예정/진행/검수/완료)

### B. 방송 예정 스케줄러 (공개용)
- 월간/주간 뷰 제공
- 공개 필드: 날짜, 시작 시간, 방송 카테고리/제목, 메모
- 내부 필드와 공개 필드를 분리해 민감 정보 비공개 처리

### C. 데이터 수집/누적
- Google Sheets를 마스터 데이터로 사용
- 치지직 API 연동 가능 항목을 주기적으로 수집하여 보조 데이터로 축적
- 예: 실제 방송 시작/종료 시각, 방송 식별자, 상태값 등

## 4) 기술 방향 (결정 전)
- 앱/웹은 미정
- 웹 선택 시: GitHub + Cloudflare 기반 운영
- 시청자 페이지는 `inel_songbook` 방식처럼 스냅샷(정적 결과) 중심으로 공개

## 5) 제안 아키텍처
- `data-source`: Google Sheets 읽기/쓰기
- `sync`: 치지직 API 수집 및 정규화
- `domain`: 편집 일정/방송 일정 비즈니스 로직
- `publish`: 공개용 스냅샷 생성
- `ui`: 내부 관리 화면 + 공개 뷰

## 6) 데이터 모델 초안

### edit_tasks (편집 작업)
- id, date, title, segment, expected_minutes, format, editor, status, due_date, note, updated_at

### stream_schedule (방송 일정)
- id, date, start_time, title, category, is_public, public_note, internal_note, updated_at

### stream_metrics (치지직 연동 데이터)
- id, stream_id, started_at, ended_at, collected_at, raw_status, normalized_status

## 7) 단계별 진행안
1. 문서/규칙 확정 (`docs`, `code_flow`, 개발 룰)
2. Google Sheets 스키마 확정
3. 기본 CRUD(내부용) 구현
4. 공개용 월간/주간 뷰 구현
5. 치지직 API 연동 및 누적 저장
6. 스냅샷 배포 자동화 (웹 선택 시)

## 8) 오픈 이슈
- 앱 vs 웹 최종 선택
- 치지직 API 인증 방식/호출 제한 확인
- 공개 스냅샷 갱신 주기(수동/자동) 결정
- 편집자 권한 범위(읽기/쓰기/승인) 결정
