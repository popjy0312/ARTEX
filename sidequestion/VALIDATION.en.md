> Languages: [Chinese](VALIDATION.md) | English | [Korean](VALIDATION.ko.md)

# `/btw` Validation Record

Date: 2026-09-10. Branch: `codex/btw-side-question`. Baseline: `8dae851b9b622f2ff2631f332fde9719d0b16fba`.

An independent PostgreSQL test database and data directory were used. Real model credentials were injected only into the isolated test environment; they were not written to code or this record, and the product’s default model was not changed. Go 1.26.3, norma v0.3.6, and Next.js 16.2.9.

Actual model conversations, returned objects, engineering assertions, and the original Qwen review text are stored in [validation-2026-09-10.json](validation-2026-09-10.json), which contains no API credentials.

## Engineering checks

| Scope | Result | Evidence |
| --- | --- | --- |
| Deep copy of structured messages and tool parameters | Passed | `TestCheckpointDeepCopyAndBoundaries` |
| Summary/compaction requests do not overwrite; complete replies and terminal states publish; partial replies are excluded | Passed | `TestCheckpointDeepCopyAndBoundaries`, `TestSnapshotExcludesPartialStreamAndSelectsPoolMember` |
| Identity of the actual model-pool member | Passed | `TestSnapshotExcludesPartialStreamAndSelectsPoolMember` |
| Tool pairing, 20-group replay, budget trimming, and overflow errors | Passed | `TestBuildRequestCompactionToolPairingAndBudget` |
| Main/side concurrency and bidirectional cancellation isolation | Passed | Blocking Provider, `TestMainSideConcurrencyAndIndependentCancellation` |
| No tool execution, streaming/non-streaming, and usage on failure | Passed | `TestServiceNoToolsAndUsageOnFailure` |
| Real norma ChatAgent + local Read tool; main transcript/activity isolation | Passed | `TestSideActualChatCheckpointToolResultAndTranscriptIsolation`, streaming and non-streaming subcases |
| Persistence, pagination, idempotency, and restart retention of partial answers | Passed | `TestSideHistoryIdempotencyPagingAndRecovery` |
| Clear/late-write race, parent deletion, and version comparison | Passed | `TestSideClearLateWritersAndDeletedParent` |
| MainAgent/Worker archive and recovery, v1/v2/v3 | Passed | `TestSideTaskArchiveVersions` |
| Three parent interfaces, authentication, resource ownership, and Worker logical deletion | Passed | `TestSideHTTPGlobalLimitTaskWorkerAndDeletion`, `TestSideCheckpointPersistsBeforeAdmissionAndRestart` |
| Busy main session remains available to side questions; independent SSE reconnect/disconnect, cancellation, and clear | Passed | `TestSideHTTPBusyIsolationClearAndReconnect` |
| One concurrent request per parent / four globally | Passed | Two `TestSideHTTP…` cases |
| Snapshot persisted before submission, restart continuation, and no fabricated snapshot for old sessions | Passed | `TestSideCheckpointPersistsBeforeAdmissionAndRestart` |
| Reject continuation after cached configuration deletion or model change | Passed | `TestSideRejectsDeletedOrChangedCachedProfile` |
| Cancel and wait for final answer and usage persistence before archive | Passed | `TestSideTaskDrainPersistsBeforeArchive` |
| Record usage once and preserve side-question ownership when a streaming consumer cancels early | Passed | `TestSideUsageRecordedOnceOnConsumerCancellation` |
| Restored Worker/runtime deadline contexts continue publishing new snapshots after restart | Passed | `TestSideRestoredWorkerRuntimePublishesNewCheckpoint` |
| Race checks for related packages | Passed | Commands below |
| TypeScript and production build | Passed | `npx tsc --noEmit`, `npm run build` |
| Biome for new frontend modules | Passed | `biome check`, three new modules |

With `ARTEX_PG_DSN` configured for a separate disposable database, the automated checks can be reproduced (do not point it at a production database):

```sh
go test -race ./agent ./db ./server ./sidequestion ./llmrec ./llmpool \
  -run 'Test(Side|Checkpoint|Snapshot|BuildRequest|Service|MainSide|CaptureRun|TaskArchive|CompleteForwards|StopIntent|CancelIntent)' -count=1
cd web
npx tsc --noEmit
npx biome check src/lib/side-questions.ts src/hooks/use-side-questions.ts src/components/side-question-workspace.tsx
npm run build
```

The full Go regression suite is not entirely green: two pre-existing `server` tests fail during temporary-directory cleanup, both reporting `TempDir RemoveAll … directory not empty`:

- `TestInheritedActivityDetailAndRelationDeletion`
- `TestTaskMetadataPatchReturnsRenameAndPin`

Exporting source from the unmodified baseline and rerunning the `server` package in the same isolated environment reproduces both cleanup failures. That baseline run also showed a `TestCoreTaskLifecyclePG` target-node-count assertion failure; the final modified `server` regression did not show that assertion failure. Other packages passed, and the side-question cases and race checks passed. The baseline issues were not counted as acceptance passes, and existing assertions were not changed for hidden issues.

The Next.js build reports existing multiple-lockfile/workspace-root inference warnings; the build completed and all pages were generated.

## Browser checks

The Codex In-app Browser connected to an isolated local Go service and Next.js development server. The following desktop and 390 × 844 narrow-screen operations were completed, with screenshots and browser logs checked:

- Submit `/btw` during an ordinary chat run; main content and side question display simultaneously; the desktop sidebar works.
- Ask follow-ups; after stopping the side question, partial output remains and the main flow continues.
- After closing the panel, the request continues; reopening restores the completed answer; after refresh, an empty `/btw` restores history.
- The narrow-screen Drawer input, buttons, history, and close operation work without horizontal overflow.
- Clear uses a confirmation dialog; after clearing, history disappears while the main transcript and snapshot remain.
- Ask and switch between a task MainAgent and two Workers; Agent labels and history do not cross-contaminate.
- Keep a Worker running with a blocking local-model fixture; submit `/btw` from the Worker main input, stop the side question, and verify that the Worker still shows its live run and its own pause button while the side question saves partial output.
- Browser error/warning logs are empty.

Controllable fixtures were used to verify concurrency timing precisely, without depending on real-model response speed. Two early Worker-run checks did not create a valid concurrency window because the task had ended or the answer finished early; after correcting the fixture, the checks were repeated and passed. Those initial operations are not counted as valid passes.

## Real-model conversations

The preferred probe was `grok-4.6` through the OpenAI-compatible endpoint `http://127.0.0.1:12580/tingly/openai`. The probe returned HTTP 200, model `grok-4.6`, and `READY` in 2.82 seconds. Because the preferred endpoint was available, the Tingly `glm` and Zhipu `glm-5.3` fallback services were not enabled or verified.

| Scenario | Actual result |
| --- | --- |
| Ask about assets, target, and marker during a main-session run | Returned `redhaze.top`, the home-page read and summary goal, and `BTW-REAL-0910`; side question completed in 16.97 seconds |
| Ask for tool evidence after the main session read the home page | Correctly cited WebFetch 200, curl redirects 301 → 302 → 200, and the page title; 7.24 seconds |
| Ask the side question to use Bash to create a test file | Refused execution; target file was not created; 7.74 seconds |
| Completed side question does not change main context | Main transcript SHA-256 and main activity record remained unchanged; side-question tool executions: 0 |
| Ask again after actually stopping/restarting the Go service | Retained three previous side-question history entries and answered about the asset, marker, and title directly from the persisted snapshot without rerunning the main Agent |
| New session using a Grok non-streaming profile | Correctly answered the asset and `ATOMIC-0910`; returned and saved usage: input 11734, output 138, cache_read 11520 |

The asset case’s main session used WebFetch and Bash/curl to read a public home page. The landing page was `https://id.redhaze.top/home`, titled “红幕科技 RedHaze Group · 全球综合集团门户” (“Red Curtain Technology RedHaze Group · Global Integrated Group Portal”). Bash temporarily stored the response in a local test file; it did not write remotely. This fact was checked separately from the side question’s lack of tool execution.

Main transcript checksum: `e7e61f135a4a120954b539f357e8c4205d7d5cd7460dcaf3dc0fd066463e1d00`.

**Usage limitation:** Tingly’s Grok streaming response did not return usage. A separate direct request with `stream_options.include_usage=true` returned HTTP 200 with 12 data frames and 0 usage frames. Therefore, 0 in the streaming tests means that the endpoint provided no usage; it does not mean that no billing occurred. Non-streaming usage and fixture failure/cancellation usage were saved correctly.

## Qwen review

The review model was `qwen-flash` at an approved OpenAI-compatible review endpoint, which returned HTTP 200. It received the first three real side-question conversations, main-session tool evidence, and engineering assertions; it returned `verdict: accept` and `concerns: []`, judging that the answers matched the asset, marker, and page-reading evidence and that refusing side-question tools complied with constraints. Review usage: prompt 6625, completion 312, total 6937.

This Qwen review did not include the later service restart or non-streaming test. Qwen’s statement that there was “no writing” was too broad: the main-session curl did create a local temporary response file, as stated above. Engineering assertions, not the model review, established concurrency, zero tool execution, and transcript isolation.
