package control

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/event"
	"reasonix/internal/contract/provider"
	"reasonix/internal/contract/tool"
	"reasonix/internal/runtime/agent"
	"reasonix/internal/state/sessioninbox"
	"reasonix/internal/state/sessionstore"
)

// steeringVisionTurn is steeringTurn with a workspace whose model reads pictures,
// so a steer naming an image resolves one.
func steeringVisionTurn(t *testing.T) (*Controller, *sessionstore.Session, *inboxSteerProvider, chan event.Event, string) {
	t.Helper()
	dir := testenv.TempDir(t)
	workspace := filepath.Join(dir, "workspace")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	writeVisionTestConfig(t, workspace)
	imagePath := filepath.Join(workspace, "diagram.png")
	if err := os.WriteFile(imagePath, mustBase64(t, tinyPNG), 0o644); err != nil {
		t.Fatal(err)
	}
	prov := newInboxSteerProvider()
	sess := sessionstore.NewSession("sys")
	exec := agent.New(prov, tool.NewRegistry(), sess, agent.Options{}, event.Discard)
	sink, done, _ := collectSink()
	c := New(Options{
		Runner:        exec,
		Executor:      exec,
		Sink:          sink,
		SessionDir:    dir,
		SessionPath:   filepath.Join(dir, "s.jsonl"),
		WorkspaceRoot: workspace,
		ModelRef:      "custom/vision-pro",
	})
	t.Cleanup(func() { prov.unblock(); c.autosaveWG.Wait() })
	c.Submit("initial turn")
	select {
	case <-prov.started:
	case e := <-done:
		t.Fatalf("the turn ended before it reached the provider: %+v", e)
	case <-time.After(testenv.Budget(t)):
		t.Fatal("the turn never started")
	}
	return c, sess, prov, done, imagePath
}

// A picture sent with mid-turn words is part of the same message: the turn reads
// it where it reads the guidance, not as a file it has to go and open. This is
// what makes "look at this, but do it the other way" one thing to say.
func TestSteerCarryingAPictureRidesTheSameTurn(t *testing.T) {
	c, _, prov, done, imagePath := steeringVisionTurn(t)

	rec, err := c.TryEnqueueAndSteer(InboxRequest{Submit: "look at @diagram.png before you continue", Source: "test"})
	if err != nil {
		t.Fatalf("steer with a picture: %v", err)
	}
	if rec.Disposition != sessioninbox.DispositionSteerAccepted {
		t.Fatalf("disposition = %q, want the steer accepted rather than queued as a follow-up", rec.Disposition)
	}
	_, env, err := c.ReadInboxItem(rec.ItemID)
	if err != nil || len(env.FrozenImages) != 1 {
		t.Fatalf("the item carries no frozen picture: %+v err=%v", env, err)
	}
	frozen := env.FrozenImages[0]

	// The picture is the one that was there when the words were sent, even if the
	// file changed while the turn was still working.
	if err := os.WriteFile(imagePath, []byte("changed after enqueue"), 0o644); err != nil {
		t.Fatal(err)
	}
	prov.unblock()
	waitForDoneWithin(t, done, 60*time.Second)

	if len(prov.requests) < 2 {
		t.Fatalf("provider requests = %d, want the turn to continue after the steer", len(prov.requests))
	}
	applied := prov.requests[len(prov.requests)-1].Messages
	at := -1
	for i, m := range applied {
		if m.Role == provider.RoleUser && strings.Contains(m.Content, "before you continue") {
			at = i
			break
		}
	}
	if at < 0 {
		t.Fatalf("the steer never reached the model: %+v", applied)
	}
	if len(applied[at].Images) != 1 || applied[at].Images[0] != frozen {
		t.Fatalf("the picture did not ride the guidance's own message: %+v", applied[at])
	}
	// It is guidance, not a new task: the mid-turn wrapper still says so.
	if !strings.Contains(applied[at].Content, sessionstore.MidTurnSteerPrefix) {
		t.Fatalf("the message is not marked as mid-turn guidance: %q", applied[at].Content)
	}
}
