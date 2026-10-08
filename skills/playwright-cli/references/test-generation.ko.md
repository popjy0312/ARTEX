# 테스트 생성(계획 → 생성 → 복구)

언어: [English](test-generation.md) | [한국어](test-generation.ko.md)

`playwright-cli`로 Playwright 테스트를 작성하고 유지 관리하는 종단 간 워크플로입니다. 모든 `playwright-cli` 동작은 대응하는 Playwright TypeScript를 출력하며, 생성된 코드가 모든 테스트의 원재료가 됩니다. 아래 섹션은 독립적으로 사용할 수 있습니다.

- **생성 방식** — 다른 모든 기능이 의존하는 핵심 메커니즘: 동작을 TypeScript로 바꾸고 assertion을 추가하는 방법입니다.
- **계획** — 애플리케이션을 탐색하고 테스트할 내용을 설명하는 spec 파일을 만듭니다.
- **생성** — spec을 Playwright 테스트 파일로 변환합니다. 모호하거나 오래된 spec은 업데이트합니다.
- **복구** — 실패한 테스트를 진단하고 코드를 수정하며 spec을 실제 동작과 맞춥니다.

계획/생성/복구는 같은 메커니즘을 사용합니다. `npx playwright test --debug=cli`를 백그라운드에서 실행한 뒤 `playwright-cli attach tw-XXXX`로 일시 중지된 페이지를 대화형으로 조작합니다. 디버깅 및 연결 방식은 [playwright-tests.md](playwright-tests.md)를 참조하세요.

---

## 0. 생성 방식

`playwright-cli`로 수행하는 모든 동작은 대응하는 Playwright TypeScript 코드를 생성합니다. 이 코드는 출력에 표시되며 테스트 파일에 직접 복사할 수 있습니다.

```bash
# Start a session
playwright-cli open https://example.com/login

# Take a snapshot to see elements
playwright-cli snapshot
# Output shows: e1 [textbox "Email"], e2 [textbox "Password"], e3 [button "Sign In"]

# Fill form fields - generates code automatically
playwright-cli fill e1 "user@example.com"
# Ran Playwright code:
# await page.getByRole('textbox', { name: 'Email' }).fill('user@example.com');

playwright-cli fill e2 "password123"
# Ran Playwright code:
# await page.getByRole('textbox', { name: 'Password' }).fill('password123');

playwright-cli click e3
# Ran Playwright code:
# await page.getByRole('button', { name: 'Sign In' }).click();
```

### 테스트 파일 만들기

생성된 코드를 Playwright 테스트로 모읍니다.

```typescript
import { test, expect } from '@playwright/test';

test('login flow', async ({ page }) => {
  // Generated code from playwright-cli session:
  await page.goto('https://example.com/login');
  await page.getByRole('textbox', { name: 'Email' }).fill('user@example.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('password123');
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Add assertions
  await expect(page).toHaveURL(/.*dashboard/);
});
```

### 의미 있는 locator 사용

생성된 코드는 가능한 경우 역할 기반 locator를 사용하므로 더 견고합니다.

```typescript
// Generated (good - semantic)
await page.getByRole('button', { name: 'Submit' }).click();

// Avoid (fragile - CSS selectors)
await page.locator('#submit-btn').click();
```

### 기록 전에 탐색

동작을 기록하기 전에 스냅샷을 찍어 페이지 구조를 파악합니다.

```bash
playwright-cli open https://example.com
playwright-cli snapshot
# Review the element structure
playwright-cli click e5
```

### assertion 수동 추가

생성된 코드는 동작은 기록하지만 assertion은 기록하지 않습니다. 다음 권장 matcher 중 하나를 사용해 테스트에 expectation을 추가합니다.

- `toBeVisible()` — 요소가 렌더링되어 표시되는지 확인
- `toHaveText(text)` — 요소의 텍스트 내용이 일치하는지 확인
- `toHaveValue(value) / toBeEmpty()` — input/select 값이 일치하는지 확인
- `toBeChecked() / toBeUnchecked()` — 체크박스 상태를 확인
- `toMatchAriaSnapshot(snapshot)` — 페이지 또는 locator가 부분 접근성 스냅샷과 일치하는지 확인

`playwright-cli generate-locator <target>`로 assertion에 사용할 locator 표현식을 만들고, snapshot/eval 명령으로 예상 값을 캡처합니다.

텍스트 내용을 assertion할 때 생성된 locator에 요소 자체의 텍스트가 포함되지 않는지 확인합니다. 텍스트 assertion에는 보통 `getByTestId()` 또는 `getByLabel()`이 잘 맞습니다. locator가 텍스트 기반이면 대신 `toBeVisible()`을 우선 사용합니다.

비교할 스냅샷은 모든 정보를 포함할 필요가 없으며 assertion에 필요한 정보만 캡처하면 됩니다. 변하는 값에는 정규 표현식을 사용할 수 있습니다.

```bash
# Get a stable locator for an element ref to use in the assertion
playwright-cli --raw generate-locator e5
# getByRole('button', { name: 'Submit' })

# Capture expected text content for toHaveText
playwright-cli --raw eval "el => el.textContent" e5

# Capture expected input value for toHaveValue/toBeEmpty
playwright-cli --raw eval "el => el.value" e5

# Capture expected aria snapshot for toMatchAriaSnapshot/toBeChecked
# (whole page, or use a ref to scope to a region)
playwright-cli --raw snapshot
playwright-cli --raw snapshot e5
```

```typescript
// Generated action
await page.getByRole('button', { name: 'Submit' }).click();

// Manual assertions using the outputs above:
await expect(page.getByRole('alert', { name: 'Success' })).toBeVisible();
await expect(page.getByTestId('main-header')).toHaveText('Welcome, user');
await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue('user@example.com');
await expect(page.getByRole('checkbox', { name: 'Enable notifications' })).toBeChecked();

// toMatchAriaSnapshot on the whole page, finds a matching region
await expect(page).toMatchAriaSnapshot(`
  - heading "Welcome, user"
  - link /\\d+ new messages?/
  - button "Sign out"
`);

// toMatchAriaSnapshot scoped to a region
await expect(page.getByRole('navigation')).toMatchAriaSnapshot(`
  - link "Home"
  - link /\\d+ new messages?/
  - link "Profile"
`);
```

---

## 1. 계획

목표: 테스트할 시나리오를 열거하는 spec 파일(예: `specs/<feature>.plan.md`)을 생성합니다. **항상** spec을 파일에 기록합니다.

### 1.1 사전 조건: workspace

무엇보다 먼저 workspace에 Playwright가 설치되어 있는지 확인합니다.

```bash
# Either of these confirms a workspace:
test -f playwright.config.ts || test -f playwright.config.js
npx --no-install playwright --version
```

Playwright가 설치되어 있지 않으면 기본값을 사용자가 선택하도록 설치를 시작합니다.

```bash
npm init playwright@latest
```

### 1.2 사전 조건: seed 테스트

**seed 테스트**는 모든 시나리오가 시작하는 상태(앱 탐색, 필요한 로그인, 기능 플래그 등)까지 페이지를 이동시키는 최소 테스트입니다. 시나리오는 seed가 끝난 뒤 새로 시작한다고 가정합니다. `--debug=cli`는 이 테스트 내부에서 일시 중지하므로 seed가 모든 계획 및 생성 세션의 시작점입니다.

최소 seed:

```ts
// tests/seed.spec.ts
import { test } from '@playwright/test';

test('seed', async ({ page }) => {
  await page.goto('https://example.com/');
});
```

권장 방식 — 시나리오 테스트가 재사용하도록 fixture로 탐색을 옮깁니다.

```ts
// tests/fixtures.ts
import { test as baseTest } from '@playwright/test';
export { expect } from '@playwright/test';

export const test = baseTest.extend({
  page: async ({ page }, use) => {
    await page.goto('https://example.com/');
    await use(page);
  },
});
```

```ts
// tests/seed.spec.ts
import { test } from './fixtures';

test('seed', async ({ page }) => {
  // Fixture already navigates. This empty body tells agents where to start.
});
```

seed가 없으면 최소한 앱으로 이동하는 seed를 만듭니다.

### 1.3 앱 탐색

seed를 통해 백그라운드에서 앱을 시작하고 연결합니다.

```bash
PLAYWRIGHT_HTML_OPEN=never npx playwright test tests/seed.spec.ts --debug=cli
# wait for "Debugging Instructions" and the session name tw-XXXX
playwright-cli attach tw-XXXX
```

seed를 실행하도록 재개한 뒤 앱을 조사합니다.

```bash
playwright-cli resume                   # resume so that seed test runs fully
playwright-cli snapshot                 # inventory of interactive elements
playwright-cli click e5                 # follow a flow
playwright-cli eval "location.href"     # read URL / state
playwright-cli show --annotate          # ask the user to point at something
```

다음 항목을 정리합니다.

- 상호작용 표면(폼, 버튼, 목록, 필터, 모달)
- 처음부터 끝까지의 주요 사용자 여정
- 엣지 케이스: 빈 상태, 유효성 검사 오류, 매우 긴 입력, 경계 값
- 지속성: reload, local/session storage, URL fragment
- 탐색: 어떤 컨트롤이 URL을 바꾸는지, 뒤로/앞으로 동작

**중요**: `playwright-cli`로 앱 URL만 직접 열지 말고 항상 테스트를 통해 열어 해당 테스트의 사용자 지정 설정을 캡처합니다.
**중요**: 탐색이 끝나면 백그라운드 테스트를 중지합니다.

### 1.4 spec 파일 작성

`specs/<feature>.plan.md`에 저장합니다. 다음 구조를 사용합니다.

```markdown
# <Feature> Test Plan

## Application Overview

<One paragraph describing what the feature does and why it matters.>

## Test Scenarios

### 1. <Group Name>

**Seed:** `tests/seed.spec.ts`

#### 1.1. <kebab-case-scenario-name>

**File:** `tests/<group>/<kebab-case-scenario-name>.spec.ts`

**Steps:**
  1. <Concrete user step>
    - expect: <observable outcome>
    - expect: <another observable outcome>
  2. <Next step>
    - expect: <outcome>

#### 1.2. <next-scenario>
...

### 2. <Next Group>

**Seed:** `tests/seed.spec.ts`
...
```

지침:

- 각 시나리오는 독립적이며 seed의 새 상태에서 시작합니다. 시나리오를 연결하지 않습니다.
- 시나리오 이름은 kebab-case이고 테스트 파일 이름과 일치합니다(`should-add-single-todo` → `should-add-single-todo.spec.ts`).
- 정상 경로, 엣지 케이스, 유효성 검사, 부정 흐름, 지속성을 다룹니다.
- API 수준이 아니라 사용자 수준으로 단계를 작성합니다(“`fill` 호출”이 아니라 “입력란에 'Buy milk' 입력”).
- `- expect:` 항목에 관찰 가능한 결과를 적습니다. 생성 단계에서 각각 assertion이 됩니다.

---

## 2. 생성

목표: spec 파일을 받아 Playwright 테스트 파일을 생성합니다. 필요하다면 spec이 실제 동작과 달라졌을 때 업데이트합니다.

### 2.1 입력

- **Spec 파일**, 예: `specs/basic-operations.plan.md`
- **대상**: 단일 시나리오(예: `1.2`), 전체 그룹(`1`) 또는 전체
- **Seed 파일**: 시나리오 그룹의 `**Seed:**` 줄에서 읽습니다.

### 2.2 단일 시나리오 생성

각 대상 시나리오를 순서대로 처리합니다(병렬 처리하지 않습니다 — 시나리오가 seed 세션을 공유합니다).

```bash
PLAYWRIGHT_HTML_OPEN=never npx playwright test <seed-file> --debug=cli   # background
playwright-cli attach tw-XXXX
# resume
```

앱 URL만 `playwright-cli`로 직접 열지 말고 항상 테스트를 통해 열어 테스트의 사용자 지정 설정을 캡처합니다.

`playwright-cli`로 spec의 `Steps:`를 하나씩 실행하며 spec을 계획으로, 실행 중인 앱을 사실의 기준으로 삼습니다. 단계가 모호하거나(“버튼 클릭” — 어느 버튼인가?), 더 이상 존재하지 않는 요소를 가리키거나, 앱의 실제 동작과 모순되면 판단해 앱의 실제 동작에 맞게 spec을 업데이트한 뒤 계속합니다. 생성 중 spec을 편집하는 것은 정상입니다.

모든 동작은 대응하는 Playwright TypeScript를 출력합니다([생성 방식](#0-생성-방식) 참조).

```bash
playwright-cli snapshot                         # find refs
playwright-cli fill e3 "John Doe"               # -> page.getByRole('textbox', {...}).fill(...)
playwright-cli press Enter
playwright-cli click e7
```

각 `- expect:` 항목에는 명시적인 assertion을 추가합니다. 자세한 내용은 [생성 방식](#0-생성-방식)을 참조하세요.

생성된 코드를 모아 spec에 지정된 경로에 테스트 파일을 작성합니다.

```ts
// spec: specs/basic-operations.plan.md
// seed: tests/seed.spec.ts
import { test, expect } from './fixtures';   // or '@playwright/test' if no fixtures file

test.describe('Signing in and out', () => {
  test('should sign in', async ({ page }) => {
    // 1. Navigate to the application
    // (handled by the seed fixture)

    // 2. Type 'John Doe' into the username field
    await page.getByRole('textbox', { name: 'username' }).fill('John Doe');

    // 3. Type password
    await page.getByRole('textbox', { name: 'password' }).fill('TestPassword');

    // 4. Press Enter to submit
    await page.getByRole('textbox', { name: 'password' }).press('Enter');

    await expect(page.getByRole('heading')).toContainText('Welcome, John Doe!');
  });
});
```

규칙:

- **파일당 테스트 하나.** 파일 경로, describe 이름, 테스트 이름은 순번을 제외하고 spec에서 그대로 가져옵니다.
- 번호가 있는 각 단계의 동작 앞에 `// N. <step text>` 주석을 붙입니다.
- describe 그룹 이름은 `1.` 순번 없이 spec에서 그대로 사용합니다.
- 프로젝트에 `./fixtures`가 있으면 여기서 import하고, 없으면 `@playwright/test`에서 import합니다.
- **중요**: 다음 시나리오로 이동하기 전에 CLI 세션을 닫고 백그라운드 테스트를 중지합니다.

### 2.3 여러 시나리오 생성

대상 시나리오에 2.2를 한 번에 하나씩 적용하고, 모든 테스트가 깨끗한 페이지에서 시작하도록 각 시나리오 사이에 seed를 다시 시작합니다. 생성된 세션 이름이 고유하면 병렬화해도 안전하지만 각 테스트 실행은 반드시 중지합니다.

### 2.4 생성된 테스트 실행

생성 후 새 테스트를 한 번 실행합니다.

```bash
PLAYWRIGHT_HTML_OPEN=never npx playwright test tests/<group>/<scenario>.spec.ts
```

실패하면 3절로 이동합니다.

---

## 3. 복구

목표: 실패한 테스트를 고치고 앱의 의도된 동작이 바뀌었다면 spec도 업데이트합니다.

### 3.1 실패한 테스트 찾기

```bash
PLAYWRIGHT_HTML_OPEN=never npx playwright test
```

실패한 `<file>:<line>` 항목을 기록하고 한 번에 하나씩 처리합니다. 병렬 수정은 시도하지 않습니다. 공유 상태와 단일 CLI 세션 때문에 취약합니다.

### 3.2 한 실패 디버깅

실패한 단일 테스트를 백그라운드 디버그 모드로 실행한 뒤 연결합니다.

```bash
PLAYWRIGHT_HTML_OPEN=never npx playwright test tests/<group>/<scenario>.spec.ts:<line> --debug=cli
# wait for "Debugging Instructions" and the tw-XXXX session name
playwright-cli attach tw-XXXX
```

테스트는 시작 지점에서 일시 중지됩니다. 실패한 동작 또는 assertion 직전까지 진행하거나 실행한 뒤 원인을 조사합니다.

```bash
playwright-cli snapshot                # did the element change / move / rename?
playwright-cli console                 # app-side errors?
playwright-cli requests                # failed request? wrong payload?
playwright-cli show --annotate         # ask the user to point somewhere
```

일반적인 원인은 selector 변경, 새 wrapper 요소, label/ARIA 이름 변경, 타이밍(transition, 비동기 로드), 앱에서 바뀐 assertion 텍스트, 실행 간 테스트 데이터 누수입니다.

수정한 상호작용을 `playwright-cli`로 재현합니다. 출력에 생성된 코드가 테스트에 붙여 넣을 코드입니다.

### 3.3 수정 적용

테스트 파일을 편집해 locator, assertion, 단계 순서 또는 입력을 수정된 동작에 맞춥니다. 백그라운드 디버그 실행을 중지하고 단일 테스트를 다시 실행해 통과하는지 확인합니다.

수정을 위해 hook을 건너뛰거나 sleep을 추가하지 않습니다. `networkidle`을 사용하지 않습니다.

### 3.4 spec과 대조

테스트 파일의 `// spec:` 헤더가 가리키는 spec을 열고 테스트와 일치하는 시나리오를 찾습니다.

- **순수한 기술 수정**(locator 변경, 더 나은 assertion 형태)이고 spec의 사용자 수준 동작이 앱과 여전히 일치하면 → spec을 그대로 둡니다.
- **수정으로 사용자에게 보이는 단계, 입력, 순서 또는 예상 결과가 변경**되었고 spec이 이를 설명한다면 → spec을 실제 동작에 맞게 업데이트합니다. 시나리오 ID와 파일 경로는 유지하고 단계/expect 줄만 바꿉니다.
- **앱 변경이 의도된 것인지(오래된 spec) 회귀인지(테스트가 맞고 앱이 잘못됨) 불분명**하면 → 중지하고 사용자에게 묻습니다. 다음을 제공합니다.
  - 시나리오 ID(예: `2.3`)
  - 더 이상 일치하지 않는 spec 줄
  - 관찰한 앱 동작(스냅샷 일부 또는 구체적인 결과 인용)

사용자가 답한 뒤에만 spec을 업데이트하거나 테스트가 버그를 다룬다고 표시합니다.

### 3.5 반복 및 포기

- 실패를 한 번에 하나씩 수정하고 매번 다시 실행합니다.
- 철저히 조사한 결과 테스트는 정확하지만 앱이 잘못되었고 사용자가 버그임을 확인했다면, 결정 또는 이슈 링크를 가리키는 주석과 함께 `test.fixme(...)`를 표시합니다. 조용히 건너뛰지 않습니다.

## 상호 참조

| 대상 | 참조 |
|---|---|
| `--debug=cli` / 연결 방식 | [playwright-tests.md](playwright-tests.md) |
| 탐색/생성 중 요청 모킹 | [request-mocking.md](request-mocking.md) |
| CLI 브라우저 세션 관리 | [session-management.md](session-management.md) |
