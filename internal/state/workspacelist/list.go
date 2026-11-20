package workspacelist

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"time"

	"reasonix/internal/base/filelock"
	"reasonix/internal/base/fileutil"
)

// FileName is where the list lives, at the top of the state root.
const FileName = "serve-workspaces.json"

// AdoptedSuffix marks a list that has been merged into the current one, so the
// merge happens once.
const AdoptedSuffix = ".adopted"

// List is the remembered project order and the project a launch opens first.
type List struct {
	Paths  []string `json:"paths"`
	Launch string   `json:"launch,omitempty"`
	// Names are the display names a project reads by in the sidebar: a folder
	// renamed there keeps its on-disk path and its files whole.
	Names map[string]string `json:"names,omitempty"`
	// Pinned are the projects that lead the list, in the order they pinned.
	Pinned []string `json:"pinned,omitempty"`
}

// SetName renames a project in the sidebar. An empty name clears it, so the
// folder reads by its own basename again.
func (l *List) SetName(path, name string) {
	path = strings.TrimSpace(path)
	if path == "" {
		return
	}
	name = strings.TrimSpace(name)
	if name == "" {
		delete(l.Names, path)
		return
	}
	if l.Names == nil {
		l.Names = map[string]string{}
	}
	l.Names[path] = name
}

// SetPinned records whether the project at path leads the list. Pinning twice
// is not two entries, and unpinning one that was never pinned is nothing.
func (l *List) SetPinned(path string, pinned bool) {
	path = strings.TrimSpace(path)
	if path == "" {
		return
	}
	at := slices.Index(l.Pinned, path)
	if pinned && at < 0 {
		l.Pinned = append(l.Pinned, path)
	}
	if !pinned && at >= 0 {
		l.Pinned = append(l.Pinned[:at], l.Pinned[at+1:]...)
	}
}

// Read parses the list at path. A missing file or empty path is an empty list.
func Read(path string) (List, error) {
	var list List
	if path == "" {
		return list, nil
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return list, nil
	}
	if err != nil {
		return list, err
	}
	data = bytes.TrimSpace(data)
	if len(data) > 0 && data[0] == '[' {
		err = json.Unmarshal(data, &list.Paths)
	} else {
		err = json.Unmarshal(data, &list)
	}
	if err != nil {
		return List{}, err
	}
	paths := make([]string, 0, len(list.Paths))
	for _, dir := range list.Paths {
		dir = strings.TrimSpace(dir)
		if dir != "" && !slices.Contains(paths, dir) {
			paths = append(paths, dir)
		}
	}
	list.Paths = paths
	if !slices.Contains(paths, list.Launch) {
		list.Launch = ""
		if len(paths) > 0 {
			list.Launch = paths[0]
		}
	}
	// Metadata about a project that is no longer listed is dead weight, and worse
	// than that: adding the same folder back would resurrect a name or a pin the
	// person never re-applied. A project is listed, or it is forgotten.
	for dir := range list.Names {
		if !slices.ContainsFunc(paths, func(have string) bool { return samePath(have, dir) }) {
			delete(list.Names, dir)
		}
	}
	list.Pinned = slices.DeleteFunc(list.Pinned, func(dir string) bool {
		return !slices.ContainsFunc(paths, func(have string) bool { return samePath(have, dir) })
	})
	return list, nil
}

// defaultLockWait bounds a caller that set no deadline of its own. A caller
// that did owns the bound: writers queue on one lock, so how long the last one
// may wait is a property of how many it expects, not of this package.
var defaultLockWait = 5 * time.Second

// Update applies mutate to the list under its lock and publishes the result
// atomically. With repair, a list that is not valid JSON is set aside as a
// backup and replaced rather than refusing every later write.
func Update(ctx context.Context, path string, repair bool, mutate func(*List) error) error {
	if path == "" {
		return errors.New("no workspace list directory")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if _, bounded := ctx.Deadline(); !bounded {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, defaultLockWait)
		defer cancel()
	}
	unlock, err := filelock.Acquire(ctx, path+".lock")
	if err != nil {
		return err
	}
	defer unlock()
	return updateLocked(path, repair, mutate)
}

func updateLocked(path string, repair bool, mutate func(*List) error) error {
	list, err := Read(path)
	if err != nil {
		var syntax *json.SyntaxError
		var shape *json.UnmarshalTypeError
		if !repair || (!errors.As(err, &syntax) && !errors.As(err, &shape)) {
			return err
		}
		if err := backup(path); err != nil {
			return err
		}
		list = List{}
	}
	if err := mutate(&list); err != nil {
		return err
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return fileutil.AtomicWriteFile(path, data, 0o644)
}

func backup(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".bak-*")
	if err != nil {
		return err
	}
	_, writeErr := f.Write(data)
	return errors.Join(writeErr, f.Close())
}

// MergeOnce appends the projects of the list at old that the list at current
// lacks, then renames old aside so it is merged exactly once: a project the
// user forgets afterwards is not brought back by the next run. Current keeps
// its order and its launch project. It returns how many projects were added.
func MergeOnce(ctx context.Context, current, old string) (int, error) {
	if current == "" || old == "" {
		return 0, nil
	}
	if _, err := os.Stat(old); err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	incoming, err := Read(old)
	if err != nil {
		return 0, fmt.Errorf("workspace list %s: %w", old, err)
	}
	added := 0
	err = Update(ctx, current, false, func(list *List) error {
		for _, dir := range incoming.Paths {
			if !slices.ContainsFunc(list.Paths, func(have string) bool { return samePath(have, dir) }) {
				list.Paths = append(list.Paths, dir)
				added++
			}
		}
		// The names and pins travel with their projects: a migration that keeps
		// the folders but drops what a person called them would undo the rename
		// silently. Incoming wins only where the current list has nothing.
		for dir, name := range incoming.Names {
			if slices.ContainsFunc(list.Paths, func(have string) bool { return samePath(have, dir) }) &&
				!hasName(list.Names, dir) {
				if list.Names == nil {
					list.Names = map[string]string{}
				}
				list.Names[dir] = name
			}
		}
		for _, dir := range incoming.Pinned {
			if slices.ContainsFunc(list.Paths, func(have string) bool { return samePath(have, dir) }) &&
				!slices.ContainsFunc(list.Pinned, func(have string) bool { return samePath(have, dir) }) {
				list.Pinned = append(list.Pinned, dir)
			}
		}
		if list.Launch == "" && len(list.Paths) > 0 {
			list.Launch = list.Paths[0]
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return added, fileutil.RenameAside(old, AdoptedSuffix)
}

// hasName says whether the list already carries a name for dir, spelled any way
// the platform treats as the same folder.
func hasName(names map[string]string, dir string) bool {
	for have := range names {
		if samePath(have, dir) {
			return true
		}
	}
	return false
}

func samePath(a, b string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}
