# Playwright 테스트 실행

언어: [English](playwright-tests.md) | [한국어](playwright-tests.ko.md)

Playwright 테스트를 실행하려면 `npx playwright test` 명령 또는 패키지 관리자 스크립트를 사용합니다. 대화형 HTML 리포트가 열리지 않게 하려면 `PLAYWRIGHT_HTML_OPEN=never` 환경 변수를 사용합니다.

```bash
# Run all tests
PLAYWRIGHT_HTML_OPEN=never npx playwright test

# Run all tests through a custom npm script
PLAYWRIGHT_HTML_OPEN=never npm run special-test-command
```

# Playwright 테스트 디버깅

실패한 Playwright 테스트를 디버깅하려면 `--debug=cli` 옵션으로 실행합니다. 이 명령은 테스트 시작 지점에서 일시 중지하고 디버깅 지침을 출력합니다.

**중요**: 명령을 백그라운드에서 실행하고 `Debugging Instructions`가 출력될 때까지 결과를 확인합니다. 작업이 끝나면 명령을 중지해야 합니다.

세션 이름이 포함된 지침이 출력되면 `playwright-cli`로 세션에 연결해 페이지를 탐색합니다.

```bash
# Run the test
PLAYWRIGHT_HTML_OPEN=never npx playwright test --debug=cli
# ...
# ... debugging instructions for "tw-abcdef" session ...
# ...

# Attach to the test
playwright-cli attach tw-abcdef
```

문제를 조사하는 동안 테스트를 백그라운드에서 계속 실행합니다.
테스트는 시작 지점에서 일시 중지되므로, 가장 문제가 발생할 가능성이 높은 위치까지 한 단계씩 진행하거나 그 지점에서 일시 중지합니다.

`playwright-cli`로 수행하는 모든 동작은 대응하는 Playwright TypeScript 코드를 생성합니다.
이 코드는 출력에 표시되며 테스트에 그대로 복사할 수 있습니다. 대부분의 경우 특정 locator 또는 assertion을 수정해야 하지만 애플리케이션의 버그일 수도 있으므로 상황에 맞게 판단합니다.

테스트를 수정한 뒤 백그라운드 테스트 실행을 중지하고 다시 실행해 통과하는지 확인합니다.
