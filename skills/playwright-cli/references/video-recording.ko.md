# 비디오 녹화

언어: [English](video-recording.md) | [한국어](video-recording.ko.md)

디버깅, 문서화 또는 검증을 위해 브라우저 자동화 세션을 비디오로 캡처합니다. WebM(VP8/VP9 코덱)을 생성합니다.

## 기본 녹화

```bash
# Open browser first
playwright-cli open

# Start recording
playwright-cli video-start demo.webm

# Add a chapter marker for section transitions
playwright-cli video-chapter "Getting Started" --description="Opening the homepage" --duration=2000

# Navigate and perform actions
playwright-cli goto https://example.com
playwright-cli snapshot
playwright-cli click e1

# Add another chapter
playwright-cli video-chapter "Filling Form" --description="Entering test data" --duration=2000
playwright-cli fill e2 "test input"

# Stop and save
playwright-cli video-stop
```

## 권장 사항

### 1. 설명적인 파일 이름 사용

```bash
# Include context in filename
playwright-cli video-start recordings/login-flow-2024-01-15.webm
playwright-cli video-start recordings/checkout-test-run-42.webm
```

### 2. 전체 핵심 스크립트 녹화

사용자에게 보여주거나 작업 증거로 사용할 비디오를 녹화할 때는 코드 조각을 만들어 `run-code`로 실행하는 것이 좋습니다.
이 방식으로 동작 사이에 적절한 일시 중지를 넣고 비디오에 주석을 추가할 수 있습니다. 이를 위한 새로운 Playwright API가 있습니다.

1) CLI로 시나리오를 수행하며 모든 locator와 동작을 기록합니다. 강조 표시를 요청하려면 locator의 bounding box가 필요합니다.
2) 아래처럼 비디오용 스크립트 파일을 만듭니다. 보기 좋은 입력을 위해 `pressSequentially`와 지연을 사용하고 합리적인 일시 중지를 넣습니다.
3) `playwright-cli run-code --filename your-script.js`를 사용합니다.

**중요**: 오버레이는 `pointer-events: none`이므로 페이지 상호작용을 방해하지 않습니다. 페이지에서 클릭, 입력 또는 다른 동작을 수행하는 동안 고정 오버레이를 안전하게 표시할 수 있습니다.

```js
async page => {
  await page.screencast.start({ path: 'video.webm', size: { width: 1280, height: 800 } });
  await page.goto('https://demo.playwright.dev/todomvc');

  // Show a chapter card — blurs the page and shows a dialog.
  // Blocks until duration expires, then auto-removes.
  // Use this for simple use cases, but always feel free to hand-craft your own beautiful
  // overlay via await page.screencast.showOverlay().
  await page.screencast.showChapter('Adding Todo Items', {
    description: 'We will add several items to the todo list.',
    duration: 2000,
  });

  // Perform action
  await page.getByRole('textbox', { name: 'What needs to be done?' }).pressSequentially('Walk the dog', { delay: 60 });
  await page.getByRole('textbox', { name: 'What needs to be done?' }).press('Enter');
  await page.waitForTimeout(1000);

  // Show next chapter
  await page.screencast.showChapter('Verifying Results', {
    description: 'Checking the item appeared in the list.',
    duration: 2000,
  });

  // Add a sticky annotation that stays while you perform actions.
  // Overlays are pointer-events: none, so they won't block clicks.
  const annotation = await page.screencast.showOverlay(`
    <div style="position: absolute; top: 8px; right: 8px;
      padding: 6px 12px; background: rgba(0,0,0,0.7);
      border-radius: 8px; font-size: 13px; color: white;">
      ✓ Item added successfully
    </div>
  `);

  // Perform more actions while the annotation is visible
  await page.getByRole('textbox', { name: 'What needs to be done?' }).pressSequentially('Buy groceries', { delay: 60 });
  await page.getByRole('textbox', { name: 'What needs to be done?' }).press('Enter');
  await page.waitForTimeout(1500);

  // Remove the annotation when done
  await annotation.dispose();

  // You can also highlight relevant locators and provide contextual annotations.
  const bounds = await page.getByText('Walk the dog').boundingBox();
  await page.screencast.showOverlay(`
    <div style="position: absolute;
      top: ${bounds.y}px;
      left: ${bounds.x}px;
      width: ${bounds.width}px;
      height: ${bounds.height}px;
      border: 1px solid red;">
    </div>
    <div style="position: absolute;
      top: ${bounds.y + bounds.height + 5}px;
      left: ${bounds.x + bounds.width / 2}px;
      transform: translateX(-50%);
      padding: 6px;
      background: #808080;
      border-radius: 10px;
      font-size: 14px;
      color: white;">Check it out, it is right above this text
    </div>
  `, { duration: 2000 });

  await page.screencast.stop();
}
```

창의적으로 활용하세요. 오버레이는 강력합니다.

### 오버레이 API 요약

| 메서드 | 사용 사례 |
|--------|----------|
| `page.screencast.showChapter(title, { description?, duration?, styleSheet? })` | 흐린 배경 위에 전체 화면 장 카드를 표시 — 섹션 전환에 적합 |
| `page.screencast.showOverlay(html, { duration? })` | 사용자 지정 HTML 오버레이 — 호출, 레이블, 강조 표시에 사용 |
| `disposable.dispose()` | 지속 시간을 지정하지 않고 추가한 고정 오버레이 제거 |
| `page.screencast.hideOverlays()` / `page.screencast.showOverlays()` | 모든 오버레이를 일시적으로 숨기거나 표시 |

## 트레이싱과 비디오 비교

| 기능 | 비디오 | 트레이싱 |
|---------|-------|---------|
| 출력 | WebM 파일 | Trace Viewer에서 볼 수 있는 트레이스 파일 |
| 표시 내용 | 시각적 녹화 | DOM 스냅샷, 네트워크, 콘솔, 동작 |
| 사용 사례 | 데모, 문서화 | 디버깅, 분석 |
| 크기 | 큼 | 작음 |

## 제한 사항

- 녹화는 자동화에 약간의 오버헤드를 추가합니다.
- 큰 녹화 파일은 디스크 공간을 상당히 사용할 수 있습니다.
