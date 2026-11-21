package workspacefile_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/base/workspacefile"
)

func write(t *testing.T, root, rel string) {
	t.Helper()
	at := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(at), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(at, []byte(rel), 0o644); err != nil {
		t.Fatal(err)
	}
}

func suffix(root, written string) (workspacefile.Ref, error) {
	return (workspacefile.Service{Primary: root}).Suffix(context.Background(), written)
}

func TestSuffixFindsAFileSpelledFromAnotherWorkingDirectory(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "crate/target/release/app.exe")
	ref, err := suffix(root, "target/release/app.exe")
	if err != nil {
		t.Fatalf("Suffix: %v", err)
	}
	if ref.Path != "crate/target/release/app.exe" || ref.Root != "" {
		t.Fatalf("Suffix = %+v, want the crate's path inside the workspace", ref)
	}
}

func TestSuffixTakesBackslashesAsTheModelWritesThem(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "crate/target/release/app.exe")
	ref, err := suffix(root, `target\release\app.exe`)
	if err != nil || ref.Path != "crate/target/release/app.exe" {
		t.Fatalf("Suffix(`target\\release\\app.exe`) = %+v, %v", ref, err)
	}
}

func TestSuffixFindsAFileUnderTheWorkspaceRootItself(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "app.exe")
	ref, err := suffix(root, "app.exe")
	if err != nil || ref.Path != "app.exe" {
		t.Fatalf("Suffix = %+v, %v", ref, err)
	}
}

func TestSuffixRefusesAnAmbiguousTail(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "a/release/app.exe")
	write(t, root, "b/release/app.exe")
	_, err := suffix(root, "release/app.exe")
	if !errors.Is(err, workspacefile.ErrAmbiguous) {
		t.Fatalf("Suffix = %v, want ErrAmbiguous", err)
	}
}

func TestSuffixKeepsAPathThatIsNotATail(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "x/release/app.exe")
	if _, err := suffix(root, "target/release/app.exe"); !errors.Is(err, workspacefile.ErrMissing) {
		t.Fatalf("a path that only shares the file name = %v, want ErrMissing", err)
	}
}

func TestSuffixNamesTheRootAFileWasFoundIn(t *testing.T) {
	primary, extra := testenv.TempDir(t), testenv.TempDir(t)
	write(t, extra, "shots/out.png")
	ref, err := (workspacefile.Service{Primary: primary, Extra: []string{extra}}).Suffix(context.Background(), "shots/out.png")
	if err != nil {
		t.Fatalf("Suffix: %v", err)
	}
	if ref.Path != "shots/out.png" || filepath.Clean(ref.Root) != filepath.Clean(extra) {
		t.Fatalf("Suffix = %+v, want the granted folder named", ref)
	}
}

func TestSuffixLeavesDependencyTreesOutOfTheWalk(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "node_modules/pkg/release/app.exe")
	write(t, root, "crate/release/app.exe")
	ref, err := suffix(root, "release/app.exe")
	if err != nil || ref.Path != "crate/release/app.exe" {
		t.Fatalf("Suffix = %+v, %v; want the crate's own file, not the dependency's", ref, err)
	}
}

// Windows lets a folder be spelled Node_Modules or Node_Modules; a walk that
// only skips the exact spelling pays for the whole dependency tree there.
func TestSuffixSkipsDependencyTreesHoweverTheyAreSpelled(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "Node_Modules/pkg/release/app.exe")
	write(t, root, "crate/release/app.exe")
	ref, err := suffix(root, "release/app.exe")
	if err != nil || ref.Path != "crate/release/app.exe" {
		t.Fatalf("Suffix = %+v, %v; want the crate's file, not the dependency's", ref, err)
	}
}

// Build output is not skipped: `target/release/app.exe` is the very path this
// search exists to find, so excluding target/ would answer "no such file" about
// the one spelling a conversation writes most often.
func TestSuffixFindsAFileInsideBuildOutput(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "crate/target/release/app.exe")
	ref, err := suffix(root, "target/release/app.exe")
	if err != nil {
		t.Fatalf("Suffix: %v", err)
	}
	if ref.Path != "crate/target/release/app.exe" {
		t.Fatalf("Suffix = %+v, want the file inside target/", ref)
	}
}

func TestSuffixRefusesToClimbOrEscape(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "app.exe")
	for _, written := range []string{"../app.exe", "/etc/passwd", "..", "", `C:\Windows\app.exe`, "C:/Windows/app.exe", `\\server\\share\\a.png`} {
		if _, err := suffix(root, written); !errors.Is(err, workspacefile.ErrMissing) {
			t.Errorf("Suffix(%q) = %v, want ErrMissing", written, err)
		}
	}
}

// A cancelled request must stop the walk rather than keep the CPU busy for a
// client that has already gone.
func TestSuffixStopsWhenTheRequestIsCancelled(t *testing.T) {
	root := testenv.TempDir(t)
	for i := range 40 {
		write(t, root, "d"+string(rune('a'+i%26))+"/f"+string(rune('a'+i/26))+".txt")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (workspacefile.Service{Primary: root}).Suffix(ctx, "no/such/file.txt"); !errors.Is(err, context.Canceled) {
		t.Fatalf("Suffix on a cancelled request = %v, want context.Canceled", err)
	}
}

// Two spellings of one root are one root: counting them twice would call a
// unique file ambiguous.
func TestSuffixDoesNotCallOneRootTwoRoots(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "shots/out.png")
	service := workspacefile.Service{Primary: root, Extra: []string{filepath.Clean(root) + string(filepath.Separator)}}
	ref, err := service.Suffix(context.Background(), "shots/out.png")
	if err != nil {
		t.Fatalf("Suffix with the same root granted twice = %v, want the file", err)
	}
	if ref.Path != "shots/out.png" {
		t.Fatalf("Suffix = %+v", ref)
	}
}
