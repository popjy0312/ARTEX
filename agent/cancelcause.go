package agent

import (
	"context"
	"errors"
	"fmt"
)

// AbortCause names why an agent run's context was cancelled. Every cancellation
// site should attach one so the activity trace can report the real initiator.
type AbortCause struct {
	Code  string
	Short string
	Text  string
}

func (c *AbortCause) Error() string { return c.Text }

func cause(code, short, text string) *AbortCause {
	return &AbortCause{Code: code, Short: short, Text: text}
}

// Causef builds a cause that includes runtime-specific detail.
func Causef(code, short, format string, args ...any) *AbortCause {
	return &AbortCause{Code: code, Short: short, Text: fmt.Sprintf(format, args...)}
}

var (
	// Task-level execution context.
	AbortPausedByUser = cause("paused_by_user", "Task paused by user",
		"The user paused the task through POST /api/tasks/{id}/control action=pause. Planner/Worker execution was cancelled; running intents return to frontier(open) and are reclaimed from the beginning when resumed")
	AbortPausedByOrchestrator = cause("paused_by_orchestrator", "Task paused by orchestrator",
		"The orchestrator called pause_task. Planner/Worker execution was cancelled; running intents return to frontier(open) and resume from the beginning")
	AbortTaskDeleted = cause("task_deleted", "Task deleted",
		"The task is being deleted (DELETE /api/tasks/{id}); the deletion barrier cancelled its Planner, Worker, and main Agent. This run's results will not be used")
	AbortPausedOnReload = cause("paused_on_reload", "Task restored as paused",
		"The backend restored the persisted paused state at startup. This run was cancelled; normally no Agent is running during restoration")
	AbortGoalMet = cause("goal_met", "Planner determined the goal is met",
		"The planner marked the task done after determining its goal was met, then cancelled running Workers. Their intents are marked stopped, not failed")
	AbortSettleDrainTimeout = cause("settle_drain_timeout", "Task timeout drain expired",
		"The task reached timeout and waited for Workers to finish gracefully, but the 90-second drain grace period was insufficient. Execution was cancelled; intents are exhausted and facts/assets already written are retained")

	// Per-work context.
	AbortKilledByPlanner = cause("killed_by_planner", "Intent killed by planner",
		"The planner called kill_work, usually because the direction was wrong or no longer useful. The intent is marked stopped and is not reclaimed automatically")
	AbortWorkPausedByUser = cause("work_paused_by_user", "Worker intent paused by user",
		"The user paused the running Worker. This call was cancelled and the intent is paused; intents, facts, findings, and activity records are retained and execution restarts when resumed")
	AbortWorkCancelledByUser = cause("work_cancelled_by_user", "Worker intent deleted by user",
		"The user deleted the running Worker. This call was cancelled; after the Worker leaves its write section, the server applies the selected deletion mode: soft deletion retains outputs, hard deletion cascades to dependent nodes")
	AbortWorkFinished = cause("work_finished", "Worker finished and released context",
		"The Worker finished normally and detachWork released its context. This is not an interruption; if shown in an interruption message, cancellation raced with cleanup")
	AbortPausedRaceGuard = cause("paused_race_guard", "New run rejected while task is paused",
		"The engine refused to create an execution context while the task was paused, preventing a claim/pause race from starting a Worker. Claimed intents return to frontier")

	// Main Agent and standalone conversation contexts.
	AbortChatStoppedByUser = cause("chat_stopped_by_user", "Conversation stopped by user",
		"The user clicked stop and cancelled the main or session Agent turn. Activity records are retained and another message can be sent")
	AbortChatPausedWithTask = cause("chat_paused_with_task", "Task paused; chat cancelled",
		"Pausing the task also cancelled the running main-Agent conversation. Activity records are retained; the turn is not replayed when the task resumes")
	AbortChatTurnFinished = cause("chat_turn_finished", "Conversation turn finished",
		"The conversation turn finished normally and the server released its context. This is not an interruption; if shown in one, cancellation raced with cleanup")

	// Process-level and per-run hard backstop.
	AbortShutdown = cause("shutdown", "Backend process shutting down",
		"The backend received SIGINT or SIGTERM and is restarting, updating, or shutting down. Running Agents are cancelled; leftover running intents reset to open after restart")
	AbortRunHardTimeout = cause("run_hard_timeout", "Run hard timeout triggered",
		"A run exceeded its soft wall-clock budget and grace period, indicating a model request or tool did not return. Check the last unfinished tool call before interruption")
)

// AbortReason resolves the named cause attached to a cancelled run context.
func AbortReason(ctx context.Context) (code, short, text string, ok bool) {
	c := context.Cause(ctx)
	if c == nil {
		return "", "", "", false
	}
	var ac *AbortCause
	if errors.As(c, &ac) {
		return ac.Code, ac.Short, ac.Text, true
	}
	switch {
	case errors.Is(c, context.DeadlineExceeded):
		return "deadline_exceeded", "Upstream context reached its deadline",
			"The upstream context reached its deadline without a named WithTimeoutCause: " + c.Error(), true
	case errors.Is(c, context.Canceled):
		return "canceled_no_cause", "Cancellation has no named cause",
			"The upstream context was cancelled without context.WithCancelCause; register a cause in agent/cancelcause.go and attach it at this cancellation point", true
	default:
		return "other", firstLine(c.Error(), 80), c.Error(), true
	}
}
