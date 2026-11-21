package serve

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"reasonix/internal/contract/config"
	"reasonix/internal/state/workspacelist"
)

type workspaceList = workspacelist.List

var errWorkspaceNotRemembered = errors.New("workspace is not remembered")
var errWorkspaceListFull = errors.New("the project list is at the limit you set (desktop.max_workspaces); remove one before adding another")

// workspaceListFull says whether the user's own limit leaves no room for another
// project. No limit is set unless their file sets one.
func workspaceListFull(n int) bool {
	limit := config.LoadForEdit(config.UserConfigPath()).WorkspaceLimit()
	return limit > 0 && n >= limit
}

func workspacesPath() string {
	if dir := config.MemoryUserDir(); dir != "" {
		return filepath.Join(dir, workspacelist.FileName)
	}
	return ""
}

// Workspaces is the sidebar's remembered project order.
func Workspaces() []string {
	list, _ := readWorkspaceList(workspacesPath())
	return list.Paths
}

// LaunchWorkspaces puts the launch project first without changing sidebar order.
func LaunchWorkspaces() []string {
	list, _ := readWorkspaceList(workspacesPath())
	if list.Launch == "" {
		return list.Paths
	}
	paths := []string{list.Launch}
	for _, dir := range list.Paths {
		if dir != list.Launch {
			paths = append(paths, dir)
		}
	}
	return paths
}

func readWorkspaceList(path string) (workspaceList, error) { return workspacelist.Read(path) }

// workspaceNames are the display names projects read by in the sidebar, keyed by
// project identity so a folder spelled two ways still finds the name it was
// given — the write side normalizes, so the read side must too.
func workspaceNames() map[string]string {
	list, _ := readWorkspaceList(workspacesPath())
	out := map[string]string{}
	for dir, name := range list.Names {
		if id := projectIdentity(dir); id != "" {
			out[id] = name
		}
	}
	return out
}

// workspacePinned is the set of projects that lead the list, keyed by identity
// so a folder spelled two ways still reads as the one that was pinned.
func workspacePinned() map[string]bool {
	list, _ := readWorkspaceList(workspacesPath())
	out := map[string]bool{}
	for _, dir := range list.Pinned {
		if id := projectIdentity(dir); id != "" {
			out[id] = true
		}
	}
	return out
}

// storedWorkspacePath names the path exactly as the list carries it, so a
// metadata write lands on the entry the sidebar reads.
func storedWorkspacePath(list workspaceList, dir string) string {
	for _, stored := range list.Paths {
		if strings.EqualFold(strings.TrimSpace(stored), strings.TrimSpace(dir)) {
			return stored
		}
	}
	return dir
}

// workspaceMetaPath resolves the folder a metadata write names — a rename or a
// pin changes the list, not the disk. Stat'ing it here would refuse both for a
// project the person can still see in the tree as missing, which is exactly
// when removing or renaming it matters.
func workspaceMetaPath(raw string) (string, error) {
	dir := strings.TrimSpace(raw)
	if dir == "" {
		return "", fmt.Errorf("missing path")
	}
	return filepath.Abs(dir)
}

func updateWorkspaceList(ctx context.Context, repair bool, mutate func(*workspaceList) error) error {
	return workspacelist.Update(ctx, workspacesPath(), repair, mutate)
}

// isAutoWorkspace says whether dir is the folder the app opens when nobody chose
// one. It is where such a launch lands, not a project, so no list holds it.
func isAutoWorkspace(dir string) bool {
	auto := config.AutoWorkspaceDir()
	return auto != "" && projectIdentity(dir) == projectIdentity(auto)
}

// ensureAutoWorkspace makes the app's own folder on demand and returns it, or ""
// when the state root will not take it. A new session with no project behind it
// opens there instead of being refused.
func ensureAutoWorkspace() string {
	auto := config.AutoWorkspaceDir()
	if auto == "" || os.MkdirAll(auto, 0o755) != nil {
		return ""
	}
	return auto
}

func rememberWorkspace(dir string) {
	if err := addRememberedWorkspace(context.Background(), dir); err != nil {
		slog.Warn("serve: remember workspace", "err", err)
	}
}

// addRememberedWorkspace remembers a folder, and the name the sidebar reads it
// by when one is given. Both go into one list write, so a project does not
// appear under its folder name and get renamed a moment later.
func addRememberedWorkspace(ctx context.Context, dir string, displayName ...string) error {
	if dir == "" || isAutoWorkspace(dir) {
		return nil
	}
	name := ""
	if len(displayName) > 0 {
		name = strings.TrimSpace(displayName[0])
	}
	return updateWorkspaceList(ctx, true, func(list *workspaceList) error {
		// The name is the answer to "what does this project read as". A folder
		// that is already listed has one — set when it was added, or renamed
		// later — and re-adding it is not a request to change that.
		fresh := !slices.Contains(list.Paths, dir)
		if fresh {
			if workspaceListFull(len(rememberedProjects(list.Paths))) && !hasWorkspaceProject(list.Paths, dir) {
				return refusal(http.StatusConflict, "workspace.limit_reached", errWorkspaceListFull, nil)
			}
			identity := projectIdentity(dir)
			at := slices.IndexFunc(list.Paths, func(path string) bool { return projectIdentity(path) == identity })
			if at < 0 {
				list.Paths = append([]string{dir}, list.Paths...)
			} else {
				list.Paths = slices.Insert(list.Paths, at+1, dir)
			}
			list.Launch = dir
		}
		if fresh && name != "" {
			list.SetName(storedWorkspacePath(*list, dir), name)
		}
		return nil
	})
}

// keepUsedWorkspace lists a folder a conversation now lives in, behind the ones
// already there so neither the order nor the launch project moves. A pane
// adopted at launch is no folder anyone picked, and its conversations are
// reachable only through a row for it.
func keepUsedWorkspace(dir string) {
	if dir == "" || isAutoWorkspace(dir) {
		return
	}
	err := updateWorkspaceList(context.Background(), true, func(list *workspaceList) error {
		if slices.Contains(list.Paths, dir) || (workspaceListFull(len(rememberedProjects(list.Paths))) && !hasWorkspaceProject(list.Paths, dir)) {
			return nil
		}
		list.Paths = append(list.Paths, dir)
		return nil
	})
	if err != nil {
		slog.Warn("serve: list the folder a conversation lives in", "err", err)
	}
}

func forgetWorkspace(dir string) {
	if dir == "" {
		return
	}
	err := updateWorkspaceList(context.Background(), true, func(list *workspaceList) error {
		root := projectIdentity(dir)
		list.Paths = slices.DeleteFunc(list.Paths, func(path string) bool { return projectIdentity(path) == root })
		if projectIdentity(list.Launch) == root {
			list.Launch = ""
			if len(list.Paths) > 0 {
				list.Launch = list.Paths[0]
			}
		}
		return nil
	})
	if err != nil {
		slog.Warn("serve: forget workspace", "err", err)
	}
}

func moveWorkspace(ctx context.Context, dir string, direction int) error {
	return updateWorkspaceList(ctx, false, func(list *workspaceList) error {
		roots := workspaceProjectOrder(list.Paths)
		at := slices.Index(roots, projectIdentity(dir))
		if at < 0 {
			return errWorkspaceNotRemembered
		}
		to := at + direction
		if to >= 0 && to < len(roots) {
			roots[at], roots[to] = roots[to], roots[at]
			list.Paths = orderWorkspaceMembers(list.Paths, roots)
		}
		return nil
	})
}

// placeWorkspace drops dir where a drag left it: before the remembered project
// named by before, or at the end when before is empty. The launch project stays.
func placeWorkspace(ctx context.Context, dir, before string) error {
	return updateWorkspaceList(ctx, false, func(list *workspaceList) error {
		roots := workspaceProjectOrder(list.Paths)
		dir = projectIdentity(dir)
		if before != "" {
			before = projectIdentity(before)
		}
		if !slices.Contains(roots, dir) {
			return errWorkspaceNotRemembered
		}
		if before != "" && !slices.Contains(roots, before) {
			return errWorkspaceNotRemembered
		}
		if dir == before {
			return nil
		}
		rest := slices.DeleteFunc(roots, func(path string) bool { return path == dir })
		at := len(rest)
		if before != "" {
			at = slices.Index(rest, before)
		}
		list.Paths = orderWorkspaceMembers(list.Paths, slices.Insert(rest, at, dir))
		return nil
	})
}
