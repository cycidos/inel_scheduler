---
name: sheets-sync
description: Google Sheets 양방향 동기화 — 헤더 정렬, 시트 누락 자동 보충, sheets-patch-row 패턴, 편집자별 service account 분리 모델. Use when the user mentions sheets, 시트, 동기화, 시트 헤더, 시트 정렬, 토큰 시트(_tokens), 시트 업로드 실패, 시트 다운로드, sheets-export, sheets-patch-row, sheets-import, 또는 service account 관련 작업.
---

# Google Sheets 동기화 — Inel Scheduler

## 한 줄 요약
"시트의 실제 헤더 순서를 진실로 삼는다" — 앱 schema 가 임의로 시트를 재배열하지 않는다. 앱 schema 에만 있는 컬럼은 시트 헤더 끝에 자동 append.

## 핵심 IPC 채널

| 채널 | 방향 | 용도 |
|---|---|---|
| `sheets-pick-keyfile` | renderer → main | 사용자가 SA JSON 파일 선택 (dialog) |
| `sheets-init-auth` | renderer → main | 키 경로로 인증 초기화 |
| `sheets-test-connection` | renderer → main | 시트 ID 추출 + 시트 목록 + clientEmail |
| `sheets-import` | renderer → main | 시트 → 앱 (전체 행 불러오기) |
| `sheets-export` | renderer → main | 앱 → 시트 (전체 행 쓰기, 날짜순 정렬) |
| `sheets-patch-row` | renderer → main | 단일 행 update/append (라이브 감지 패치용) |

## 시트 ↔ 앱 schema 매핑 규칙

### 1. 헤더 정렬은 시트가 진실
- `sheets-export` / `sheets-patch-row` 모두 시트의 헤더 row 를 먼저 읽음.
- 앱 schema 에만 있는 라벨은 시트 헤더 row 끝에 append.
- 시트에만 있는 라벨은 무시 (앱이 모르는 열은 안 건드림).
- 따라서 관리자가 시트 헤더 순서를 바꿔도 앱이 임의로 되돌리지 않음.

### 2. 2-row 구조 (shorts/longform)
- 영상별 row 가 2개: 공유 행(shared columns) + 담당자 행.
- `shared: true` 컬럼은 공유 row 에만 값. 담당자 row 는 그 컬럼 비움.
- `shared: false` 컬럼은 담당자 row 에만 값.
- 시트 export 시 두 row 를 연속으로 쓰기. import 시 연속 2-row 를 한 영상으로 합치기.

### 3. 1-row 구조 (fullReplay)
- 한 row = 한 방송 세션.
- `categoryTimeline`, `videoTitle` 은 multi-line 누적 (timeline 타입).

### 4. 날짜 정렬 (export 전용)
- `sheets-export` 직전 안정 정렬: `broadcastDate` 오름차순, 같으면 `broadcastStartTime` 오름차순, 같으면 원래 입력 순서.
- 빈 날짜는 항상 맨 끝.
- 이유: 사람이 시트 열었을 때 시간순으로 자연스럽게 보이도록.
- 앱 화면 정렬은 별도 (`sortOrderByTab`). 시트는 항상 오름차순 고정.

## sheets-patch-row 흐름 (라이브 감지 패치용)

```
1. 시트 헤더 row 읽기 (RAW)
2. 앱 schema 에 있는데 시트엔 없는 라벨 → 시트 헤더 끝에 append
3. 시트 전체 데이터 읽기 (matchPairs 로 행 찾기 위해)
4. matchPairs (예: [["videoTitle", "오늘방송"], ["broadcastDate", "2026-05-24"]]) 로 행 매칭
   - 매칭 1행: update
   - 매칭 0행: 새 행 append
   - 매칭 2+행: 첫 번째 매칭 update (다중 매칭은 경고 로그)
5. rowOut 배열은 시트의 현재 헤더 순서대로 만든다 (앱 schema 순서 X)
6. valueInputOption: USER_ENTERED (날짜 자동 인식)
```

## valueInputOption 선택
| 값 종류 | 옵션 | 이유 |
|---|---|---|
| 사용자 입력 (날짜/숫자/문자) | `USER_ENTERED` | 구글이 날짜를 진짜 날짜로 인식 |
| 헤더 row, 시스템 라벨 | `RAW` | 라벨에 `=` 시작하는 경우 수식 변환 방지 |

## 흔한 버그 패턴

### `방송일` 이 `46144` 같은 숫자로 표시
- 원인: 시트 헤더와 앱 schema 의 열 수/순서가 어긋나 날짜 컬럼이 다른 컬럼(숫자형)으로 들어감.
- 해결: `sheets-patch-row` 가 시트 헤더 기준으로 정렬 후 patch 하도록 보장 (현재 코드에 반영됨).

### `담당자` 컬럼 업로드 안 됨
- 원인: 2-row 구조에서 `shared` 플래그가 헷갈려 담당자 row 가 빈 값으로 쓰임.
- 해결: import/export 양쪽에서 `shared` 명시적 체크.

### 헤더 row 가 자꾸 늘어남
- 원인: 앱 schema 에서 컬럼 삭제 후 다시 export 했는데 시트엔 옛 컬럼이 남아 있음 + 앱은 새 컬럼을 append 함.
- 해결: 시트에서 사람이 직접 옛 컬럼 정리 필요. 자동 삭제는 의도적으로 안 함 (데이터 유실 위험).

## 편집자 인스톨러 — service account 분리 모델 (Phase 2)

### 보안 모델
- 키는 클라이언트에 임베드되면 노출됐다고 가정.
- 그래서 **편집자별 별도 service account 발급**:
  - 각 키는 작업 시트 1개에만 공유 권한.
  - 퇴직 시 그 키의 공유 권한만 해제 → 진짜 차단.
  - `_tokens` 시트 회수는 일상적 정지 (앱 정상 사용자 차단).
- 키 추출 우회는 `_tokens` 만으로는 못 막으므로, 구글 쪽 공유 권한 해제가 진짜 차단.

### `_tokens` 시트 스키마 (제안)
```
name | role | token | issuedAt | status | lastSeen
─────┼──────┼───────┼──────────┼────────┼─────────
홍길동 | editor | <hex> | 2026-05-24 | active | 2026-05-24 18:32
```

### 빌드 시 임베드 흐름 (구현 예정)
```
관리자 UI → 인스톨러 빌드 버튼 →
  1. 토큰 생성 (32-48 hex)
  2. _tokens 시트에 행 추가 (status=active)
  3. service account JSON 도 같이 임베드
  4. electron-builder --config build-editor.json 호출
  5. 산출물: Inel Work Scheduler-편집자-홍길동-Setup-X.Y.Z.exe
```

### 편집자 앱 시작 시 검증
```
1. 임베드된 토큰 + _tokens 시트 대조
2. status=active 이면 통과
3. revoked / 행 없음 → 잠금 화면
4. 5-10분 주기로 재검증 (회수 즉시 잠금)
```

## 운영 권장 보완책 (관리자가 사람으로 해야 할 일)
1. service account 권한을 작업 시트 1개로만 좁힘.
2. 시트 자동 백업 (주 1회 사본).
3. service account 키 6-12개월 회전.
4. 편집자 exe 발급 시 "본인 전용 / 공유 금지" 명시.
5. `_tokens.lastSeen` 으로 누가 언제 동기화했는지 추적.

## 절대 하지 말 것
- service account JSON 을 코드/문서/커밋에 평문으로.
- `sheets-export` 가 시트 헤더 순서를 마음대로 바꾸는 패턴.
- 시트에 있는데 앱이 모르는 컬럼을 자동 삭제.
- USER_ENTERED / RAW 옵션 임의 혼용.
