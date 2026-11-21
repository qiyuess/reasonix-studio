package tui

import (
	"strings"
	"testing"

	"reasonix/internal/base/i18n"
)

// A picture is no longer a reason a line waits: guidance carries its own
// attachments, so an intent=steer line is held like any other guidance. Only a
// real follow-up runs as a whole turn and therefore waits for this one to end —
// that is the line the wording describes, and saying it about a steer would name
// a rule the kernel stopped applying.
func TestQueueListSaysWhyAPicturedLineIsWaiting(t *testing.T) {
	snap := InboxSnapshot{Revision: 3, Items: []InboxItem{
		{ID: "aaaaaaaa1", Intent: "steer", State: "queued", Preview: "look at @shot.png", Images: true},
		{ID: "bbbbbbbb2", Intent: "followup", State: "queued", Preview: "look at @other.png", Images: true},
		{ID: "cccccccc3", Intent: "steer", State: "queued", Preview: "words only"},
		{ID: "dddddddd4", Intent: "steer", State: "steer_accepted", Preview: "taken", Images: true},
	}}
	lines := strings.Split(renderQueueList(snap), "\n")
	reason := i18n.M.QueueImageWait
	if reason == "" {
		t.Fatal("the reason has no wording in the catalogue")
	}
	if strings.Contains(lines[1], reason) {
		t.Fatalf("a picture no longer keeps guidance waiting, but the line says it does: %q", lines[1])
	}
	if !strings.Contains(lines[2], reason) {
		t.Fatalf("a follow-up with a picture does wait for the turn to end, and does not say so: %q", lines[2])
	}
	if strings.Contains(lines[3], reason) || strings.Contains(lines[4], reason) {
		t.Fatalf("the reason leaked onto a line it does not describe: %q / %q", lines[3], lines[4])
	}
}
