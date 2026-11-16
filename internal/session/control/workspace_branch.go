package control

import (
	"context"
	"errors"
	"fmt"
	"time"

	"reasonix/internal/contract/config"
	"reasonix/internal/platform/gitcmd"
	"reasonix/internal/state/workspacelease"

	"reasonix/internal/platform/gitstatus"
)

var (
	// ErrWorkspaceBusy means a checkout or an external write claim prevents switching.
	ErrWorkspaceBusy = errors.New("control: workspace is busy")
	// ErrJobsRunning means unfinished background work still holds the workspace.
	ErrJobsRunning = errors.New("control: background jobs are running in the workspace")
)

const workspaceBranchLeaseWait = 150 * time.Millisecond

// SwitchWorkspaceBranch checks out another local branch while the workspace is
// idle. Panes share the admission guard, and the write lease honors existing
// cross-process write claims. It answers for the workspace's own repository;
// a workspace that is a folder of projects has none, and SwitchBranchIn names
// which repository inside it the branches belong to.
func (c *Controller) SwitchWorkspaceBranch(ctx context.Context, name string) (gitstatus.Info, bool, error) {
	return c.SwitchBranchIn(ctx, "", name)
}

// SwitchBranchIn checks out a local branch of the repository `dir` names — the
// folder below the workspace as GitRepos lists it, "" being the workspace's
// own repository. The guard, the lease and the summary all follow the named
// repository, because the tree that moves is that one.
func (c *Controller) SwitchBranchIn(ctx context.Context, dir, name string) (gitstatus.Info, bool, error) {
	repo, err := c.RepoFor(ctx, dir)
	if err != nil {
		return gitstatus.Info{}, false, err
	}
	c.commitMu.Lock()
	defer c.commitMu.Unlock()
	if err := c.workspaceActivityConflict(); err != nil {
		return gitstatus.Info{}, false, err
	}
	releaseLease, err := c.acquireRepoWriteLease(ctx, repo)
	if err != nil {
		return gitstatus.Info{}, false, err
	}
	defer releaseLease()
	releaseWorkspace, err := c.excludeWorkspaceActivity()
	if err != nil {
		return gitstatus.Info{}, false, err
	}
	defer releaseWorkspace()
	c.mu.Lock()
	busy := c.gate.busy()
	c.mu.Unlock()
	if busy {
		return gitstatus.Info{}, false, ErrTurnRunning
	}
	if err := gitstatus.SwitchBranch(ctx, repo, name); err != nil {
		return gitstatus.Info{}, false, err
	}
	info, ok := gitstatus.Summary(ctx, repo)
	return info, ok, nil
}

// Lease contention must not prevent other panes from admitting work.
func (c *Controller) acquireBranchWriteLease(ctx context.Context) (func(), error) {
	return c.acquireRepoWriteLease(ctx, c.WorkspaceRepo())
}

// acquireRepoWriteLease is the lease of the repository the write will move,
// which is not the workspace's own repository in a folder of projects.
func (c *Controller) acquireRepoWriteLease(ctx context.Context, repo gitcmd.Repo) (func(), error) {
	if !repo.Valid() {
		return func() {}, nil
	}
	lease, err := workspacelease.New(repo.WorkTree, config.WorkspaceLeaseDir(), nil)
	if err != nil {
		return nil, err
	}
	lease.BeginRun()
	leaseCtx, cancel := context.WithTimeout(ctx, workspaceBranchLeaseWait)
	defer cancel()
	if err := lease.AcquireWrite(leaseCtx); err != nil {
		lease.EndRun()
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, workspacelease.ErrConflict) {
			return nil, fmt.Errorf("%w: %w", ErrWorkspaceBusy, err)
		}
		return nil, err
	}
	return lease.EndRun, nil
}
