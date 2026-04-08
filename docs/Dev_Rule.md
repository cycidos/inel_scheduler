# 개발 규칙 (Dev Rule)

> inel_scheduler 프로젝트 공통 개발 규칙

## 1. docs 문서 관리
- 프로젝트 문서는 `docs/`에 정리한다.
- 코드 흐름 및 중복 방지 기준 문서는 `docs/structure/code_flow.md`를 사용한다.
- 코드 작성 전 `code_flow`에서 기존 클래스/함수/컴포넌트 존재 여부를 확인한다.
- 새 클래스/함수/컴포넌트 추가 또는 기존 구조 변경 시 `code_flow`를 함께 업데이트한다.

## 2. Git 초기 설정
- 저장소 초기화 기준:
  - `git init`
  - `git config user.name "kimhwan"`
  - `git config user.email "cycidos@naver.com"`
- 기본 리모트:
  - `git remote add origin https://github.com/cycidos/inel_scheduler.git`

## 3. Reference 반입 정책
- reference는 `git submodule` 또는 별도 파일/프로젝트 단위로 가져온다.
- 사용한 reference 정보는 `references.txt`에 기록한다.
- reference 원본 파일/폴더는 `.gitignore`에 추가하고 커밋하지 않는다.

## 4. Reference 사용 제한
- reference는 참고용으로만 사용한다.
- reference의 코드/함수/클래스/컴포넌트를 그대로 복사하거나 수정 후 재사용하지 않는다.

## 5. 추가 모듈 관리
- 추가 Python 모듈은 `requirements.txt`에 명시한다.
- 설치 산출물(가상환경, 캐시, 빌드 결과물 등)은 `.gitignore`에 추가하고 커밋하지 않는다.
