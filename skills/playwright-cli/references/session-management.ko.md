# 브라우저 세션 관리

언어: [English](session-management.md) | [한국어](session-management.ko.md)

상태를 유지하면서 서로 격리된 여러 브라우저 세션을 동시에 실행합니다.

## 이름이 지정된 브라우저 세션

`-s` 플래그로 브라우저 컨텍스트를 격리합니다.

```bash
# Browser 1: Authentication flow
playwright-cli -s=auth open https://app.example.com/login

# Browser 2: Public browsing (separate cookies, storage)
playwright-cli -s=public open https://example.com

# Commands are isolated by browser session
playwright-cli -s=auth fill e1 "user@example.com"
playwright-cli -s=public snapshot
```

## 브라우저 세션 격리 속성

각 브라우저 세션은 다음 항목을 독립적으로 가집니다.

- 쿠키
- LocalStorage / SessionStorage
- IndexedDB
- 캐시
- 검색 기록
- 열린 탭

## 브라우저 세션 명령

```bash
# List all browser sessions
playwright-cli list

# Stop a browser session (close the browser)
playwright-cli close                # stop the default browser
playwright-cli -s=mysession close   # stop a named browser

# Stop all browser sessions
playwright-cli close-all

# Forcefully kill all daemon processes (for stale/zombie processes)
playwright-cli kill-all

# Delete browser session user data (profile directory)
playwright-cli delete-data                # delete default browser data
playwright-cli -s=mysession delete-data   # delete named browser data
```

## 환경 변수

환경 변수로 기본 브라우저 세션 이름을 지정합니다.

```bash
export PLAYWRIGHT_CLI_SESSION="mysession"
playwright-cli open example.com  # Uses "mysession" automatically
```

## 일반적인 패턴

### 동시 스크래핑

```bash
#!/bin/bash
# Scrape multiple sites concurrently

# Start all browsers
playwright-cli -s=site1 open https://site1.com &
playwright-cli -s=site2 open https://site2.com &
playwright-cli -s=site3 open https://site3.com &
wait

# Take snapshots from each
playwright-cli -s=site1 snapshot
playwright-cli -s=site2 snapshot
playwright-cli -s=site3 snapshot

# Cleanup
playwright-cli close-all
```

### A/B 테스트 세션

```bash
# Test different user experiences
playwright-cli -s=variant-a open "https://app.com?variant=a"
playwright-cli -s=variant-b open "https://app.com?variant=b"

# Compare
playwright-cli -s=variant-a screenshot
playwright-cli -s=variant-b screenshot
```

### 영구 프로필

기본적으로 브라우저 프로필은 메모리에만 유지됩니다. `open`에 `--persistent` 플래그를 사용하면 브라우저 프로필을 디스크에 저장합니다.

```bash
# Use persistent profile (auto-generated location)
playwright-cli open https://example.com --persistent

# Use persistent profile with custom directory
playwright-cli open https://example.com --profile=/path/to/profile
```

## 실행 중인 브라우저에 연결

새 브라우저를 실행하는 대신 `attach`를 사용해 이미 실행 중인 브라우저에 연결합니다.

### 채널 이름으로 연결

채널 이름으로 실행 중인 Chrome 또는 Edge 인스턴스에 연결합니다. 브라우저에서 원격 디버깅을 활성화해야 합니다. 대상 브라우저에서 `chrome://inspect/#remote-debugging`으로 이동해 이 브라우저 인스턴스의 원격 디버깅 허용을 선택합니다.

```bash
# Attach to Chrome
playwright-cli attach --cdp=chrome

# Attach to Chrome Canary
playwright-cli attach --cdp=chrome-canary

# Attach to Microsoft Edge
playwright-cli attach --cdp=msedge

# Attach to Edge Dev
playwright-cli attach --cdp=msedge-dev
```

지원 채널은 `chrome`, `chrome-beta`, `chrome-dev`, `chrome-canary`, `msedge`, `msedge-beta`, `msedge-dev`, `msedge-canary`입니다.

`--session`을 지정하지 않으면 세션 이름은 채널 이름을 따릅니다(예: `--cdp=msedge`는 `msedge`라는 세션을 만듭니다). 따라서 Chrome과 Edge에 병렬로 연결해도 `default`에서 충돌하지 않습니다. `--session=<name>`을 전달해 이름을 덮어쓸 수 있습니다.

### CDP 엔드포인트로 연결

Chrome DevTools Protocol 엔드포인트를 노출하는 브라우저에 연결합니다.

```bash
playwright-cli attach --cdp=http://localhost:9222
```

### 브라우저 확장 프로그램으로 연결

Playwright 확장 프로그램이 설치된 브라우저에 연결합니다.

```bash
playwright-cli attach --extension
```

### 연결 해제

외부 브라우저에는 영향을 주지 않고 연결된 세션을 정리합니다.

```bash
# Detach the default attached session
playwright-cli detach

# Detach a specific attached session
playwright-cli -s=msedge detach
```

`detach`는 `attach`로 만든 세션에서만 동작합니다. `open`으로 만든 세션에는 `close`를 사용합니다.

## 기본 브라우저 세션

`-s`를 생략하면 명령은 기본 브라우저 세션을 사용합니다.

```bash
# These use the same default browser session
playwright-cli open https://example.com
playwright-cli snapshot
playwright-cli close  # Stops default browser
```

## 브라우저 세션 설정

열 때 특정 설정으로 브라우저 세션을 구성합니다.

```bash
# Open with config file
playwright-cli open https://example.com --config=.playwright/my-cli.json

# Open with specific browser
playwright-cli open https://example.com --browser=firefox

# Open in headed mode
playwright-cli open https://example.com --headed

# Open with persistent profile
playwright-cli open https://example.com --persistent
```

## 권장 사항

### 1. 브라우저 세션에 의미 있는 이름 지정

```bash
# GOOD: Clear purpose
playwright-cli -s=github-auth open https://github.com
playwright-cli -s=docs-scrape open https://docs.example.com

# AVOID: Generic names
playwright-cli -s=s1 open https://github.com
```

### 2. 항상 정리

```bash
# Stop browsers when done
playwright-cli -s=auth close
playwright-cli -s=scrape close

# Or stop all at once
playwright-cli close-all

# If browsers become unresponsive or zombie processes remain
playwright-cli kill-all
```

### 3. 오래된 브라우저 데이터 삭제

```bash
# Remove old browser data to free disk space
playwright-cli -s=oldsession delete-data
```
