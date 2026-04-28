# inel_scheduler 연동/배포 조사 노트 (2026-04-08)

> 목적: 현재 기획에서 핵심 쟁점인 치지직 실시간성, 네이버 카페 배포 가능성, 앱/웹 운영 구조를 공식 문서 근거 기반으로 정리한다.

---

## 1) 조사 요약 (TL;DR)

- 치지직은 `liveTitle`, `liveCategoryValue`를 API로 조회할 수 있다.
- 다만 현재 공개 문서 기준, 방송 제목/카테고리 변경을 직접 push해주는 전용 실시간 이벤트는 확인되지 않았다.
- 따라서 방송 제목/카테고리 타임라인은 **준실시간 폴링 기반**이 현실적이다.
- 네이버 카페는 공식 API로 게시글 작성이 가능하다.
- 카페 API를 사용하면 스케줄러 배포 결과를 카페 게시글로 자동/반자동 전송할 수 있다.
- 제품 구조는 "내부 운영(관리자/편집자) + 외부 공개(시청자)"를 분리하는 하이브리드가 안정적이다.

---

## 2) 치지직 API 조사 결과

### 2-1. 확인된 내용

#### A. Live API
- 라이브 목록 조회에서 아래 필드를 확인 가능
  - `liveTitle` (방송 제목)
  - `liveCategoryValue` (카테고리 이름)
  - `openDate` 등
- 참고 문서:
  - [CHZZK Live API](https://chzzk.gitbook.io/chzzk/chzzk-api/live)

#### B. Session API (소켓/이벤트 구독)
- 세션 기반 소켓 연결 가능
- 이벤트 구독 종류는 문서상 아래 중심
  - `CHAT`
  - `DONATION`
  - `SUBSCRIPTION`
- 방송 제목/카테고리 변경 이벤트에 대한 명시는 확인되지 않음
- 참고 문서:
  - [CHZZK Session API](https://chzzk.gitbook.io/chzzk/chzzk-api/session)

#### C. Chat API
- 채팅 전송, 공지, 채팅 설정 조회/변경 제공
- 방송 제목/카테고리 변경 이벤트 용도는 아님
- 참고 문서:
  - [CHZZK Chat API](https://chzzk.gitbook.io/chzzk/chzzk-api/chat)

#### D. Webhook
- 문서상 Webhook은 Drops 영역 이벤트 중심으로 확인됨
- 일반 방송 메타(title/category) 변경 Webhook으로는 확인되지 않음
- 참고 문서:
  - [CHZZK Drops Webhook](https://chzzk.gitbook.io/chzzk/drops/webhook)
  - [CHZZK Drops Guide](https://chzzk.gitbook.io/chzzk/drops/guide)

### 2-2. 해석 및 결론
- "완전 실시간(push-only)"로 제목/카테고리 타임라인 수집은 현재 공개 문서 기준 불확실.
- 실무 구현은 다음이 안전:
  1. 일정 주기 폴링으로 `liveTitle`/`liveCategoryValue` 조회
  2. 이전 스냅샷과 비교하여 변경점만 타임라인 append
  3. 앱 UI에서는 실시간처럼 보이도록 간격 최적화(예: 10~30초)

### 2-3. 구현 아이디어 (초안)
- `collector`가 채널별 현재 상태를 메모리/DB에 유지
- 변경 감지 시 이벤트 로그 생성
  - `changed_at`
  - `uptime_at_change`
  - `from_title` -> `to_title`
  - `from_category` -> `to_category`
- Full Replay `카테고리 타임라인` 컬럼에 직렬화 저장

---

## 3) 네이버 카페 API 조사 결과

### 3-1. 확인된 내용
- 카페 게시글 쓰기 API가 공식 제공됨
- 엔드포인트:
  - `POST https://openapi.naver.com/v1/cafe/{clubid}/menu/{menuid}/articles`
- 인증:
  - OAuth 2.0 (네이버 로그인 기반 Access Token)
- 주요 파라미터:
  - `subject`, `content` (필수)
  - `openyn`, `searchopen` 등 옵션
- 처리 한도(공식 소개 문서):
  - 카페 글쓰기: 계정당 일일 200건

### 3-2. 참고 문서
- [카페 API 명세](https://developers.naver.com/docs/login/cafe-api/cafe-api.md)
- [카페 API 소개](https://developers.naver.com/products/login/cafe/cafe.md)
- [네이버 오픈 API 목록](https://developers.naver.com/docs/common/openapiguide/apilist.md)

### 3-3. 적용 아이디어
- 관리자 배포 시 "카페 게시글 작성"을 후속 액션으로 제공
- 배포 결과(방송 주간/월간 요약 + 링크 모음)를 템플릿화
- 게시 모드는 2가지:
  1. 반자동: 초안 생성 후 관리자 확인 -> 게시
  2. 자동: 배포 성공 시 즉시 게시

---

## 4) 링크 난립 문제에 대한 정보 설계 아이디어

현재 우려:
- 이늘 노래책, 이늘 링크, 이늘 스케줄러 등 링크가 많아짐

제안:
- 카페에는 "허브 링크 1개"를 우선 배포
- 허브 페이지에 다음을 카드형으로 통합
  - 노래책
  - 링크 모음
  - 방송 스케줄러

효과:
- 시청자 진입점 단순화
- 게시글 업데이트 비용 감소
- 서비스 증가 시 확장 용이

---

## 5) 앱/웹 구조 고민 정리 (협업 + 방송)

### 5-1. 이슈 정리
- 협업 스케줄러를 앱으로만 하면 설치 부담이 있음
- 각 클라이언트가 시트를 직접 감시하면 리소스 비효율
- 웹 단일 페이지 공유 시 동시 수정 혼선 우려

### 5-2. 권장 구조 (하이브리드)
- 내부 운영:
  - 관리자/편집자용 Work Scheduler는 데스크톱 친화 UX 유지
  - 앱(Electron) 또는 내부 웹앱 중 선택 가능
- 외부 공개:
  - Broadcast Scheduler는 스냅샷 웹 제공

핵심은 앱/웹보다 **동기화 위치 분리**:
- 클라이언트가 직접 시트를 폴링하지 않고
- 중앙 sync worker가 Google Sheets + 치지직 API를 수집
- 클라이언트는 내부 API만 조회/수정

### 5-3. 기대 효과
- 클라이언트 리소스 감소
- 동시 편집 충돌 제어 용이
- 로그/재시도/감사 추적 일원화

---

## 6) 권한/도메인 분리 원칙 (확인사항 반영)

- Work Scheduler:
  - 관리자 + 편집자 공동 사용/수정
  - ShotGrid 스타일 테이블 중심 UX 적용
- Broadcast Scheduler:
  - 관리자 모드: 작성/수정/배포
  - 시청자 모드: 읽기 전용(스냅샷)

즉, 제품 경험은 통합하되 도메인 권한은 분리한다.

---

## 7) 다음 결정 포인트

1. 치지직 타임라인 수집 간격 확정 (예: 10초/20초/30초)
2. 카페 게시글 배포 모드 선택 (반자동 vs 자동)
3. 내부 운영 인터페이스 선택
   - Electron 우선
   - 내부 웹 우선
4. 중앙 sync worker 도입 여부 확정

---

## 8) 참고 링크 모음

### CHZZK
- [About CHZZK Developers](https://chzzk.gitbook.io/chzzk)
- [Live API](https://chzzk.gitbook.io/chzzk/chzzk-api/live)
- [Session API](https://chzzk.gitbook.io/chzzk/chzzk-api/session)
- [Chat API](https://chzzk.gitbook.io/chzzk/chzzk-api/chat)
- [Drops Webhook](https://chzzk.gitbook.io/chzzk/drops/webhook)

### NAVER Cafe
- [카페 API 명세](https://developers.naver.com/docs/login/cafe-api/cafe-api.md)
- [카페 API 소개](https://developers.naver.com/products/login/cafe/cafe.md)
- [오픈 API 목록](https://developers.naver.com/docs/common/openapiguide/apilist.md)
