package sessionstore

import (
	"reasonix/internal/contract/provider"
)

// AuthoredTurnIdentity is what a host published for the message a turn is
// about, before any work that could produce it: the turn number, the session
// index it named, and the raw authored text both were derived from.
type AuthoredTurnIdentity struct {
	AuthoredTurn int
	MsgIndex     int
	Raw          string
}

// ClassifyTurn answers which authored turn msg belongs to, given the turns
// closed before it. Both projections of that number derive it here: the
// display-index sidecar counts a whole transcript with it, and a live turn
// start names its own pending message with it.
func ClassifyTurn(msg provider.Message, priorTurn int) TurnClassification {
	class := TurnClassification{AuthoredTurn: priorTurn}
	if msg.Role != provider.RoleUser {
		return class
	}
	// LocalOnly is the frontend's own bookkeeping, never something the person
	// said. A surface-action receipt is the case that matters: pressing a button
	// on an interaction card appends one of these, so counting it would report a
	// longer conversation than anybody had — and withdrawing the same action
	// would lengthen it again.
	//
	// It opens no turn and it splits no run, which is why this is a field of its
	// own rather than a Steer: `TurnWorkMs` and the history index close a run at
	// every user message that is neither, so a receipt reported as an ordinary
	// one would cut its turn in half and sum the halves. The history index
	// already excludes these from starting a turn; this is the second projection
	// of that number, and it excludes them from everything.
	if msg.LocalOnly {
		class.LocalOnly = true
		return class
	}
	// The steer wrapper only ever rides Content: a desktop steer keeps the
	// person's own words in RawContent, so asking UserMessageText first would
	// read an interruption as a turn they opened. Ask Content, the way the
	// history index already does.
	if _, _, isSteer := SteerKind(msg.Content); isSteer {
		class.Steer = true
		return class
	}
	content := UserMessageText(msg)
	if IsUserAuthoredTurn(content) && !msg.HostAuthored {
		class.AuthoredTurn = priorTurn + 1
		class.StartsTurn = true
		return class
	}
	// HostAuthored is the host's own line: a round-limit fact, a finalization
	// nudge. It reads like something a person wrote and it is not one, which is
	// the fact the history index and the session preview already exclude it by.
	if msg.HostAuthored || IsSyntheticUserText(content) {
		class.Synthetic = true
	}
	return class
}

// TurnClassification names the authored turn a message belongs to. StartsTurn
// marks the one that opens it; Steer, Synthetic and LocalOnly say why a user
// message that opened none is still a user message. LocalOnly is the only one
// that must also leave a run's boundaries alone: `TurnWorkMs` closes a run at
// every user message that is neither a steer nor a turn start, so treating a
// receipt as one would split its turn and add the pieces together.
type TurnClassification struct {
	AuthoredTurn int
	StartsTurn   bool
	Steer        bool
	Synthetic    bool
	LocalOnly    bool
}
