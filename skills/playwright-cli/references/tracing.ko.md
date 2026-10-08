# 트레이싱

언어: [English](tracing.md) | [한국어](tracing.ko.md)

디버깅과 분석을 위해 상세 실행 트레이스를 캡처합니다. 트레이스에는 DOM 스냅샷, 스크린샷, 네트워크 활동 및 콘솔 로그가 포함됩니다.

## 기본 사용법

```bash
# Start trace recording
playwright-cli tracing-start

# Perform actions
playwright-cli open https://example.com
playwright-cli click e1
playwright-cli fill e2 "test"

# Stop trace recording
playwright-cli tracing-stop
```

## 트레이스 출력 파일

트레이싱을 시작하면 Playwright가 `traces/` 디렉터리와 다음 파일을 만듭니다.

### `trace-{timestamp}.trace`

**동작 로그** — 다음 내용을 담은 주 트레이스 파일입니다.

- 수행한 모든 동작(클릭, 입력, 탐색)
- 각 동작 전후의 DOM 스냅샷
- 각 단계의 스크린샷
- 타이밍 정보
- 콘솔 메시지
- 소스 위치

### `trace-{timestamp}.network`

**네트워크 로그** — 전체 네트워크 활동입니다.

- 모든 HTTP 요청과 응답
- 요청 헤더와 본문
- 응답 헤더와 본문
- DNS, 연결, TLS, TTFB, 다운로드 타이밍
- 리소스 크기
- 실패한 요청과 오류

### `resources/`

**리소스 디렉터리** — 캐시된 리소스입니다.

- 이미지, 글꼴, 스타일시트, 스크립트
- 재생을 위한 응답 본문
- 페이지 상태를 재구성하는 데 필요한 자산

## 트레이스에 캡처되는 항목

| 범주 | 세부 내용 |
|----------|---------|
| **동작** | 클릭, 입력, 마우스 오버, 키보드 입력, 탐색 |
| **DOM** | 각 동작 전후의 전체 DOM 스냅샷 |
| **스크린샷** | 각 단계의 시각적 상태 |
| **네트워크** | 요청, 응답, 헤더, 본문, 타이밍 |
| **콘솔** | 모든 console.log, warn, error 메시지 |
| **타이밍** | 각 작업의 정확한 실행 시간 |

## 사용 사례

### 실패한 동작 디버깅

```bash
playwright-cli tracing-start
playwright-cli open https://app.example.com

# This click fails - why?
playwright-cli click e5

playwright-cli tracing-stop
# Open trace to see DOM state when click was attempted
```

### 성능 분석

```bash
playwright-cli tracing-start
playwright-cli open https://slow-site.com
playwright-cli tracing-stop

# View network waterfall to identify slow resources
```

### 증거 캡처

```bash
# Record a complete user flow for documentation
playwright-cli tracing-start

playwright-cli open https://app.example.com/checkout
playwright-cli fill e1 "4111111111111111"
playwright-cli fill e2 "12/25"
playwright-cli fill e3 "123"
playwright-cli click e4

playwright-cli tracing-stop
# Trace shows exact sequence of events
```

## 트레이스와 비디오 및 스크린샷 비교

| 기능 | 트레이스 | 비디오 | 스크린샷 |
|---|---|---|---|
| **형식** | .trace 파일 | .webm 비디오 | .png/.jpeg 이미지 |
| **DOM 검사** | 예 | 아니요 | 아니요 |
| **네트워크 세부 정보** | 예 | 아니요 | 아니요 |
| **단계별 재생** | 예 | 연속 | 단일 프레임 |
| **파일 크기** | 중간 | 큼 | 작음 |
| **적합한 용도** | 디버깅 | 데모 | 빠른 캡처 |

## 권장 사항

### 1. 문제가 발생하기 전에 트레이싱 시작

```bash
# Trace the entire flow, not just the failing step
playwright-cli tracing-start
playwright-cli open https://example.com
# ... all steps leading to the issue ...
playwright-cli tracing-stop
```

### 2. 오래된 트레이스 정리

트레이스는 디스크 공간을 상당히 사용할 수 있습니다.

```bash
# Remove traces older than 7 days
find .playwright-cli/traces -mtime +7 -delete
```

## 제한 사항

- 트레이싱은 자동화에 오버헤드를 추가합니다.
- 큰 트레이스는 디스크 공간을 상당히 사용할 수 있습니다.
- 일부 동적 콘텐츠는 완벽하게 재생되지 않을 수 있습니다.
