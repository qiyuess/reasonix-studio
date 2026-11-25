package serve

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"

	"reasonix/internal/state/sessionstore"
)

// archiveWorkspaceSessions archives or restores every conversation a project holds, in
// one request. Archiving is a property of conversations, not folders: a project reads as
// archived exactly when everything in it is. The sidebar presses this from the folder's
// row, but the rows it holds are only a page of what is on disk — so the reach is decided
// here, from the listing, rather than by the paths the window happened to load.
func (h *Hub) archiveWorkspaceSessions(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Root     string `json:"root"`
		Archived bool   `json:"archived"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		badBody(w)
		return
	}
	raw, err := filepath.Abs(strings.TrimSpace(body.Root))
	if err != nil {
		refuse(w, http.StatusBadRequest, codeSessionBadPath, "the project path could not be resolved", nil)
		return
	}
	project, ok := h.projectFor(raw)
	if !ok {
		refuse(w, http.StatusNotFound, codeWorkspaceUnknown, "this folder is not on the list", nil)
		return
	}
	// Every conversation of the project, across every root the row stands for:
	// a worktree and its source are one project in the sidebar.
	dirs := make([]string, 0, len(project.roots))
	for _, root := range project.roots {
		dir, err := filepath.Abs(SessionDirFor(root))
		if err != nil || !h.ownsSessionDir(dir) {
			continue
		}
		dirs = append(dirs, dir)
	}
	open := h.openSessions()
	blocked := make(map[string]bool, len(open))
	panes := make([]*Runtime, 0, len(open))
	targets := make([]string, 0)
	for _, dir := range dirs {
		for _, si := range h.listTreeSessions(dir, nil, false) {
			if si.Archived == body.Archived {
				continue
			}
			targets = append(targets, si.Path)
			// A conversation on screen is not archived behind the person's back:
			// an idle pane is closed first, a running one refuses the batch —
			// the same terms one conversation's archive is held to.
			if id := open[sessionstore.CanonicalSessionPath(si.Path)]; id != "" && !blocked[id] {
				blocked[id] = true
				panes = append(panes, h.panesWhere(func(rt *Runtime) bool { return rt.ID == id })...)
			}
		}
	}
	if len(targets) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !h.releaseOrRefuse(w, r, "session.running", "a conversation is running; stop it first", panes) {
		return
	}
	// Read the open set again: the panes just released no longer hold a file,
	// and whatever is still open must be left alone by the sweep.
	open = h.openSessions()
	excluded := make([]string, 0, len(open))
	for path := range open {
		excluded = append(excluded, path)
	}
	for _, path := range targets {
		if err := sessionstore.SetSessionLineageArchived(path, body.Archived, excluded...); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
	}
	h.treeChanged()
	w.WriteHeader(http.StatusNoContent)
}

// projectFor finds the project a folder belongs to: a worktree and its source
// are one row in the sidebar, so an action on that row reaches both.
func (h *Hub) projectFor(root string) (workspaceProject, bool) {
	want := projectIdentity(root)
	for _, p := range groupWorkspaces(h.roots()) {
		if projectIdentity(p.root) == want {
			return p, true
		}
	}
	return workspaceProject{}, false
}
