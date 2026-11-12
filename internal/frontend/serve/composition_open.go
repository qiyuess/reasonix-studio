package serve

import (
	"errors"
	"net/http"
	"path/filepath"

	"reasonix/internal/contract/agentcomposition"
	"reasonix/internal/state/sessionstore"
	"reasonix/internal/state/store"
)

// loadedSession is a transcript already read from disk, together with the stamp
// of the bytes it came from.
//
// Opening a session reads it once to learn which agent composition it was
// written under, then assembles a runtime for that composition, then binds the
// transcript to the runtime — and the middle step can take seconds on a cold
// machine. Reading the whole log a second time afterwards doubles that wait for
// nothing, as long as the file has not moved underneath us. The stamp is what
// makes the second read skippable without guessing.
type loadedSession struct {
	path    string
	stamp   sessionstore.SessionContentStamp
	session *sessionstore.Session
}

// reusableFor reports whether this load still describes path's bytes on disk.
// A different file, or any append/rewrite/compaction since, answers false and
// the caller reads the log again.
func (l *loadedSession) reusableFor(path string) bool {
	if l == nil || l.session == nil {
		return false
	}
	if filepath.Clean(l.path) != filepath.Clean(path) {
		return false
	}
	return l.stamp == sessionstore.SessionContentStampOf(path)
}

func loadOpenComposition(root, path string) (*loadedSession, error) {
	if !store.IsSessionTranscriptName(filepath.Base(path)) {
		return nil, refusal(http.StatusBadRequest, codeSessionBadPath, errors.New("invalid session path"), nil)
	}
	realPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		status, refused := pathUnresolved(err)
		return nil, keepRefusalStatus(status, refused)
	}
	realDir, err := filepath.EvalSymlinks(SessionDirFor(root))
	if err != nil {
		status, refused := pathUnresolved(err)
		return nil, keepRefusalStatus(status, refused)
	}
	rel, err := filepath.Rel(realDir, realPath)
	if err != nil || !filepath.IsLocal(rel) {
		return nil, refusal(http.StatusForbidden, codeSessionOutside, errors.New("path outside session dir"), nil)
	}
	realPath = filepath.Join(realDir, rel)
	if err := sessionstore.PrepareSessionPath(realPath); err != nil {
		return nil, err
	}
	owned, err := loadOwnedSession(realPath)
	if err != nil {
		return nil, err
	}
	return owned, nil
}

// loadOwnedSession reads a transcript and records what it read, so the open path
// can hand it to the binding step instead of paying for a second full read.
func loadOwnedSession(realPath string) (*loadedSession, error) {
	stamp := sessionstore.SessionContentStampOf(realPath)
	loaded, err := sessionstore.LoadSession(realPath)
	if err != nil {
		return nil, err
	}
	return &loadedSession{path: realPath, stamp: stamp, session: loaded}, nil
}

// bindingOf is the composition a loaded transcript was written under.
func (l *loadedSession) bindingOf() *agentcomposition.Binding {
	if l == nil {
		return nil
	}
	return l.session.Composition()
}
