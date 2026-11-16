package main

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"reasonix/internal/base/testenv"
)

// A build product is gitignored and regenerated, so its size is neither
// anyone's debt nor stable across machines. Measuring one once reported 4812
// lines of file-size debt and pushed the repo total past its ceiling, which
// made every unrelated run look dirty.
func TestGeneratedOutputIsNotCollected(t *testing.T) {
	root := testenv.TempDir(t)
	write := func(rel, body string) {
		t.Helper()
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("desktop/frontend/dist/models.js", "export class X {}\n")
	write("desktop/frontend/src/app.ts", "export const x = 1\n")
	write("internal/runtime/agent/agent.go", "package agent\n")

	got, err := collect(root)
	if err != nil {
		t.Fatalf("collect: %v", err)
	}
	for _, rel := range got {
		if filepath.ToSlash(rel) == "desktop/frontend/dist/models.js" {
			t.Fatalf("generated output was collected: %v", got)
		}
	}
	for _, want := range []string{"desktop/frontend/src/app.ts", "internal/runtime/agent/agent.go"} {
		if !slices.ContainsFunc(got, func(rel string) bool { return filepath.ToSlash(rel) == want }) {
			t.Errorf("%s was skipped; only generated output should be", want)
		}
	}
}

// mobile is the phone app, carried from an upstream this repository does not
// author. Its files are longer than this repo's ceilings by upstream's design,
// so measuring them would report debt no change here could pay — and would make
// every unrelated run look dirty.
func TestThePhoneAppIsNotCollected(t *testing.T) {
	root := testenv.TempDir(t)
	write := func(rel, body string) {
		t.Helper()
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("mobile/src/chat/ChatScreen.tsx", strings.Repeat("const a = 1\n", 900))
	write("mobile/README.md", "# phone app\n")
	write("desktop/frontend-next/src/app.ts", "export const x = 1\n")

	got, err := collect(root)
	if err != nil {
		t.Fatalf("collect: %v", err)
	}
	for _, rel := range got {
		if strings.HasPrefix(filepath.ToSlash(rel), "mobile/") {
			t.Fatalf("the phone app was collected: %v", got)
		}
	}
	if !slices.ContainsFunc(got, func(rel string) bool { return filepath.ToSlash(rel) == "desktop/frontend-next/src/app.ts" }) {
		t.Errorf("the desktop tree was skipped too: %v", got)
	}
}
