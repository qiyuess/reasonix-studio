package workspacefile

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"reasonix/internal/base/testenv"
)

// A conversation can name a path that is simply not there. Answering "no" must
// not cost a walk of an arbitrarily large tree, so the search stops at its
// budget and says so rather than guessing. The budget is lowered here instead of
// building a tree large enough to exhaust the real one — twenty thousand files
// per test is not a price this assertion is worth.
func TestSuffixStopsAtItsBudgetInsteadOfWalkingForever(t *testing.T) {
	root := testenv.TempDir(t)
	for i := range 60 {
		at := filepath.Join(root, "dir", "f"+string(rune('a'+i%26))+string(rune('a'+i/26))+".txt")
		if err := os.MkdirAll(filepath.Dir(at), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(at, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	was := maxScanEntries
	maxScanEntries = 10
	t.Cleanup(func() { maxScanEntries = was })

	_, err := (Service{Primary: root}).Suffix(context.Background(), "nothing/ends/this/way.txt")
	if !errors.Is(err, ErrTooBroad) {
		t.Fatalf("Suffix on a tree past the budget = %v, want ErrTooBroad", err)
	}
}

// A file found before the budget runs out is still answered: the ceiling is
// about how much work an unanswered search may cost, not a cap on what can be
// found.
func TestSuffixAnswersWhatItFoundBeforeTheBudget(t *testing.T) {
	root := testenv.TempDir(t)
	at := filepath.Join(root, "a", "release", "app.exe")
	if err := os.MkdirAll(filepath.Dir(at), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(at, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	was := maxScanEntries
	maxScanEntries = 5
	t.Cleanup(func() { maxScanEntries = was })

	ref, err := (Service{Primary: root}).Suffix(context.Background(), "release/app.exe")
	if err != nil {
		t.Fatalf("Suffix: %v", err)
	}
	if ref.Path != "a/release/app.exe" {
		t.Fatalf("Suffix = %+v", ref)
	}
}
