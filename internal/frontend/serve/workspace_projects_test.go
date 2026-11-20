package serve

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/config"
	"reasonix/internal/session/control"
	"reasonix/internal/state/sessionstore"
)

// The pill's 不使用项目 answer carries no path at all, so a kernel that only
// resolves paths answers 400. It lands in the app's own folder instead.
func TestTheWorkspaceSwitchCanAskForTheAppsOwnFolder(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	old := control.New(control.Options{})
	defer old.Close()
	replacement := control.New(control.Options{})
	defer replacement.Close()
	var got string

	s := New(old, NewBroadcaster(), config.ServeConfig{})
	s.AllowWorkspaceSwitch()
	s.buildWorkspaceController = func(_ context.Context, dir, _ string) (*control.Controller, error) {
		got = dir
		return replacement, nil
	}
	srv := httptest.NewServer(operatorHandler(s))
	defer srv.Close()

	resp := postJSON(t, srv.URL+"/workspace", map[string]bool{"auto": true})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /workspace {auto} = %d, want 200", resp.StatusCode)
	}
	auto := config.AutoWorkspaceDir()
	if auto == "" {
		t.Fatal("this environment names no folder for the app itself")
	}
	if got != auto {
		t.Errorf("built at %q, want the app's own folder %q", got, auto)
	}
	if st, err := os.Stat(auto); err != nil || !st.IsDir() {
		t.Errorf("the app's own folder was not made: %v", err)
	}
}

// A worktree and the app's own folder are two different answers to where a
// conversation lives. Answering both would cut a worktree and then walk away
// from it, leaving it on disk with nothing pointing at it.
func TestAskingForTheAppsOwnFolderRefusesAWorktree(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	ctrl := control.New(control.Options{})
	defer ctrl.Close()
	s := New(ctrl, NewBroadcaster(), config.ServeConfig{})
	s.AllowWorkspaceSwitch()
	s.buildWorkspaceController = func(context.Context, string, string) (*control.Controller, error) {
		t.Fatal("a build was attempted for a contradictory request")
		return nil, nil
	}
	srv := httptest.NewServer(operatorHandler(s))
	defer srv.Close()

	resp := postJSON(t, srv.URL+"/workspace", map[string]any{"auto": true, "isolate": true})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("POST /workspace {auto,isolate} = %d, want 400", resp.StatusCode)
	}
}

// A blank project is an empty folder inside the one the picker returned, never
// a rename of that folder: the name is made and then remembered.
func TestANamedAddCreatesTheFolderAndRemembersIt(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	parent := testenv.TempDir(t)
	h := NewHub(HubOptions{})
	hubRuntime(t, h, parent)
	srv := httptest.NewServer(operatorHandler(h))
	defer srv.Close()

	resp := postJSON(t, srv.URL+"/tree/workspaces", map[string]string{"path": parent, "name": "blank"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /tree/workspaces = %d, want 200", resp.StatusCode)
	}
	created := filepath.Join(parent, "blank")
	if st, err := os.Stat(created); err != nil || !st.IsDir() {
		t.Fatalf("the named folder was not made: %v", err)
	}
	if got := Workspaces(); len(got) != 1 || got[0] != created {
		t.Fatalf("remembered %v, want just %q", got, created)
	}
}

// The name becomes a folder inside the parent, so anything that walks out of
// it is refused rather than joined.
func TestANamedAddRefusesANameThatIsAPath(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	parent := testenv.TempDir(t)
	h := NewHub(HubOptions{})
	hubRuntime(t, h, parent)
	srv := httptest.NewServer(operatorHandler(h))
	defer srv.Close()

	for _, name := range []string{"../escape", `a\b`, "a/b", ".", ".."} {
		resp := postJSON(t, srv.URL+"/tree/workspaces", map[string]string{"path": parent, "name": name})
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("name %q = %d, want 400", name, resp.StatusCode)
		}
	}
	if got := Workspaces(); len(got) != 0 {
		t.Fatalf("a refused name was remembered anyway: %v", got)
	}
}

// A pin is only worth recording if the tree says so, because the sidebar leads
// with what the tree marks.
func TestAPinnedProjectReadsPinnedInTheTree(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	root := testenv.TempDir(t)
	if err := addRememberedWorkspace(t.Context(), root); err != nil {
		t.Fatal(err)
	}
	h := NewHub(HubOptions{})
	hubRuntime(t, h, root)
	srv := httptest.NewServer(operatorHandler(h))
	defer srv.Close()

	if treeFor(t, srv, "").Pinned {
		t.Fatal("a project nobody pinned already reads pinned")
	}
	pin := func(on bool) {
		t.Helper()
		resp := postJSON(t, srv.URL+"/tree/workspaces/pin", map[string]any{"path": root, "pinned": on})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("POST /tree/workspaces/pin {pinned:%v} = %d, want 200", on, resp.StatusCode)
		}
	}
	pin(true)
	if !treeFor(t, srv, "").Pinned {
		t.Fatal("the pinned project does not read pinned in the tree")
	}
	pin(false)
	if treeFor(t, srv, "").Pinned {
		t.Fatal("unpinning left the project pinned")
	}
}

// A rename changes what the row is called and nothing on disk, so the folder
// keeps both its path and its files.
func TestARenamedProjectReadsByItsNewNameInTheTree(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	root := testenv.TempDir(t)
	if err := addRememberedWorkspace(t.Context(), root); err != nil {
		t.Fatal(err)
	}
	h := NewHub(HubOptions{})
	hubRuntime(t, h, root)
	srv := httptest.NewServer(operatorHandler(h))
	defer srv.Close()

	resp := postJSON(t, srv.URL+"/tree/workspaces/display-name", map[string]string{"path": root, "name": "我的项目"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /tree/workspaces/display-name = %d, want 200", resp.StatusCode)
	}
	ws := treeFor(t, srv, "")
	if ws.DisplayName != "我的项目" {
		t.Fatalf("displayName = %q, want 我的项目", ws.DisplayName)
	}
	if ws.Name != filepath.Base(root) {
		t.Fatalf("the folder's own name changed to %q", ws.Name)
	}
	if st, err := os.Stat(root); err != nil || !st.IsDir() {
		t.Fatalf("renaming touched the folder: %v", err)
	}
}

// A drag names a place rather than a step, which is what makes it land where
// the pointer let go.
func TestPlacingASessionBeforeARowPutsItThere(t *testing.T) {
	list := []sessionstore.SessionInfo{info("a", 9, 0), info("b", 8, 0), info("c", 7, 0)}
	sortSessions(list)

	got, ok := rankUpdatesForPlace(list, "c", "a")
	if !ok {
		t.Fatal("placing c before a is a move")
	}
	for i := range list {
		if rank, changed := got[list[i].Path]; changed {
			list[i].ManualRank = rank
		}
	}
	sortSessions(list)
	if p := fmt.Sprint(paths(list)); p != "[c a b]" {
		t.Fatalf("after placing c before a the order is %v, want [c a b]", p)
	}
}

// An empty before means the end of the partition, the way dropping below the
// last row does.
func TestPlacingASessionWithNoTargetPutsItLast(t *testing.T) {
	list := []sessionstore.SessionInfo{info("a", 9, 0), info("b", 8, 0), info("c", 7, 0)}
	sortSessions(list)

	got, ok := rankUpdatesForPlace(list, "a", "")
	if !ok {
		t.Fatal("placing a at the end is a move")
	}
	for i := range list {
		if rank, changed := got[list[i].Path]; changed {
			list[i].ManualRank = rank
		}
	}
	sortSessions(list)
	if p := fmt.Sprint(paths(list)); p != "[b c a]" {
		t.Fatalf("after placing a last the order is %v, want [b c a]", p)
	}
}

func TestPlacingASessionOnItselfOrAnUnknownRowChangesNothing(t *testing.T) {
	list := []sessionstore.SessionInfo{info("a", 9, 0), info("b", 8, 0)}
	sortSessions(list)
	if _, ok := rankUpdatesForPlace(list, "a", "a"); ok {
		t.Fatal("dropping a row onto itself is not a move")
	}
	if _, ok := rankUpdatesForPlace(list, "a", "nope"); ok {
		t.Fatal("an unknown target has no place to drop onto")
	}
	if _, ok := rankUpdatesForPlace(list, "nope", "a"); ok {
		t.Fatal("an unknown row has no place to move from")
	}
}
