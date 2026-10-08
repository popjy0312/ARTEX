> Languages: [Chinese](CONTEXT_BUDGET.md) | English | [Korean](CONTEXT_BUDGET.ko.md)

# Long Side Conversations and Context Budget

Fixed on 2026-09-11. The original implementation treated the character count of request JSON directly as tokens and inherited the main task’s 32K output reservation. As a result, it rejected ordinary side questions early when HTML, JavaScript, and tool results were numerous.

## Open-source implementation review

- [Grok CLI side-question context](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L739): extracts snippets from recent user and assistant text, with a character budget of about 2000 and at most 400 characters per item. This path does not maintain continuous side-question history.
- [Grok CLI independent request](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/utils/side-question.ts): independent cancellation signal; output is capped at 2048 tokens when the model supports it; no tools.
- [Grok CLI main-session compaction](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/compaction.ts): estimates tokens, retains recent content, updates new content into the old summary, and handles truncation across turns.
- [OpenCode session compaction](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/session/compaction.ts): estimates the complete request, reserves output/buffer space, keeps recent content with a rolling summary, and makes summary requests without tools; the implementation defaults to a recent budget of 8000 and a summary output cap of 4096 tokens.
- [OpenCode overflow recovery](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/session/runner/llm.ts): attempts overflow recovery only before assistant output starts; the recovered call does not enter the same overflow-recovery path again.

ARTEX borrows the independent output budget, recent content plus rolling summary, and limited recovery. It retains norma v0.3.6 structured messages and tool pairing rather than copying Grok’s text extraction, and it does not write OpenCode main-session compaction events into the ARTEX main transcript.

## Request budget and execution

- Messages use norma’s UTF-8 byte estimate by content block with a 4/3 margin; system prompts, tool schemas, and message-envelope overhead are also counted. The estimate is not an exact model token count.
- Side-question output defaults to at most 8192 tokens and cannot exceed the output limit configured for the main profile. Set the cap to 256–32768 through the service environment variable `ARTEX_BTW_MAX_OUTPUT_TOKENS`; this does not change the product’s default model or main-task parameters.
- Input budget equals the context window minus the output limit and a safety margin; an unknown window uses the platform default of 200K. The safety margin is 5% of the window, with a minimum of 128 and maximum of 8192 tokens.
- Successful question/answer pairs load in batches of at most 20 by increasing ordinal. At most 20 original pairs are retained; their token budget is at most one quarter of the input budget and no more than 16K.
- Over-budget answers are folded into a rolling summary. The summary includes historical sources and context time; a historical assistant answer is not new tool evidence, and the latest main snapshot takes priority in conflicts.
- If the main context is still too long, only old messages in the copy are summarized, retaining at most 8K recent tokens; the cut point never splits a tool call from its result. An oversized pair enters the summary as a whole.
- Summary input is split into UTF-8-safe chunks according to the remaining window, with a 2048-token output cap. Empty, truncated, tool-call, or over-budget summaries are not cached. One side question makes at most 12 summary calls and remains under the same 120-second timeout; reaching the limit fails explicitly rather than looping indefinitely.
- If the model first returns a context-overflow error before any text or tool call is output, reduce the request further and retry at most once. Stop recovery immediately if the estimate does not decrease. Other model errors and partial streaming output do not trigger recovery.
- All obtained usage, including summaries, failed attempts, and cancellation usage, accumulates on the same side-question request. If the Provider does not return usage, record zero; never present an estimate as actual usage.

## Persistence and interface

`side_question_sessions.memory` stores old question/answer summaries, the covered ordinal, and main-context summaries cached by snapshot identity. `side_question_requests.context_info` stores preparation state, the actual number of replayed pairs, summary usage, and budget estimates.

Save a summary only while the original request is still running and the cleanup version matches. Clearing also removes the cache, and late writes cannot restore cleared data. A new snapshot does not reuse an old snapshot summary. Summary fields are preserved in v3 task archives; when restoring old v3 data, missing fields become empty objects, while v1/v2 remain compatible.

POST accepts and returns the request first; preparation and compaction run in the background without holding the admission lock or a database transaction. SSE/history displays preparation, question organization, copy compaction, and answer phases; a compaction failure is saved as the side-question request’s failed terminal state. The frontend retains the error and restores the failed question as a draft instead of covering the input with a toast; history polling no longer clears submission errors.

## Verification record

- Replay of 19/20/21/50 groups, retention of conclusions older than 20 groups, and reuse of summary caches after restart: automated checks passed.
- Long Chinese answers and code contexts, chunked request budgets, tool pairing, snapshot immutability, and invalidation of the new-snapshot cache: automated checks passed.
- Summary failure/cancellation/truncation/oversize/tool return, clear races, call limits, one-time overflow recovery, and no retry after partial streams: automated checks passed.
- Independent PostgreSQL pagination, restart, v1/v2/v3 archives, summary-cache and budget-metadata archive recovery, old v3 missing new fields, and four shared concurrency slots across 20 parent sessions: passed.
- Go candidate-service build, frontend TypeScript check, Biome checks for changed components, and a Next.js production build in an independent directory: passed.
- With an isolated browser UI fixture, preparation phase, summary-range notice, draft restoration after failure, no toast error, no horizontal overflow, and no console errors were verified at 1280×720 and 390×844. The temporary fixture was removed.
- Read-only replay of the existing local Worker snapshot passed the new budget check; for example, Worker #3’s 293085-character snapshot is no longer incorrectly rejected by local character counting. This item made no external model call.
- The requested real-conversation test that would send a private Worker snapshot to Grok was rejected by automatic approval review and was not run; it is not counted as a pass.
- At 2026-09-11 00:37, the local backend was restarted at the user’s request, reusing the original database, data directory, and login configuration. Runtime files and the candidate binary had identical SHA-256 values; the backend and frontend proxy `/api/health` both returned normally.

Verification commands (use only an independent test database):

```sh
go test -race ./sidequestion ./db ./server -run 'TestSide|TestCheckpoint|TestSnapshot|TestBuildRequest|TestService|TestMainSide|TestTaskArchive' -count=1
go build ./cmd/artex
npx tsc --noEmit
npm run build -- --webpack
```

Use an independent copy for the frontend production build so the current preview’s `.next` is not overwritten. The candidate service is at `/private/tmp/artex-btw-budget-candidate`, copied to `/private/tmp/artex-btw-preview/artex` and started there; the original binary backup is `artex.before-context-budget` in the same directory.
