[Chinese](CHANGELOG.md) · [English](CHANGELOG.en.md) · [Korean](CHANGELOG.ko.md)

# Changelog

The notable changes to this project are recorded in this file. The format follows [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/).

## [Unreleased]

## [0.3.15] - 2026-10-07

### Interception

#### Added

- **Added a built-in interception rule "Delete-style API paths"**: The built-in HTTP destructive rule previously recognized only the DELETE **method**, yet most applications' delete endpoints can be triggered with GET/POST, so calls such as `curl 'http://t/api/user/delete?id=1'` would really delete the target's data. A `deny` rule now covers `/delete /del /remove /unlink /erase /destroy` (the verb must be followed by a separator, so `/delivery`, `/details`, and `/delta` are not blocked by mistake). Existing instances also receive it after upgrading, and it can be disabled or deleted under "System → Command Interception".
- **Token consumption of the model fallback approval can now be viewed separately**: Approval calls previously had no separate metering attribution, so how much they cost was anyone's guess. They are now metered separately, and a usage card appears below the "Model fallback approval" switch under "System → Command Interception" — cumulative statistics for five items (call count, input, output, cache read, cache write), plus a mini bar chart of daily consumption over the last 30 days.

### Vulnerability Push

#### Added

- **Vulnerability findings can be pushed to IM**: A new "System → Notification Push" page can push scan findings to six channels: **DingTalk, Feishu, WeCom, generic Webhook, Telegram, and email**. Any number of instances can be configured for the same type, and each instance has its own enable/disable switch, rate limit, and filter rules.
- **Push timing has two modes, real-time and digest**: In real-time mode, each hit is sent one by one; in digest mode, hits are merged into a single message per global period (default 30 minutes), with the number of new items and the severity distribution at the top. To get "real-time for high severity, digest for the rest", create two channels and configure them separately.
- **Filter rules support four dimensions**: minimum severity, restriction to a task / asset scope, inclusion and exclusion of vulnerability-type keywords (exclusion takes precedence), and whether to receive disposition-status changes (off by default). Messages carry a "View details" button whose target address is set by the global "Callback URL" setting; if left empty, no button is included.
- **Delivery history and manual resend**: Lists each delivery's status, attempt count, failure reason, and owning channel, filterable by channel and status; failed items can be resent with one click (a resend resets the retry count).
- **Channel credentials are echoed back masked**: Webhook URLs, signing secrets, Bot Tokens, SMTP passwords, and the like are echoed back only as masked values with a trailing-characters hint; submitting the value back unchanged means "do not modify", and clearing the input box deletes the field.

#### Fixed

> This section records the conclusions of a security audit carried out after the first version of the feature was complete. Each item was reproduced first, then fixed, then covered by an added regression test.

- **Fixed the mask being bypassable by "changing the target address while keeping the credentials" (critical)**: Config merging kept the stored value for every "unmentioned key", so by changing only the address and saying nothing about the credentials, one could make the server send the real stored credentials to an arbitrary address, completely silently. It is now required that once the target address changes, every credential field must be explicitly addressed — either give a new value, or explicitly leave it empty to indicate it is no longer needed.
- **Fixed markdown-style channels performing zero escaping on untrusted content**: Vulnerability titles and summaries come from model output and asset URLs come from scan results, so a crafted title would render as a clickable external link in DingTalk / WeCom / Feishu, and image syntax would be fetched by the client at render time and leak the reader's IP. Content is now uniformly flattened to a single line and markdown metacharacters are escaped, with the escaping done at each channel's rendering exit rather than in the shared title function.
- **Fixed the SSRF surface of delivery addresses**: Previously loopback, internal-network, and cloud-metadata addresses were all deliverable, and the first 200 bytes of a failure response body went into `last_error` and were echoed by the delivery history, forming a semi-blind read primitive. Protection is now applied at the **dial stage**, which covers DNS rebinding, and cross-host redirects are rejected; loopback and link-local addresses require explicitly setting `ARTEX_NOTIFY_ALLOW_LOCAL=1`, while RFC1918 private networks are still allowed (self-hosted internal SMTP relays are common).
- **Fixed push credentials leaking through error messages**: DingTalk's `access_token`, WeCom's `key`, and Telegram's bot token are all in the URL, and when a delivery failed, the full URL flowed into `last_error`, the delivery history, the server logs, and frontend prompts. These are now redacted uniformly, keeping only `scheme://host` and the underlying cause.
- **Fixed silent loss when a digest message was truncated yet the whole batch was marked delivered**: Vulnerabilities that were cut off were neither in the message nor in the failure list, while the delivery history showed success. Packing is now done by **whole entries**, only those that fit into the current message are marked, and the rest go back to the queue to be continued in the next message without consuming retry attempts; the message header also states how many more will continue in the next message.
- **Fixed a typo in the minimum severity threshold silently disabling the filter**: When `min_severity` was written with a typo such as `hgih`, the unknown severity ordinal was 0 and the check degraded to always-true, so the user thought they were receiving only high severity while all vulnerabilities were actually being flooded into the group. The value is now validated on the write path and the allowed values are listed.
- **Fixed `rate_per_min = 0` (no rate limit) being unreachable**: At the database write layer, an explicit 0 was silently changed to the default value, so operators thought they had lifted the rate limit while it was still in effect. The default is now filled at the API layer when the field is omitted.
- **Fixed digest channels bypassing the token bucket entirely**: `rate_per_min` previously had no effect on digest mode. The number of items claimed is now constrained by both the quota for the current round and an in-memory upper bound.
- **Fixed failure handling being decided by the maximum attempt count of the whole batch, so old deliveries dragged down new ones**: An old delivery already retried twice would drag brand-new deliveries in the same batch into failed as well, so new vulnerabilities were permanently lost without using a single retry. The decision is now made per entry.
- **Fixed deliveries in a digest batch whose snapshot could not be parsed being silently marked as successful**: Such entries were skipped at the rendering stage yet counted as successful along with the whole batch. They are now explicitly judged as failed, with a reason given.
- **Fixed the number of deliveries per round for a single channel possibly exceeding the lease duration**: In multi-instance deployments, rows whose lease had expired would be claimed again, sent in duplicate, and have their attempt counts incremented twice. The per-round cap is now derived backward from "lease / single-attempt timeout", and an assertion pins down the relationship between these constants.
- **Fixed Telegram truncation possibly cutting HTML entities**: Truncation avoided only half-cut tags, not entity fragments such as `&amp`, and the parser might therefore reject the **whole** message. Both are now avoided.
- **Fixed the email channel judging transient SMTP failures as permanent failures**: 4xx codes such as greylisting `450` are temporary rejections that should be retried later, but they were previously all judged dead, so with a greylisting server every push would fail after its first attempt. The decision now follows the first digit of the reply code: 4xx is retryable and 5xx is a permanent failure.
- **Fixed submitting nested structures actually writing the mask literal into the database**: Object fields such as `webhook.headers` can only be masked or submitted as a whole; a mask sentinel placed inside the object would be stored as a real value, silently breaking authentication. Such submissions are now explicitly rejected.

#### Design Notes

- **The transaction that writes a vulnerability performs only one blind INSERT**: `notification_events` and the vulnerability are written in the same transaction, and committing guarantees the two are atomically consistent. This INSERT deliberately does not read the channel table or run the user's filter rules, and is wrapped in a `SAVEPOINT` — otherwise a single misconfigured filter condition could abort the transaction and keep a high-severity vulnerability from being saved.
- **Delivery uses lease-based claiming instead of a long transaction**: After claiming with `FOR UPDATE SKIP LOCKED`, the row is set to `sending` and `next_attempt_at` is pushed into the future to serve as the lease, so no database lock is held during delivery; rows left behind by a process crash are claimed again after the lease expires, which self-heals without retrying forever.
- **Rate limiting does not consume the retry budget**: The quota for the current round is first computed from the token bucket, and then that number of items is claimed. Reversing the order would make deliveries held back by rate limiting count an attempt for nothing, and the three-attempt budget would be used up by pure waiting and then fall into failure.

### Test Infrastructure

#### Fixed

- **Fixed assets permanently left behind by the cleanup order in the company ICP attribution test case**: `defer d.Close()` runs first when the function returns and `t.Cleanup` runs after it, so all the cleanup statements landed on an already-closed connection, and the errors were also discarded, leaving test assets and companies permanently in the database and causing other cases that assert on asset counts to fail inexplicably. Closing the connection now also goes through `t.Cleanup` and is registered first, and cleanup failures are now made visible.

### Traffic

#### Added

- **The traffic list supports content search, path / status code / length filtering, and column sorting**: The filter row supports filtering by **response content** (using the full-text index), **path**, **status code** (an exact value or a bucket such as `2xx`), and **response length range**; the table header can sort by time, status code, and response length, and the sorting preference is remembered locally. Two indexes were added and take effect automatically on existing instances after upgrading; the query contract of the Agent tool is unchanged.
- **The traffic list gains "Clear all"**: Deletes all traffic records at once (ignoring the current filter) and cleans up historical host directories that the index no longer records; after clearing, a full compaction is run and the amount of space actually freed is reported. Traffic evidence already bound to vulnerabilities is stored in a separate evidence store and is unaffected.

#### Fixed

- **Fixed disk space not being released after deleting traffic**: The index database was created without `auto_vacuum` enabled, so the file never shrank; and the full-text index is `contentless_delete`, where `DELETE` writes only a tombstone and does not reclaim the original postings — deleting traffic actually made the index bigger (measured: capturing a 6MB body → 16MB index, still 16MB after deleting everything). Newly created index databases now enable `auto_vacuum=incremental`, and after each deletion, full-text index merging and incremental reclamation run in the background in chunks, gradually returning space to the system (the same scenario drops back to 104KB); reclamation releases the write lock between chunks and does not block traffic recording.

> Upgrade note: `auto_vacuum` can only be set when the database is created, so **the index databases of existing instances remain in the old mode**, and incremental reclamation is a no-op on them (a hint line is printed at startup). On such databases, tombstone growth is already stopped after the upgrade, and the space already occupied can be reclaimed once with "Clear all" — that step converts the database to incremental reclamation mode, after which routine deletions take effect on their own.

### LLM

#### Fixed

- **Fixed the custom session header not taking effect on the "one-off LLM call" paths**: Goal decomposition (round 0) and cold-node compression are both one-off calls that do not attach a transcript store, so there is no session id on the context and the gateway side therefore cannot read that header — for endpoints like opencode zen that return 400 outright when the header is missing, this showed up as "round 0 fails, yet subsequent planner rounds are entirely normal". A session id that is stable per exploration is now explicitly attached on these two paths, which also lets token usage be correctly attributed to the corresponding exploration (previously it was not recorded at all).

### Tools

#### Fixed

- **Fixed output truncation for MCP and custom tools not taking effect, with large results flooding the context wholesale**: MCP tool returns previously went through no truncation at all, and HTTP-type custom tools, because an empty tool context was passed in, always used a hard-coded 6000 characters rather than the session-configured limit. Both paths now go through `actool.Capture` uniformly: output is truncated at the session's `MaxOutputChars` (default 30000), and when `ToolOutputDir` is configured, the full output is spilled to disk and only the opening snippet and a file pointer are kept in the message.
- **Upgraded norma to v0.4.3**: The harness layer now uniformly executes `CaptureOnce`, so no tool (including ones added in the future) will overflow the context again because truncation was not wired in.

### Deployment

#### Fixed

- **Fixed the activity stream failing to connect under reverse-proxy deployments**: The SSE address was previously assembled unconditionally as `${hostname}:8787`; in deployments proxied to 443, the page loaded from `https://domain/` while SSE was pointed at port 8787, which is not open to the public network, showing up as the activity stream reconnecting repeatedly. It now differs by `NODE_ENV`: production defaults to same-origin, and only `next dev` keeps `:8787` to bypass Next.js's buffering of SSE; the `NEXT_PUBLIC_SSE_BASE` override is retained. The README adds instructions for reverse-proxy deployment.

### Discovery

#### Fixed

- **Fixed the asset list in the "By asset" view having no scrollbar when it overflows**: The outer card was given only a `max-height` and no definite height, so the percentage height of the scroll viewport could not be resolved, and with many assets the list either burst out of the card or was truncated and could not be scrolled. The height cap is now applied directly to the asset tree's native scroll container and adapts to the window height.

### Database

#### Fixed

- **Set an upper limit on the connection pool**: `database/sql` by default does not limit the number of connections the application itself can open, and when there is no idle connection in the pool it creates one unconditionally, all the way up to PostgreSQL's `max_connections` (default 100) before being rejected. It is now capped at 32; excess queries wait for an idle connection, so under the same load the symptom is slowness rather than errors; if `max_connections` has been lowered, adjust this down accordingly.
- **Improved connection reuse**: The default of `MaxIdleConns` is 2, so connections beyond 2 under concurrency were closed after use and the next request had to redo the TCP and PostgreSQL authentication handshakes. The idle limit is now raised to match the total limit, and a 30-minute connection lifetime and a 5-minute idle eviction are added, so the pool can naturally replace long-lived bad connections.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)

## [0.3.14] - 2026-09-24

### Task List

#### Added

- **The task list gains a "Vulnerabilities" column**: Shows the counts for Critical / High / Medium / Low by severity tier, with non-zero tiers colored by severity, so the vulnerability scale and distribution of each task are clear at a glance.

#### Changed

- **The "Description / Target" columns are narrowed**: Overlong content is shown truncated with an ellipsis and the full text can be viewed on mouse hover, reducing the horizontal space that long text takes up in the list.

### Exploration Graph and Planning Situation Overview

#### Changed

- **Slimmed down the planning situation overview (graph_overview) and set count limits for each list**: Recent facts, finished intents, pending intents, cold-zone summaries, and confirmed vulnerability details all become "latest window + count fallback", and whatever is not shown can be queried on demand; this significantly reduces the LLM context size per round and avoids context bloat in long tasks (the cold zone of the related-task overview is rate-limited as well).

#### Fixed

- **Eliminated reverse duplicate edges between digest and finding in the exploration graph after collapsing cold nodes**.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)

## [0.3.13] - 2026-09-19

### Asset Interception

#### Added

- **Added global asset interception rules (blacklist)**: Supports entering exact-match and fuzzy-match domains / IPs / URLs as well as CIDR ranges, with create, read, update, and delete of rules and enable/disable; the management page is at "System → Asset Interception"; fuzzy interception of government (`.gov` / `.gov.cn`) and education (`.edu` / `.edu.cn`) websites is built in by default.
- **Asset interception is wired into the execution chain**: Before issuing an intent (`add_intent`) and inserting assets (`insert_assets`), the Agent first runs an interception check on the target assets — intents that hit interception are not issued, assets that hit interception are not inserted, and the asset information and interception reason are returned to the Agent.
- **Added task-level interception / allow (whitelist) rules**: Independent of the global rules and effective only for this task, with the evaluation order "intercept first, then allow" — a hit on interception means prohibited; if there is no interception hit but this task has allow rules configured and none of them hit, the result is "testing not allowed"; when no allow rules are configured, the whitelist is not enabled. They can be entered when creating a task, and also added, edited, deleted, and enabled/disabled in the task details "Overview".
- **Task templates support preset categories and task-level interception/allow rules**: A template can save a task category and a set of task-level rules, which are brought into the new-task form together when the template is applied.

### Operation Review

#### Fixed

- **Tightened the model judge's output protocol to reduce false allows caused by truncation**: The upper limit of the verdict explanation (comment) is lowered from 500 Chinese characters to 120 Chinese characters, and "output JSON only, with no preamble or code block" is enforced, to avoid a verdict being truncated by `MaxTokens` so that it cannot be parsed and is then allowed under the model failure policy (fail-open).

### Task Archiving

#### Fixed

- **Archiving now skips symbolic links instead of failing the whole package**: The archive format supports only regular files and directories end to end, and previously any symbolic link in the working directory made the whole task archive fail; the symbolic link is now skipped and logged, while the remaining files are archived normally (links are not followed and the directory tree is not left).

### Account and Compliance

#### Added

- **Added a "Notice of Use and Disclaimer" dialog before login**: Login is possible only after ticking to agree.

### License and Dependencies

#### Changed

- **The project adopts the AGPL-3.0 open-source license**, and the license and disclaimer descriptions in the README are improved.
- **Upgraded norma to v0.4.1**.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)

## [0.3.12] - 2026-09-17

### Exploration Chain Broadcast Board

#### Added

- **The task details page gains an "Exploration Chain Broadcast Board"** (#144): Presents the task's exploration nodes (start/target/intent/fact/vulnerability/hint/compression) in a timeline feed view, with filtering by type, keyword search, ascending/descending order, pagination, and auto-refresh; on the "first page, newest first" it is the live position and refreshes every round, and when you leave that position it only accumulates an unread count without disturbing your current reading, and one click on "N new broadcasts · Back to latest" returns you. It is grouped by day, so even when paging through a long task you can tell "which day this happened".
- **The broadcast board shows the node id on each row** (#145), making it easier to cross-reference the exploration chain graph and locate a specific node.
- **Expanding a broadcast node's details shows upstream/downstream and anchored assets** (#147): Expanding a broadcast shows the node's upstream (where it came from) / downstream (what it produced) relations, and hovering over a related entry pops up that node's card (type/status/source/time/summary/payload snippet); it also lists the assets anchored to the node (type label + identifiable text). The related data is delivered together with the broadcast page, so expanding sends no additional request.
- **Broadcast board search supports filtering by node id** (#150): In addition to "content / source", the search box adds node id matching; entering a pure number or the "#41" form shown in the interface locates the corresponding node precisely.

### Intent Management

#### Added

- **Intent deletion supports two modes, "soft delete / hard delete"** (#149): Pending, running, and paused intents can all be deleted, and a reason must be provided for deletion; the deletion mode is chosen in the confirmation dialog.
  - **Soft delete (default)**: The intent is set to "deleted" and the reason is recorded in a separate field, keeping the intent node and all its outputs and lineage.
  - **Hard delete**: Physically removes the intent as well as the exclusive descendant nodes "supported only by it" (cascading along the output / intent chain down to the leaves), avoiding leaving orphaned data; the deleted intent's token metering is archived and kept under its original date; shared nodes (still referenced by other intents), targets, and the task's root fact are always kept, and the hard-delete dialog shows the number of nodes expected to be affected by the cascade.

  Both modes notify the planner that "this intent was deleted by the user + reason" and have it re-plan accordingly.

### Operation Review

#### Added

- **Approval records support filtering by status and decision source** (#139): Approval records can be filtered by approval status and decision source, to quickly locate the target record.

#### Fixed

- **Pending approval requests are loaded independently of history pagination** (#133): Pending requests are no longer affected by the pagination of the history list and remain fully visible while paging through history records.

### Agent

#### Changed

- **The Worker role description is changed to a generic cybersecurity platform wording** (#138).

#### Fixed

- **Fixed cold-node compression never triggering**: The Compactor is now wired into the per-task planner; cold-node compression (cold-digest) previously never ran because it was not wired in, and has now been restored.

### Chat

#### Added

- **Chat supports @ references to multiple record types and scroll pagination** (#135): Records of multiple types can be @-referenced in chat, and the reference candidates support scroll-paginated loading.

#### Fixed

- **Long message bubbles are constrained within the conversation panel** (#137): Overlong message bubbles no longer overflow the conversation area.
- **Fixed uploading a file before a new conversation is created reporting "missing upload file"**: The Composer's file selection snapshots the `FileList` into an array before clearing the input and then calls back; previously, in the draft state a conversation had to be created asynchronously first, and by the time execution resumed, the `FileList` live-bound to the input had already been cleared, so the upload lacked the file field and the backend returned 400.

### Traffic

#### Fixed

- **The traffic recording proxy listens only on 127.0.0.1 by default** (#129, #130): Avoids exposing an open proxy on other network interfaces under the default configuration.

### Web

#### Fixed

- **Fixed the statically exported task list page losing the global header**.
- **Filled in the related-traffic mock for the demo vulnerability details page, fixing a blank screen**.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)
- [@RuoJi6](https://github.com/RuoJi6)
- [@dingpotian](https://github.com/dingpotian)

## [0.3.11] - 2026-09-15

### Operation Review

#### Added

- **Approval records support source location** (#125): Clicking an approval record's "Source" jumps back to the tool execution that triggered that approval — opening the original full session, automatically paging in to the target position, expanding the command and result in place, and highlighting it centered in the scroll area, while the surrounding messages remain readable; auto-correction stops when the user scrolls manually. Across ordinary conversations, task Workers, planners, and main Agent segmented sessions, precise location is achieved through the persisted `tool_use_id` and the task mapping (a scope-level call ID index was added), and when it is missing, duplicated, or the association is unclear, an explicit notice is shown instead of jumping to some other execution. When the session has been deleted or the task is archived/the record is missing, a clear notice is given.
- **Approval records support pagination** (#115).

#### Changed

- **Slimmed down the model review input** (#124, #125): The input to model review (the LLM judge after no rule hits) is narrowed to a versioned JSON of "the current complete tool call + an explicitly chosen short background + the local working directory". The background takes only real user messages (the current user message of the chat/task main Agent); Workers no longer carry an intent summary, and background inherited from the superior Agent is also cleared; planners and auto-triggered sessions do not fabricate user messages. Task description, targets, operation constraints, global exploration situation, historical calls, and the Worker's full intent are no longer attached — these are still used as before for Agent execution and independent session auditing, just no longer entering operation review. All verdicts are required to output JSON `decision`/`comment`, and the explanation must include "the actual operation, the consequence on success, and the rule hit"; instructions inside parameters or background cannot change the review policy. A snapshot of the input actually sent to the model is saved along with its fingerprint; old-version snapshots are kept and labeled with their version, and old inputs are not fabricated from current data.

#### Fixed

- **A model verdict wrapped in a code block is no longer silently allowed** (#126): If the verdict JSON returned by the model was wrapped in a ``` code block, a parse failure previously led to it being silently allowed via the model failure policy; the code-block fences are now stripped before parsing, and only if parsing still fails is the configured failure policy applied.

### Agent

#### Added

- **Added experimental noa context compression** (norma upgraded to v0.4.0): An experimental feature that can be enabled in system settings, off by default. When enabled, noa (model-driven context compression) takes over context compression for four kinds of Agent — main Agent, planner, Worker, and chat — replacing the built-in compression; the original compressed text is persistently archived, placed centrally under `<workDir>/noa/<session-id>/` (not scattered across task directories), in directories that are globally unique by session ID. If integration fails, it automatically falls back to the built-in compression without interrupting real tasks; the switch is read once per run, so toggling affects only runs started afterward.

#### Fixed

- **Exploration graph tools now reject rather than crash with nil when there is no task context**: Calling exploration-graph-related tools in a non-task context returns an explicit error instead of crashing on a nil store dereference.

### MCP

#### Added

- **Supports legacy SSE MCP services** (#117): Compatible with MCP servers that offer only the legacy SSE transport.

### Traffic

#### Fixed

- **Traffic search matches a record's host in a port-aware way** (#114): Host matching in `traffic_search` now includes the port, avoiding cross-interference between records of the same host on different ports.
- **An error migrating `traffic_search` descriptions no longer interrupts subsequent reporter migrations**: A single migration failure is isolated and does not affect the execution of subsequent migrations.

### Web

#### Changed

- **Added a divider to the task re-test vulnerability options** (#122): A separator is added between re-test vulnerability choices, making them visually clearer.

#### Fixed

- **Fixed the whole demo task details page crashing**: In mock mode, the "Session" tab of task details fetches `GET /api/tasks/<id>/side-questions` (the side-question history), but the mock handler had no such route, and the read fallback, by the rule "a path ending in s is a collection", returned `[]`, making `data.items` `undefined`, so the side-channel hook's `merge()` iterating over it threw `TypeError: t is not iterable`; the exception occurred inside the updater of `setItems`, was deferred by React to the render phase and rethrown, the caller's `catch` could not catch it, and the whole page was taken over by the error boundary showing "This page couldn't load". The mock handler now explicitly returns an empty side-question history, and `sideAPI.history` also normalizes the returned value (anything where `items` is not an array is coerced to `[]`) as defense in depth.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)
- [@RuoJi6](https://github.com/RuoJi6)

## [0.3.10] - 2026-09-13

### Network

#### Added

- **Web search adds the official DeepSeek source**: It directly reuses the currently active LLM configuration. It differs in nature from the other three sources — DeepSeek has no directly callable search interface; search exists only inside its Anthropic-compatible interface (the `web_search_20250305` server-side tool) and is executed on DeepSeek's server side. It therefore **supports only the official DeepSeek endpoint + anthropic protocol** (OpenAI-protocol endpoints reject server-side tools outright), and each search **consumes an extra model call**, the request **does not go through the search egress proxy**, and it is **not counted in traffic logging**; results contain **only titles and links** (no summaries; when the body text is needed, it is fetched with WebFetch). The settings page describes the above limitations but **does not block on validation**; whether they are satisfied is for the user to confirm, and the "Test search" button can be used to run one real search to verify.

### Agent

#### Added

- **Workers gain cross-work lookback capability**: Adds `search_all_worker_traces` (without needing to know the intent_id first, globally searches for matching steps in the execution process of all works in this task by keyword) and `get_worker_trace` (after locking onto one work, lists the step stream, searches in place by keyword, and fetches full content by step_id), used to reuse observations that other works saw but did not write into a fact, avoiding duplicated effort.
- **`node_detail` is handed down to workers**: Together with the lookback tools above, once a worker has an intent_id / node id it can directly query that node's full details.
- **Planning rounds triggered by `add_hint` are explicitly broadcast**: Previously, adding a hint only folded the hint into the situation overview and left the planner to discover it itself; now each `add_hint` records a trigger for the planner, "a human added N strategic hints: …" (a batch counts as one, not flooding one by one), and the planner is explicitly told "this round was triggered by newly added hints" and sees the hint content directly.

#### Changed

- **The global situation prompt is changed to a "loosened" tone**: Encourages divergent exploration and timely reporting of cross-intent leads, rather than converging too early.
- **Slimmed down the wording of the worker boundary**: Being blocked at first does not mean it has been fully probed; the focus is on "finish the bypass techniques within this intent before drawing a conclusion".
- `insert_assets` removes the per-asset `related` input: its only purpose was to decide whether to add the asset to this task's scope, yet the value was not persisted (it was voided when the same asset was registered again, and the UI could not show who had been judged irrelevant), so in practice it just made the model make one more judgment that could not be retained.
- **The test scope (`task_scope`) is no longer affected by the asset coverage switch**: The automatic scope entry of `insert_assets` (`source='auto'`) is performed whether coverage is on or off, and `add_task_scope` is also always provided to the planner / in-task main Agent / goal decomposition Agent. The scope is the task's authorization boundary and the filtering baseline for asset queries; the coverage switch only decides whether to use it as the denominator for computing metrics, and should not decide whether to accumulate the scope itself. Previously, turning off coverage made both the `auto` and `agent` write paths fail at once, leaving `task_scope` with only rows added manually in the UI. `list_untested_assets` is still hidden when coverage is off (it is itself a purely coverage-oriented view).

#### Fixed

- **Fixed assets leaking between tasks** (#59): `list_assets` previously hard-coded the task id to 0 and queried the whole shared asset library bare, and the model had no way to write a scope filter condition, so assets of other tasks (IPs especially) were taken as this task's targets and the testing direction was led astray. It now returns only assets that fall within the test scope (`task_scope`) of **this task and directly related tasks**, matching by **ownership** rather than literal value: having a root domain in scope lets you find all subdomains/services/endpoints under it, and having a network range lets you find the hosts and services within the range; fetching an out-of-scope asset directly by id likewise fails. Non-task contexts (Auto/pentest) have no scope to rely on and still fall back to the whole library. It also fixes an ownership blind spot where IP-direct hosts (such as `http://1.2.3.4/api`) could not be matched by a network-range scope. The UI's "Test assets" view (filtered by task producer) is unaffected.
- **Fixed the worker cross-work lookback tools being deleted by mistake**: After `search_all_worker_traces` / `get_worker_trace` (and `node_detail`) were added to the worker's default tool set, an old migration that "narrows the worker tool surface" unbound them again at startup, so the worker actually could not get these tools. They have been removed from that unbind list, and databases that had already run the old migration get them re-bound to the worker once.
- **Fixed `/btw` side-question occasionally failing to be stored**: Before the side_question checkpoint is written to the database, the NUL (`\u0000`) escape that JSONB does not support is stripped, avoiding write errors for content that contains this character.

### Triggers

#### Fixed

- **Merged trigger sessions deduplicate the task description/target by task**: When multiple tasks are merged into one trigger, the same task's description/target is no longer concatenated into the message repeatedly, avoiding long targets stacking up over and over and blowing up the context.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)

## [0.3.9] - 2026-09-11

### Agent

#### Added

- The in-task main Agent supports **multiple sessions**: you can create, switch, and independently reset the context, and every session can be interacted with.
- Supports persistent `/btw` **side questions**: follow-up questions that do not interrupt the main line, with Q&A stored in the database and still there after a restart.
- `spawn_task` adds `source_task_ids`, so a new task can **inherit the source tasks' assets and findings read-only**.

#### Changed

- Turned off the worker's cross-engagement memory and narrowed its default tool surface: reading context and cross-work review are planning duties, and the worker only handles the execution and write-back of a single intent.
- Slimmed down the worker's default prompt; `get_worker_output` removes the `terminated` and `worker_name` fields; slimmed down the descriptions of `insert_assets` / `list_assets`.

#### Fixed

- Fixed a work being interrupted early by an **idle-spin turn**: the model sometimes uses an entire turn to output only thinking, giving neither body text nor a tool call; the harness then sees a natural end (`end_turn` with no `tool_use`) and finishes directly with `completed` + an empty summary — an intent that is not yet finished breaks off halfway, showing up as "the task ended normally but without any text summary". None of the five LLM retry layers can reach it: it is not an error, the entry point of the same-provider safe-window retry is "stream failure", the circuit breaker judges success directly when `err == nil`, and intent re-run only recognizes `model_error`; the SDK's empty-response retry cannot reach it either, because that layer judges emptiness by "whether any event was yielded", and the thinking deltas are themselves events. The work's Stop hook now recognizes such a turn and injects a continuation instruction, letting the model continue to the next step carrying the thinking it has already produced — deliberately not choosing "resend as is", because such idle spinning is usually determined by the shape of the prompt and context, a stable behavior rather than random flakiness, and resending would only make the model think it all over again.
- The count reuses the **empty-response retry count** in the LLM page's "Retry and backoff" (both answer "the model finished but produced no substantive content", differing only in criterion and means), default 2, and entering `-1` turns it off and goes back to the previous behavior of "finish on idle spin". It is a **total** cap per intent rather than a consecutive count: the harness itself already limits consecutive idle spins to a single nudge, and the quota is refreshed only after a tool turn has genuinely happened, so this number guards against loops like "tool → idle spin → nudge → tool → idle spin" exhausting the intent's budget. When triggered, the log records the exact string `[work <worker> · #<意图>] 空转回合…注入续跑指令 (n/N)` (Chinese log text retained for exact matching). For the design see `docs/LLM重试设计.md` (LLM retry design) §1.1.
- Fixed the context budget and input layout of `/btw` in long conversations; in non-secure contexts (non-HTTPS access), the side-request ID generation degrades gracefully.

### Traffic

#### Added

- Vulnerabilities support **associating multiple traffic evidence items**, which can be sorted, annotated, and distinguished by role (request/response/corroboration).
- The report Agent **automatically associates** relevant traffic evidence before writing a report.
- Added the Agent **traffic binding switch**, and filled in the handoff of evidence between Agents.

### Tasks

#### Added

- Supports **session-level vulnerability re-testing**: The re-test runs in an independent Agent session, and the list and details show the running status.

### Interception

#### Added

- Approval records gain **details and execution audit**: You can view the tool request context, the model/rule preliminary judgment, the execution output, and the parameter fingerprint.

### Assets

#### Added

- Task test assets support **DSL search**.

### LLM

#### Fixed

- Fixed test-connection not re-sending the custom session header, which caused opencode zen to return 400.

### Network

#### Added

- The MCP HTTP transport supports **skipping TLS certificate verification**, making it easy to connect to services with self-signed certificates.

### UI

#### Added

- The session list is grouped by Agent, supporting expand/collapse and independent pinning; conversations support filtering by Agent.
- The attack chain graph renders compressed (digest) nodes and shrinks their members.

#### Fixed

- Fixed a blank screen caused by out-of-sync login credentials.
- The interception notice wording now clearly states "platform-controlled", to avoid being misread as a defense on the target side.

### Deployment and Updates

#### Added

- Supports **one-click update from the page**: The system configuration page adds a "Version and Updates" card, and the top bar lights up a notice when a new version is available. The flow is download the release package → verify `SHA256SUMS` → smoke test → stage → exit to be relaunched by the guard script to complete the swap, and the page refreshes automatically.
- Added the guard startup scripts `start.sh` / `start.bat` as the official startup entry (already included in the release package and the Docker image; `install.sh` is unchanged), which decide whether to relaunch based on the exit code and take care of forwarding SIGTERM to artex. The verification and swap logic are all in Go, and the scripts are kept dead simple.
- Automatic failure fallback: if verification or the smoke test fails it is discarded and the current version keeps running; if the new version fails to start 3 times in a row, it rolls back to the previous version. The settings page also has a manual rollback (note that the database schema is not rolled back).
- Updates recognize only GitHub domains and force HTTPS, and the release source is not configurable; one-click update is disabled in development builds. GitHub query results are cached for 30 minutes so that the top-bar notice does not exhaust the API quota.

#### Known Limitations

- Under Docker only the program is swapped, not the image: the toolchain is not upgraded along with it, and recreating the container reverts to the version that ships with the image; use `docker compose pull artex` when needed.
- The `skills/` in the release package are not synced, so new built-in skills added in the new version do not take effect automatically.
- An update means a restart, which interrupts running tasks.

### Dependencies

#### Changed

- Upgraded norma to v0.3.7.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)
- [@RuoJi6](https://github.com/RuoJi6)

## [0.3.8] - 2026-09-09

### LLM

#### Added

- The LLM page adds a "Retry and backoff" tab: both the **count** and the **interval** of the five retry layers are configurable. A failure of one model call passes, from the inside out, through connection retry (SDK; connection reset / timeout / 429 / 5xx before the stream starts), empty-response retry (SDK; normal completion without any content, openai format only), same-provider safe-window retry (replaying a broken stream before any output has been delivered to the caller), polling circuit breaker (cooling down and skipping once consecutive failures reach a threshold), and intent re-run (re-running the whole intent after a worker ends with model_error) — five layers, and the outer layer's turn comes only after the inner layer is exhausted. Each layer has two knobs with uniform semantics: empty = use the original default count and exponential backoff; entering a count uses that count; entering an interval replaces exponential backoff with a fixed interval; entering -1 = turn this layer's retry off. The first three layers follow the endpoint, and each model configuration can override the global default field by field (pinning only the interval still inherits the global count); the circuit breaker and intent re-run have process-level semantics, with only one global copy. It takes effect hot after saving, with no restart needed. Leaving everything empty is the current behavior, and after upgrading an old database it is byte-for-byte unchanged (new columns default to 0, and absent settings keys mean all defaults). The connection test deliberately carries none of these parameters — it has a 30s hard timeout, and stacking user-configured retries on top would only make a usable endpoint test as a timeout failure. For the design see `docs/LLM重试设计.md` (LLM retry design).
- Each LLM configuration supports a custom **session header** (`session_header_key`): when non-empty, every LLM request carries that HTTP header, whose value is the session id of the current run (`conv-<id>` for chat sessions, `exp<x>-worker-i<intent>` for workers, and so on), for gateways that do prompt caching / sticky routing by a session-id header. It is implemented by reading the session id from the request context and injecting it, requiring no norma changes, and even the same shared provider can send different header values per session. Old databases get a migration, and the frontend LLM configuration dialog adds an input box.

#### Fixed

- Fixed saving an LLM configuration failing directly with `23502` when the session header field was empty: that column is `NOT NULL DEFAULT ''`, and `NULLIF($n,'')` had been wrongly applied, writing an unfilled session header as NULL and triggering the NOT NULL constraint; it now passes the argument directly with empty-string semantics.

### Agent

#### Added

- Wall-clock timeout is changed to **in-place wrap-up**: Depending on norma v0.3.6, when `MaxDuration` is reached it interrupts the running tool and continues, on the live ctx, for the wrap-up round count (writing back what has been identified + a summary, with terminal state timeout), no longer relying on the external hard ctx of `maxDur+90s` that the worker/planner each had, which killed a stuck run outright as `aborted_tools`. Chat goes through the same harness and automatically gets the same behavior, and mainagent has no `MaxDuration` and is unaffected.
- Stall fallback: when the planner wakes on a heartbeat / no-change wake-up and the whole graph has no open or running intent at all, the opening statement changes to a stall alert, explicitly telling it that no worker is running and no direction is queued, and that this round must produce one or more non-duplicate new intents (producing 0 intents is not allowed).

#### Changed

- Worker prompt restructured: the raw JSON of the intent / startup instruction / anchored assets is moved into the system prompt, re-assembled every round and never compressed away by compaction, and continuation no longer depends on the transcript's first message being retained; the startup user message is slimmed down to just the global situation overview (degradable, tolerating staleness). The cost is that per-intent data is mixed into the system prompt and cross-intent cache reuse is lost, a deliberate trade-off for "never losing the intent".
- Slimmed down the planner / worker default text and fixed several real-world problems: the planner now distinguishes `recent_done` by status (blocked/exhausted: check the trace first and then decide, neither treating it as a dead end nor blindly re-running it), negative conclusions are changed to "observation / doubtful, not a final verdict" and evidence is checked before adopting them, when the goal is not met and there is no open/running intent it must produce one (hard floor), and depth takes priority over coverage; for the worker, negative-type conclusions are written only as "observation + tentative reading", the verdict authority belongs to the planner, and cross-intent leads are written into the fact's summary for the planner rather than chased by the worker itself. A reseed appends the new defaults as a new version and switches to it, while user-customized / old versions are kept in history and can be rolled back.
- Narrowed the work agent's default tool set and the asset write-back prompt: the worker handles only the execution and write-back of a single intent, and reading context / cross-work review are planning duties, so `list_facts` / `node_detail` / `list_companies` and cross-work retrieval (`search_all_worker_traces` / `list_worker_traces` / `get_worker_trace`) are removed from its default tools, leaving only `list_findings` (check for duplicates before reporting a vulnerability) + `add_finding` / `record_fact` + `insert_assets` / `list_assets`; the prompt deletes stale field descriptions (`type=tech`/`on_url`/`props`) that conflict with the `insert_assets` schema. Old databases get a one-off migration that strips the corresponding bindings, and bindings of the same names on planner/main are left untouched.

### Exploration Graph

#### Added

- **Exploration graph cold-node compression (cold-digest)**: Collapses old, long-inactive intents / facts into digest nodes shown in `graph_overview`, while the original nodes are kept permanently and can be fully restored by id (lossless storage, compressing only the presentation, reversible folding). Cold/hot is determined by reverse reachability + any live branch makes it hot, with R=6 rounds of debouncing and connected-component grouping; background compression (minor folds uncovered cold blocks, major re-compresses from source to merge fragments) comes with activity rechecks and cooldown mutual exclusion, and never goes on the hot path nor overwrites nodes that have come back to life. The overview side provides `cold_digests` and the asset-indexed `cold_index`, with `expand_digest` / `expand_index` responsible for restoring. The overviews of related / inherited tasks likewise reuse their own folded views, and `expand_digest` supports cross-task read-only restoration. `expand_digest` / `expand_index` are given only to the planner and main agent, not to the worker. All come with old-database migrations.
- `graph_overview` outputs `finding_list` in full: findings are the task's highest-value output and a single task usually does not have many, so they are now brought out in full in the overview (unlike facts, which only give a recent window), letting the planner/worker see all confirmed vulnerabilities at a glance every round without calling `list_findings` again. Each entry is slimmed to `{id, summary, evidence?, from_intent?, assets?}`, where affected assets are given directly as readable content (url / domain / ip:port) rather than bare ids.

#### Changed

- `graph_overview` no longer flattens `hosts`: the coverage block removes the host list (in large-scope tasks each round carried up to 500 host strings, of limited value for planning decisions) and keeps only `host_count`, and specific hosts are queried on demand with `list_assets`. A new top-level `done_intents_total` (total number of finished intents) is added, parallel to `recent_done_intents` truncated to ≤15, so the planner knows whether anything was truncated when deduplicating.

### Tools

#### Changed

- The default binding of `add_company_scope` changes from worker to planner: defining the enterprise asset scope is the duty of planning / main control / Auto, and the worker only executes exploration. Seeds for new databases default-bind to mainagent/planner/auto, and old databases get a one-off migration.
- The planner is default-bound to `list_assets`: it now has both `list_assets` (DSL full-library search) and `list_untested_assets` (untested within scope), with a one-off backfill for old databases that does not override user unbinding.

### Tasks

#### Added

- The task list adds a "Running Workers" column: counts the intent nodes with `state='running'` under the task, with exactly the same definition as the "Running Workers" in the task details page overview, and shows 0 when there are no running Workers.

### Network

#### Added

- Added a **global egress proxy** configuration: all target traffic can leave through a unified global proxy (http/https/socks5, supporting `user:pass`). When traffic capture is on, it serves as the upstream of the MITM recording proxy (traffic is still recorded and then leaves through the proxy; both the interception and pass-through paths go through the upstream without leaking the source IP); when capture is off, it is injected directly into the agent's bash environment and WebFetch (`proxyEnv` adds `ALL_PROXY` support for socks5). The configuration is stored in the settings KV table (no migration needed), and the frontend system configuration page adds a "Global Proxy" card, independent of the web-search proxy and the LLM proxy.

### UI

#### Fixed

- Corrected the semantic errors in intent status labels: `exhausted` "Exhausted" → "Budget exhausted" (actually cut off midway on reaching the step / time budget with only partial results written back, not that the direction has been fully explored), `blocked` "Blocked" → "Execution error" (actually model / API / network failures with retries used up, with the intent basically not really explored, not interception by the target / WAF), and added the previously missing `stopped` "Stopped" (a work stopped manually by the user).

### Dependencies

#### Changed

- Upgraded norma to v0.3.4: MCP tool output gains truncation and spilling to disk (see `651b961`), and the subsequent v0.3.6 supports in-place wall-clock wrap-up.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)

## [0.3.7] - 2026-08-31

### LLM

#### Added

- Model configuration adds an "Output limit", and you can choose which request field name the limit uses: the limit caps how many tokens a single reply can generate and is sent with each request, with 0 (default) = do not send the field and let the server default decide; it is a different thing from the "Context window" — the latter is the model's total capacity, used only locally to compute the compression threshold and not appearing in requests. The field-name switch is meaningful only for the `openai` (Chat Completions) format: empty (default) sends `max_tokens`, which the vast majority of compatible gateways recognize alone; OpenAI's official reasoning models (o series / GPT-5) conversely recognize only `max_completion_tokens` and report `unsupported_parameter` directly on receiving `max_tokens`, so such endpoints need to be switched manually to the new field. The two other formats each fix their field name (`max_tokens` for Anthropic, `max_output_tokens` for the Responses API), so for non-openai formats the switch is greyed out and cleared on save. It also fills in a link that had never been wired up: the planner / worker / chat / main Agent / goal decomposition — five places — never set an output limit, openai-family did not send it at all, and Anthropic fell back to the SDK's 8192; adding only the configuration item without wiring this line would mean that a filled-in number has no effect; the value is now resolved every round from the configuration, like "Streaming output", so it takes effect on the next round after a failover switch. After upgrading an old database, behavior is completely unchanged (new column defaults to 0 and empty field name).
- When clicking "Test" in the admin console, the status code of every HTTP attempt and the gateway's raw response body are written into the server log (response body cut to 4K), making it easier to diagnose cases such as 401, quota wording, empty frames, and HTML pages being returned, instead of only being able to see the ok / err collapsed by the UI. This log does not depend on the "LLM records" switch.

#### Changed

- The task LLM configuration chain can now be modified in any state, no longer restricted to "running / paused / configuration chain exhausted": after a task ends (done / failed / timeout) the main Agent conversation still goes through this chain, and when the model on the chain had a problem, it could neither be changed nor could interaction continue. Both the backend HTTP and DB transaction terminal-state checks are removed, and the frontend dialog also opens editing and saving for terminal-state tasks. Saving for a terminal-state task no longer reopens quota-blocked intents (those intents would be moved to open, with no worker to execute them and no longer meeting the conditions for "re-run intent"); to continue running, still use re-run intent / add target, which pull the task back into the running state.

### Agent

#### Changed

- "Send a message to a running Worker to adjust direction" is changed to reuse the existing pause / resume + transcript resume mechanism, with behavior consistent with the main Agent conversation: previously it went through a self-built intervention persistence protocol, which touched scheduling barriers, the resume flow, and a dozen-plus activity query filters. Messages are now injected through the next round of input, and the intent runs directly in its own dedicated goroutine, not limited by the 3-slot worker pool, running as soon as it is sent; the frontend keeps the message box and restores the "Continue directly" button, with sending now carried by SSE. No DB schema changes. Trade-offs: messages are held only in memory with no crash recovery, and when a message is sent the task may momentarily exceed the concurrency by one worker (a low-frequency scenario, acceptable).

### Tasks

#### Fixed

- Fixed the out-of-memory (OOM) crash when archiving large tasks: archiving now writes the snapshot as a stream and no longer reads the entire task into memory at once; it also fills three recovery gaps on the cold archive path — the traffic of modern installations exists only in SQLite, and previously a crash between the PostgreSQL commit and the SQLite commit would leave the archived task's traffic stuck in hot storage with no way to recover; a staging log is now written whether or not there is a history directory, and a missing `journal.json` is also treated as discardable.
- Fixed the system lag when there are many tasks: loading conversations and loading the interface had noticeable delays. The queries for the task list, task context, and exploration records are optimized together, and the frontend's dashboard, conversation page, and task details page also reduce duplicate requests accordingly.

### Assets

#### Changed

- Removed the "at most 256 rules" limit on the enterprise asset scope: enterprises that enter their scope IP by IP / domain by domain easily hit this ceiling, and after hitting it could only split into multiple enterprises, even though the scope itself is not slower just because there are more entries. The limits in the frontend, backend, and demo mock — three places — are removed together; a single rule is still limited to 1024 characters, and the 2 MiB request body limit is kept as a fallback (about forty to fifty thousand rules).

### Skills

#### Fixed

- Fixed uploading a skill archive reporting "Upload failed: zip: unsupported compression": the Go standard library has built in only two decompressors, Store / Deflate, and bzip2 and Zstandard packages written by compression software at non-default levels could not be decompressed at all. These two decompressors are now added (pure Go implementation, introducing no new external dependency); methods that truly cannot be decompressed, such as Deflate64 / LZMA / XZ / PPMd, as well as encrypted archives, are now reported with a Chinese message before decompression, naming directly which file uses which compression method and how to repackage it, instead of throwing the underlying English error at the user.
- Fixed validation that incorrectly rejected non-ASCII skill file names: path validation was originally an ASCII whitelist of `[A-Za-z0-9-_./]`, and as long as one file in the archive had a non-ASCII name (such as `reference/description.md`), the whole package upload failed with "archive contains illegal path". It is changed to a Unicode blacklist: file names in various languages and spaces are allowed, while control characters, invalid UTF-8, zero-width and bidirectional control characters (RLO file-name disguise), `\ % # ? * : " < > |`, and `..` / absolute paths / empty path segments are still rejected, with the directory traversal protection behavior unchanged. Skill names are relaxed too — ASCII is still limited to lowercase letters, digits, and hyphens (agentskills.io specification), non-ASCII letters can be used directly as a skill name, but spaces, dots, and path separators are not accepted.
- Fixed packages produced by Windows compression software having garbled non-ASCII file names after extraction or the whole package being rejected: such zips do not set the UTF-8 flag bit and write file names in GBK; GBK fallback decoding is now applied before path validation. Quoted frontmatter such as `name: "中文技能"` (a Chinese skill name, retained as an exact decoding example) can also now have the skill name correctly extracted.

### UI

#### Added

- The Discovery page adds an "All findings" flat view and sets it as the default, switchable via the header Tab with the original "Group by task" view: the grouped view requires expanding task by task to see vulnerabilities, which is a detour when you only want to glance over a list across tasks. The flat view is one big cross-task table (10/20/50/100 per page), behaving exactly like the grouped view — tick to export, expand a row to view evidence and the detailed report, edit name/category/severity inline, change disposition status, dig deeper, delete. The two views share the statistics cards and the filter bar, switching does not lose filters, and the current view and filter items are remembered locally; polling hits only the current view, and inline changes are written to both caches, so switching over does not show stale data.
- The Discovery page adds a "By asset" view: the left side is an asset tree (enterprise → root domain / IP → subdomain → service → endpoint, with the enterprise layer appearing only when assets really have an ownership), and the right side shows the findings under the entire subtree of the selected node, sharing the same table and the same filter conditions with the other two views. The tree includes only assets that have findings, with the ancestor chain filled in on demand (when a finding hangs only on the deepest endpoint, the layers above can still be assembled), and the counts on nodes are subtree aggregates deduplicated by finding; findings whose assets have been deleted or that never had associated assets go into the "Unassociated assets" bucket. Unlike the other two views, the asset view does not poll — it queries only when entering the view, changing filters, adding/deleting/editing findings within the page, or clicking the refresh button on the tree; the left tree is a navigation structure and there is no need to recompute it every 5 seconds. Each layer of the tree shows only the increment relative to the previous layer (subdomains with the root domain suffix removed, services shown as `https :443`, endpoints showing only the path), with full values in the hover tooltip and the breadcrumb; when there are too many nodes, the endpoint/service levels are dropped for the whole layer with a notice, while the counts still count toward the upper layers.

#### Fixed

- Fixed the session records in the mobile session details being squeezed and not fully visible: on narrow screens the session list is collapsed, giving the width to the records themselves.

### Dependencies

#### Changed

- Upgraded norma v0.3.2 → v0.3.3: adds `Config.MaxTokensField`, so that the output limit of OpenAI Chat Completions can be sent as `max_completion_tokens` instead (reasoning models recognize only this key). The two keys are mutually exclusive with only one sent, and the default is still `max_tokens`.
- Upgraded `golang.org/x/mod` v0.37.0 → v0.40.0, fixing two dependency security alerts.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)
- [@neouks](https://github.com/neouks)
- [@begininvoke](https://github.com/begininvoke)

## [0.3.6] - 2026-08-27

### LLM

#### Fixed

- Fixed the "non-streaming" switch changing back to "streaming" after being saved and reopened (#69): the DTO of the configuration list endpoint omitted the `streaming` field and the response never returned it, so the frontend read `undefined` and always fell back to the default of streaming; the actual write and DB storage were fine, it just could not be read back. The DTO gets the field back (without `omitempty`, since `false` must also appear in the response).
- The connection test is changed to verify that the model really replies, and to test using the configuration's real send/receive mode (#65): previously it judged only whether HTTP succeeded, so a request that went through but with zero model reply (thinking burned the budget / body swallowed by a safety policy / compatibility layer dropping `content`) was also reported as "connection successful", disconnected from the "no reply" behavior in sessions; and the test always went through streaming, so for non-streaming configurations it was actually testing a different channel. An empty reply is now judged a failure directly, the model's reply is shown in the message on success, and the current streaming switch is carried into the test, keeping "test passed" consistent with "the session works".

### Agent

#### Changed

- `list_facts` is changed to pagination + keyword filtering, to avoid a single call blowing up the context when there are many facts (#74): returns the latest 20 by default, supports `limit` (max 100) / `before` cursor / `q` summary keyword, and returns `{facts, total, has_more, next_before}`; a single summary that is too long is truncated by character count (full text still goes through `node_detail`). The worker / planner prompts are updated to the pagination semantics. Old databases get a one-off migration that refreshes the new parameter schema into the tool catalog table (`SeedTool` inserts only the first time, otherwise the tool management page shows "no parameters").

### Tools

#### Added

- The "Tool execution" page adds tool call count statistics (#72): the "Statistics" button in the toolbar opens a dialog showing, per tool, the call count, share, and failure count (descending by count); it follows the list's task / keyword filters, counts the entire result set rather than the current page, and fetches only when the dialog is opened.

### Dependencies

#### Changed

- Upgraded norma v0.3.1 → v0.3.2: fixes reasoning/refusal silently dropped from OpenAI-family responses (Responses adds `reasoning_text`), dedup of the three reasoning field names, bounded retry for empty responses (zero content blocks), and gateway 400s caused by compression boundaries cutting tool pairs (also fixing existing orphans already baked into transcripts).

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)

## [0.3.5] - 2026-08-25

### LLM

#### Added

- Each LLM configuration supports a streaming/non-streaming switch (streaming by default): on uses streaming SSE; off uses truly non-streaming (`stream:false`, returning the full JSON at once), which can bypass the poor SSE implementations of some gateways (empty frames, dropped thinking-field frames), at the cost of losing real-time progress and real-time token counting during a run. worker / planner / mainagent / chat / goals all take the value dynamically from the currently active configuration; the three Provider wrapper layers `llmpool` / `llmrec` / task runtime are all compatible with non-streaming; `llm_profiles` adds a `streaming` column and old databases get it via `ALTER` (default `true`, imperceptible to old configurations).
- Supports LLM configurations in OpenAI Responses API format: each configuration adds a third format `openai-responses` (hitting `POST /v1/responses`), alongside Chat Completions / Anthropic; `BaseURL` normalization, default model `gpt-5`; the `format` constraint of `llm_profiles` adds `openai-responses` with an idempotent migration for old databases; the frontend format dropdown adds "OpenAI (Responses API)". The dependency is upgraded to norma v0.3.1 (including the `reasoning_content` pass-back fix).
- Records the raw HTTP text of LLM requests/responses: captures the real wire body at the HTTP transport layer, preserving the tool schemas, `tool_use` blocks, and raw SSE frames that the normalized view cannot see; multiple attempts from norma's internal retries are each preserved; `llm_records` adds the `raw_request` / `raw_response` columns with `ALTER` for old databases; the recording page's details panel adds a "Raw" view toggle and request/response copy buttons (compatible with the `execCommand` fallback for non-secure contexts).

### Conversations

#### Changed

- Multi-select in the session list is changed to a "Multi-select" mode switch: by default the list no longer permanently shows a checkbox on every row (cleaner look), the header becomes a "N total + Multi-select" button; clicking "Multi-select" enters selection mode (checkboxes, select all, batch delete), "Done" exits and clears the selection, and after a batch delete fully succeeds it exits automatically (if there are failures it stays in selection mode for easy retry); single rename / pin / delete still go through each row's ⋯ menu.

### UI

#### Changed

- Improved task management, session operations, and traffic viewing experience (#57): the task list's column sorting preference is now persistently remembered, inline rename is triggered directly with an icon (no longer through a menu), and the drawer (sheet) interaction and traffic viewing details are refined.

#### Fixed

- The Worker asset tag shows only domains and IPs, and correctly handles the case of empty tags.

### Agent

#### Added

- When the planner judges a goal, a new "quantified acceptance check" is added: when the goal contains quantifiable acceptance conditions (asset testing coverage reaching X%, getting N flags, obtaining some permission), the measured values in `graph_overview` (`coverage.pct`, findings counts, and so on) must be checked before `prove_goal`; if the measured value falls short, `prove_goal` is prohibited and intents are dispatched to close the gap instead, and it may not mark met prematurely on grounds such as "the main part is done / roughly achieved". This fixes the problem where the goal required 100% coverage but the measured 40% was still judged complete.

#### Changed

- Rewrote the basis for judging "0 intents this round" in the planner prompt: the original text described 0 intents as "the most common and most important principle", which could make the planner stop too early when the goal was not achieved and there were still untested surfaces within scope. It now says 0 intents should be produced only in two specific cases — ① the directions thought of are all already covered by open/running/recent_done intents; ② the next step depends on the output of a currently running work and that output has not appeared yet (it should wait for it to finish and plan at the next wake-up after the graph updates). A reverse constraint is added: when there are indeed new directions not covered and not dependent on running works, or when the goal is not achieved and untested surfaces remain, do not stop on the grounds that "0 intents is common".
- Strengthened the "evidence threshold for negative conclusions" in the worker prompt: for negative conclusions such as "not injectable / port closed / no login entry" that may lead the planner to abandon a whole direction, it requires exhausting the reasonable techniques within that intent (changing encoding/parameters/path/method) before concluding; when the techniques have not all been tried or the evidence is weak, always mark `confidence=inferred`, to avoid welding a whole route shut with a careless `observed` negation (wrong negations early in a task especially lead the direction astray and are hard to self-heal).
- The planner / worker default prompt changes above are appended as new versions and switched to be the current version through one-off migrations (`reseedPlannerPrompt` / `reseedWorkerPrompt`, each guarded by a settings flag); old versions remain in the version history, and users who customized the prompts can restore them from the version records.

### Operations

#### Added

- Added `reset-password.sh` to reset the administrator password (username fixed as `ARTEX`): supports both local / docker deployments, connection information can be specified explicitly or read automatically from `--dsn`/`$ARTEX_PG_DSN`/`config.json`; it generates a bcrypt hash compatible with the backend login using `pgcrypto` inside the database and writes it back to `settings.auth.password_hash`, with no service restart needed after the reset. The password is passed in via an environment variable, does not enter the process argv, and is escaped to prevent injection.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)
- [@neouks](https://github.com/neouks)

## [0.3.4] - 2026-08-24

### UI

#### Added

- After ticking multiple tasks in the task list, the category can be modified in batch, and the target category supports "Uncategorized" to move tasks out of the current category; the whole batch is written within one transaction, and failed items can only be tasks that were deleted after being ticked.

#### Changed

- The "Task category" of a new task is changed from a dropdown selection to a searchable input box: typing filters existing categories, and a name that does not exist in the library is created and selected on the spot by pressing Enter (or clicking "Create" in the dropdown), with the selected item shown as a removable tag; still limited to a single category.

### Conversations

#### Fixed

- Fixed sending a message being blocked by "LLM not configured, cannot converse" when the session has a selected LLM configuration but there is no globally active configuration. The pre-send check originally looked only at the global active configuration, while actual execution prefers the configuration selected by the session, so the two places resolved inconsistently; both now use the same logic (session/Agent binding first, global as fallback).
- The prompt when conversation is impossible is subdivided by state: with no configuration at all it prompts "Add a configuration", with configurations but none active it prompts "Activate one or specify one for this session", no longer always showing "Not configured", making it easier to locate.

### Agent

#### Added

- For a task whose goals have all been achieved, intents issued by the main Agent via `add_intent` can be claimed and executed directly by Workers and stop once run: at this time the Planner no longer runs (a task with no open goals does not enter planning), avoiding it re-judging the goal as achieved and cancelling the freshly issued intents; once the frontier is drained the task returns to completed. Before issuing an intent, the main Agent asks the user, based on the intent's content, whether to register it as a formal goal, and if registered the task resumes regular autonomous planning.

#### Changed

- When the `step_ids` of `get_worker_trace` / `get_task_worker_trace` exceed the one-time limit (5), it no longer errors directly but returns the full content of the first 5 steps, and tells in the result via `returned_step_ids` / `omitted_step_ids` / `notice` which were fetched this time and which remain, with the hint "if this is enough there is no need to fetch more". Duplicate and invalid ids passed in are first deduplicated and removed before counting.

#### Fixed

- The task list is changed to descending by task id (most recently created first), replacing the previous ordering by creation time. Multiple tasks created at the same moment have identical timestamps and unstable ordering, which, combined with the 10-second polling and the random iteration of an in-memory map, caused them to swap positions in the list frequently.

### Assets

#### Fixed

- Fixed enterprise ownership recomputation being broken by a single dirty row: when `assets.ip` held a hostname (written by the Agent or the asset API), `a.ip::inet` would throw `22P02`, making adding/modifying an enterprise asset scope and deleting an enterprise all fail and roll back. The safe conversion `try_inet()` is now used, and invalid values are skipped instead of aborting the whole statement.
- An unparseable `ip` is no longer skipped silently: after an enterprise scope is saved, it now explicitly reports how many assets have an `ip` that is not a valid IP (including the specific ids and values), reminding that these assets will not be attributed by IP/CIDR rules; the same information is also written to the server log, covering paths without a frontend response (deleting an enterprise, scopesentry sync, Agent writes).
- IP/CIDR matching for the task test scope also switches to `try_inet()`, replacing the earlier regex guard that only checked the character set (hostnames made entirely of hex letters such as `abc.def` previously still slipped through and triggered the same error).

#### Changed

- The `ip` field of `ip`, `service`, and `endpoint` assets no longer accepts hostnames: `insert_assets` and the asset API return an error with an `index` for each entry and directly give the fix (use `type=subdomain` and fill `domain`, or resolve the A/AAAA record first), so the Agent can correct it by itself and re-insert. Other assets in the same batch are unaffected and are stored as usual.

### Contributors

- [@neouks](https://github.com/neouks)

## [0.3.3] - 2026-08-23

### Worker

#### Added

- Running Workers support individual pause, resume, and cancel; pausing keeps the intent, facts, and vulnerabilities, and cancelling transactionally cleans up the current intent and its direct products after execution exits.
- Added the `paused` intent state, execution fences, and named termination reasons, preventing late blackboard writes after pause, cancel, or task deletion.
- Added an optional task concurrency cap; creation, resume, vulnerability dig-deeper, and queue backfill all go through a persistent FIFO admission path.

#### Changed

- The default wall-clock duration of a single Worker run is adjusted from 600 seconds to 1200 seconds; after a timed-out task is revived, the timer restarts at the next real execution.
- The real execution states of Worker, Planner, and main Agent uniformly drive the task status badge, fixing "Idle" still being shown while a Worker is running.
- The Worker session keeps individual controls and the current-session token summary, and the model name moves to the right of the current session title.

#### Removed

- Removed the Worker multi-select, select-all, and batch pause/continue UI, and removed the Worker batch control API and Mock contract.
- Removed the token badge and tooltip in Worker list rows, while the underlying full token ledger and the task aggregate endpoint continue to be kept.

### LLM

#### Added

- Tasks support an ordered LLM configuration chain; when insufficient provider quota is explicitly recognized, it automatically switches to the next configuration, and persists the current configuration, the exhausted state, and the error summary.
- Running and paused tasks support editing the full configuration chain, adjusting the order, and manually switching the current configuration, taking effect from the next LLM call.
- Automatic switches, manual switches, and full-chain exhaustion are written into structured system activity, and dedupable reminders pop up through the task activity stream.
- Added a task role model resolution endpoint that uniformly resolves the configuration and model used by the next call of Main Agent, Planner, and Worker.
- Added an optional global LLM Pool, supporting configuration of call order, fallback on failure of a specified model, health status, cooldown recovery, and manual reset.
- Added an always-on LLM usage ledger, aggregating input, output, and cache tokens by task, session, model, and configuration.

#### Changed

- Goal decomposition, Planner, Worker, and main Agent share the task-level LLM runtime (resolution priority below).
- Failover responds only to explicit quota, balance, or billing errors; ordinary rate-limit, authentication, network, server, and context errors do not trigger a switch by mistake.
- The LLM configuration page is changed to a configuration card list with right-side drawer editing, and provides the Pool polling order, priority, exclusions, health status, and recovery actions.
- Configuration-chain exhaustion information supports line wrapping on narrow screens; the current model changes from a session-list icon to a text label next to the current session title with a full tooltip.
- The order in which each role within a task resolves the LLM is adjusted to "Agent binding → task configuration chain → global": roles with an explicitly bound model always run on that model, unbound roles fall to the task chain, and when the task chain is empty they fall to global.
- Leaving the outbound proxy empty means direct connection and no longer falls back to the `HTTP_PROXY`/`HTTPS_PROXY` environment variables (an explicit `ARTEX_LLM_PROXY` is unaffected); the proxy input supports `socks5://user:pass@host:port` with account and password.

#### Fixed

- Transient streaming failures before commit (before any output has been produced) are now safely backed off and retried on the same provider, significantly reducing cases of "interrupted after running only one or two tools, no summary, terminal state `model_error`"; quota exhaustion, context too long, and deterministic 4xx errors are not retried and are still handled by failover and compression recovery respectively.

#### Removed

- Removed the icon-style LLM identifier in the session list, to avoid confusion with the Worker status icon.

### UI

#### Added

- Tasks support creating, renaming, deleting, and filtering global categories; a new task can choose a category directly.
- Added global task template CRUD and a right-side management drawer; a new task can load a preset description and goals, and the current content can also be saved as a template.
- A new task supports associating multiple source tasks and multiple enterprise asset scopes; enterprise scopes are automatically recognized from a single multi-line text box as domains, URLs, IPs, CIDRs, ICP numbers, and enterprise keywords.
- Task test assets support live adding and deleting, recording sources such as manual, enterprise, inherited, or Agent-discovered; the Worker session title shows the current test assets and a source summary alongside.
- The Discovery page is grouped by task and provides independent pagination within groups, and supports filling in a description for a vulnerability and creating a high-priority dig-deeper intent.
- Conversations support rename, pin, unpin, and delete; the task list supports batch pause and continue for the current page.
- Traffic details and tool execution details are changed to a right-side drawer; HTTP messages are completed with `Host` and highlight the request line, status code, headers, JSON, and markup-language bodies.
- The task list's actions column adds "Details" and "Pause/Resume" buttons; the session send key binding can be configured in system settings (`Enter` / `Cmd+Enter`, etc.), and the Web search area adds a proxy input box.
- The badge to the right of the session title is changed to show the LLM configuration name, with the model ID moved to the hover tooltip; tasks can be given an optional name, and the task list adds a name column and search (falling back to the description when empty).
- The Skills page adds usage count, last-used time, and missing-dependency statistics, making it easier to locate skills that are not taking effect or not installed.

#### Changed

- The task title is changed to a focusable details link; task assets, enterprise assets, discovery task groups, and vulnerabilities within groups use real server-side pagination, stable ordering, and exact totals.
- Adding an enterprise now uses a right-side drawer, and scope entry is unified as multi-line text with live recognition, validation, and type preview.
- The main Agent input box supports auto-growing, `Enter` to send, `Shift+Enter` for a new line, and avoids accidental sending during Chinese IME composition.
- Agent previews, task reports, and related details uniformly use shared Markdown rendering; delete confirmations, long errors, and mobile drawer widths are fixed uniformly.
- The task template select box shows and searches by template name and submits by template ID; the system's original font size is restored, and the application version is uniformly shown as `0.3.3`.
- The task total and current-session tokens highlight only the input, cache-read, and output numbers; the send button uses a simpler up-arrow icon.
- The test scope in the task overview shows enterprise names rather than IDs.

#### Fixed

- Ordinary text containing dots is no longer misjudged as an ICP filing number.
- Fixed a name collision in the variable catalog with global runtime variables (such as `{{.Now}}`) that made the Agent editor's variable list render duplicate keys.

#### Removed

- Removed the standalone "Enter" button on task cards; clicking the task title uniformly enters the details.
- Removed the dashboard "New task" button, the Logo URL input item for adding an enterprise, and the vulnerability count Badge at the top of the Discovery page and in task groups.
- Reverted the style that enlarged the global font by 10%, and removed the Worker select box, model icon, and row-level token statistics in the session list.

### Agent

#### Added

- A new task can directly associate multiple existing tasks, live inheriting read-only the goals, facts, vulnerabilities, completed intents, asset scope, and blackboard context of the directly sourced tasks.
- Blackboard read tools support on-demand querying of source-task nodes, facts, vulnerabilities, and execution traces; inherited nodes carry a source marker and all write tools refuse to modify them.
- Enterprise scope tools support domains, URLs, IPs, CIDRs, ICP numbers, and enterprise keywords; keywords serve only as Agent scope hints and do not take part in automatic asset attribution.
- The vulnerability dig-deeper operation creates, in the original task, a high-priority manual Worker intent with asset anchors and `derived_from` edges.
- The overview adds a "Goal management" card, supporting manually viewing, adding, modifying, and deleting goals; adding or modifying notifies the Planner and revives the task, and deleting hard-deletes the goal node (cascading deletion of edges and anchors) but does not revive.
- The main Agent gets the `steer_work` tool by default, which can inject corrective instructions into a running Worker in real time without interrupting it or losing progress (still verifying that the intent belongs to this task).

#### Changed

- Source-task intents do not enter the new task's frontier, and the new task continues to use its own independent exploration, execution queue, working directory, and conversation history.
- Deleting a running intent no longer destroys data: it is stopped into `stopped`, a deletion reason is required, the reason is attached to the intent as a fact and written into the payload, and the planner perceives it as a `cancelled` trigger (keeping the intent content and reason).
- The main Agent conversation is changed to be driven by the server-side activity stream, and input can be recovered after a send failure; opening a session automatically sticks to the bottom and keeps the last reply visible after the details are lazily loaded.
- Pausing a task terminates the current Main Agent, Planner, and Worker calls, but does not prevent the user from actively starting a new main Agent orchestration session during the pause.
- Cancellation, closing, and stream interruption uniformly preserve the real termination reason, the content already generated, the number of rounds run, elapsed time, tokens, and tool calls that did not return.

#### Removed

- Removed the main Agent client-side optimistic message echo, avoiding duplicate messages and cross-session stream mixing under pause, failure, or concurrent activity.

### Constraints

#### Added

- The goal decomposition stage first extracts operation constraints (allow/deny) before decomposing goals, and the main Agent can supplement them at runtime; constraints are injected into the Planner and Worker system prompts at the highest priority, and after de-biasing, diversity and surface-widening exploration explicitly obey the constraints.
- The overview adds a "Constraint management" card and add/delete/modify endpoints; the scope of constraint injection can be toggled separately for Planner / Worker (both on by default, read every round, effective immediately). The new table `task_constraints` uses `CREATE TABLE IF NOT EXISTS`, and old databases are created automatically.

### Interception

#### Added

- In addition to regex/string rules, command interception adds a model fallback approval: when no rule at all is hit, the model makes a semantic `ALLOW`/`ASK`/`DENY` judgment, and the fallback action on failure and the action on approval timeout are configurable; the interception page is split into two Tabs, "Interception rules / Model configuration", and model judgment results are labeled with the exact `[模型]` prefix (Chinese “model”, retained for log matching) and a reason.

#### Fixed

- Hardened the judge output parsing, avoiding a correct `DENY` verdict being mistaken for an allow.

### Traffic

#### Changed

- Traffic recording is changed to store whole exchanges in SQLite (large bodies overflow into a blob bucket deduplicated by hash), text bodies get a trigram full-text index, supporting arbitrary substring and Chinese search; deletion degrades to a single SQL transaction, dropping from hours to milliseconds and no longer stalling recording meanwhile. Added streaming download of large bodies and a `traffic_search` full-text parameter; old file-tree data needs no migration and can still be read, searched, and deleted.

### Tasks and Assets

#### Added

- Creating a task adds an "Asset coverage feature" switch (on by default): when off, coverage is not computed or shown, the situation graph shows only assets, `task_scope` is not accumulated automatically, and the related tools are removed from the Planner / main Agent; enterprise association is unaffected by this switch.
- Each asset in `insert_assets` adds a `related` flag (default `true`): effective only when coverage is on, and `false` puts the asset only into the shared asset library without counting it toward this task's coverage (such as side-found neighboring sites or unrelated assets).
- Enterprise scope and task test assets uniformly support text recognition of domains, URLs, IPs, CIDRs, ICP numbers, and keywords; domains/IPs can create or reuse global assets, while CIDR/ICP/keywords are kept as task-scope context.

### Build

- `build.sh --release` supports building Linux amd64/arm64, macOS amd64/arm64, and Windows amd64 in one go, and generates zip release packages bundled with `skills/`, configuration examples, and the README.
- Uses the Go linker to strip debug information and produce zip release packages; UPX is made explicitly optional, to avoid its self-extracting ELF segfaulting at startup in some Linux environments.
- The Release Workflow runs a startup smoke test on the Linux amd64 binary and provides `SHA256SUMS` along with the release package.

### Contributors

- [@neouks](https://github.com/neouks)

## [0.3.2] - 2026-08-20

### Added

- A new task can associate multiple existing tasks, live and read-only inheriting the facts, vulnerabilities, completed intents, asset scope, and blackboard context of the directly sourced tasks; the new task still uses its own independent execution queue, working directory, and session history.
- Tasks support an ordered LLM configuration chain. When insufficient provider quota is explicitly recognized, it automatically switches to the next configuration, and persists the current configuration, the exhausted state, and structured audit activity.
- Running and paused tasks support editing the LLM configuration chain, adjusting the order, and manually switching the current configuration; automatic switches, manual switches, and full-chain exhaustion are prompted on the task details page.
- Running Workers support pause, resume, and cancel. Pausing keeps the blackboard data, and cancelling transactionally cleans up the intent and the facts, vulnerabilities, and execution records it directly produced after the Worker stops writing.
- Deleting a task can optionally also clean up associated assets, traffic, vulnerabilities, and task landing files, with a delete barrier, concurrency protection, and auditable deletion statistics added.
- Added an optional task concurrency cap; new tasks that reach the cap are queued FIFO and start automatically once a run slot is released.
- Added task asset pagination, company asset pagination, task category statistics, and a paginated-intent Mock contract.
- Added the `build.sh` single-binary build script, supporting static frontend export, resource embedding, cross-platform targets, and build version injection.

### Changed

- The task-level explicit LLM configuration chain coexists with the existing global LLM Pool; the explicit chain continues to use strict quota-failover semantics, and when there is no explicit chain the Agent-binding and global configuration rules continue to apply.
- The main Agent input box supports auto-growing multi-line input, `Enter` to send, `Shift+Enter` for a new line, and avoids accidental sending during Chinese IME composition.
- Planner, Worker, and main Agent share the task-level LLM runtime; the task chain uses the smallest context window among the candidate models as the safe compression threshold.
- The task details page shows running, idle, and paused states according to the real LLM call state; the facts, vulnerabilities, intents, asset references, and graph nodes of source tasks are uniformly marked with their source and kept read-only.
- Agent previews, task reports, and related detail views uniformly use the shared Markdown rendering component.
- LLM model configuration adopts card and drawer interaction, and the model list scrolls independently within the drawer.
- Pausing a task no longer blocks the main Agent conversation: the main Agent orchestration session is independent of task pausing, and new messages can still be sent while paused (pausing terminates only the round currently in progress).
- The default wall-clock duration of a single Worker run is adjusted from 600 seconds to 1200 seconds.

### Fixed

- Removed the optimistic echo of the main Agent console, switching to rendering purely from server data, fixing messages getting mixed up or content from other sessions leaking in under scenarios such as pausing or send failure.
- Opening a main Agent session scrolls to the bottom by default and fully shows the last reply: after the full content of the last reply is lazily loaded and expanded it automatically sticks to the bottom and is no longer pushed off-screen.
- Fixed the main Agent session continuing to run after a task is paused, and the main Agent not being stopped in sync when an orchestration Agent paused the task.
- Fixed the task status badge and action button states going out of sync when a task completes or when the Planner, Worker, or main Agent is actually running.
- Fixed late blackboard writes or residual files that could arise among Worker cancellation, task deletion, and concurrent writes.
- Fixed Markdown preview failing, delete-confirmation long text overflowing, mobile widths, and some task-detail buttons being misaligned.
- Added named termination reasons to all Agent cancellation paths, and activity details can show the canceller, terminal state, number of rounds run, elapsed time, token usage, and tool calls that did not return.
- Fixed a race where the parent context could pre-empt and overwrite the named `shutdown` reason when the backend shuts down, and the garbled text caused by truncating Chinese activity summaries by bytes.
- Fixed cancellation events carrying partial streaming output losing the real termination reason, while preserving the content already generated before cancellation.

### Contributors

- [@Autumn-27](https://github.com/Autumn-27)
- [@neouks](https://github.com/neouks)

[Unreleased]: https://github.com/Autumn-27/ARTEX/compare/v0.3.10...HEAD
[0.3.10]: https://github.com/Autumn-27/ARTEX/compare/v0.3.9...v0.3.10
[0.3.9]: https://github.com/Autumn-27/ARTEX/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/Autumn-27/ARTEX/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/Autumn-27/ARTEX/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/Autumn-27/ARTEX/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/Autumn-27/ARTEX/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/Autumn-27/ARTEX/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/Autumn-27/ARTEX/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/Autumn-27/ARTEX/compare/v0.3.1...v0.3.2
