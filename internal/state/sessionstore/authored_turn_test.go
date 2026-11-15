package sessionstore

import (
	"testing"

	"reasonix/internal/contract/provider"
	"reasonix/internal/contract/surfacespec"
)

// countTurns applies the same derivation the controller and the display index
// use, so a test here speaks about the number the rail shows.
func countTurns(msgs []provider.Message) int {
	turn := 0
	for _, m := range msgs {
		turn = ClassifyTurn(m, turn).AuthoredTurn
	}
	return turn
}

// A steer lands two different ways, and the turn count has to agree with both.
// The wrapper only ever rides Content; a desktop steer also keeps the person's
// own words in RawContent, which is why asking the display text first counted
// an interruption as a turn they had opened.
func TestASteerOpensNoTurnWhicheverShapeItLandsIn(t *testing.T) {
	first := []provider.Message{
		{Role: provider.RoleUser, Content: "first"},
		{Role: provider.RoleAssistant, Content: "ok"},
	}
	for _, tc := range []struct {
		name string
		msg  provider.Message
	}{
		{
			name: "desktop: wrapper in Content, the person's words in RawContent",
			msg: provider.Message{
				Role:       provider.RoleUser,
				Content:    MidTurnSteerMessage("keep going", false),
				RawContent: "keep going",
			},
		},
		{
			name: "host notice: the runtime's own advice, also nothing they said",
			msg: provider.Message{
				Role:       provider.RoleUser,
				Content:    MidTurnSteerMessage("recovery advice", true),
				RawContent: "recovery advice",
			},
		},
		{
			name: "no RawContent: the shape this test used to cover alone",
			msg:  provider.Message{Role: provider.RoleUser, Content: MidTurnSteerMessage("keep going", false)},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			msgs := append(append([]provider.Message{}, first...), tc.msg)
			if got := countTurns(msgs); got != 1 {
				t.Fatalf("turns = %d, want 1: a steer opened no turn", got)
			}
			if class := ClassifyTurn(tc.msg, 1); class.Steer != true || class.StartsTurn != false {
				t.Fatalf("classified %+v; want Steer without StartsTurn", class)
			}
		})
	}
}

// The other user-role lines that open nothing, so a later change cannot fix one
// and quietly lose another. A host-authored line is the subtlest: it reads like
// something a person typed, and HostAuthored is the only thing that says
// otherwise — the same fact the history index and the session preview exclude
// it by.
func TestOnlyAuthoredLinesOpenTurns(t *testing.T) {
	for _, tc := range []struct {
		name string
		msg  provider.Message
		want int
	}{
		{"a fold digest", provider.Message{Role: provider.RoleUser, Content: "<compaction-summary>\ndigest\n</compaction-summary>"}, 1},
		{"a host nudge that reads like a person", provider.Message{Role: provider.RoleUser, Content: "Your tool-call round limit (12) has been reached.", HostAuthored: true}, 1},
		{"a host handoff retry", provider.Message{Role: provider.RoleUser, Content: "The executor handoff failed; try again.", HostAuthored: true}, 1},
		{"a surface-action receipt, which the frontend wrote", provider.Message{Role: provider.RoleUser, LocalOnly: true, Name: surfacespec.ActionMessageName, Content: `{"action":"pick"}`}, 1},
		{"the withdrawal of that same action", provider.Message{Role: provider.RoleUser, LocalOnly: true, Name: surfacespec.ActionMessageName, Content: `{"action":"pick","withdrawn":true}`}, 1},
		{"a real second turn", provider.Message{Role: provider.RoleUser, Content: "second"}, 2},
		{"a real turn keeps its own words", provider.Message{Role: provider.RoleUser, Content: "second", RawContent: "second"}, 2},
		{"the model's reply", provider.Message{Role: provider.RoleAssistant, Content: "ok"}, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			msgs := []provider.Message{
				{Role: provider.RoleUser, Content: "first"},
				{Role: provider.RoleAssistant, Content: "ok"},
				tc.msg,
			}
			if got := countTurns(msgs); got != tc.want {
				t.Fatalf("turns = %d, want %d", got, tc.want)
			}
		})
	}
}
