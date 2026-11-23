package control

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/config"
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
	return steeringPictureTurn(t, "custom/vision-pro")
}

// steeringPictureTurn is steeringVisionTurn for a chosen model, so a test can ask
// what becomes of a picture when the turn's model cannot read one at all.
func steeringPictureTurn(t *testing.T, modelRef string) (*Controller, *sessionstore.Session, *inboxSteerProvider, chan event.Event, string) {
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
		ModelRef:      modelRef,
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

// A turn whose model cannot read pictures must not swallow the picture, so the
// line goes in as a follow-up. What must not happen is the item being left in a
// state the store cannot act on: orphan recovery would then pause the entire
// queue over one undelivered image.
func TestPictureSteerToATextOnlyModelFallsBackToAFollowUp(t *testing.T) {
	c, _, prov, done, _ := steeringPictureTurn(t, "custom/text-only")

	rec, err := c.TryEnqueueAndSteer(InboxRequest{Submit: "look at @diagram.png", Source: "test"})
	if err != nil {
		t.Fatalf("a picture sent to a model that cannot read it was refused outright: %v", err)
	}
	if rec.Disposition != sessioninbox.DispositionQueuedFollowup {
		t.Fatalf("disposition = %q, want it held as a follow-up", rec.Disposition)
	}
	snap := c.InboxSnapshot()
	if len(snap.Items) != 1 {
		t.Fatalf("queue = %+v, want the line still there", snap.Items)
	}
	item := snap.Items[0]
	if item.State != sessioninbox.StateQueued || item.Intent != sessioninbox.IntentFollowup {
		t.Fatalf("item = state %q intent %q, want a queued follow-up the dispatcher can take", item.State, item.Intent)
	}
	if snap.Paused {
		t.Fatalf("the queue was paused (%q) over one undelivered picture", snap.PauseCode)
	}

	// The fallback dispatches this line as a turn of its own, and this test's sink
	// answers TurnDone on a one-slot channel: draining is what keeps the turn from
	// blocking on a send nobody will read.
	drainInbox(t, c, prov, done)
}

// A picture sent mid-turn to a model that cannot read it still steers when a
// vision model is configured to read it on delegation: the words carry the
// same routing note a whole turn's input gets, so the turn hands the picture
// over instead of the line waiting out the turn as a follow-up nobody asked
// for.
func TestSteerCarryingAPictureDelegatesWhenTheModelCannotReadIt(t *testing.T) {
	c, _, prov, done, _ := steeringDelegatedTurn(t)

	rec, err := c.TryEnqueueAndSteer(InboxRequest{Submit: "look at @diagram.png before you continue", Source: "test"})
	if err != nil {
		t.Fatalf("steer with a picture: %v", err)
	}
	if rec.Disposition != sessioninbox.DispositionSteerAccepted {
		t.Fatalf("disposition = %q, want the steer accepted rather than held as a follow-up", rec.Disposition)
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
	got := applied[at].Content
	if !strings.Contains(got, sessionstore.MidTurnSteerPrefix) {
		t.Fatalf("the message is not marked as mid-turn guidance: %q", got)
	}
	if !strings.Contains(got, ImageRoutingTag) {
		t.Fatalf("the guidance does not tell the model where its picture goes: %q", got)
	}
	if !strings.Contains(got, "vision-pro") {
		t.Fatalf("the routing note does not name the configured vision model: %q", got)
	}
}

// steeringDelegatedTurn is steeringPictureTurn for a model that cannot read
// pictures while a vision model is configured to read them on delegation.
func steeringDelegatedTurn(t *testing.T) (*Controller, *sessionstore.Session, *inboxSteerProvider, chan event.Event, string) {
	t.Helper()
	dir := testenv.TempDir(t)
	workspace := filepath.Join(dir, "workspace")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	writeDelegatingVisionTestConfig(t, workspace)
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
		ModelRef:      "custom/text-only",
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

// writeDelegatingVisionTestConfig is writeVisionTestConfig plus a configured
// vision_model, so a text-only turn's pictures have a configured reader.
func writeDelegatingVisionTestConfig(t *testing.T, root string) {
	t.Helper()
	cfg := config.Default()
	cfg.DefaultModel = "custom/vision-pro"
	cfg.Agent.VisionModel = "custom/vision-pro"
	cfg.Providers = []config.ProviderEntry{{
		Name:         "custom",
		Kind:         "openai",
		BaseURL:      "https://example.invalid/v1",
		Models:       []string{"text-only", "vision-pro"},
		VisionModels: []string{"vision-pro"},
	}}
	if err := cfg.SaveTo(filepath.Join(root, "reasonix.toml")); err != nil {
		t.Fatalf("save config: %v", err)
	}
	approveWorkspace(t, root)
}

// drainInbox runs the queue to empty so a test's one-slot TurnDone channel does
// not block the turn it started.
func drainInbox(t *testing.T, c *Controller, prov *inboxSteerProvider, done chan event.Event) {
	t.Helper()
	prov.unblock()
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case <-done:
		default:
		}
		snap := c.InboxSnapshot()
		if len(snap.Items) == 0 && !c.Running() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the inbox never drained")
}
