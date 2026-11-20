package boot

import (
	"testing"
	"time"

	"reasonix/internal/base/testenv"
)

// waitFor polls until ok holds, or fails the test naming what it was waiting
// for. Shared by the effect tests that watch something arrive asynchronously.
func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(testenv.Budget(t))
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
