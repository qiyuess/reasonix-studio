package workspacefile

import (
	"context"
	"io/fs"
	"path"
	"path/filepath"
	"strings"
)

// skipScanDir names the folders a suffix search never enters, matched
// case-insensitively: Windows lets a folder be spelled Node_Modules, and a walk
// that does not skip it pays for the whole dependency tree. Build output is
// absent on purpose — `target/release/app.exe` is what this search exists for —
// and size is bounded by the entry budget instead.
var skipScanDir = map[string]bool{
	".git": true, ".hg": true, ".svn": true, "node_modules": true, "vendor": true,
	".venv": true, "venv": true, "__pycache__": true, ".mypy_cache": true,
	".cache": true, ".gradle": true, ".nuxt": true, ".turbo": true, ".parcel-cache": true,
	".idea": true, ".vs": true,
}

// scanBudget bounds one suffix search. A conversation can name a path that is
// simply not there, and answering "no" must not cost a walk of the whole tree;
// a caller that hits the ceiling gets ErrTooBroad rather than a slow answer.
// maxScanEntries is a variable so a test can lower it instead of building a tree
// large enough to exhaust the real budget.
var maxScanEntries = 20000

const maxScanDepth = 24

// ErrTooBroad reports that the search stopped at its budget without deciding.
// It is a refusal to answer rather than a "not found": the file may well be
// there, past the part that was read.
var ErrTooBroad = errTooBroad{}

type errTooBroad struct{}

func (errTooBroad) Error() string {
	return "the workspace is too large to search for that path; spell more of it"
}

func skipScanDirName(name string) bool {
	return skipScanDir[strings.ToLower(name)]
}

// Suffix locates a path written by something whose working directory is not the
// workspace root: `cd crate && cargo build` reports `target/release/app.exe`,
// though the file sits under `crate/` from the workspace. Only an unambiguous
// answer is returned — two files ending the same way is a question for the
// person, not a coin toss.
func (s Service) Suffix(ctx context.Context, written string) (Ref, error) {
	tail := path.Clean(strings.ReplaceAll(strings.TrimSpace(written), `\`, "/"))
	if tail == "" || tail == "." || tail == ".." || path.IsAbs(tail) || strings.HasPrefix(tail, "../") {
		return Ref{}, ErrMissing
	}
	// A Windows absolute path survives path.IsAbs (`C:/x` is not rooted for
	// slash-paths), so ask the platform too: this answers "where does that tail
	// live", not "open this file".
	if filepath.IsAbs(filepath.FromSlash(tail)) || filepath.VolumeName(filepath.FromSlash(tail)) != "" {
		return Ref{}, ErrMissing
	}
	// The spelling is usually right, so an exact answer costs one stat and no
	// walk. That matters because a caller asks before opening every path a
	// conversation names, not only the ones that failed.
	if ref, err := s.Resolve(filepath.FromSlash(tail)); err == nil {
		if _, infoErr := s.Info(ctx, ref); infoErr == nil {
			return ref, nil
		}
	}
	var found Ref
	// One root granted twice — the primary also listed among the extra readable
	// folders, or the same folder granted again — is one root. Walking it twice
	// would count a unique file twice and call it ambiguous.
	seen := map[string]bool{}
	bases := append([]string{s.Primary}, s.Extra...)
	for _, base := range bases {
		if err := ctx.Err(); err != nil {
			return Ref{}, err
		}
		key := strings.ToLower(filepath.Clean(base))
		if seen[key] {
			continue
		}
		seen[key] = true
		matched, err := matchSuffix(ctx, base, tail)
		if err != nil {
			return Ref{}, err
		}
		for _, rel := range matched {
			if found.Path != "" {
				return Ref{}, ErrAmbiguous
			}
			found = Ref{Path: rel}
			if !sameRoot(base, s.Primary) {
				found.Root = base
			}
		}
	}
	if found.Path == "" {
		return Ref{}, ErrMissing
	}
	return found, nil
}

// sameRoot reports whether two spellings name the same directory.
func sameRoot(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

// matchSuffix walks one root for up to two files whose path ends with the given
// tail on a separator boundary. Two is all the caller needs to refuse an
// ambiguous answer; a root it cannot open contributes nothing. The walk stops at
// the budget or when ctx is cancelled, and says which of the two stopped it.
func matchSuffix(ctx context.Context, base, tail string) ([]string, error) {
	var out []string
	entries := 0
	overBudget := false
	err := filepath.WalkDir(base, func(at string, entry fs.DirEntry, walkErr error) error {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		if walkErr != nil {
			if at != base && entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if at == base {
			return nil
		}
		if entries++; entries > maxScanEntries {
			overBudget = true
			return filepath.SkipAll
		}
		if entry.IsDir() {
			if skipScanDirName(entry.Name()) {
				return filepath.SkipDir
			}
			if rel, relErr := filepath.Rel(base, at); relErr == nil && strings.Count(filepath.ToSlash(rel), "/") >= maxScanDepth {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		rel, relErr := filepath.Rel(base, at)
		if relErr != nil || !filepath.IsLocal(rel) {
			return nil
		}
		if rel = filepath.ToSlash(rel); rel == tail || strings.HasSuffix(rel, "/"+tail) {
			out = append(out, rel)
			if len(out) > 1 {
				return filepath.SkipAll
			}
		}
		return nil
	})
	if ctxErr := ctx.Err(); ctxErr != nil {
		return nil, ctxErr
	}
	if err != nil {
		// A root that cannot be read contributes nothing; only the budget is an
		// answer about the workspace rather than about this directory.
		if overBudget {
			return nil, ErrTooBroad
		}
		return out, nil
	}
	if overBudget && len(out) == 0 {
		return nil, ErrTooBroad
	}
	return out, nil
}
