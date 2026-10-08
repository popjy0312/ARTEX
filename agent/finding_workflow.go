package agent

import (
	"encoding/json"
	"fmt"

	"github.com/Autumn-27/artex/db"
	actool "github.com/Autumn-27/norma/tool"
)

const findingIDGuidance = "\n\nFinding ID contract: finding_id identifies the independent finding record; finding_node_id identifies the exploration node. list_findings/list_task_findings/node_detail/get_task_node_detail expose exploration-node IDs alongside finding_id; use finding_id for get_finding_traffic and bind_finding_traffic, while update_finding_report still receives finding_node_id. After binding, call get_finding_traffic again, read the newest version and required bodies, and pass that exact version as evidence_version. Never use the first report_finding line number as a traffic ID, guess another ID, or mix the two handles."

// The server supplies the persisted setting. A missing setting/host is off.
// Consulted at assembly and again on writes so an already-running session
// cannot keep binding after the user switches the feature off.
var FindingTrafficBindingEnabled func() bool

func findingTrafficBindingEnabled() bool {
	return FindingTrafficBindingEnabled != nil && FindingTrafficBindingEnabled()
}

// Applied after ToolResolve: user descriptions and prompts remain intact, while
// all actual reporters (including Planner and custom chat agents) see the same
// API contract. Disabled/unbound tools are never reintroduced here.
func findingWorkflowTools(agentKey string, tools []actool.CoreTool) ([]actool.CoreTool, string) {
	if !findingTrafficBindingEnabled() {
		out := make([]actool.CoreTool, 0, len(tools))
		for _, tool := range tools {
			if tool.Name() == "bind_finding_traffic" {
				continue
			}
			if agentKey == "reporter" && (tool.Name() == "traffic_search" || tool.Name() == "traffic_get" || tool.Name() == "traffic_blob") {
				continue
			}
			switch tool.Name() {
			case "report_finding", "add_hint", "add_task_hint":
				// Work on a copy: toggling back on must restore the original schema.
				raw, _ := json.Marshal(tool.InputSchema())
				var schema map[string]any
				if json.Unmarshal(raw, &schema) == nil {
					stripTrafficParameters(schema)
					tool = DecorateTool(tool, tool.Description(), schema)
				}
			}
			out = append(out, tool)
		}
		return out, ""
	}
	out := append([]actool.CoreTool(nil), tools...)
	has := map[string]bool{}
	for i, tool := range out {
		has[tool.Name()] = true
		note := ""
		switch tool.Name() {
		case "report_finding":
			note = "\nThe reporting agent should preserve verified evidence, traffic_refs, and evidence_hint_id when handing a finding to the report workflow."
		case "add_hint", "add_task_hint":
			note = "\nWhen handing off a confirmed finding, preserve verified traffic_refs with their IDs, roles, notes, and order; do not pass unverified candidates as evidence."
		case "get_finding_traffic", "bind_finding_traffic", "list_findings", "list_task_findings", "node_detail", "get_task_node_detail", "update_finding_report":
			note = findingIDGuidance
		}
		if note != "" {
			out[i] = DecorateTool(tool, tool.Description()+note, tool.InputSchema())
		}
	}
	guidance := ""
	if has["report_finding"] || has["add_task_hint"] || has["add_hint"] {
		guidance = "\n\nOptional traffic evidence handoff: the report agent normally verifies and binds captured HTTP traffic after report_finding and before writing the report. Preserve real traffic IDs, roles (baseline/proof/verification/supporting), notes, and reproduction order in traffic_refs or evidence_hint_id. TCP findings, uncaptured traffic, and no-exact-match findings remain valid with command/log evidence and an explanation; do not probe again merely to obtain traffic."
		if has["add_task_hint"] && !has["add_hint"] {
			guidance += "\nWithout task context, use add_task_hint to hand off to the owning task instead of calling report_finding directly."
		}
		if has["prove_goal"] || has["goal_met"] {
			guidance += "\nBefore marking the goal complete, finish reporting or handing off existing evidence; do not end solely because the finding text was saved."
		}
	}
	if has["update_finding_report"] && has["bind_finding_traffic"] && has["get_finding_traffic"] {
		guidance += "\n\nAutomatic report traffic association is enabled: obtain finding_id and finding_node_id from report_finding JSON or task detail, read the finding and execution evidence, prioritize handed-off real IDs, use traffic_search only to find candidates, and traffic_get to verify each request/response actually supports this finding. Bind confirmed refs in reproduction order with bind_finding_traffic and roles baseline/proof/verification/supporting. Then reread get_finding_traffic for the latest version and pass it to update_finding_report using finding_node_id. Operate only on this finding; skip binding for TCP, absent/unavailable traffic, or no exact match, and never guess IDs or repeat probing to create traffic."
	}
	if guidance != "" || has["get_finding_traffic"] || has["update_finding_report"] {
		guidance += findingIDGuidance
	}
	return out, guidance
}

func stripTrafficParameters(schema map[string]any) {
	props, _ := schema["properties"].(map[string]any)
	delete(props, "traffic_refs")
	delete(props, "evidence_hint_id")
	if required, ok := schema["required"].([]any); ok {
		kept := required[:0]
		for _, key := range required {
			if key != "traffic_refs" && key != "evidence_hint_id" {
				kept = append(kept, key)
			}
		}
		schema["required"] = kept
	}
	if hints, ok := props["hints"].(map[string]any); ok {
		if items, ok := hints["items"].(map[string]any); ok {
			stripTrafficParameters(items)
		}
	}
}

// HintTrafficSchema is shared by the task-local and cross-task hint tools.
func HintTrafficSchema() map[string]any {
	return map[string]any{"type": "array", "description": "Verified traffic references for the finding, kept in reproduction order.", "items": obj(map[string]any{"traffic_id": str("Real captured traffic ID"), "role": str("baseline / proof / verification / supporting"), "note": str("What conclusion this traffic supports")}, "traffic_id")}
}

func (t *ToolSet) findingRefsFromHint(hintID int64, explicit []db.TrafficRef) ([]db.TrafficRef, error) {
	if hintID <= 0 {
		return db.NormalizeTrafficRefs(explicit)
	}
	n, err := t.ts.GetNode(hintID) // local store only: inherited hints cannot supply evidence
	if err != nil {
		return nil, err
	}
	if n == nil || n.Kind != db.KindHint {
		return nil, fmt.Errorf("node %d is not a task hint", hintID)
	}
	var payload struct {
		Refs []db.TrafficRef `json:"traffic_refs"`
	}
	if err := json.Unmarshal(n.Payload, &payload); err != nil {
		return nil, err
	}
	return db.NormalizeTrafficRefs(append(append([]db.TrafficRef{}, explicit...), payload.Refs...))
}
