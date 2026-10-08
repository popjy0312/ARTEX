> Languages: [Chinese](漏洞流量证据.md) | English | [Korean](finding-traffic-evidence.ko.md)

# Vulnerability Traffic Evidence

The finding details page supports selecting multiple related traffic records across pages, assigning a role and note, ordering them, and unbinding them. The traffic page can also select multiple records and bind them to one existing finding. Evidence inherited from a task is read-only; edit it from the source task.

The “Agent automatic traffic binding” setting is off by default. Its read and update API is `/api/settings` with `agent_traffic_binding`. Enabling it adds token consumption from retrieval requests/responses, tool calls, and prompts; the Agent uses the new setting on its next run. When off, automatic-binding parameters and the supplemental-binding tool are hidden, automatic-binding guidance is not injected, and new automatic-binding submissions from already-running sessions are rejected. Manual binding, traffic capture, reading saved evidence, and exports are unaffected.

When enabled, the default flow is “record discovery → automatically trigger the report Agent → verify and bind traffic → write the report against the latest evidence version”. The reporter keeps verification commands, key output, existing real traffic IDs, and their roles in `evidence`; the report Agent combines finding details with execution records, verifies with `traffic_search` / `traffic_get`, calls `bind_finding_traffic`, then reads the latest `version` before saving the report. When the setting is off, the report Agent does not receive raw traffic search/read tools or bind automatically; it can still read manually bound snapshots and generate the report.

Existing callers remain compatible: `report_finding` still supports explicit, immediate binding through `traffic_refs` / `evidence_hint_id`. Binding is optional: for non-HTTP vulnerabilities such as TCP, when traffic was not collected, or when no exact record can be found, omit the reference and reporting and report writing still work; retain command output, logs, and other verifiable evidence, and preferably explain why it was not bound. Do not add required fields. Every submitted ID must be valid and the body must be complete. Any failure rolls back this binding operation; if explicit binding during reporting fails, the entire report submission rolls back. Re-adding the same snapshot does not create another binding or overwrite its note.

## Agent IDs and report versions

`report_finding` adds an optional parameter; array order is the initial evidence order:

```json
{
  "traffic_refs": [
    {"traffic_id": "real-traffic-id", "role": "baseline", "note": "normal account request"},
    {"traffic_id": "another-real-traffic-id", "role": "proof", "note": "reproduction request"}
  ]
}
```

Roles are `baseline` (normal comparison), `proof` (vulnerability proof), `verification` (supplemental verification), and `supporting` (supporting evidence, the default). First use `traffic_search` / `traffic_get` to verify real records; domain and time are only candidate filters and do not infer task ownership.

See [CyberStrikeAI’s vulnerability reporting tool guidance](https://github.com/RuoJi6/CyberStrikeAI/blob/54d56774b8bd285817d16d48b70a4a5e6e0963f7/internal/app/vulnerability_tools.go) for the prompt reference. Combine it with this project’s optional-binding convention; do not introduce a required validation merely because a package is absent. Do not guess IDs or repeat probing only to fill a package.

The first return line remains the exact runtime string `finding recorded: <探索节点 ID>` (Chinese placeholder means “exploration node ID”); the following JSON provides the independent finding record `finding_id`, exploration node `finding_node_id`, and a binding summary.

- `get_finding_traffic(finding_id)` uses the **independent finding record ID** and returns an ordered list and `version`; pass `binding_id`, `side=request|response`, `offset`, and `length` to read in segments, with at most 8192 bytes per segment.
- `update_finding_report` continues to use the exploration node ID for `finding_id`. The new `evidence_version` must be the version actually read; if evidence changes during generation, writing the old version is rejected and you must read and generate again.
- Older report calls that omit the version do not claim to cover existing traffic evidence. After binding, note, role, or order changes, existing reports are marked as needing an update.

When automatic binding is enabled, `add_hint` / `add_task_hint` support saving `traffic_refs` in each item of a single prompt or batch `hints`. A Planner acting as reporter can pass `evidence_hint_id` to explicitly select references from the prompt for this task; inherited prompts cannot be referenced. The system does not infer bindings from domains, times, or browsing history. A failed submission creates neither a partial finding nor an early report-Agent trigger.

For an existing finding missing bindings, use `bind_finding_traffic(finding_id, traffic_refs)` without registering it again. `list_findings` / `list_task_findings` / `node_detail` / `get_task_node_detail` return explicit `finding_id` and `finding_node_id`; the legacy `id` retains exploration-node semantics.

At startup, only optional properties are added to the old tool schema, and the original default traffic-tool binding is extended to the report Agent; the supplemental-binding tool is assigned to the report Agent by default. Custom binding lists, prompts, descriptions, and enabled states are preserved. Guidance is added once, after final tool assembly: the reporting role hands off existing evidence, and the report Agent verifies, binds, and writes the report. If a platform conversation lacks task context, it should hand off to the task Agent through a structured prompt rather than report directly. Existing evidence should be handed off before declaring the task complete; absence of a package does not require waiting. A failed `report_finding` does not trigger the report Agent.

## API

Base path: `/api/exploration/findings/{finding_id}/traffic`, using the independent finding ID. Existing authentication applies; `context_task` checks task visibility and inherited read-only status.

| Method / relative path | Request / response |
| --- | --- |
| `GET` | Ordered summary, evidence version, report-adopted version |
| `POST` | `{"traffic_refs":[...]}` append as a batch |
| `PATCH /{binding_id}` | `{"version":1,"role":"proof","note":"description"}` |
| `DELETE /{binding_id}` | `{"version":1}` |
| `PUT /order` | `{"version":1,"binding_ids":["2","1"]}`, must be the complete list |
| `GET /{binding_id}` | Snapshot metadata and bounded body preview |
| `GET /{binding_id}/body` | `side`, `offset`, `length`; `download=1` downloads the complete original bytes |

Version/order-set conflicts and writes during archiving return `409`; writes to inherited data return `403`; a binding that does not exist or does not belong to the finding returns `404`; traffic/attachment read and validation failures return explicit errors.

## Storage and migration

An idempotent PostgreSQL migration runs at startup: it adds `traffic_evidence_snapshots`, `finding_traffic_bindings`, and `findings.evidence_version` / `report_evidence_version` (default 0). It does not infer bindings from historical text.

Snapshots save the original traffic ID, capture time, URL, method, status, request/response headers, body length, and SHA-256. Bodies are stored by hash at `<data>/evidence/blobs/<first-two-hash-characters>/<hash>.bin`, independently of the cleanable `data/traffic`; multiple findings can share snapshots/bodies. Snapshots have no content-update API; inconsistent validation causes reads and exports to fail.

Under the original traffic write lock, read the complete body, including large body blobs and records in the old directory. Persist and validate the file first, then use one PostgreSQL transaction to write the exploration node, intent relation, finding, snapshot, and binding; notify the Planner only after commit. A failure may leave an unreferenced file, but it does not create partial business records.

PostgreSQL advisory lock `7337741004` coordinates evidence files and SQL references; the task row lock prevents evidence changes after archive queuing. Recovery holds the evidence lock from body installation through metadata commit. Deleting a finding cascades to remove its bindings.

The cleaner runs hourly and only reclaims unreferenced content that is not part of an in-progress operation, with a delay of at least 24 hours. Ordinary traffic cleanup does not touch the evidence directory. Back up PostgreSQL and `data/evidence` together when backing up hot data.

## Export and archive

Markdown contains an ordered evidence list and version; JSON contains metadata; CSV adds the count and binding IDs. `md-zip` retains the finding Markdown and provides:

```text
evidence/<finding_id>/<binding_id>/
  manifest.json
  request.http
  response.http
  request.bin
  response.bin
```

Markdown references messages with relative links. Before sending a download, complete attachment copying, hash validation, compression, disk synchronization, and CRC read validation for every ZIP entry; a missing or damaged item fails the entire download. Complete attachments retain the original binary bytes.

Archive v3 collects snapshots and bodies by finding bindings, independent of original traffic or domain. Clean hot data only after package validation completes; shared evidence remains. Recovery first validates installed bodies, then transactionally restores metadata and bindings, with retry support on failure. v1/v2 remain recoverable; missing new fields are explicitly filled with 0.

## Verification and boundaries

Give each test package an independent, newly created PostgreSQL test database through `ARTEX_PG_DSN`, to prevent leftover task/model fixtures from triggering background runs. Run the relevant package tests in full and confirm that no configuration gap caused a skip:

```sh
# Before each package runs, set ARTEX_PG_DSN to its independent test database; explicit configuration failure must be reported.
go test ./<package> -count=1
go test -race -p 1 ./evidence ./db ./agent ./server -run 'TestEvidence|TestFindingTraffic|TestFindingEvidence|TestReportFindingAtomicContract|TestTaskArchive'
```

Frontend verification includes `npx tsc --noEmit`, Biome checks for affected files, a Webpack build, and static export with `NEXT_EXPORT=1`. Use an independent cache directory to avoid overwriting a running development service.

Local end-to-end acceptance uses an independent port, controlled HTTP / domain HTTPS targets, and a temporary data directory. It covers both binding entry points, cross-page selection, ordering/notes, error messages, inherited read-only behavior, downloads, and export/archive/cleanup of hot bodies/recovery plus hash validation after deleting the original traffic.

The first release uses one global evidence coordination lock; other evidence operations may wait during bulk binding/export or slow attachment downloads. Missing recordings or incomplete bodies cannot be fabricated into evidence. This feature does not change the capture switch or address certificate problems when HTTPS directly accesses an IP.
