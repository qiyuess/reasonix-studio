package serve

import (
	"strings"

	"reasonix/internal/state/sessionstore"
)

// openSessionsIn is openSessions for the panes drivesRoot accepts: the ones
// unlistedOpenSessions will give a row of their own under root.
func (h *Hub) openSessionsIn(root string) map[string]string {
	out := map[string]string{}
	for _, rt := range h.localRuntimes() {
		if !drivesRoot(rt, root) {
			continue
		}
		if path := sessionstore.CanonicalSessionPath(rt.Server.Controller().SessionPath()); path != "" {
			out[path] = rt.ID
		}
	}
	return out
}

func (h *Hub) openSessions() map[string]string {
	out := map[string]string{}
	for _, rt := range h.localRuntimes() {
		if path := sessionstore.CanonicalSessionPath(rt.Server.Controller().SessionPath()); path != "" {
			out[path] = rt.ID
		}
	}
	return out
}

func (h *Hub) rootPanes(root string) int {
	n := 0
	for _, rt := range h.localRuntimes() {
		if sameFolder(rt.Server.Controller().WorkspaceRoot(), root) {
			n++
		}
	}
	return n
}

// titleCacheFor keeps one reader per project directory. Titles are file-name
// keyed and unique only within a project, so the caches must not be shared.
func (h *Hub) titleCacheFor(dir string) *titleCache {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.titles == nil {
		h.titles = map[string]*titleCache{}
	}
	if c := h.titles[dir]; c != nil {
		return c
	}
	c := newTitleCache(dir)
	h.titles[dir] = c
	return c
}

// workspaceRootForSession recovers which folder a transcript belongs to from
// its own sidecar, for an open request that names a session but no root.
func workspaceRootForSession(path string) string {
	meta, ok, err := sessionstore.LoadBranchMeta(strings.TrimSpace(path))
	if err != nil || !ok {
		return ""
	}
	return strings.TrimSpace(meta.WorkspaceRoot)
}

// decorateArchiveState reads the two marks the listing does not carry; the
// tree is bounded per workspace, so this is a handful of sidecar reads.
func decorateArchiveState(row *treeSession, path string) {
	m, ok, err := sessionstore.LoadBranchMeta(path)
	if err != nil || !ok {
		return
	}
	row.Pinned = m.Pinned
	if !m.AutoArchivedAt.IsZero() {
		row.AutoArchivedAt = m.AutoArchivedAt.UnixMilli()
	}
}
